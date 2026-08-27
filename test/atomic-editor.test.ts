import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => {
	class CustomEditor {
		protected tui: { requestRender: () => void };
		onChange?: (text: string) => void;
		onPasteImage?: () => void;
		onSubmit?: (text: string) => void;
		state = { lines: [""], cursorLine: 0, cursorCol: 0 };
		undoStack: Array<{ lines: string[]; cursorLine: number; cursorCol: number }> = [];
		constructor(tui: { requestRender: () => void }) { this.tui = tui; }
		getCursor() { return { line: this.state.cursorLine, col: this.state.cursorCol }; }
		getLines() { return this.state.lines; }
		getText() { return this.state.lines.join("\n"); }
		setCursorCol(col: number) { this.state.cursorCol = col; }
		pushUndoSnapshot() { this.undoStack.push(structuredClone(this.state)); }
		handleInput(data: string) { if (data === "UNDO") { const prior = this.undoStack.pop(); if (prior) this.state = prior; } }
		insertTextAtCursor(text: string) { this.pushUndoSnapshot(); this.state.lines[0] = this.state.lines[0]!.slice(0, this.state.cursorCol) + text + this.state.lines[0]!.slice(this.state.cursorCol); this.state.cursorCol += text.length; }
		/** Mirrors the host's submitValue(): clear the draft, then notify. */
		submitValue() {
			const result = this.getText();
			this.state = { lines: [""], cursorLine: 0, cursorCol: 0 };
			this.undoStack = [];
			this.onSubmit?.(result);
		}
	}
	return { CustomEditor };
});

import { createAtomicMarkerEditor, enhanceAtomicMarkerEditor, ImageViewAtomicEditor } from "../src/atomic-editor.ts";
import { CustomEditor } from "@earendil-works/pi-coding-agent";

const keys = {
	matches(data: string, action: string) {
		return (data === "DELETE" && action === "tui.editor.deleteCharForward");
	},
};

function makeEditor(options: Partial<{ readClipboard: () => Promise<any>; attachImage: (image: any) => string }> = {}) {
	return new ImageViewAtomicEditor(
		{ requestRender: vi.fn() } as any,
		{} as any,
		keys as any,
		{
			readClipboard: options.readClipboard ?? (async () => ({ kind: "empty" })),
			attachImage: options.attachImage ?? (() => "[Image #1]"),
		},
	) as any;
}

/** Let the serialized paste queue drain. */
const drain = () => new Promise((r) => setImmediate(r));

function hostPaste(editor: any, fallback: () => void = () => {}): () => void {
	if (!editor.onPasteImage) editor.onPasteImage = fallback;
	return editor.onPasteImage;
}

/** An undecorated host editor, so the decorator path is actually exercised. */
function makeBareEditor(): any {
	return new (CustomEditor as any)({ requestRender: vi.fn() });
}

/**
 * Mirrors pi-zentui's `WrappedPolishedEditor`: a wrapper that owns no editing
 * state and forwards the host callbacks to the editor it wraps through
 * prototype accessors.
 */
class ForwardingWrapper {
	constructor(private readonly base: any) {}
	handleInput(data: string) { this.base.handleInput(data); }
	getText() { return this.base.getText(); }
	getLines() { return this.base.getLines(); }
	getCursor() { return this.base.getCursor(); }
	get onSubmit() { return this.base.onSubmit; }
	set onSubmit(value) { this.base.onSubmit = value; }
	get onPasteImage() { return this.base.onPasteImage; }
	set onPasteImage(value) { this.base.onPasteImage = value; }
	get actionHandlers() { return this.base.actionHandlers; }
}

