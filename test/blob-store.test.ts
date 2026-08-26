import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { putImageBlob, resolveImageReference } from "../src/blob-store.ts";

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

});
