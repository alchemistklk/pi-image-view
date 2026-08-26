import { describe, expect, it } from "vitest";
import { imageMarkerSpans, markerSpanAt, segmentAtomicImageMarkers } from "../src/marker-spans.ts";

describe("atomic image markers", () => {
	it("segments a marker as one editor token", () => {
		const text = "before [Image #12] after";
		expect(imageMarkerSpans(text)).toEqual([{ start: 7, end: 18, text: "[Image #12]" }]);
		expect(segmentAtomicImageMarkers(text).map((part) => part.segment)).toContain("[Image #12]");
		const words = segmentAtomicImageMarkers(text, new Intl.Segmenter("en", { granularity: "word" }));
		expect(words.map((part) => part.segment)).toEqual(expect.arrayContaining(["before", "[Image #12]", "after"]));
	});

	it("matches movement and deletion across the whole marker", () => {
		const text = "x[Image #1]y";
		expect(markerSpanAt(text, 5, "left")).toMatchObject({ start: 1, end: 11 });
		expect(markerSpanAt(text, 5, "right")).toMatchObject({ start: 1, end: 11 });
		expect(markerSpanAt(text, 11, "backspace")).toMatchObject({ start: 1, end: 11 });
		expect(markerSpanAt(text, 1, "delete")).toMatchObject({ start: 1, end: 11 });
		expect(markerSpanAt(text, 0, "delete")).toBeUndefined();
	});
});
