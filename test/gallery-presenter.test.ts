import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", () => ({}));

import { GalleryPresenter, type GalleryClock } from "../src/gallery-presenter.ts";
import type { ImageGallery } from "../src/image-gallery.ts";

const image = (key: string) => ({ key, data: key, mimeType: "image/png", label: `${key}.png` });

function createClock(): { clock: GalleryClock; advance(ms: number): void } {
	let now = 0;
	let nextId = 0;
	const timers = new Map<number, { due: number; callback: () => void }>();
	return {
		clock: {
			now: () => now,
			setTimeout: (callback, delay) => {
				const id = ++nextId;
				timers.set(id, { due: now + delay, callback });
				return id as unknown as ReturnType<typeof setTimeout>;
			},
			clearTimeout: (timer) => timers.delete(timer as unknown as number),
		},
		advance(ms) {
			now += ms;
			for (const [id, timer] of [...timers]) {
				if (timer.due <= now) {
					timers.delete(id);
					timer.callback();
				}
			}
		},
	};
}

function createHarness() {
	const clock = createClock();
	const gallery = { setImages: vi.fn(), dispose: vi.fn() };
	const requestRender = vi.fn();
	const setWidget = vi.fn((_key, content) => {
		if (content) content({ requestRender }, { fg: (_name: string, text: string) => text, bold: (text: string) => text });
	});
	const presenter = new GalleryPresenter({
		widget: { setWidget },
		key: "image-view",
		clock: clock.clock,
		createGallery: () => gallery as unknown as ImageGallery,
	});
	return { presenter, gallery, requestRender, setWidget, clock };
}

describe("GalleryPresenter", () => {
	it("mounts once and makes the first update visible synchronously", () => {
		const { presenter, gallery, requestRender, setWidget } = createHarness();
		presenter.update([image("one")]);
		expect(setWidget).toHaveBeenCalledTimes(1);
		expect(gallery.setImages).toHaveBeenLastCalledWith([image("one")]);
		expect(requestRender).toHaveBeenCalledTimes(1);
	});

	it("coalesces latest snapshots into a non-extending 50ms trailing flush", () => {
		const { presenter, gallery, requestRender, clock } = createHarness();
		presenter.update([image("one")]);
		clock.advance(25);
		presenter.update([image("one"), image("two")]);
		clock.advance(24);
		expect(gallery.setImages).toHaveBeenCalledTimes(1);
		clock.advance(1);
		expect(gallery.setImages).toHaveBeenLastCalledWith([image("one"), image("two")]);
		expect(requestRender).toHaveBeenCalledTimes(2);
	});

	it("clears immediately and ignores late timer work after dispose", () => {
		const { presenter, gallery, setWidget, clock } = createHarness();
		presenter.update([image("one")]);
		presenter.update([]);
		expect(gallery.dispose).toHaveBeenCalledTimes(1);
		expect(setWidget).toHaveBeenLastCalledWith("image-view", undefined);
		presenter.dispose();
		clock.advance(100);
		expect(gallery.setImages).toHaveBeenCalledTimes(1);
	});

	it("uses one gallery mount for 20 staggered updates and one trailing flush", () => {
		const { presenter, gallery, requestRender, setWidget, clock } = createHarness();
		presenter.update([image("0")]);
		for (let index = 1; index < 20; index += 1) presenter.update(Array.from({ length: index + 1 }, (_, item) => image(String(item))));
		clock.advance(50);
		expect(setWidget).toHaveBeenCalledTimes(1);
		expect(gallery.setImages).toHaveBeenCalledTimes(2);
		expect(requestRender).toHaveBeenCalledTimes(2);
	});

	it("opens its deadline before a reentrant widget update and mounts the latest snapshot once", () => {
		const clock = createClock();
		const gallery = { setImages: vi.fn(), dispose: vi.fn() };
		const requestRender = vi.fn();
		let presenter!: GalleryPresenter;
		const setWidget = vi.fn((_key, content) => {
			if (!content) return;
			presenter.update([image("latest")]);
			content({ requestRender }, { fg: (_name: string, text: string) => text, bold: (text: string) => text });
		});
		presenter = new GalleryPresenter({ widget: { setWidget }, key: "image-view", clock: clock.clock, createGallery: () => gallery as unknown as ImageGallery });
		presenter.update([image("first")]);
		expect(setWidget).toHaveBeenCalledTimes(1);
		expect(gallery.setImages).toHaveBeenCalledWith([image("latest")]);
		clock.advance(50);
		expect(gallery.setImages).toHaveBeenCalledTimes(2);
	});

	it("disposes a factory gallery that arrives after a reentrant clear", () => {
		const clock = createClock();
		const staleGallery = { setImages: vi.fn(), dispose: vi.fn() };
		let presenter!: GalleryPresenter;
		const setWidget = vi.fn((_key, content) => {
			if (!content) return;
			presenter.update([]);
			content({ requestRender: vi.fn() }, { fg: (_name: string, text: string) => text, bold: (text: string) => text });
		});
		presenter = new GalleryPresenter({ widget: { setWidget }, key: "image-view", clock: clock.clock, createGallery: () => staleGallery as unknown as ImageGallery });
		presenter.update([image("first")]);
		expect(staleGallery.dispose).toHaveBeenCalledTimes(1);
		expect(staleGallery.setImages).not.toHaveBeenCalled();
		expect(setWidget).toHaveBeenLastCalledWith("image-view", undefined);
	});

	it("does not let a stale factory resurrect state after clear", () => {
		const clock = createClock();
		const staleGallery = { setImages: vi.fn(), dispose: vi.fn() };
		let factory: ((tui: { requestRender?: () => void }, theme: any) => ImageGallery) | undefined;
		const setWidget = vi.fn((_key, content) => { if (content) factory = content; });
		const presenter = new GalleryPresenter({ widget: { setWidget }, key: "image-view", clock: clock.clock, createGallery: () => staleGallery as unknown as ImageGallery });
		presenter.update([image("first")]);
		presenter.update([]);
		factory!({ requestRender: vi.fn() }, { fg: (_name: string, text: string) => text, bold: (text: string) => text });
		expect(staleGallery.dispose).toHaveBeenCalledTimes(1);
		presenter.update([image("new")]);
		expect(setWidget).toHaveBeenCalledTimes(3); // initial mount, clear, fresh mount
	});
});
