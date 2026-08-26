import { describe, expect, it } from "vitest";
import { supportsDirectClipboard } from "../src/clipboard.ts";

describe("direct clipboard platform support", () => {
	it("enables direct image paste on macOS, Windows, and WSL", () => {
		expect(supportsDirectClipboard({}, "darwin")).toBe(true);
		expect(supportsDirectClipboard({}, "win32")).toBe(true);
		expect(supportsDirectClipboard({ WSL_DISTRO_NAME: "Ubuntu" }, "linux")).toBe(true);
	});

	it("keeps native Linux on Pi's built-in paste plus burst scans", () => {
		expect(supportsDirectClipboard({}, "linux")).toBe(false);
	});
});
