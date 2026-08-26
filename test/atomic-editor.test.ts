import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => {
	class CustomEditor {
		protected tui: { requestRender: () => void };
		onChange?: (text: string) => void;
		onPasteImage?: () => void;
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
	}
	return { CustomEditor };
});

import { ImageViewAtomicEditor } from "../src/atomic-editor.ts";

const keys = {
	matches(data: string, action: string) {
		return (data === "DELETE" && action === "tui.editor.deleteCharForward");
	},
};

describe("atomic editor adapter", () => {
	it("restores a whole-marker deletion through the host undo seam", () => {
		const editor = new ImageViewAtomicEditor(
			{ requestRender: vi.fn() } as any,
			{} as any,
			keys as any,
			{ readClipboard: async () => ({ kind: "empty" }), attachImage: () => "[Image #1]" },
		) as any;
		editor.state = { lines: ["[Image #1]x"], cursorLine: 0, cursorCol: 0 };

		editor.handleInput("DELETE");
		expect(editor.getText()).toBe("x");
		editor.handleInput("UNDO");
		expect(editor.getText()).toBe("[Image #1]x");
	});
});
