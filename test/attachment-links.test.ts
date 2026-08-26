import { describe, expect, it } from "vitest";
import {
	createImageMarkerLink,
	renderImageMarkerLinks,
	stripImageMarkerLinks,
	sanitizeModelMessages,
} from "../src/attachment-links.ts";

describe("attachment links", () => {
	const ref = `image-view://sha256/${"a".repeat(64)}.png`;
	const fileRef = `file:///tmp/image-view/blobs/${"a".repeat(64)}.png`;

	it("stores an internal reference while rendering a clickable file link", () => {
		const stored = createImageMarkerLink("[Image #1]", ref);
		expect(stored).toBe(`[Image #1](${ref})`);
		expect(renderImageMarkerLinks(stored, () => "/tmp/blob.png")).toBe(
			"[Image #1](file:///tmp/blob.png)",
		);
	});

	it("keeps direct file targets clickable while hiding them from model context", () => {
		const stored = createImageMarkerLink("[Image #1]", fileRef);
		expect(stored).toBe(`[Image #1](${fileRef})`);
		expect(renderImageMarkerLinks(stored, () => undefined)).toBe(stored);
		expect(stripImageMarkerLinks(stored)).toBe("[Image #1]");
	});

	it("removes internal targets from model-facing text", () => {
		expect(stripImageMarkerLinks(`Compare [Image #1](${ref}) now`)).toBe(
			"Compare [Image #1] now",
		);
	});
	it("sanitizes string and structured text without changing image blocks", () => {
		const image = { type: "image", data: "RAW", mimeType: "image/png" };
		const messages = sanitizeModelMessages([
			{ role: "user", content: `[Image #1](${ref})` },
			{ role: "user", content: [{ type: "text", text: `See [Image #1](${ref})` }, image] },
		]);
		expect(messages).toEqual([
			{ role: "user", content: "[Image #1]" },
			{ role: "user", content: [{ type: "text", text: "See [Image #1]" }, image] },
		]);
	});

});
