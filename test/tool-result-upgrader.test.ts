import { describe, expect, it, vi } from "vitest";
import { upgradeScreenshotToolResult } from "../src/tool-result-upgrader.ts";

const image = (data: string) => ({ type: "image" as const, data, mimeType: "image/png" });

describe("screenshot tool-result upgrading", () => {
	it("resizes an inline screenshot image", async () => {
		const resize = vi.fn(async () => image("THUMB"));
		const result = await upgradeScreenshotToolResult(
			{ toolName: "take_screenshot", content: [{ type: "text", text: "done" }, image("RAW")], isError: false },
			"/tmp",
			vi.fn(async () => null),
			resize,
		);
		expect(result?.content).toEqual([{ type: "text", text: "done" }, image("THUMB")]);
	});

	it("loads and resizes a saved screenshot path", async () => {
		const load = vi.fn(async () => image("RAW"));
		const resize = vi.fn(async () => image("THUMB"));
		const result = await upgradeScreenshotToolResult(
			{ toolName: "take_screenshot", content: [{ type: "text", text: "Saved screenshot to shot.png" }], isError: false },
			"/tmp",
			load,
			resize,
		);
		expect(load).toHaveBeenCalledWith("/tmp/shot.png");
		expect(result?.content).toEqual([
			{ type: "text", text: "Saved screenshot to shot.png" },
			image("THUMB"),
		]);
	});

	it("ignores non-screenshot tools", async () => {
		const result = await upgradeScreenshotToolResult(
			{ toolName: "read", content: [image("RAW")], isError: false },
			"/tmp",
			vi.fn(async () => null),
			vi.fn(async () => image("THUMB")),
		);
		expect(result).toBeUndefined();
	});
});
