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

describe("submit attachment resizing", () => {
	it("attaches the downscaled image when a tracked attachment is oversized", async () => {
		vi.useFakeTimers();
		try {
			const rawImage = {
				type: "image" as const,
				data: "RAW",
				mimeType: "image/png",
			};
			const resizedImage = {
				type: "image" as const,
				data: "SMALL",
				mimeType: "image/png",
			};
			const resizeForSubmission = vi.fn(async () => resizedImage);
			const deps = {
				readImageContentFromPathAsync: vi.fn(async () => rawImage),
				loadImageContentFromPath: vi.fn(async () => null),
				resizeForSubmission,
			};
			const { handlers, ctx } = makeHarness(deps);
			ctx.ui.getEditorText = vi.fn(() => "check /tmp/big.png");

			await handlers.get("session_start")!(undefined, ctx);
			await vi.advanceTimersByTimeAsync(300);

			const result = await handlers.get("input")!(
				{ text: "check /tmp/big.png", images: [] },
				ctx,
			);

			expect(result.action).toBe("transform");
			expect(result.images).toEqual([resizedImage]);
			expect(resizeForSubmission).toHaveBeenCalledWith(rawImage);
		} finally {
			vi.useRealTimers();
		}
	});

	it("resizes multiple oversized attachments concurrently and preserves order", async () => {
		const rawA = {
			type: "image" as const,
			data: "RAW_A",
			mimeType: "image/png",
		};
		const rawB = {
			type: "image" as const,
			data: "RAW_B",
			mimeType: "image/png",
		};
		const byPath: Record<string, any> = {
			"/tmp/a.png": rawA,
			"/tmp/b.png": rawB,
		};
		const started: string[] = [];
		let releaseA!: () => void;
		const aGate = new Promise<void>((resolve) => {
			releaseA = resolve;
		});
		const resizeForSubmission = vi.fn(async (img: any) => {
			started.push(img.data);
			if (img.data === "RAW_A") await aGate;
			return {
				type: "image" as const,
				data: `${img.data}_SMALL`,
				mimeType: img.mimeType,
			};
		});
		const deps = {
			readImageContentFromPathAsync: vi.fn(
				async (p: string) => byPath[p] ?? null,
			),
			loadImageContentFromPath: vi.fn(async () => null),
			resizeForSubmission,
		};
		const { handlers, ctx } = makeHarness(deps);
		const text = "see /tmp/a.png and /tmp/b.png";
		ctx.ui.getEditorText = vi.fn(() => text);

		await handlers.get("session_start")!(undefined, ctx);
		await new Promise((r) => setTimeout(r, 300));

		const submit = handlers.get("input")!({ text, images: [] }, ctx);
		await Promise.resolve();
		await Promise.resolve();

		// Both resizes must start even while the first is still pending.
		expect(started.length === 2).toBe(true);

		releaseA();
		const result = await submit;
		expect(result.action).toBe("transform");
		expect(result.images).toEqual([
			{ type: "image", data: "RAW_A_SMALL", mimeType: "image/png" },
			{ type: "image", data: "RAW_B_SMALL", mimeType: "image/png" },
		]);
	});

	it("attaches the original image when no submission resizer is provided", async () => {
		vi.useFakeTimers();
		try {
			const rawImage = {
				type: "image" as const,
				data: "RAW",
				mimeType: "image/png",
			};
			const deps = {
				readImageContentFromPathAsync: vi.fn(async () => rawImage),
				loadImageContentFromPath: vi.fn(async () => null),
			};
			const { handlers, ctx } = makeHarness(deps);
			ctx.ui.getEditorText = vi.fn(() => "check /tmp/big.png");

			await handlers.get("session_start")!(undefined, ctx);
			await vi.advanceTimersByTimeAsync(300);

			const result = await handlers.get("input")!(
				{ text: "check /tmp/big.png", images: [] },
				ctx,
			);

			expect(result.action).toBe("transform");
			expect(result.images).toEqual([rawImage]);
		} finally {
			vi.useRealTimers();
		}
	});
});


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
				storeImage: vi.fn(async () => "image-view://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"),
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
				text: "[Image #1](image-view://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png)\nfix the conflict",
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
		const deps = {
			readImageContentFromPathAsync: vi.fn(async () => image),
			loadImageContentFromPath: vi.fn(async () => null),
			storeImage: vi.fn(async () => "image-view://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"),
		};
		const { handlers, ctx } = makeHarness(deps);

		const result = await handlers.get("input")!(
			{ text: "/tmp/fast.png explain this", images: [] },
			ctx,
		);

		expect(result).toEqual({
			action: "transform",
			text: "[Image #1](image-view://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png) explain this",
			images: [image],
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
			"[Image #1](file:///tmp/blob.png)",
		);
		expect(transform(stored, { messageType: "assistant" })).toBe(stored);

		const context = await handlers.get("context")!({
			messages: [{ role: "user", content: stored }],
		});
		expect(context.messages).toEqual([{ role: "user", content: "[Image #1]" }]);
	});
});
