import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", () => ({
	getCapabilities: () => ({ images: null }),
	getImageDimensions: () => null,
	calculateImageRows: () => 0,
	getCellDimensions: () => ({ width: 0, height: 0 }),
}));

import { sanitizeModelMessages } from "../src/attachment-links.ts";
import { registerImagePreviewExtension } from "../src/extension-runtime.ts";

const internal = `file:///tmp/image-view/blobs/${"a".repeat(64)}.png`;
const image = (data: string) => ({ type: "image", data, mimeType: "image/png" });

function contextHarness() {
	const handlers = new Map<string, (...args: any[]) => any>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => void }>();
	const notify = vi.fn();
	registerImagePreviewExtension({
		on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
		registerCommand: (name: string, options: { handler: (args: string, ctx: any) => void }) => commands.set(name, options),
	} as any, {
		readImageContentFromPathAsync: vi.fn(async () => null),
		loadImageContentFromPath: vi.fn(async () => null),
	});
	const ctx = {
		cwd: "/tmp",
		isIdle: () => true,
		hasUI: false,
		ui: { notify, setWidget: vi.fn(), getEditorText: vi.fn(() => ""), setEditorText: vi.fn(), theme: {} },
	};
	return { handlers, command: commands.get("image-view-context")!, ctx, notify };
}

describe("model image context filtering", () => {
	it("defaults to all images while stripping only internal marker targets", () => {
		const messages = [
			{ role: "user", content: `[[Image #1]](${internal}) and [docs](https://example.com)` },
			{ role: "user", content: [{ type: "text", text: `[[Image #2]](${internal}) [visible](https://pi.dev)` }, image("USER")] },
			{ role: "toolResult", content: [image("TOOL")] },
		];

		expect(sanitizeModelMessages(messages)).toEqual([
			{ role: "user", content: "[Image #1] and [docs](https://example.com)" },
			{ role: "user", content: [{ type: "text", text: "[Image #2] [visible](https://pi.dev)" }, image("USER")] },
			{ role: "toolResult", content: [image("TOOL")] },
		]);
	});

	it("latest keeps user and tool-result images only in the newest image-bearing user turn", () => {
		const messages = [
			{ role: "user", content: [{ type: "text", text: "old" }, image("OLD_USER")] },
			{ role: "toolResult", content: [image("OLD_TOOL")] },
			{ role: "assistant", content: [{ type: "text", text: "done" }] },
			{ role: "user", content: [{ type: "text", text: "inspect screenshot" }] },
			{ role: "assistant", content: [{ type: "text", text: "calling tool" }] },
			{ role: "toolResult", content: [image("NEW_TOOL")] },
			{ role: "user", content: [{ type: "text", text: "continue without another image" }] },
		];

		const result = sanitizeModelMessages(messages, "latest");
		expect(result[0]!.content).toEqual([{ type: "text", text: "old" }]);
		expect(result[1]!.content).toEqual([{ type: "text", text: "[Image omitted from model context]" }]);
		expect(result[5]!.content).toEqual([image("NEW_TOOL")]);
	});

	it("none removes every image, adds placeholders for image-only messages, and does not mutate input", () => {
		const messages = [
			{ role: "user", content: [image("USER")] },
			{ role: "toolResult", content: [{ type: "text", text: "result" }, image("TOOL")] },
		];
		const snapshot = structuredClone(messages);

		const result = sanitizeModelMessages(messages, "none");

		expect(result).toEqual([
			{ role: "user", content: [{ type: "text", text: "[Image omitted from model context]" }] },
			{ role: "toolResult", content: [{ type: "text", text: "result" }] },
		]);
		expect(messages).toEqual(snapshot);
		expect(result).not.toBe(messages);
	});
});

describe("/image-view-context", () => {
	it("shows status, validates arguments, updates the current session mode, and resets on session start", async () => {
		const { handlers, command, ctx, notify } = contextHarness();
		const event = { messages: [{ role: "user", content: [image("ONE")] }] };

		command.handler("", ctx);
		command.handler("bogus", ctx);
		command.handler("none", ctx);
		expect(notify.mock.calls).toEqual([
			["Image context mode: all", "info"],
			["Usage: /image-view-context [status|all|latest|none]", "error"],
			["Image context mode: none", "info"],
		]);
		expect(handlers.get("context")!(event).messages[0].content).toEqual([
			{ type: "text", text: "[Image omitted from model context]" },
		]);

		await handlers.get("session_start")!(undefined, ctx);
		command.handler("status", ctx);
		expect(notify).toHaveBeenLastCalledWith("Image context mode: all", "info");
		expect(handlers.get("context")!(event).messages[0].content).toEqual([image("ONE")]);
	});

	it.each(["all", "latest", "none"])("accepts %s", (mode) => {
		const { command, ctx, notify } = contextHarness();
		command.handler(mode, ctx);
		expect(notify).toHaveBeenLastCalledWith(`Image context mode: ${mode}`, "info");
	});
});
