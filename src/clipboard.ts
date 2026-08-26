import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageContent } from "./content.ts";

export type ClipboardPayload =
	| { kind: "image"; image: ImageContent }
	| { kind: "text"; text: string }
	| { kind: "empty" };

export function supportsDirectClipboard(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
	return platform === "darwin" || platform === "win32" || Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

function macImage(): ImageContent | undefined {
	for (const [clipboardClass, extension, mimeType] of [
		["PNGf", "png", "image/png"],
		["JPEG", "jpg", "image/jpeg"],
	] as const) {
		const file = join(tmpdir(), `pi-image-view-clipboard-${randomUUID()}.${extension}`);
		try {
			const result = spawnSync("osascript", [
				"-e", `set imageData to the clipboard as «class ${clipboardClass}»`,
				"-e", `set outputFile to open for access POSIX file ${JSON.stringify(file)} with write permission`,
				"-e", "set eof of outputFile to 0",
				"-e", "write imageData to outputFile",
				"-e", "close access outputFile",
			], { timeout: 3000, stdio: "ignore" });
			if (result.status !== 0) continue;
			const bytes = readFileSync(file);
			if (bytes.length > 0 && bytes.length <= 50 * 1024 * 1024) {
				return { type: "image", data: bytes.toString("base64"), mimeType };
			}
		} catch {
			// Try the next format, then text.
		} finally {
			try { unlinkSync(file); } catch { /* best effort */ }
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

function windowsImage(platform: NodeJS.Platform): ImageContent | undefined {
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
		const result = spawnSync(powershellExecutable(platform), ["-NoProfile", "-NonInteractive", "-STA", "-Command", script], {
			timeout: 5000, encoding: "utf8", maxBuffer: 70 * 1024 * 1024,
		});
		if (result.status !== 0) return undefined;
		const data = (result.stdout || "").trim();
		const bytes = Buffer.from(data, "base64");
		return bytes.length > 0 && bytes.length <= 50 * 1024 * 1024
			? { type: "image", data, mimeType: "image/png" }
			: undefined;
	} catch { return undefined; }
}

function clipboardText(platform: NodeJS.Platform): string | undefined {
	try {
		const result = platform === "darwin"
			? spawnSync("pbpaste", [], { timeout: 3000, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
			: spawnSync(powershellExecutable(platform), ["-NoProfile", "-NonInteractive", "-Command", "[Console]::Out.Write((Get-Clipboard -Raw))"], { timeout: 5000, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
		return result.status === 0 && result.stdout ? result.stdout : undefined;
	} catch { return undefined; }
}

export function readDirectClipboard(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): ClipboardPayload {
	if (!supportsDirectClipboard(env, platform)) return { kind: "empty" };
	const image = platform === "darwin" ? macImage() : windowsImage(platform);
	if (image) return { kind: "image", image };
	const text = clipboardText(platform);
	return text ? { kind: "text", text } : { kind: "empty" };
}
