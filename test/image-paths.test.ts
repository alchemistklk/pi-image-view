import { describe, expect, it } from "vitest";
import { extractImagePaths, normalizeDetectedImagePath } from "../src/image-paths.ts";

describe("image path detection", () => {
	it("detects a plain absolute image path", () => {
		expect(extractImagePaths("/Users/jv/Downloads/IMG_2667.jpg")).toEqual([
			{
				raw: "/Users/jv/Downloads/IMG_2667.jpg",
				path: "/Users/jv/Downloads/IMG_2667.jpg",
			},
		]);
	});

	it("detects a dragged path whose spaces are backslash-escaped and resolves them", () => {
		expect(
			extractImagePaths("/Users/jv/Desktop/CleanShot\\ 2026\\ shot.png"),
		).toEqual([
			{
				raw: "/Users/jv/Desktop/CleanShot\\ 2026\\ shot.png",
				path: "/Users/jv/Desktop/CleanShot 2026 shot.png",
			},
		]);
	});

	it("detects a double-quoted path that contains spaces", () => {
		expect(extractImagePaths('"/Users/jv/Desktop/My Photo.png"')).toEqual([
			{
				raw: '"/Users/jv/Desktop/My Photo.png"',
				path: "/Users/jv/Desktop/My Photo.png",
			},
		]);
	});

	it("detects a single-quoted path that contains spaces", () => {
		expect(extractImagePaths("'/Users/jv/Desktop/My Photo.png'")).toEqual([
			{
				raw: "'/Users/jv/Desktop/My Photo.png'",
				path: "/Users/jv/Desktop/My Photo.png",
			},
		]);
	});

	it("finds several paths in free text and skips non-image files", () => {
		const text = 'see "/a/My Pic.png", /b/c.jpeg and /b/notes.txt';
		expect(extractImagePaths(text)).toEqual([
			{ raw: '"/a/My Pic.png"', path: "/a/My Pic.png" },
			{ raw: "/b/c.jpeg", path: "/b/c.jpeg" },
		]);
	});

it("detects native Windows drive and UNC image paths", () => {
	expect(extractImagePaths(String.raw`C:\Users\me\shot.png \\server\share\screen.jpg`)).toEqual([
		{ raw: String.raw`C:\Users\me\shot.png`, path: String.raw`C:\Users\me\shot.png` },
		{ raw: String.raw`\\server\share\screen.jpg`, path: String.raw`\\server\share\screen.jpg` },
	]);
});

it("preserves quoted Windows spaces and converts drive paths under WSL", () => {
	expect(extractImagePaths(String.raw`"C:\Users\me\My Shot.png"`)).toEqual([
		{ raw: String.raw`"C:\Users\me\My Shot.png"`, path: String.raw`C:\Users\me\My Shot.png` },
	]);
	expect(normalizeDetectedImagePath(String.raw`C:\Users\me\shot.png`, {
		platform: "linux",
		env: { WSL_DISTRO_NAME: "Ubuntu" },
	})).toBe("/mnt/c/Users/me/shot.png");
});


it("accepts common punctuation immediately after unquoted paths", () => {
	expect(extractImagePaths(String.raw`/tmp/a.png, C:\Users\me\b.jpg; \\server\share\c.webp)`)).toEqual([
		{ raw: "/tmp/a.png", path: "/tmp/a.png" },
		{ raw: String.raw`C:\Users\me\b.jpg`, path: String.raw`C:\Users\me\b.jpg` },
		{ raw: String.raw`\\server\share\c.webp`, path: String.raw`\\server\share\c.webp` },
	]);
});

});