describe("atomic editor adapter", () => {
	it("restores a whole-marker deletion through the host undo seam", () => {
		const editor = makeEditor();
		editor.state = { lines: ["[Image #1]x"], cursorLine: 0, cursorCol: 0 };

		editor.handleInput("DELETE");
		expect(editor.getText()).toBe("x");
		editor.handleInput("UNDO");
		expect(editor.getText()).toBe("[Image #1]x");
	});

	it("enhances an undecorated editor instance in place", () => {
		const base = makeBareEditor();
		expect(base[Symbol.for("pi-image-view.atomic-editor-installed")]).toBeUndefined();
		base.state = { lines: ["[Image #1]x"], cursorLine: 0, cursorCol: 0 };
		base.render = () => ["zentui-render"];
		const enhanced = createAtomicMarkerEditor(
			{ requestRender: vi.fn() } as any, {} as any, keys as any,
			{ readClipboard: async () => ({ kind: "empty" }), attachImage: () => "[Image #2]" },
			base,
		) as any;
		expect(enhanced).toBe(base);
		expect(enhanced[Symbol.for("pi-image-view.atomic-editor-installed")]).toBe(true);
		expect(enhanced.render()).toEqual(["zentui-render"]);
		enhanced.handleInput("DELETE");
		expect(enhanced.getText()).toBe("x");
	});

	it("declines a forwarding wrapper so host callbacks still reach the real editor", () => {
		const inner = makeBareEditor();
		const wrapper: any = new ForwardingWrapper(inner);
		const returned = enhanceAtomicMarkerEditor(
			wrapper, { requestRender: vi.fn() } as any, keys as any,
			{ readClipboard: async () => ({ kind: "empty" }), attachImage: () => "[Image #1]" },
		);

		expect(returned).toBe(wrapper);
		expect(wrapper[Symbol.for("pi-image-view.atomic-editor-installed")]).toBeUndefined();

		// Pi assigns the callbacks on whatever it was handed.
		const piSubmit = vi.fn();
		wrapper.onSubmit = piSubmit;
		inner.state = { lines: ["hello"], cursorLine: 0, cursorCol: 5 };
		inner.submitValue();

		// Shadowing the wrapper's forwarding accessor would strand this on the wrapper.
		expect(inner.onSubmit).toBe(piSubmit);
		expect(piSubmit).toHaveBeenCalledWith("hello");
	});

	it("still applies atomic behavior through a wrapper whose base is enhanced", () => {
		const inner = makeEditor();
		inner.state = { lines: ["[Image #1]x"], cursorLine: 0, cursorCol: 0 };
		const wrapper: any = new ForwardingWrapper(inner);
		enhanceAtomicMarkerEditor(
			wrapper, { requestRender: vi.fn() } as any, keys as any,
			{ readClipboard: async () => ({ kind: "empty" }), attachImage: () => "[Image #1]" },
		);

		wrapper.handleInput("DELETE");
		expect(wrapper.getText()).toBe("x");
	});

	it("defers to the host when the undo snapshot seam is unavailable", () => {
		const prototype = Object.getPrototypeOf(Object.getPrototypeOf(makeEditor()));
		const fallback = vi.spyOn(prototype, "handleInput");
		const editor = makeEditor();
		editor.state = { lines: ["[Image #1]x"], cursorLine: 0, cursorCol: 0 };
		editor.pushUndoSnapshot = undefined;

		editor.handleInput("DELETE");

		expect(fallback).toHaveBeenCalledWith("DELETE");
		expect(editor.getText()).toBe("[Image #1]x");
		fallback.mockRestore();
	});
});

describe("clipboard paste lifecycle", () => {
	it("inserts a clipboard image marker into the draft it was started for", async () => {
		const editor = makeEditor({
			readClipboard: async () => ({ kind: "image", image: { type: "image", data: "x", mimeType: "image/png" } }),
		});

		hostPaste(editor)();
		await drain();

		expect(editor.getText()).toBe("[Image #1]");
	});

	it("drops a clipboard read that resolves after the draft was submitted", async () => {
		let release: (payload: any) => void = () => {};
		const editor = makeEditor({
			readClipboard: () => new Promise((resolve) => { release = resolve; }),
		});
		const submitted: string[] = [];
		editor.onSubmit = (text: string) => submitted.push(text);
		editor.state = { lines: ["hello"], cursorLine: 0, cursorCol: 5 };

		hostPaste(editor)();
		editor.submitValue();
		release({ kind: "image", image: { type: "image", data: "x", mimeType: "image/png" } });
		await drain();

		expect(submitted).toEqual(["hello"]);
		expect(editor.getText()).toBe("");
	});

	it("keeps the host submit handler reachable through the interceptor", () => {
		const editor = makeEditor();
		const onSubmit = vi.fn();
		editor.onSubmit = onSubmit;

		editor.state = { lines: ["draft"], cursorLine: 0, cursorCol: 5 };
		editor.submitValue();

		expect(onSubmit).toHaveBeenCalledWith("draft");
	});

	it("calls Pi's captured paste handler when direct clipboard access is empty or rejects", async () => {
		const fallback = vi.fn();
		const empty = makeEditor();
		hostPaste(empty, fallback)();
		await drain();
		expect(fallback).toHaveBeenCalledTimes(1);

		const rejected = makeEditor({ readClipboard: async () => { throw new Error("command disappeared"); } });
		hostPaste(rejected, fallback)();
		await drain();
		expect(fallback).toHaveBeenCalledTimes(2);
	});

	it("does not call the fallback after the draft has been submitted", async () => {
		let release: (payload: any) => void = () => {};
		const editor = makeEditor({ readClipboard: () => new Promise((resolve) => { release = resolve; }) });
		const fallback = vi.fn();
		hostPaste(editor, fallback)();
		editor.submitValue();
		release({ kind: "empty" });
		await drain();
		expect(fallback).not.toHaveBeenCalled();
	});

	it("preserves the editor as callback receiver", async () => {
		const editor = makeEditor();
		let submitReceiver: unknown;
		editor.onSubmit = function (this: unknown) { submitReceiver = this; };
		editor.state = { lines: ["draft"], cursorLine: 0, cursorCol: 5 };
		editor.submitValue();
		expect(submitReceiver).toBe(editor);

		const empty = makeEditor();
		let pasteReceiver: unknown;
		hostPaste(empty, function (this: unknown) { pasteReceiver = this; })();
		await drain();
		expect(pasteReceiver).toBe(empty);
	});

	it("serializes overlapping pastes and survives a rejected clipboard read", async () => {
		const payloads: Array<Promise<any>> = [
			Promise.reject(new Error("clipboard unavailable")),
			Promise.resolve({ kind: "text", text: "second" }),
		];
		payloads[0]!.catch(() => {});
		let call = 0;
		const editor = makeEditor({ readClipboard: () => payloads[call++]! });

		hostPaste(editor)();
		hostPaste(editor)();
		await drain();

		expect(editor.getText()).toBe("second");
	});
});
