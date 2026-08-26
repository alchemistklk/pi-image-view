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
	/** Source image used to build the submitted preview. */
	image: ImageContent;
	/** Small PNG thumbnail used for both inline preview and model submission. */
	previewImage?: ImageContent;
	previewPromise?: Promise<ImageContent>;
	label: string;
};

export type ExtensionDeps = {
	readImageContentFromPathAsync: (
		filePath: string,
	) => Promise<ImageContent | null>;
	maybeResizeImage?: (image: ImageContent) => Promise<ImageContent>;
	resizeDetailImage?: (image: ImageContent) => Promise<ImageContent>;
	normalizeImageForMatching?: (image: ImageContent) => Promise<ImageContent>;
	createAtomicEditor?: (tui: unknown, theme: unknown, keybindings: unknown) => unknown;
	loadImageContentFromPath: (
		filePath: string,
	) => Promise<ImageContent | null>;
	storeImage?: (image: ImageContent) => Promise<string | undefined>;
	resolveImageReference?: (reference: string) => string | undefined;
};

type PiLike = {
	on(event: string, handler: (...args: any[]) => any): void;
	registerCommand?: (name: string, options: { description?: string; handler: (args: string, ctx: CtxLike) => Promise<void> | void }) => void;
	registerMarkdownTransformer?: (
		transformer: (markdown: string, context: { messageType: string }) => string,
	) => void;
};

