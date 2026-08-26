import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ImageContent } from "./content.ts";

const execFileAsync = promisify(execFile);

export type ClipboardPayload =
	| { kind: "image"; image: ImageContent }
	| { kind: "text"; text: string }
	| { kind: "empty" };

export function supportsDirectClipboard(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
	return platform === "darwin" || platform === "win32" || Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

async function macImage(): Promise<ImageContent | undefined> {
	for (const [clipboardClass, extension, mimeType] of [
		["PNGf", "png", "image/png"],
		["JPEG", "jpg", "image/jpeg"],
	] as const) {
		const file = join(tmpdir(), `pi-image-view-clipboard-${randomUUID()}.${extension}`);
		try {
			await execFileAsync("osascript", [
				"-e", `set imageData to the clipboard as «class ${clipboardClass}»`,
				"-e", `set outputFile to open for access POSIX file ${JSON.stringify(file)} with write permission`,
				"-e", "set eof of outputFile to 0",
				"-e", "write imageData to outputFile",
				"-e", "close access outputFile",
			], { timeout: 1500, maxBuffer: 1024 * 1024 });
			const bytes = await readFile(file);
			if (bytes.length > 0 && bytes.length <= 50 * 1024 * 1024) {
				return { type: "image", data: bytes.toString("base64"), mimeType };
			}
		} catch {
			// Try the next format, then text.
		} finally {
			try { await unlink(file); } catch { /* best effort */ }
		}
	}
	return undefined;
}

function powershellExecutable(platform: NodeJS.Platform): string {
	if (platform === "win32") return "powershell.exe";
	for (const candidate of [
		"/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
		"/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe",
	]) if (existsSync(candidate)) return candidate;
	return "powershell.exe";
}

async function windowsImage(platform: NodeJS.Platform): Promise<ImageContent | undefined> {
	const script = [
		"$ErrorActionPreference = 'Stop'",
		"Add-Type -AssemblyName System.Windows.Forms | Out-Null",
		"Add-Type -AssemblyName System.Drawing | Out-Null",
		"$img = [System.Windows.Forms.Clipboard]::GetImage()",
		"if ($img -eq $null) { exit 2 }",
		"$ms = New-Object System.IO.MemoryStream",
		"$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
		"[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))",
	].join("; ");
	try {
		const { stdout } = await execFileAsync(powershellExecutable(platform), ["-NoProfile", "-NonInteractive", "-STA", "-Command", script], {
			timeout: 2500, encoding: "utf8", maxBuffer: 70 * 1024 * 1024,
		});
		const data = stdout.trim();
		const bytes = Buffer.from(data, "base64");
		return bytes.length > 0 && bytes.length <= 50 * 1024 * 1024
			? { type: "image", data, mimeType: "image/png" }
			: undefined;
	} catch { return undefined; }
}

async function clipboardText(platform: NodeJS.Platform): Promise<string | undefined> {
	try {
		const { stdout } = platform === "darwin"
			? await execFileAsync("pbpaste", [], { timeout: 1500, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
			: await execFileAsync(powershellExecutable(platform), ["-NoProfile", "-NonInteractive", "-Command", "[Console]::Out.Write((Get-Clipboard -Raw))"], { timeout: 2500, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
		return stdout || undefined;
	} catch { return undefined; }
}

export async function readDirectClipboard(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): Promise<ClipboardPayload> {
	if (!supportsDirectClipboard(env, platform)) return { kind: "empty" };
	const image = platform === "darwin" ? await macImage() : await windowsImage(platform);
	if (image) return { kind: "image", image };
	const text = await clipboardText(platform);
	return text ? { kind: "text", text } : { kind: "empty" };
}
