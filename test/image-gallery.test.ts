import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", () => ({
	getCapabilities: () => ({ images: "kitty" }),
	getImageDimensions: () => ({ widthPx: 100, heightPx: 100 }),
	calculateImageRows: () => 4,
	getCellDimensions: () => ({ width: 8, height: 16 }),
}));

import { ImageGallery } from "../src/image-gallery.ts";

const plain = (text: string) => text;

describe("image gallery format safety", () => {
	it("falls back to text when Kitty f=100 receives a non-PNG image", () => {
		const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		try {
			const gallery = new ImageGallery({ accent: plain, muted: plain, dim: plain, bold: plain });
			gallery.setImages([{ data: "jpeg", mimeType: "image/jpeg", label: "fallback.jpg" }]);
			const lines = gallery.render(80);
			expect(lines).toContain("  fallback.jpg");
			expect(write).not.toHaveBeenCalled();
		} finally {
			write.mockRestore();
		}
	});

	it("still transmits through Kitty when every image is PNG", () => {
		const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		try {
			const gallery = new ImageGallery({ accent: plain, muted: plain, dim: plain, bold: plain });
			gallery.setImages([{ data: "png", mimeType: "image/png", label: "shot.png" }]);
			const lines = gallery.render(80);
			expect(lines).not.toContain("  shot.png");
			expect(write).toHaveBeenCalled();
		} finally {
			write.mockRestore();
		}
	});
});
