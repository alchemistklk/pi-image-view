import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", () => ({
	getCapabilities: () => ({ images: null }),
	getImageDimensions: () => null,
	calculateImageRows: () => 0,
	getCellDimensions: () => ({ width: 0, height: 0 }),
}));

import { registerImagePreviewExtension } from "../src/extension-runtime.ts";

type Handler = (...args: any[]) => any;

function makeHarness(deps: any) {
	const handlers = new Map<string, Handler>();
	let markdownTransformer: ((markdown: string, context: { messageType: string }) => string) | undefined;
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerMarkdownTransformer: (transformer: typeof markdownTransformer) => {
			markdownTransformer = transformer;
		},
	};
	const ctx = {
		cwd: "/tmp",
		isIdle: () => true,
		ui: {
			setWidget: vi.fn(),
			getEditorText: vi.fn(() => ""),
			setEditorText: vi.fn(),
			theme: {},
		},
	};
	registerImagePreviewExtension(pi as any, deps);
	return { handlers, ctx, getMarkdownTransformer: () => markdownTransformer };
}

describe("compact editor attachments", () => {
	it("replaces a pasted path with a placeholder and submits the same image", async () => {
		vi.useFakeTimers();
		try {
			const image = {
				type: "image" as const,
				data: "RAW",
				mimeType: "image/png",
			};
			const deps = {
				readImageContentFromPathAsync: vi.fn(async () => image),
				loadImageContentFromPath: vi.fn(async () => null),
				storeImage: vi.fn(async () => "file:///tmp/image-view/blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"),
			};
			const { handlers, ctx } = makeHarness(deps);
			ctx.ui.getEditorText = vi.fn(() => "/tmp/screenshot.png\nfix the conflict");

			await handlers.get("session_start")!(undefined, ctx);
			await vi.advanceTimersByTimeAsync(300);

			expect(ctx.ui.setEditorText).toHaveBeenCalledWith(
				"[Image #1]\nfix the conflict",
			);

			const result = await handlers.get("input")!(
				{ text: "[Image #1]\nfix the conflict", images: [] },
				ctx,
			);

			expect(result).toEqual({
				action: "transform",
				text: "[[Image #1]](file:///tmp/image-view/blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png)\nfix the conflict",
				images: [image],
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("loads and submits a raw path when the user submits before the poll runs", async () => {
		const image = {
			type: "image" as const,
			data: "FAST",
			mimeType: "image/png",
		};
		const preview = { ...image, data: "FAST_PREVIEW" };
		const deps = {
			readImageContentFromPathAsync: vi.fn(async () => image),
			loadImageContentFromPath: vi.fn(async () => null),
			maybeResizeImage: vi.fn(async () => preview),
			storeImage: vi.fn(async () => "file:///tmp/image-view/blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"),
		};
		const { handlers, ctx } = makeHarness(deps);

		const result = await handlers.get("input")!(
			{ text: "/tmp/fast.png explain this", images: [] },
			ctx,
		);

		expect(result).toEqual({
			action: "transform",
			text: "[[Image #1]](file:///tmp/image-view/blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png) explain this",
			images: [preview],
		});
	});


	it("replaces a Pi-resized event image with one path thumbnail", async () => {
		const image = {
			type: "image" as const,
			data: "SAME_IMAGE",
			mimeType: "image/png",
		};
		const eventImage = { ...image, data: "CORE_RESIZED" };
		const ref = `file:///tmp/image-view/blobs/${"a".repeat(64)}.png`;
		const deps = {
			readImageContentFromPathAsync: vi.fn(async () => image),
			loadImageContentFromPath: vi.fn(async () => null),
			maybeResizeImage: vi.fn(async () => ({ ...image, data: "THUMB" })),
			storeImage: vi.fn(async () => ref),
		};
		const { handlers, ctx } = makeHarness(deps);

		const result = await handlers.get("input")!(
			{ text: "/tmp/already-attached.png describe it", images: [eventImage] },
			ctx,
		);

		expect(result).toEqual({
			action: "transform",
			text: `[[Image #1]](${ref}) describe it`,
			images: [{ ...image, data: "THUMB" }],
		});
	});

	it("does not submit an attachment after its placeholder is deleted", async () => {
		vi.useFakeTimers();
		try {
			const image = {
				type: "image" as const,
				data: "RAW",
				mimeType: "image/png",
			};
			const deps = {
				readImageContentFromPathAsync: vi.fn(async () => image),
				loadImageContentFromPath: vi.fn(async () => null),
			};
			const { handlers, ctx } = makeHarness(deps);
			let editorText = "/tmp/remove.png";
			ctx.ui.getEditorText = vi.fn(() => editorText);
			ctx.ui.setEditorText = vi.fn((text: string) => {
				editorText = text;
			});

			await handlers.get("session_start")!(undefined, ctx);
			await vi.advanceTimersByTimeAsync(300);
			expect(editorText).toBe("[Image #1]");

			editorText = "plain prompt";
			await vi.advanceTimersByTimeAsync(300);
			const result = await handlers.get("input")!(
				{ text: editorText, images: [] },
				ctx,
			);

			expect(result).toEqual({ action: "continue" });
		} finally {
			vi.useRealTimers();
		}
	});
});


describe("draft scan lifecycle", () => {
	it("discards a stale async scan after the editor changes", async () => {
		vi.useFakeTimers();
		try {
			let editorText = "/tmp/stale.png";
			let resolveRead!: (image: any) => void;
			const read = vi.fn(() => new Promise((resolve) => { resolveRead = resolve; }));
			const { handlers, ctx } = makeHarness({
				readImageContentFromPathAsync: read,
				loadImageContentFromPath: vi.fn(async () => null),
			});
			ctx.ui.getEditorText = vi.fn(() => editorText);
			ctx.ui.setEditorText = vi.fn((text: string) => { editorText = text; });

			await handlers.get("session_start")!(undefined, ctx);
			await vi.advanceTimersByTimeAsync(250);
			expect(read).toHaveBeenCalledTimes(1);

			editorText = "new prompt";
			await vi.advanceTimersByTimeAsync(250);
			resolveRead({ type: "image", data: "STALE", mimeType: "image/png" });
			await Promise.resolve();

			expect(ctx.ui.setEditorText).not.toHaveBeenCalled();
			await handlers.get("session_shutdown")!(undefined, ctx);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not rescan unchanged editor text", async () => {
		vi.useFakeTimers();
		try {
			const read = vi.fn(async () => null);
			const { handlers, ctx } = makeHarness({
				readImageContentFromPathAsync: read,
				loadImageContentFromPath: vi.fn(async () => null),
			});
			ctx.ui.getEditorText = vi.fn(() => "/tmp/unchanged.png");

			await handlers.get("session_start")!(undefined, ctx);
			await vi.advanceTimersByTimeAsync(1_000);

			expect(read).toHaveBeenCalledTimes(1);
			await handlers.get("session_shutdown")!(undefined, ctx);
		} finally {
			vi.useRealTimers();
		}
	});

	it("polls only with UI and cleans up on session shutdown", async () => {
		vi.useFakeTimers();
		try {
			const deps = {
				readImageContentFromPathAsync: vi.fn(async () => null),
				loadImageContentFromPath: vi.fn(async () => null),
			};
			const headless = makeHarness(deps);
			headless.ctx.hasUI = false;
			await headless.handlers.get("session_start")!(undefined, headless.ctx);
			await vi.advanceTimersByTimeAsync(500);
			expect(headless.ctx.ui.getEditorText).not.toHaveBeenCalled();
			expect(headless.handlers.has("session_switch")).toBe(false);

			const interactive = makeHarness(deps);
			await interactive.handlers.get("session_start")!(undefined, interactive.ctx);
			await vi.advanceTimersByTimeAsync(250);
			expect(interactive.ctx.ui.getEditorText).toHaveBeenCalledTimes(1);
			await interactive.handlers.get("session_shutdown")!(undefined, interactive.ctx);
			await vi.advanceTimersByTimeAsync(500);
			expect(interactive.ctx.ui.getEditorText).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});


describe("transcript hyperlinks", () => {
	it("renders links only in user transcript Markdown and strips targets from model context", async () => {
		const ref = `image-view://sha256/${"a".repeat(64)}.png`;
		const deps = {
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			resolveImageReference: vi.fn(() => "/tmp/blob.png"),
		};
		const { handlers, getMarkdownTransformer } = makeHarness(deps);
		const transform = getMarkdownTransformer()!;
		const stored = `[Image #1](${ref})`;

		expect(transform(stored, { messageType: "user" })).toBe(
			"[[Image #1]](file:///tmp/blob.png)",
		);
		expect(transform(stored, { messageType: "assistant" })).toBe(stored);

		const context = await handlers.get("context")!({
			messages: [{ role: "user", content: stored }],
		});
		expect(context.messages).toEqual([{ role: "user", content: "[Image #1]" }]);
	});
});
