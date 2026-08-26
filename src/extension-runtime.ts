import path from "node:path";
import type { ImageContent } from "./content.ts";
import {
	createImageMarkerLink,
	renderImageMarkerLinks,
	sanitizeModelMessages,
} from "./attachment-links.ts";
import { ImageGallery, type GalleryImage } from "./image-gallery.ts";
import { extractImagePaths } from "./image-paths.ts";
import { upgradeScreenshotToolResult } from "./tool-result-upgrader.ts";
import { debugLog } from "./debug.ts";

// ── Types ──────────────────────────────────────────────────

type TrackedImage = {
	filePath: string;
	placeholder: string;
	/** Full-resolution image attached to the submitted message. */
	image: ImageContent;
	/** Small PNG thumbnail used only for the inline gallery preview. */
	previewImage?: ImageContent;
	label: string;
};

export type ExtensionDeps = {
	readImageContentFromPathAsync: (
		filePath: string,
	) => Promise<ImageContent | null>;
	maybeResizeImage?: (image: ImageContent) => Promise<ImageContent>;
	loadImageContentFromPath: (
		filePath: string,
	) => Promise<ImageContent | null>;
	/** Downscale the full-size attachment below the provider's per-image byte
	 * limit before it is submitted. Absent means submit the image unchanged. */
	resizeForSubmission?: (image: ImageContent) => Promise<ImageContent>;
	storeImage?: (image: ImageContent) => Promise<string | undefined>;
	resolveImageReference?: (reference: string) => string | undefined;
};

type PiLike = {
	on(event: string, handler: (...args: any[]) => any): void;
	registerMarkdownTransformer?: (
		transformer: (markdown: string, context: { messageType: string }) => string,
	) => void;
};

type CtxLike = {
	cwd: string;
	isIdle(): boolean;
	sessionManager?: { getSessionDir(): string };
	ui: {
		setWidget(
			key: string,
			content:
				| string[]
				| ((tui: any, theme: any) => any)
				| undefined,
			options?: { placement?: "aboveEditor" | "belowEditor" },
		): void;
		getEditorText(): string;
		setEditorText(text: string): void;
		theme: any;
	};
};

/** Event shape for the "input" event from pi. */
type InputEvent = {
	text: string;
	images?: ImageContent[];
};

/** Discriminated union for input handler return values. */
type InputResult =
	| { action: "continue" }
	| { action: "handled" }
	| { action: "transform"; text: string; images: ImageContent[] };

/** Re-export for tool_result event typing. */
type ToolResultEvent = import("./tool-result-upgrader.ts").ToolResultEventLike;

// ── Constants ──────────────────────────────────────────────

