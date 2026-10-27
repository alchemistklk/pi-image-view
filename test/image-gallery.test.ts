import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capabilities = vi.hoisted(() => ({ images: "kitty" as "kitty" | null, hyperlinks: false }));

vi.mock("@earendil-works/pi-tui", () => ({
	getCapabilities: () => ({ images: capabilities.images, hyperlinks: capabilities.hyperlinks }),
	getImageDimensions: () => ({ widthPx: 100, heightPx: 100 }),
	calculateImageRows: () => 4,
	getCellDimensions: () => ({ width: 8, height: 16 }),
}));

import {
	ImageGallery,
	detectImageProtocol,
	supportsKittyUnicodePlaceholders,
	supportsTerminalHyperlinks,
} from "../src/image-gallery.ts";

const plain = (text: string) => text;
const theme = { accent: plain, muted: plain, dim: plain, bold: plain };
// Two valid 1×1 PNG base64 payloads. Snapshot fixtures cycle them by key, while preview selects the other payload.
const PNG_FIXTURES = [
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/2QAAAABJRU5ErkJggg==",
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jm3cAAAAASUVORK5CYII=",
] as const;
const png = (key: string, data: string = PNG_FIXTURES[0]) => ({ key, data, mimeType: "image/png", label: `${key}.png` });

type Metrics = { galleryCreations: number; renders: number; updateRequests: number; pngPayloadBytes: number; controlBytes: number; deletes: number; liveIds: number };

function writesFor(action: () => void): string[] {
	const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	try {
		action();
		return write.mock.calls.map(([value]) => String(value));
	} finally {
		write.mockRestore();
	}
}

function transmittedIds(writes: readonly string[]): number[] {
	return writes.flatMap((line) => [...line.matchAll(/a=T[^;]*,i=(\d+)/g)].map((match) => Number(match[1])));
}

function deletedIds(writes: readonly string[]): number[] {
	return writes.flatMap((line) => [...line.matchAll(/a=d,d=I,i=(\d+)/g)].map((match) => Number(match[1])));
}

function metric(writes: readonly string[], galleryCreations: number, renders: number, updateRequests: number): Metrics {
	let pngPayloadBytes = 0;
	let controlBytes = 0;
	for (const line of writes) {
		const payloadMatch = /\x1b_G([^;]*);([^\x1b]*)\x1b\\/.exec(line);
		if (payloadMatch) {
			const [, controls, payload] = payloadMatch;
			if (controls.includes("a=T") || controls.startsWith("m=")) pngPayloadBytes += payload.length;
			controlBytes += line.length - payload.length;
		} else {
			controlBytes += line.length;
		}
	}
	const transmitted = new Set(transmittedIds(writes));
	for (const id of deletedIds(writes)) transmitted.delete(id);
	return { galleryCreations, renders, updateRequests, pngPayloadBytes, controlBytes, deletes: deletedIds(writes).length, liveIds: transmitted.size };
}

function staggeredSnapshots(count: number): Array<ReturnType<typeof png>[]> {
	let current = Array.from({ length: count }, (_, index) => png(`image-${index}`, PNG_FIXTURES[index % PNG_FIXTURES.length]));
	const snapshots = [current];
	for (let index = 0; index < count; index += 1) {
		current = current.map((item, itemIndex) => itemIndex === index
			? png(item.key, PNG_FIXTURES[(index + 1) % PNG_FIXTURES.length])
			: item);
		snapshots.push(current);
	}
	return snapshots;
}

function withoutTmux<T>(action: () => T): T {
	const previousTmux = process.env.TMUX;
	delete process.env.TMUX;
	try { return action(); } finally {
		if (previousTmux === undefined) delete process.env.TMUX;
		else process.env.TMUX = previousTmux;
	}
}

/** Measured old behavior: a fresh gallery is created and rendered for each complete snapshot. */
function measureFullRebuildBaseline(snapshots: readonly (readonly ReturnType<typeof png>[])[]): Metrics {
	let galleryCreations = 0;
	let renders = 0;
	let updateRequests = 0;
	const writes = withoutTmux(() => writesFor(() => {
		let previous: ImageGallery | undefined;
		for (const snapshot of snapshots) {
			previous?.dispose();
			const gallery = new ImageGallery(theme);
			galleryCreations += 1;
			gallery.setImages(snapshot);
			updateRequests += 1;
			gallery.render(200);
			renders += 1;
			previous = gallery;
		}
		previous?.dispose();
	}));
	return metric(writes, galleryCreations, renders, updateRequests);
}