type CtxLike = {
	cwd: string;
	hasUI?: boolean;
	mode?: "tui" | "rpc" | "json" | "print";
	isIdle(): boolean;
	ui: {
		setEditorComponent?(factory: ((tui: unknown, theme: unknown, keybindings: unknown) => unknown) | undefined): void;
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
		notify(message: string, type?: "info" | "warning" | "error"): void;
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

	let clearBeforeIndex: number | undefined;
	let clearOnNextContext = false;
	let lastContextMessageCount = 0;
	let detailNextSubmission = false;

	pi.registerCommand?.("pi-image-view", {
		description: "Clear existing image context or arm 1280px detail mode",
		handler: (args, ctx) => {
			const action = args.trim();
			if (action === "detail") {
				detailNextSubmission = true;
				ctx.ui.notify("Next image submission will use 1280px detail mode", "info");
				return;
			}
			if (action !== "clear") {
				ctx.ui.notify("Usage: /pi-image-view [clear|detail]", "error");
				return;
			}
			if (lastContextMessageCount > 0) {
				clearBeforeIndex = lastContextMessageCount;
				clearOnNextContext = false;
			} else {
				clearOnNextContext = true;
			}
			ctx.ui.notify("Existing images cleared from model context", "info");
		},
	});

	pi.on("context", (event: { messages: Array<{ role?: unknown; content?: unknown }> }) => {
		if (clearBeforeIndex !== undefined && event.messages.length < lastContextMessageCount) {
			const removedPrefixLength = lastContextMessageCount - event.messages.length;
			clearBeforeIndex = Math.max(0, clearBeforeIndex - removedPrefixLength);
		}
		if (clearOnNextContext) {
			let latestUserIndex = -1;
			for (let index = event.messages.length - 1; index >= 0; index -= 1) {
				if (event.messages[index]?.role === "user") {
					latestUserIndex = index;
					break;
				}
			}
			clearBeforeIndex = latestUserIndex >= 0 ? latestUserIndex : event.messages.length;
			clearOnNextContext = false;
		}
		lastContextMessageCount = event.messages.length;
		return { messages: sanitizeModelMessages(event.messages, clearBeforeIndex) };
	});

	let tracked: Map<string, TrackedImage> = new Map();
	let gallery: ImageGallery | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let latestCtx: CtxLike | null = null;
	let nextPlaceholderNumber = 1;
	let scanInFlight = false;
	let scanGeneration = 0;
	let lastScannedText: string | undefined;
	let failedScanText: string | undefined;
	let failedScanAttempts = 0;

	// ── Helpers ────────────────────────────────────────────


	function ensurePreview(entry: TrackedImage): Promise<ImageContent> {
		if (entry.previewImage) return Promise.resolve(entry.previewImage);
		if (!deps.maybeResizeImage) return Promise.resolve(entry.image);
		if (!entry.previewPromise) {
			entry.previewPromise = deps.maybeResizeImage(entry.image)
				.then((preview) => {
					entry.previewImage = preview;
					if (latestCtx && tracked.get(entry.placeholder) === entry) refreshWidget(latestCtx);
					return preview;
				})
				.catch((error) => {
					debugLog(`Failed to resize image ${entry.filePath}`, error);
					return entry.image;
				});
		}
		return entry.previewPromise;
	}

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
		scanGeneration += 1;
		lastScannedText = undefined;
		failedScanText = undefined;
		failedScanAttempts = 0;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	}

	/**
	 * Scan editor text for image paths.
	 * Track new ones, remove ones that are no longer in the text.
	 * Async to avoid blocking the event loop with file I/O.
	 */
	async function scanEditorText(ctx: CtxLike): Promise<void> {
		let text: string;
		try {
			text = ctx.ui.getEditorText();
		} catch (err) {
			debugLog("Failed to get editor text", err);
			return;
		}
		if (text === lastScannedText) return;
		if (text !== failedScanText) {
			failedScanText = text;
			failedScanAttempts = 0;
		}
		lastScannedText = text;
		const generation = ++scanGeneration;
		if (scanInFlight) return;

		scanInFlight = true;
		try {
			const visiblePlaceholders = placeholdersIn(text);
			const nextTracked = new Map(tracked);
			let changed = false;
			for (const placeholder of nextTracked.keys()) {
				if (!visiblePlaceholders.has(placeholder)) {
					nextTracked.delete(placeholder);
					changed = true;
				}
			}

			let renderedText = text;
			let hadReadFailure = false;
			const newEntries: TrackedImage[] = [];
			for (const { raw, path: filePath } of extractImagePaths(text)) {
				const image = await deps.readImageContentFromPathAsync(filePath);
				if (generation !== scanGeneration) {
					lastScannedText = undefined;
					return;
				}
				if (!image) {
					hadReadFailure = true;
					continue;
				}

				let placeholder: string;
				do {
					placeholder = `[Image #${nextPlaceholderNumber++}]`;
				} while (renderedText.includes(placeholder) || nextTracked.has(placeholder));

				const entry: TrackedImage = {
					filePath,
					placeholder,
					image,
					label: trimImageLabel(filePath),
				};
				nextTracked.set(placeholder, entry);
				newEntries.push(entry);
				renderedText = renderedText.replace(raw, placeholder);
				changed = true;
			}

			if (generation !== scanGeneration) {
				lastScannedText = undefined;
				return;
			}
			tracked = nextTracked;
			if (renderedText !== text) {
				ctx.ui.setEditorText(renderedText);
				lastScannedText = renderedText;
			}
			if (changed) refreshWidget(ctx);
			for (const entry of newEntries) {
				if (deps.maybeResizeImage) void ensurePreview(entry);
			}
			if (hadReadFailure) {
				failedScanAttempts += 1;
				if (failedScanAttempts < 3) lastScannedText = undefined;
			} else {
				failedScanText = undefined;
				failedScanAttempts = 0;
			}
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

	const cleanup = (): void => {
		stopPolling();
		scanGeneration += 1;
		lastScannedText = undefined;
		latestCtx = null;
		if (gallery) {
			gallery.dispose();
			gallery = null;
		}
	};

	pi.on("session_start", async (_event: unknown, ctx: CtxLike) => {
		clearBeforeIndex = undefined;
		detailNextSubmission = false;
		clearOnNextContext = false;
		lastContextMessageCount = 0;
		latestCtx = ctx;
		resetDraft(ctx);
		if (deps.createAtomicEditor && ctx.ui.setEditorComponent) {
			ctx.ui.setEditorComponent(deps.createAtomicEditor);
		}
		if (ctx.hasUI !== false && ctx.mode !== "print" && ctx.mode !== "json") {
			startPolling();
		}
	});

	pi.on("session_shutdown", (_event: unknown, ctx: CtxLike) => {
		cleanup();
		if (deps.createAtomicEditor) ctx.ui.setEditorComponent?.(undefined);
	});

	pi.on("tool_result", async (event: ToolResultEvent, ctx: CtxLike) => {
		latestCtx = ctx;
		return upgradeScreenshotToolResult(
			event,
			ctx.cwd,
			deps.loadImageContentFromPath,
			deps.maybeResizeImage,
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

		const existingByContent = new Map<string, number[]>();
		for (const [index, image] of (event.images ?? []).entries()) {
			const key = `${image.mimeType}\u0000${image.data}`;
			const matches = existingByContent.get(key);
			if (matches) matches.push(index);
			else existingByContent.set(key, [index]);
		}
		const existingIndexes = candidates.map(({ entry }) => {
			const key = `${entry.image.mimeType}\u0000${entry.image.data}`;
			return existingByContent.get(key)?.shift();
		});
		if (deps.normalizeImageForMatching && (event.images?.length ?? 0) > 0) {
			const normalizedCandidates = await Promise.all(
				candidates.map(({ entry }, candidateIndex) =>
					existingIndexes[candidateIndex] === undefined
						? deps.normalizeImageForMatching!(entry.image)
						: Promise.resolve(undefined),
				),
			);
			for (let candidateIndex = 0; candidateIndex < normalizedCandidates.length; candidateIndex += 1) {
				const normalized = normalizedCandidates[candidateIndex];
				if (!normalized) continue;
				const key = `${normalized.mimeType}\u0000${normalized.data}`;
				existingIndexes[candidateIndex] = existingByContent.get(key)?.shift();
			}
		}
		const preparedImages = await Promise.all(
			candidates.map(async ({ entry }, candidateIndex) => ({
				image: detailNextSubmission && deps.resizeDetailImage
					? await deps.resizeDetailImage(entry.image)
					: await ensurePreview(entry),
				existingIndex: existingIndexes[candidateIndex],
			})),
		);
		const references = await Promise.all(
			preparedImages.map(async ({ image }) => {
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
		const images = [...(event.images ?? [])];
		for (const { image, existingIndex } of preparedImages) {
			if (existingIndex === undefined) images.push(image);
			else images[existingIndex] = image;
		}
		detailNextSubmission = false;
		resetDraft(ctx);
		return { action: "transform", text: transformedText, images };
	});
}
