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

import { ImageViewAtomicEditor } from "../src/atomic-editor.ts";

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

describe("atomic editor adapter", () => {
	it("restores a whole-marker deletion through the host undo seam", () => {
		const editor = makeEditor();
		editor.state = { lines: ["[Image #1]x"], cursorLine: 0, cursorCol: 0 };

		editor.handleInput("DELETE");
		expect(editor.getText()).toBe("x");
		editor.handleInput("UNDO");
		expect(editor.getText()).toBe("[Image #1]x");
	});

	it("defers to the host when the undo snapshot seam is unavailable", () => {
		const editor = makeEditor();
		editor.state = { lines: ["[Image #1]x"], cursorLine: 0, cursorCol: 0 };
		editor.pushUndoSnapshot = undefined;
		const fallback = vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(editor)), "handleInput");

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

		editor.onPasteImage();
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

		editor.onPasteImage();
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

	it("serializes overlapping pastes and survives a rejected clipboard read", async () => {
		const payloads: Array<Promise<any>> = [
			Promise.reject(new Error("clipboard unavailable")),
			Promise.resolve({ kind: "text", text: "second" }),
		];
		payloads[0]!.catch(() => {});
		let call = 0;
		const editor = makeEditor({ readClipboard: () => payloads[call++]! });

		editor.onPasteImage();
		editor.onPasteImage();
		await drain();

		expect(editor.getText()).toBe("second");
	});
});
