import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The PATH probe cache only applies when no dependencies are injected, so this
 * suite mocks the filesystem instead and keeps its own module registry.
 */
let installed = new Set<string>();

vi.mock("node:fs/promises", () => ({
	access: vi.fn(async () => {}),
	stat: vi.fn(async (path: string) => {
		if (!installed.has(String(path))) throw new Error("ENOENT");
		return { isFile: () => true };
	}),
	readFile: vi.fn(),
	unlink: vi.fn(),
}));

const linuxEnv = { PATH: "/bin", WAYLAND_DISPLAY: "wayland-0" };

describe("Linux backend probe cache", () => {
	beforeEach(() => {
		installed = new Set();
		vi.resetModules();
	});

	it("rediscovers a backend installed after a failed probe", async () => {
		const { canReadDirectClipboard } = await import("../src/clipboard.ts");

		await expect(canReadDirectClipboard(linuxEnv, "linux")).resolves.toBe(false);
		installed.add("/bin/wl-paste");
		await expect(canReadDirectClipboard(linuxEnv, "linux")).resolves.toBe(true);
	});

	it("serves a successful probe from cache without rescanning PATH", async () => {
		const { canReadDirectClipboard } = await import("../src/clipboard.ts");
		const { stat } = await import("node:fs/promises");
		installed.add("/bin/wl-paste");

		await expect(canReadDirectClipboard(linuxEnv, "linux")).resolves.toBe(true);
		const afterFirst = vi.mocked(stat).mock.calls.length;
		await expect(canReadDirectClipboard(linuxEnv, "linux")).resolves.toBe(true);

		expect(vi.mocked(stat).mock.calls.length).toBe(afterFirst);
	});

	it("ignores a cached backend when the display environment changes", async () => {
		const { canReadDirectClipboard } = await import("../src/clipboard.ts");
		installed.add("/bin/wl-paste");

		await expect(canReadDirectClipboard(linuxEnv, "linux")).resolves.toBe(true);
		await expect(canReadDirectClipboard({ PATH: "/bin" }, "linux")).resolves.toBe(false);
	});
});