function measureIncremental(snapshots: readonly (readonly ReturnType<typeof png>[])[]): Metrics {
	let galleryCreations = 0;
	let renders = 0;
	let updateRequests = 0;
	const writes = withoutTmux(() => writesFor(() => {
		const gallery = new ImageGallery(theme);
		galleryCreations += 1;
		for (const snapshot of snapshots) {
			gallery.setImages(snapshot);
			updateRequests += 1;
			gallery.render(200);
			renders += 1;
		}
		gallery.dispose();
	}));
	return metric(writes, galleryCreations, renders, updateRequests);
}

describe("image gallery format safety", () => {
	const savedEnv: Record<string, string | undefined> = {};
	const envKeys = [
		"TERM_PROGRAM",
		"TERM",
		"WEZTERM_PANE",
		"WARP_SESSION_ID",
		"WARP_TERMINAL_SESSION_UUID",
		"KITTY_WINDOW_ID",
		"GHOSTTY_RESOURCES_DIR",
		"CMUX_SURFACE_ID",
		"CMUX_WORKSPACE_ID",
		"ORCA_IMAGE_PROTOCOL",
		"PI_IMAGE_PROTOCOL",
		"PI_HYPERLINKS",
	] as const;

	beforeEach(() => {
		for (const key of envKeys) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
		capabilities.images = "kitty";
		capabilities.hyperlinks = false;
	});

	afterEach(() => {
		for (const key of envKeys) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
		capabilities.images = "kitty";
		capabilities.hyperlinks = false;
	});

	it("uses valid PNG base64 payload fixtures", () => {
		for (const fixture of PNG_FIXTURES) expect(Buffer.from(fixture, "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
	});

	it("falls back to text when Kitty f=100 receives a non-PNG image", () => {
		const writes = writesFor(() => {
			const gallery = new ImageGallery(theme);
			gallery.setImages([{ key: "fallback", data: "jpeg", mimeType: "image/jpeg", label: "fallback.jpg" }]);
			expect(gallery.render(80)).toContain("  fallback.jpg");
		});
		expect(writes).toEqual([]);
	});

	it("retains unchanged resources while adding or replacing one keyed attachment", () => {
		const writes = writesFor(() => {
			const gallery = new ImageGallery(theme);
			gallery.setImages([png("a"), png("b")]);
			gallery.render(80);
			gallery.setImages([png("a"), png("b"), png("c")]);
			gallery.render(80);
			gallery.setImages([png("a"), png("b", PNG_FIXTURES[1]), png("c")]);
			gallery.render(80);
		});
		expect(transmittedIds(writes)).toHaveLength(4); // initial a/b, append c, then only replaced b
		expect(deletedIds(writes)).toHaveLength(1);
	});

	it("retransmits owned images with stable IDs after same-width invalidation", () => {
		const writes = writesFor(() => {
			const gallery = new ImageGallery(theme);
			gallery.setImages([png("a")]);
			gallery.render(80);
			gallery.invalidate();
			gallery.render(80);
		});
		const ids = transmittedIds(writes);
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe(ids[1]);
		expect(writes.filter((line) => line.includes("a=d,d=I"))).toEqual([]);
	});

	it("immediately releases exactly the removed ID and dispose releases only the survivor", () => {
		const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		try {
			const gallery = new ImageGallery(theme);
			gallery.setImages([png("a"), png("b")]);
			gallery.render(80);
			const [a, b] = transmittedIds(write.mock.calls.map(([value]) => String(value)));
			write.mockClear();
			gallery.setImages([png("a")]);
			expect(deletedIds(write.mock.calls.map(([value]) => String(value)))).toEqual([b]);
			write.mockClear();
			gallery.dispose();
			expect(deletedIds(write.mock.calls.map(([value]) => String(value)))).toEqual([a]);
			write.mockClear();
			gallery.dispose();
			expect(write).not.toHaveBeenCalled();
		} finally {
			write.mockRestore();
		}
	});

	it("uses placement-only writes for geometry changes", () => {
		const writes = writesFor(() => {
			const gallery = new ImageGallery(theme);
			gallery.setImages([png("a")]);
			gallery.render(80);
			gallery.render(20);
		});
		expect(writes.some((line) => line.includes("a=p") && !line.includes(";"))).toBe(true);
		expect(transmittedIds(writes)).toHaveLength(1);
	});

	it("releases Kitty resources on protocol fallback and keeps unavailable mode textual", () => {
		const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		try {
			const gallery = new ImageGallery(theme);
			gallery.setImages([png("a")]);
			gallery.render(80);
			const [id] = transmittedIds(write.mock.calls.map(([value]) => String(value)));
			write.mockClear();
			capabilities.images = null;
			gallery.invalidate();
			expect(gallery.render(80)).toContain("  a.png");
			expect(deletedIds(write.mock.calls.map(([value]) => String(value)))).toEqual([id]);
			write.mockClear();
			const unavailable = new ImageGallery(theme);
			unavailable.setImages([png("plain")]);
			expect(unavailable.render(80)).toContain("  plain.png");
			expect(write).not.toHaveBeenCalled();
		} finally {
			write.mockRestore();
		}
	});

	it("chunks large payloads and wraps Kitty APC sequences in tmux passthrough", () => {
		const previousTmux = process.env.TMUX;
		process.env.TMUX = "test";
		try {
			const writes = writesFor(() => {
				const gallery = new ImageGallery(theme);
				gallery.setImages([png("large", "x".repeat(4097))]);
				gallery.render(80);
			});
			expect(writes).toHaveLength(2);
			expect(writes[0]).toContain("a=T,U=1,f=100");
			expect(writes[0]).toContain("m=1");
			expect(writes[1]).toContain("m=0;x");
			expect(writes.every((line) => line.startsWith("\x1bPtmux;") && line.includes("\x1b\x1b_G"))).toBe(true);
		} finally {
			if (previousTmux === undefined) delete process.env.TMUX;
			else process.env.TMUX = previousTmux;
		}
	});

	it("measures the same 5/10/20 fixtures against full rebuild and incremental strategies", () => {
		for (const count of [5, 10, 20]) {
			const snapshots = staggeredSnapshots(count);
			const baseline = measureFullRebuildBaseline(snapshots);
			const optimized = measureIncremental(snapshots);
			expect(baseline.galleryCreations).toBe(snapshots.length);
			expect(baseline.renders).toBe(snapshots.length);
			expect(baseline.updateRequests).toBe(snapshots.length);
			expect(baseline.pngPayloadBytes).toBeGreaterThan(0);
			expect(baseline.controlBytes).toBeGreaterThan(0);
			expect(baseline.deletes).toBeGreaterThan(0);
			expect(baseline.liveIds).toBe(0);
			expect(optimized.galleryCreations).toBe(1);
			expect(optimized.renders).toBe(snapshots.length);
			expect(optimized.updateRequests).toBe(snapshots.length);
			expect(optimized.pngPayloadBytes).toBeLessThan(baseline.pngPayloadBytes);
			expect(optimized.controlBytes).toBeLessThan(baseline.controlBytes);
			expect(optimized.deletes).toBeLessThan(baseline.deletes);
			expect(optimized.liveIds).toBe(0);
		}
		const snapshots = staggeredSnapshots(20);
		const baseline = measureFullRebuildBaseline(snapshots);
		const optimized = measureIncremental(snapshots);
		expect(optimized.galleryCreations).toBeLessThanOrEqual(baseline.galleryCreations * 0.2);
		expect(optimized.pngPayloadBytes).toBeLessThanOrEqual(baseline.pngPayloadBytes * 0.2);
		const initialPayloadBytes = snapshots[0]!.reduce((total, item) => total + item.data.length, 0);
		const changedPayloadBytes = Array.from({ length: 20 }, (_, index) => PNG_FIXTURES[(index + 1) % PNG_FIXTURES.length].length).reduce((total, bytes) => total + bytes, 0);
		expect(optimized.pngPayloadBytes - initialPayloadBytes).toBe(changedPayloadBytes);
	});

	it("keeps strategy payload accounting nonzero under an ambient tmux environment", () => {
		const previousTmux = process.env.TMUX;
		process.env.TMUX = "ambient-test";
		try {
			const metrics = measureIncremental(staggeredSnapshots(5));
			expect(metrics.pngPayloadBytes).toBeGreaterThan(0);
			expect(metrics.controlBytes).toBeGreaterThan(0);
		} finally {
			if (previousTmux === undefined) delete process.env.TMUX;
			else process.env.TMUX = previousTmux;
		}
	});

	it("renders direct Kitty image lines in WezTerm without U=1 placeholders or out-of-band stdout writes", () => {
		process.env.TERM_PROGRAM = "WezTerm";
		process.env.WEZTERM_PANE = "0";
		expect(detectImageProtocol()).toBe("kitty");
		expect(supportsKittyUnicodePlaceholders()).toBe(false);

		const gallery = new ImageGallery(theme);
		gallery.setImages([png("wez-a"), png("wez-b")]);
		let lines: string[] = [];
		const renderWrites = writesFor(() => {
			lines = gallery.render(80);
		});
		expect(renderWrites).toEqual([]);
		expect(lines.some((line) => line.includes(String.fromCodePoint(0x10eeee)))).toBe(false);
		expect(lines[1]).toContain("\x1b[2G\x1b_Ga=T,f=100,q=2,C=1,c=25,r=4,");
		expect(lines[1]).toContain("\x1b[29G\x1b_Ga=T,f=100,q=2,C=1,c=25,r=4,");
		expect(lines.slice(2, 5)).toEqual(["", "", ""]);

		const disposeWrites = writesFor(() => {
			gallery.dispose();
		});
		expect(deletedIds(disposeWrites)).toHaveLength(2);
	});

	it("keeps the tmux WezTerm fallback when getCapabilities reports no image support", () => {
		capabilities.images = null;
		process.env.TERM_PROGRAM = "WezTerm";
		withoutTmux(() => expect(detectImageProtocol()).toBeNull());

		const previousTmux = process.env.TMUX;
		process.env.TMUX = "test";
		try {
			expect(detectImageProtocol()).toBe("kitty");
			expect(supportsKittyUnicodePlaceholders()).toBe(false);

			const gallery = new ImageGallery(theme);
			gallery.setImages([png("wez-tmux")]);
			const lines = gallery.render(80);
			expect(lines.some((line) => line.includes(String.fromCodePoint(0x10eeee)))).toBe(false);
			expect(lines[1]).toContain("a=T,f=100");
			expect(lines.some((line) => line.includes("wez-tmux.png"))).toBe(true);
		} finally {
			if (previousTmux === undefined) delete process.env.TMUX;
			else process.env.TMUX = previousTmux;
		}
	});

	it("wraps direct-placement Kitty sequences for tmux passthrough and keeps cursor positioning outside", () => {
		process.env.TERM_PROGRAM = "WezTerm";
		process.env.WEZTERM_PANE = "0";
		const previousTmux = process.env.TMUX;
		process.env.TMUX = "test";
		try {
			const gallery = new ImageGallery(theme);
			gallery.setImages([png("wez-a"), png("wez-b")]);
			const lines = gallery.render(80);
			const imageLine = lines[1]!;
			expect(imageLine).toContain("\x1b[2G\x1bPtmux;\x1b\x1b_Ga=T,f=100");
			expect(imageLine).toContain("\x1b[29G\x1bPtmux;\x1b\x1b_Ga=T,f=100");
			const unwrapped = imageLine.replace(/\x1bPtmux;\x1b\x1b_G[^\x1b]*\x1b\x1b\\\x1b\\/g, "");
			expect(unwrapped).not.toContain("\x1b_G");
			expect(unwrapped).toContain("\x1b[2G");
		} finally {
			if (previousTmux === undefined) delete process.env.TMUX;
			else process.env.TMUX = previousTmux;
		}
	});

	it("wraps every chunk of a large direct-placement payload for tmux passthrough", () => {
		process.env.TERM_PROGRAM = "WezTerm";
		const previousTmux = process.env.TMUX;
		process.env.TMUX = "test";
		try {
			const gallery = new ImageGallery(theme);
			gallery.setImages([png("wez-large", "x".repeat(4097))]);
			const imageLine = gallery.render(80)[1]!;
			const wrappers = [...imageLine.matchAll(/\x1bPtmux;\x1b\x1b_G([^;]*);/g)].map((match) => match[1]);
			expect(wrappers).toHaveLength(2);
			expect(wrappers[0]).toContain("m=1");
			expect(wrappers[1]).toContain("m=0");
		} finally {
			if (previousTmux === undefined) delete process.env.TMUX;
			else process.env.TMUX = previousTmux;
		}
	});

	it("detects Orca and cmux for Kitty Unicode placeholders and OSC 8 hyperlinks even when WEZTERM_PANE leaks", () => {
		capabilities.images = null;
		capabilities.hyperlinks = false;
		process.env.WEZTERM_PANE = "0";
		process.env.TERM_PROGRAM = "Orca";
		process.env.ORCA_IMAGE_PROTOCOL = "kitty";
		expect(detectImageProtocol()).toBe("kitty");
		expect(supportsKittyUnicodePlaceholders()).toBe(true);
		expect(supportsTerminalHyperlinks()).toBe(true);

		delete process.env.ORCA_IMAGE_PROTOCOL;
		process.env.TERM_PROGRAM = "cmux";
		process.env.CMUX_SURFACE_ID = "surface-1";
		expect(detectImageProtocol()).toBe("kitty");
		expect(supportsKittyUnicodePlaceholders()).toBe(true);
		expect(supportsTerminalHyperlinks()).toBe(true);
	});

	it("respects Herdr and PI_IMAGE_PROTOCOL=none opt-outs even when getCapabilities reports kitty", () => {
		capabilities.images = "kitty";
		process.env.TERM_PROGRAM = "herdr";
		expect(detectImageProtocol()).toBeNull();

		process.env.TERM_PROGRAM = "kitty";
		process.env.PI_IMAGE_PROTOCOL = "none";
		expect(detectImageProtocol()).toBeNull();
	});
});
