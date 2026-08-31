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
	const commands = new Map<string, { handler: (args: string, ctx: any) => void }>();
	let terminalInputHandler: ((data: string) => unknown) | undefined;
	let activeEditorFactory: ((...args: any[]) => unknown) | undefined;
	let markdownTransformer: ((markdown: string, context: { messageType: string }) => string) | undefined;
	const requestRender = vi.fn();
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerCommand: (name: string, options: { handler: (args: string, ctx: any) => void }) => commands.set(name, options),
		registerMarkdownTransformer: (transformer: typeof markdownTransformer) => {
			markdownTransformer = transformer;
		},
	};
	const ctx = {
		cwd: "/tmp",
		hasUI: true,
		isIdle: () => true,
		sessionManager: { getBranch: vi.fn<() => any[]>(() => []) },
		ui: {
			getEditorComponent: vi.fn(() => activeEditorFactory),
			onTerminalInput: vi.fn((handler: (data: string) => unknown) => { terminalInputHandler = handler; return vi.fn(); }),
			setEditorComponent: vi.fn((factory: ((...args: any[]) => unknown) | undefined) => { activeEditorFactory = factory; }),
			notify: vi.fn(),
			setWidget: vi.fn((_key: string, content: unknown) => {
				if (typeof content === "function") content({ requestRender }, { fg: (_name: string, text: string) => text, bold: (text: string) => text });
			}),
			getEditorText: vi.fn(() => ""),
			setEditorText: vi.fn(),
			theme: {},
		},
	};
	registerImagePreviewExtension(pi as any, deps);
	return { handlers, command: commands.get("pi-image-view")!, ctx, requestRender, getMarkdownTransformer: () => markdownTransformer, getTerminalInputHandler: () => terminalInputHandler };
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
			normalizeImageForMatching: vi.fn(async () => eventImage),
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


	it("preserves an unrelated event image when a raw path candidate is different", async () => {
		const eventImage = { type: "image" as const, data: "EVENT", mimeType: "image/png" };
		const pathImage = { type: "image" as const, data: "PATH", mimeType: "image/png" };
		const preview = { ...pathImage, data: "THUMB" };
		const deps = {
			readImageContentFromPathAsync: vi.fn(async () => pathImage),
			loadImageContentFromPath: vi.fn(async () => null),
			maybeResizeImage: vi.fn(async () => preview),
		};
		const { handlers, ctx } = makeHarness(deps);

		const result = await handlers.get("input")!(
			{ text: "/tmp/path.png compare", images: [eventImage] },
			ctx,
		);

		expect(result.images).toEqual([eventImage, preview]);
	});

	it("retries unchanged editor text after a transient image-read failure", async () => {
		vi.useFakeTimers();
		try {
			const image = { type: "image" as const, data: "RECOVERED", mimeType: "image/png" };
			const readImage = vi.fn()
				.mockResolvedValueOnce(null)
				.mockResolvedValue(image);
			const deps = {
				readImageContentFromPathAsync: readImage,
				loadImageContentFromPath: vi.fn(async () => null),
			};
			const { handlers, ctx } = makeHarness(deps);
			ctx.ui.getEditorText = vi.fn(() => "/tmp/retry.png");

			await handlers.get("session_start")!(undefined, ctx);
			await vi.advanceTimersByTimeAsync(600);

			expect(readImage).toHaveBeenCalledTimes(2);
			expect(ctx.ui.setEditorText).toHaveBeenCalledWith("[Image #1]");
		} finally {
			vi.useRealTimers();
		}
	});


	it("replaces only the normalized matching event image in a mixed list", async () => {
		const unrelated = { type: "image" as const, data: "UNRELATED", mimeType: "image/png" };
		const coreResized = { type: "image" as const, data: "CORE_RESIZED", mimeType: "image/png" };
		const original = { type: "image" as const, data: "ORIGINAL", mimeType: "image/png" };
		const thumbnail = { ...original, data: "THUMB" };
		const deps = {
			readImageContentFromPathAsync: vi.fn(async () => original),
			loadImageContentFromPath: vi.fn(async () => null),
			maybeResizeImage: vi.fn(async () => thumbnail),
			normalizeImageForMatching: vi.fn(async () => coreResized),
		};
		const { handlers, ctx } = makeHarness(deps);

		const result = await handlers.get("input")!(
			{ text: "/tmp/original.png compare", images: [unrelated, coreResized] },
			ctx,
		);

		expect(result.images).toEqual([unrelated, thumbnail]);
	});

	it("skips matching normalization when no event images exist", async () => {
		const original = { type: "image" as const, data: "ORIGINAL", mimeType: "image/png" };
		const thumbnail = { ...original, data: "THUMB" };
		const normalize = vi.fn(async () => original);
		const deps = {
			readImageContentFromPathAsync: vi.fn(async () => original),
			loadImageContentFromPath: vi.fn(async () => null),
			maybeResizeImage: vi.fn(async () => thumbnail),
			normalizeImageForMatching: normalize,
		};
		const { handlers, ctx } = makeHarness(deps);

		const result = await handlers.get("input")!(
			{ text: "/tmp/original.png inspect", images: [] },
			ctx,
		);

		expect(result.images).toEqual([thumbnail]);
		expect(normalize).not.toHaveBeenCalled();
	});


	it("uses 1280px detail mode for one submission then returns to preview thumbnails", async () => {
		const original = { type: "image" as const, data: "ORIGINAL", mimeType: "image/png" };
		const thumbnail = { ...original, data: "THUMB" };
		const detail = { ...original, data: "DETAIL" };
		const deps = {
			readImageContentFromPathAsync: vi.fn(async () => original),
			loadImageContentFromPath: vi.fn(async () => null),
			maybeResizeImage: vi.fn(async () => thumbnail),
			resizeDetailImage: vi.fn(async () => detail),
		};
		const { handlers, command, ctx } = makeHarness(deps);
		command.handler("detail", ctx);

		const first = await handlers.get("input")!({ text: "/tmp/first.png inspect", images: [] }, ctx);
		const second = await handlers.get("input")!({ text: "/tmp/second.png inspect", images: [] }, ctx);

		expect(first.images).toEqual([detail]);
		expect(second.images).toEqual([thumbnail]);
		expect(deps.resizeDetailImage).toHaveBeenCalledTimes(1);
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

	it("bounds retries for unchanged unreadable image paths", async () => {
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

			expect(read).toHaveBeenCalledTimes(3);
			await handlers.get("session_shutdown")!(undefined, ctx);
		} finally {
			vi.useRealTimers();
		}
	});


	it("keeps image numbers monotonic across submitted drafts", async () => {
		const image = { type: "image" as const, data: "CLIP", mimeType: "image/png" };
		const createAtomicEditor = vi.fn((_tui: unknown, _theme: unknown, _keys: unknown, _attach: (image: any) => string) => ({}));
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor,
		});
		await handlers.get("session_start")!(undefined, ctx);
		const factory = ctx.ui.setEditorComponent.mock.calls[0]![0] as (...args: any[]) => unknown;
		factory("tui", "theme", "keys");
		const attach = createAtomicEditor.mock.calls[0]![3] as (value: { type: "image"; data: string; mimeType: string }) => string;

		expect(attach(image)).toBe("[Image #1]");
		await handlers.get("input")!({ text: "[Image #1]", images: [] }, ctx);
		expect(attach(image)).toBe("[Image #2]");
	});

	it("continues numbering from user markers on the active branch", async () => {
		const createAtomicEditor = vi.fn((_tui: unknown, _theme: unknown, _keys: unknown, _attach: (image: any) => string) => ({}));
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor,
		});
		ctx.sessionManager.getBranch.mockReturnValue([
			{ type: "message", message: { role: "user", content: "[[Image #7]](file:///blob.png)" } },
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "[Image #12]" }] } },
			{ type: "message", message: { role: "assistant", content: "[Image #99]" } },
		]);
		await handlers.get("session_start")!(undefined, ctx);
		const factory = ctx.ui.setEditorComponent.mock.calls[0]![0] as (...args: any[]) => unknown;
		factory("tui", "theme", "keys");
		const attach = createAtomicEditor.mock.calls[0]![3] as (image: { type: "image"; data: string; mimeType: string }) => string;

		expect(attach({ type: "image", data: "CLIP", mimeType: "image/png" })).toBe("[Image #13]");
	});

	it("awaits direct clipboard capability before installing the optional editor", async () => {
		const createAtomicEditor = vi.fn();
		const supportsAtomicEditor = vi.fn(async () => false);
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor,
			supportsAtomicEditor,
		});

		await handlers.get("session_start")!(undefined, ctx);
		expect(supportsAtomicEditor).toHaveBeenCalledTimes(1);
		expect(ctx.ui.setEditorComponent).not.toHaveBeenCalled();
	});

	it("does not install an editor after a stale capability result resolves", async () => {
		let release: (value: boolean) => void = () => {};
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor: vi.fn(),
			supportsAtomicEditor: () => new Promise<boolean>((resolve) => { release = resolve; }),
		});

		const starting = handlers.get("session_start")!(undefined, ctx);
		await handlers.get("session_shutdown")!(undefined, ctx);
		release(true);
		await starting;
		expect(ctx.ui.setEditorComponent).not.toHaveBeenCalled();
		expect(ctx.ui.onTerminalInput).not.toHaveBeenCalled();
		expect(ctx.ui.getEditorText).not.toHaveBeenCalled();
	});

	it("installs and removes the optional atomic editor with the session lifecycle", async () => {
		const createAtomicEditor = vi.fn();
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor,
		});

		const editor = { kind: "atomic" };
		createAtomicEditor.mockReturnValue(editor);
		await handlers.get("session_start")!(undefined, ctx);
		const factory = ctx.ui.setEditorComponent.mock.calls[0]?.[0];
		expect(factory?.("tui", "theme", "keys")).toBe(editor);
		expect(createAtomicEditor).toHaveBeenCalledWith("tui", "theme", "keys", expect.any(Function), undefined);
		const attachImage = createAtomicEditor.mock.calls[0]?.[3];
		expect(attachImage({ type: "image", data: "CLIP", mimeType: "image/png" })).toBe("[Image #1]");
		await handlers.get("session_shutdown")!(undefined, ctx);
		expect(ctx.ui.setEditorComponent).toHaveBeenLastCalledWith(undefined);
	});


	it("converts a newly pasted image path during the rapid paste scan window", async () => {
		vi.useFakeTimers();
		try {
			const image = { type: "image" as const, data: "PASTED", mimeType: "image/png" };
			const { handlers, ctx, getTerminalInputHandler } = makeHarness({
				readImageContentFromPathAsync: vi.fn(async () => image),
				loadImageContentFromPath: vi.fn(async () => null),
				isImagePasteInput: (data: string) => data === "PASTE",
			});
			let editorText = "";
			ctx.ui.getEditorText = vi.fn(() => editorText);
			ctx.ui.setEditorText = vi.fn((text: string) => { editorText = text; });
			await handlers.get("session_start")!(undefined, ctx);

			getTerminalInputHandler()!("PASTE");
			await vi.advanceTimersByTimeAsync(10);
			editorText = "/tmp/pasted.png"; // Pi's built-in async clipboard handler inserts the path.
			await vi.advanceTimersByTimeAsync(10);

			expect(editorText).toBe("[Image #1]");
			expect(ctx.ui.setEditorText).toHaveBeenCalledTimes(1);
			await handlers.get("session_shutdown")!(undefined, ctx);
		} finally {
			vi.useRealTimers();
		}
	});


	it("enhances a Zentui-owned editor without replacing its renderer metadata", async () => {
		const owner = Symbol("zentui-owner");
		const zentuiEditor = { render: () => ["zentui"] };
		const zentuiFactory = vi.fn(() => zentuiEditor) as any;
		zentuiFactory[Symbol.for("pi-zentui.editor-factory")] = true;
		zentuiFactory[Symbol.for("pi-zentui.editor-owner")] = owner;
		const zentuiBase = vi.fn();
		zentuiFactory[Symbol.for("pi-zentui.editor-base-factory")] = zentuiBase;
		const createAtomicEditor = vi.fn((_tui, _theme, _keys, _attach, base) => base);
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor,
		});
		ctx.ui.setEditorComponent(zentuiFactory);

		await handlers.get("session_start")!(undefined, ctx);
		const composedFactory = ctx.ui.getEditorComponent() as any;
		expect(composedFactory[Symbol.for("pi-zentui.editor-factory")]).toBe(true);
		expect(composedFactory[Symbol.for("pi-zentui.editor-owner")]).toBe(owner);
		expect(composedFactory[Symbol.for("pi-zentui.editor-base-factory")]).toBe(zentuiBase);
		expect(composedFactory("tui", "theme", "keys")).toBe(zentuiEditor);
		expect(createAtomicEditor).toHaveBeenCalledWith(
			"tui", "theme", "keys", expect.any(Function), zentuiEditor,
		);

		// Zentui runs first during shutdown and removes its adopted owned layer.
		ctx.ui.setEditorComponent(undefined);
		await handlers.get("session_shutdown")!(undefined, ctx);
		expect(ctx.ui.getEditorComponent()).toBeUndefined();
	});

	it("clears the editor instead of restoring a Zentui factory it still fronts", async () => {
		const zentuiFactory = vi.fn() as any;
		zentuiFactory[Symbol.for("pi-zentui.editor-factory")] = true;
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor: vi.fn(() => ({ kind: "atomic" })),
		});
		ctx.ui.setEditorComponent(zentuiFactory);
		await handlers.get("session_start")!(undefined, ctx);
		const composed = ctx.ui.getEditorComponent();
		expect(composed).not.toBe(zentuiFactory);

		// Image-view shuts down first, while its composed factory is still installed.
		await handlers.get("session_shutdown")!(undefined, ctx);

		// Restoring the Zentui factory would resurrect an editor Zentui is tearing down.
		expect(ctx.ui.getEditorComponent()).toBeUndefined();
	});

	it("restores a displaced non-Zentui factory on shutdown", async () => {
		const plainFactory = vi.fn() as any;
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor: vi.fn(() => ({ kind: "atomic" })),
		});
		ctx.ui.setEditorComponent(plainFactory);
		await handlers.get("session_start")!(undefined, ctx);
		await handlers.get("session_shutdown")!(undefined, ctx);

		expect(ctx.ui.getEditorComponent()).toBe(plainFactory);
	});

	it("builds a standalone editor when the displaced factory throws", async () => {
		const brokenFactory = vi.fn(() => { throw new Error("incompatible extension"); }) as any;
		const createAtomicEditor = vi.fn(() => ({ kind: "atomic" }));
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor,
		});
		ctx.ui.setEditorComponent(brokenFactory);
		await handlers.get("session_start")!(undefined, ctx);
		const composed = ctx.ui.getEditorComponent() as any;

		expect(() => composed("tui", "theme", "keys")).not.toThrow();
		expect(createAtomicEditor).toHaveBeenCalledWith("tui", "theme", "keys", expect.any(Function), undefined);
	});

	it("does not restore a displaced factory that failed at startup", async () => {
		const brokenFactory = vi.fn(() => { throw new Error("incompatible extension"); }) as any;
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor: vi.fn(() => ({ kind: "atomic" })),
		});
		ctx.ui.setEditorComponent(brokenFactory);
		await handlers.get("session_start")!(undefined, ctx);
		(ctx.ui.getEditorComponent() as any)("tui", "theme", "keys");

		// Pi's setEditorComponent invokes the factory synchronously, so restoring a
		// factory that throws would take down session teardown.
		const store = ctx.ui.setEditorComponent;
		ctx.ui.setEditorComponent = vi.fn((factory?: (...args: any[]) => unknown) => {
			factory?.("tui", "theme", "keys");
			return store(factory);
		});

		expect(() => handlers.get("session_shutdown")!(undefined, ctx)).not.toThrow();
		expect(ctx.ui.getEditorComponent()).toBeUndefined();
	});

	it("removes its exposed base after a later-loaded Zentui wrapper shuts down", async () => {
		vi.useFakeTimers();
		try {
			const createAtomicEditor = vi.fn(() => ({ kind: "atomic" }));
			const { handlers, ctx } = makeHarness({
				readImageContentFromPathAsync: vi.fn(async () => null),
				loadImageContentFromPath: vi.fn(async () => null),
				createAtomicEditor,
			});
			const ui = ctx.ui;
			let stale = false;
			Object.defineProperty(ctx, "ui", { get: () => { if (stale) throw new Error("stale context"); return ui; } });
			await handlers.get("session_start")!(undefined, ctx);
			const imageViewFactory = ui.getEditorComponent();
			const zentuiWrapper = vi.fn();
			ctx.ui.setEditorComponent(zentuiWrapper);

			// Image-view shuts down first; Zentui then peels to its recorded base.
			await handlers.get("session_shutdown")!(undefined, ctx);
			stale = true;
			ui.setEditorComponent(imageViewFactory);
			await vi.runOnlyPendingTimersAsync();

			expect(ui.getEditorComponent()).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not clear a newer factory when deferred shutdown cleanup runs", async () => {
		vi.useFakeTimers();
		try {
			const { handlers, ctx } = makeHarness({
				readImageContentFromPathAsync: vi.fn(async () => null),
				loadImageContentFromPath: vi.fn(async () => null),
				createAtomicEditor: vi.fn(() => ({ kind: "atomic" })),
			});
			await handlers.get("session_start")!(undefined, ctx);
			ctx.ui.setEditorComponent(vi.fn());
			await handlers.get("session_shutdown")!(undefined, ctx);
			const newerFactory = vi.fn();
			ctx.ui.setEditorComponent(newerFactory);
			await vi.runOnlyPendingTimersAsync();
			expect(ctx.ui.getEditorComponent()).toBe(newerFactory);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not clear an editor factory installed by another extension", async () => {
		const createAtomicEditor = vi.fn(() => ({ kind: "atomic" }));
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor,
		});
		await handlers.get("session_start")!(undefined, ctx);
		const otherFactory = vi.fn();
		ctx.ui.setEditorComponent(otherFactory);

		await handlers.get("session_shutdown")!(undefined, ctx);

		expect(ctx.ui.getEditorComponent()).toBe(otherFactory);
	});

	it("restores the factory it displaced when it still owns the editor", async () => {
		const createAtomicEditor = vi.fn(() => ({ kind: "atomic" }));
		const { handlers, ctx } = makeHarness({
			readImageContentFromPathAsync: vi.fn(async () => null),
			loadImageContentFromPath: vi.fn(async () => null),
			createAtomicEditor,
		});
		const priorFactory = vi.fn();
		ctx.ui.setEditorComponent(priorFactory);

		await handlers.get("session_start")!(undefined, ctx);
		expect(ctx.ui.getEditorComponent()).not.toBe(priorFactory);

		await handlers.get("session_shutdown")!(undefined, ctx);

		expect(ctx.ui.getEditorComponent()).toBe(priorFactory);
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


describe("incremental gallery runtime integration", () => {
	it("mounts one widget while staggered previews request coalesced redraws", async () => {
		vi.useFakeTimers();
		try {
			let releaseFirst!: (image: any) => void;
			let releaseSecond!: (image: any) => void;
			const raw = (data: string) => ({ type: "image" as const, data, mimeType: "image/png" });
			const resize = vi.fn((image: any) => image.data === "one"
				? new Promise((resolve) => { releaseFirst = resolve; })
				: new Promise((resolve) => { releaseSecond = resolve; }));
			const { handlers, ctx, requestRender } = makeHarness({
				readImageContentFromPathAsync: vi.fn(async (filePath: string) => raw(filePath.includes("one") ? "one" : "two")),
				loadImageContentFromPath: vi.fn(async () => null),
				maybeResizeImage: resize,
			});
			ctx.ui.getEditorText = vi.fn(() => "/tmp/one.png /tmp/two.png");
			await handlers.get("session_start")!(undefined, ctx);
			ctx.ui.setWidget.mockClear(); // session reset clears the previous draft before the first mount.
			await vi.advanceTimersByTimeAsync(250);
			expect(ctx.ui.setWidget).toHaveBeenCalledTimes(1);
			expect(requestRender).toHaveBeenCalledTimes(1);

			releaseFirst(raw("one-preview"));
			releaseSecond(raw("two-preview"));
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(50);
			expect(ctx.ui.setWidget).toHaveBeenCalledTimes(1);
			expect(requestRender).toHaveBeenCalledTimes(2);
			await handlers.get("session_shutdown")!(undefined, ctx);
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
