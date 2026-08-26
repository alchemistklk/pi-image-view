import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
	collectReferencedBlobNames,
	gcUnreferencedBlobs,
	putImageBlob,
	resolveImageReference,
} from "../src/blob-store.ts";

const image = { type: "image" as const, data: Buffer.from("same-image").toString("base64"), mimeType: "image/png" };

describe("image blob store", () => {
	it("deduplicates images by content hash and resolves their typed path", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-image-view-"));
		const first = await putImageBlob(image, root);
		const second = await putImageBlob(image, root);

		expect(second.reference).toBe(first.reference);
		expect(await readFile(first.displayPath, "utf8")).toBe("same-image");
		expect(resolveImageReference(first.reference, root)).toBe(first.displayPath);
	});

	it("keeps referenced blobs and removes only old unreferenced blobs", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-image-view-"));
		const sessions = join(root, "sessions");
		const blobs = join(root, "blobs");
		const kept = await putImageBlob(image, blobs);
		const orphan = join(blobs, `${"b".repeat(64)}.png`);
		await writeFile(orphan, "orphan");
		const old = new Date(Date.now() - 10 * 60_000);
		await utimes(orphan, old, old);
		await mkdir(sessions, { recursive: true });
		await writeFile(
			join(sessions, "session.jsonl"),
			JSON.stringify({ text: pathToFileURL(kept.displayPath).href }),
		);

		const references = await collectReferencedBlobNames([sessions]);
		const result = await gcUnreferencedBlobs(blobs, references, { graceMs: 5 * 60_000 });

		expect(result.deleted).toBe(1);
		expect(await stat(kept.displayPath)).toBeTruthy();
		await expect(stat(orphan)).rejects.toMatchObject({ code: "ENOENT" });
	});
});
