import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { markerSpanAt, segmentAtomicImageMarkers } from "./marker-spans.ts";

interface EditorInternals {
	state: { lines: string[]; cursorLine: number; cursorCol: number };
	segment?: (text: string, mode?: "word" | "grapheme") => Iterable<Intl.SegmentData>;
	pushUndoSnapshot?: () => void;
	setCursorCol?: (col: number) => void;
	lastAction?: unknown;
	historyIndex?: number;
}

export class ImageViewAtomicEditor extends CustomEditor {
	constructor(tui: TUI, theme: EditorTheme, private readonly imageViewKeys: KeybindingsManager) {
		super(tui, theme, imageViewKeys);
		const internals = this as unknown as EditorInternals;
		internals.segment = (text) => segmentAtomicImageMarkers(text);
	}

	override handleInput(data: string): void {
		const action = this.imageViewKeys.matches(data, "tui.editor.cursorLeft") ? "left"
			: this.imageViewKeys.matches(data, "tui.editor.cursorRight") ? "right"
				: this.imageViewKeys.matches(data, "tui.editor.deleteCharBackward") ? "backspace"
					: this.imageViewKeys.matches(data, "tui.editor.deleteCharForward") ? "delete"
						: undefined;
		if (!action) return super.handleInput(data);

		const cursor = this.getCursor();
		const line = this.getLines()[cursor.line] ?? "";
		const span = markerSpanAt(line, cursor.col, action);
		if (!span) return super.handleInput(data);
		if (action === "left" || action === "right") {
			this.setCursor(action === "left" ? span.start : span.end);
			this.tui.requestRender();
			return;
		}
		this.deleteRange(cursor.line, span.start, span.end);
	}

	private setCursor(col: number): void {
		const internals = this as unknown as EditorInternals;
		if (internals.setCursorCol) internals.setCursorCol(col);
		else internals.state.cursorCol = col;
	}

	private deleteRange(lineIndex: number, start: number, end: number): void {
		const internals = this as unknown as EditorInternals;
		internals.pushUndoSnapshot?.();
		const line = internals.state.lines[lineIndex] ?? "";
		internals.state.lines[lineIndex] = line.slice(0, start) + line.slice(end);
		internals.state.cursorLine = lineIndex;
		this.setCursor(start);
		internals.lastAction = null;
		internals.historyIndex = -1;
		this.onChange?.(this.getText());
		this.tui.requestRender();
	}
}

export function createAtomicMarkerEditor(tui: TUI, theme: EditorTheme, keys: KeybindingsManager) {
	return new ImageViewAtomicEditor(tui, theme, keys);
}
