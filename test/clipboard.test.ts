import { describe, expect, it, vi } from "vitest";
import {
	canReadDirectClipboard,
	IMAGE_CLIPBOARD_MAX_BYTES,
	readDirectClipboard,
	supportsDirectClipboard,
	TEXT_CLIPBOARD_MAX_BYTES,
	type ClipboardDeps,
} from "../src/clipboard.ts";

const linuxEnv = { PATH: "/bin", WAYLAND_DISPLAY: "wayland-0" };

function available(command: string): ClipboardDeps {
	return { access: async (path) => { if (path !== `/bin/${command}`) throw new Error("missing"); } };
}

function runner(responses: Array<string | Buffer | Error>) {
	const execFile = vi.fn(async () => {
		const next = responses.shift();
		if (next instanceof Error) throw next;
		return { stdout: next ?? "" };
	});
	return { execFile };
}

describe("direct clipboard platform support", () => {
	it("keeps macOS, Windows, and WSL support", () => {
		expect(supportsDirectClipboard({}, "darwin")).toBe(true);
		expect(supportsDirectClipboard({}, "win32")).toBe(true);
		expect(supportsDirectClipboard({ WSL_DISTRO_NAME: "Ubuntu" }, "linux")).toBe(true);
	});

	it("asynchronously gates native Linux on a display and available command", async () => {
		await expect(canReadDirectClipboard(linuxEnv, "linux", available("wl-paste"))).resolves.toBe(true);
		await expect(canReadDirectClipboard({ PATH: "/bin", DISPLAY: ":0" }, "linux", available("xclip"))).resolves.toBe(true);
		await expect(canReadDirectClipboard({ PATH: "/bin" }, "linux", available("wl-paste"))).resolves.toBe(false);
		await expect(canReadDirectClipboard({ ...linuxEnv, DISPLAY: ":0" }, "linux", available("xclip"))).resolves.toBe(true);
		await expect(canReadDirectClipboard(linuxEnv, "linux", available("xclip"))).resolves.toBe(false);
	});
});

describe("native Linux clipboard readers", () => {
	it("reads an allowlisted Wayland image MIME as binary", async () => {
		const commands = runner(["image/png\ntext/plain\n", Buffer.from([1, 2, 3])]);
		const result = await readDirectClipboard(linuxEnv, "linux", { ...available("wl-paste"), ...commands });

		expect(result).toEqual({ kind: "image", image: { type: "image", mimeType: "image/png", data: "AQID" } });
		expect(commands.execFile).toHaveBeenNthCalledWith(1, "wl-paste", ["--list-types"], expect.objectContaining({ timeout: 1500, maxBuffer: TEXT_CLIPBOARD_MAX_BYTES }));
		expect(commands.execFile).toHaveBeenNthCalledWith(2, "wl-paste", ["--no-newline", "--type", "image/png"], expect.objectContaining({ timeout: 1500, maxBuffer: IMAGE_CLIPBOARD_MAX_BYTES, encoding: "buffer" }));
	});

	it("reads X11 xclip image targets without shell execution", async () => {
		const commands = runner(["TARGETS\nimage/webp\n", Buffer.from("webp")]);
		const result = await readDirectClipboard({ PATH: "/bin", DISPLAY: ":0" }, "linux", { ...available("xclip"), ...commands });

		expect(result).toEqual({ kind: "image", image: { type: "image", mimeType: "image/webp", data: Buffer.from("webp").toString("base64") } });
		expect(commands.execFile).toHaveBeenNthCalledWith(1, "xclip", ["-selection", "clipboard", "-out", "-target", "TARGETS"], expect.any(Object));
		expect(commands.execFile).toHaveBeenNthCalledWith(2, "xclip", ["-selection", "clipboard", "-out", "-target", "image/webp"], expect.any(Object));
	});

	it("uses xsel only for text because its -t flag is a timeout, not a MIME target", async () => {
		const commands = runner(["line one\nline two\n"]);
		const result = await readDirectClipboard({ PATH: "/bin", DISPLAY: ":0" }, "linux", { ...available("xsel"), ...commands });

		expect(result).toEqual({ kind: "text", text: "line one\nline two\n" });
		expect(commands.execFile).toHaveBeenCalledWith("xsel", ["--clipboard", "--output"], expect.objectContaining({ timeout: 1500, maxBuffer: TEXT_CLIPBOARD_MAX_BYTES }));
	});

	it("falls through unsupported image MIME to exact text including trailing newlines", async () => {
		const commands = runner(["image/tiff\ntext/plain\n", "keep this newline\n"]);
		await expect(readDirectClipboard(linuxEnv, "linux", { ...available("wl-paste"), ...commands })).resolves.toEqual({ kind: "text", text: "keep this newline\n" });
		expect(commands.execFile).toHaveBeenLastCalledWith("wl-paste", ["--no-newline", "--type", "text/plain"], expect.any(Object));
	});

	it("returns empty for a missing command, timeout, or failed runtime read", async () => {
		await expect(readDirectClipboard(linuxEnv, "linux", available("xclip"))).resolves.toEqual({ kind: "empty" });
		await expect(readDirectClipboard(linuxEnv, "linux", { ...available("wl-paste"), ...runner([new Error("timed out")]) })).resolves.toEqual({ kind: "empty" });
		await expect(readDirectClipboard({ PATH: "/bin", DISPLAY: ":0" }, "linux", { ...available("xclip"), ...runner(["image/png\n", new Error("owner disappeared")]) })).resolves.toEqual({ kind: "empty" });
	});

	it("rejects over-limit image and text output even from an injected runner", async () => {
		const tooLargeImage = Buffer.alloc(IMAGE_CLIPBOARD_MAX_BYTES + 1, 1);
		await expect(readDirectClipboard(linuxEnv, "linux", { ...available("wl-paste"), ...runner(["image/png\n", tooLargeImage]) })).resolves.toEqual({ kind: "empty" });
		const tooLargeText = Buffer.alloc(TEXT_CLIPBOARD_MAX_BYTES + 1, 1);
		await expect(readDirectClipboard(linuxEnv, "linux", { ...available("wl-paste"), ...runner(["text/plain\n", tooLargeText]) })).resolves.toEqual({ kind: "empty" });
	});
});