const WIDGET_KEY = "image-view";
const POLL_INTERVAL_MS = 250;
const IMAGE_PLACEHOLDER_RE = /\[Image #\d+\]/g;

function placeholdersIn(text: string): Set<string> {
	return new Set(text.match(IMAGE_PLACEHOLDER_RE) ?? []);
}

/** Produce a label from an image path — just the filename. */
function trimImageLabel(filePath: string): string {
	return path.basename(filePath);
}

// ── Extension ──────────────────────────────────────────────

export function registerImagePreviewExtension(
	pi: PiLike,
	deps: ExtensionDeps,
): void {
	if (pi.registerMarkdownTransformer && deps.resolveImageReference) {
		pi.registerMarkdownTransformer((markdown, context) =>
			context.messageType === "user"
				? renderImageMarkerLinks(markdown, deps.resolveImageReference!)
				: markdown,
		);
	}

	pi.on("context", (event: { messages: Array<{ content?: unknown }> }) => ({
		messages: sanitizeModelMessages(event.messages),
	}));

	let tracked: Map<string, TrackedImage> = new Map();
	let gallery: ImageGallery | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let latestCtx: CtxLike | null = null;
	let nextPlaceholderNumber = 1;
	let scanInFlight = false;

	// ── Helpers ────────────────────────────────────────────

	function refreshWidget(ctx: CtxLike): void {
		if (tracked.size === 0) {
			if (gallery) {
				gallery.dispose();
				gallery = null;
			}
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}

		const galleryImages: GalleryImage[] = [...tracked.values()].map((t) => {
			const preview = t.previewImage ?? t.image;
			return {
				data: preview.data,
				mimeType: preview.mimeType,
				label: t.label,
			};
		});

		// Dispose the previous gallery to free kitty image resources before replacement
		if (gallery) {
			gallery.dispose();
			gallery = null;
		}

		ctx.ui.setWidget(
			WIDGET_KEY,
			(_tui: any, theme: any) => {
				const galleryTheme = {
					accent: (s: string) => theme.fg("accent", s),
					muted: (s: string) => theme.fg("muted", s),
					dim: (s: string) => theme.fg("dim", s),
					bold: (s: string) => theme.bold(s),
				};

				gallery = new ImageGallery(galleryTheme);
				gallery.setImages(galleryImages);
				return gallery;
			},
			{ placement: "aboveEditor" },
		);
	}

	function resetDraft(ctx: CtxLike): void {
		if (gallery) {
			gallery.dispose();
			gallery = null;
		}
		tracked = new Map();
		nextPlaceholderNumber = 1;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	}

	/**
	 * Scan editor text for image paths.
	 * Track new ones, remove ones that are no longer in the text.
	 * Async to avoid blocking the event loop with file I/O.
	 */
	async function scanEditorText(ctx: CtxLike): Promise<void> {
		if (scanInFlight) return;
		scanInFlight = true;
		try {
			let text: string;
			try {
				text = ctx.ui.getEditorText();
			} catch (err) {
				debugLog("Failed to get editor text", err);
				return;
			}

			const visiblePlaceholders = placeholdersIn(text);
			let changed = false;
			for (const placeholder of tracked.keys()) {
				if (!visiblePlaceholders.has(placeholder)) {
					tracked.delete(placeholder);
					changed = true;
				}
			}

			let renderedText = text;
			for (const { raw, path: filePath } of extractImagePaths(text)) {
				const image = await deps.readImageContentFromPathAsync(filePath);
				if (!image) continue;

				let placeholder: string;
				do {
					placeholder = `[Image #${nextPlaceholderNumber++}]`;
				} while (renderedText.includes(placeholder) || tracked.has(placeholder));

				const entry: TrackedImage = {
					filePath,
					placeholder,
					image,
					label: trimImageLabel(filePath),
				};
				tracked.set(placeholder, entry);
				renderedText = renderedText.replace(raw, placeholder);
				changed = true;

				if (deps.maybeResizeImage) {
					void deps.maybeResizeImage(image).then((resized) => {
						if (tracked.get(placeholder) === entry) {
							entry.previewImage = resized;
							if (latestCtx) refreshWidget(latestCtx);
						}
					}).catch((err) => {
						debugLog(`Failed to resize image ${filePath}`, err);
					});
				}
			}

			if (renderedText !== text) ctx.ui.setEditorText(renderedText);
			if (changed) refreshWidget(ctx);
		} finally {
			scanInFlight = false;
		}
	}

	function startPolling(): void {
		stopPolling();
		pollTimer = setInterval(() => {
			if (!latestCtx) return;
			scanEditorText(latestCtx).catch((err) => {
				debugLog("Error during editor text scan", err);
			});
		}, POLL_INTERVAL_MS);
		// Don't let the poll timer keep the Node event loop alive.
		// In non-interactive modes (e.g. `pi --print`), the process must be
		// able to exit once work is done — an active interval would block exit.
		if (typeof pollTimer.unref === "function") {
			pollTimer.unref();
		}
	}

	function stopPolling(): void {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	// ── Event handlers ─────────────────────────────────────

	// Clean up resources when the process exits
	const cleanup = (): void => {
		stopPolling();
		if (gallery) {
			gallery.dispose();
			gallery = null;
		}
	};
	process.on("exit", cleanup);
	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);

	pi.on("session_start", async (_event: unknown, ctx: CtxLike) => {
		latestCtx = ctx;
		resetDraft(ctx);
		startPolling();
	});

	pi.on("session_switch", async (_event: unknown, ctx: CtxLike) => {
		latestCtx = ctx;
		resetDraft(ctx);
		startPolling();
	});

	pi.on("tool_result", async (event: ToolResultEvent, ctx: CtxLike) => {
		latestCtx = ctx;
		return upgradeScreenshotToolResult(
			event,
			ctx.cwd,
			deps.loadImageContentFromPath,
		);
	});

	// On submit: remove local placeholders/paths and attach the same image content.
	pi.on("input", async (event: InputEvent, ctx: CtxLike): Promise<InputResult> => {
		latestCtx = ctx;
		const fullText = (event.text || "").trim();

		const detectedPaths = extractImagePaths(fullText);
		if (
			(fullText.startsWith("/") && detectedPaths.length === 0) ||
			fullText.trimStart().startsWith("!")
		) {
			return { action: "continue" };
		}

		const candidates: Array<{ token: string; entry: TrackedImage; index: number }> = [];
		for (const [placeholder, entry] of tracked) {
			const index = fullText.indexOf(placeholder);
			if (index >= 0) candidates.push({ token: placeholder, entry, index });
		}

		// Fast-submit fallback: the input event may arrive before the 250ms editor
		// poll has converted a freshly pasted path into a placeholder.
		for (const { raw, path: filePath } of detectedPaths) {
			const image = await deps.readImageContentFromPathAsync(filePath);
			if (!image) continue;
			let placeholder: string;
			do {
				placeholder = `[Image #${nextPlaceholderNumber++}]`;
			} while (fullText.includes(placeholder) || tracked.has(placeholder));
			candidates.push({
				token: raw,
				index: fullText.indexOf(raw),
				entry: {
					filePath,
					placeholder,
					image,
					label: trimImageLabel(filePath),
				},
			});
		}

		if (candidates.length === 0) return { action: "continue" };
		candidates.sort((a, b) => a.index - b.index);

		const usedImages: ImageContent[] = await Promise.all(
			candidates.map(({ entry }) =>
				deps.resizeForSubmission
					? deps.resizeForSubmission(entry.image)
					: Promise.resolve(entry.image),
			),
		);
		const references = await Promise.all(
			usedImages.map(async (image) => {
				if (!deps.storeImage) return undefined;
				try {
					return await deps.storeImage(image);
				} catch (error) {
					debugLog("Failed to persist image attachment", error);
					return undefined;
				}
			}),
		);
		let transformedText = fullText;
		for (let index = 0; index < candidates.length; index += 1) {
			const candidate = candidates[index]!;
			const reference = references[index];
			const marker = reference
				? createImageMarkerLink(candidate.entry.placeholder, reference)
				: candidate.entry.placeholder;
			transformedText = transformedText.replace(candidate.token, marker);
		}
		const images = [...(event.images ?? []), ...usedImages];
		resetDraft(ctx);
		return { action: "transform", text: transformedText, images };
	});
}
