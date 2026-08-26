export interface DetectedImagePath {
	/** Exact substring as it appears in the editor text (used for tracking/removal). */
	raw: string;
	/** Filesystem path with surrounding quotes stripped and shell escapes resolved. */
	path: string;
}

const IMAGE_EXT = "(?:png|jpe?g|gif|webp)";
const PATH_END = `(?=[\\s,.;:!?)\\]]|$)`;
const BARE_PATH = `(?:~/|\\.\\.?/|/)(?:\\\\.|[^\\s:*?"<>|])*\\.${IMAGE_EXT}${PATH_END}`;
const WINDOWS_DRIVE_PATH = `[A-Za-z]:[\\\\/][^\\s*?"<>|]*\\.${IMAGE_EXT}${PATH_END}`;
const WINDOWS_UNC_PATH = `\\\\\\\\[^\\\\/\\s:*?"<>|]+[\\\\/][^\\s*?"<>|]*\\.${IMAGE_EXT}${PATH_END}`;
const DOUBLE_QUOTED_PATH = `"(?:\\\\.|[^"\\\\])*\\.${IMAGE_EXT}"`;
const SINGLE_QUOTED_PATH = `'(?:\\\\.|[^'\\\\])*\\.${IMAGE_EXT}'`;
const IMAGE_PATH_RE = new RegExp(
	`${DOUBLE_QUOTED_PATH}|${SINGLE_QUOTED_PATH}|${WINDOWS_UNC_PATH}|${WINDOWS_DRIVE_PATH}|${BARE_PATH}`,
	"gi",
);

export interface PathNormalizationOptions {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
}

function stripQuotes(raw: string): string {
	return (
		(raw.startsWith('"') && raw.endsWith('"')) ||
		(raw.startsWith("'") && raw.endsWith("'"))
	) ? raw.slice(1, -1) : raw;
}

export function normalizeDetectedImagePath(
	raw: string,
	options: PathNormalizationOptions = {},
): string {
	const value = stripQuotes(raw);
	const drive = /^([A-Za-z]):[\\\\/](.*)$/.exec(value);
	if (drive) {
		const platform = options.platform ?? process.platform;
		const env = options.env ?? process.env;
		if (platform === "linux" && (env.WSL_DISTRO_NAME || env.WSL_INTEROP)) {
			return `/mnt/${drive[1]!.toLowerCase()}/${drive[2]!.replace(/\\/g, "/")}`;
		}
		return value;
	}
	if (/^\\\\/.test(value)) return value;
	return value.replace(/\\(.)/g, "$1");
}

export function extractImagePaths(text: string): DetectedImagePath[] {
	const re = new RegExp(IMAGE_PATH_RE.source, IMAGE_PATH_RE.flags);
	const results: DetectedImagePath[] = [];
	for (const match of text.matchAll(re)) {
		const raw = match[0];
		results.push({ raw, path: normalizeDetectedImagePath(raw) });
	}
	return results;
}
