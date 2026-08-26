import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ImageContent } from "./content.ts";

const BLOB_NAME_RE = /^[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;
const REFERENCE_RE = /image-view:\/\/sha256\/([a-f0-9]{64}\.(?:png|jpg|gif|webp))/g;

const EXTENSION_BY_MIME: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

export interface StoredImageBlob {
	reference: string;
	displayPath: string;
	name: string;
}

export function defaultBlobRoot(): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(agentDir, "image-view", "blobs");
}

export async function putImageBlob(
	image: ImageContent,
	root = defaultBlobRoot(),
): Promise<StoredImageBlob> {
	const extension = EXTENSION_BY_MIME[image.mimeType.toLowerCase()];
	if (!extension) throw new Error(`Unsupported image MIME type: ${image.mimeType}`);
	const bytes = Buffer.from(image.data, "base64");
	const hash = createHash("sha256").update(bytes).digest("hex");
	const name = `${hash}.${extension}`;
	const displayPath = join(root, name);
	await mkdir(root, { recursive: true });
	try {
		await writeFile(displayPath, bytes, { flag: "wx" });
	} catch (error) {
		if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
	}
	return { reference: `image-view://sha256/${name}`, displayPath, name };
}

export function resolveImageReference(
	reference: string,
	root = defaultBlobRoot(),
): string | undefined {
	const match = /^image-view:\/\/sha256\/([a-f0-9]{64}\.(?:png|jpg|gif|webp))$/.exec(reference);
	return match ? join(root, match[1]) : undefined;
}

async function collectJsonlFiles(root: string, output: string[]): Promise<void> {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
		throw error;
	}
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) await collectJsonlFiles(path, output);
		else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(path);
	}
}

export async function collectReferencedBlobNames(sessionRoots: string[]): Promise<Set<string>> {
	const files: string[] = [];
	for (const root of new Set(sessionRoots)) await collectJsonlFiles(root, files);
	const references = new Set<string>();
	for (const file of files) {
		const text = await readFile(file, "utf8");
		for (const match of text.matchAll(REFERENCE_RE)) references.add(match[1]);
	}
	return references;
}

export async function gcUnreferencedBlobs(
	root: string,
	referencedNames: Set<string>,
	options: { graceMs?: number; now?: number } = {},
): Promise<{ deleted: number; bytes: number }> {
	const graceMs = options.graceMs ?? 5 * 60_000;
	const now = options.now ?? Date.now();
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
			return { deleted: 0, bytes: 0 };
		}
		throw error;
	}
	let deleted = 0;
	let bytes = 0;
	for (const entry of entries) {
		if (!entry.isFile() || !BLOB_NAME_RE.test(entry.name) || referencedNames.has(entry.name)) continue;
		const file = join(root, entry.name);
		const metadata = await stat(file);
		if (now - metadata.mtimeMs < graceMs) continue;
		await unlink(file);
		deleted += 1;
		bytes += metadata.size;
	}
	return { deleted, bytes };
}

export function sessionScanRoots(sessionDir: string): string[] {
	const parent = dirname(sessionDir);
	return basename(parent) === "sessions" ? [parent] : [sessionDir];
}
