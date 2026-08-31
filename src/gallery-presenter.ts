import { ImageGallery, type GalleryImage, type GalleryTheme } from "./image-gallery.ts";

export interface GalleryClock {
	now(): number;
	setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
	clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

export interface GalleryWidgetHost {
	setWidget(
		key: string,
		content: ((tui: { requestRender?: () => void }, theme: any) => ImageGallery) | undefined,
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
}

export interface GalleryPresenterOptions {
	widget: GalleryWidgetHost;
	key: string;
	createGallery?: (theme: GalleryTheme) => ImageGallery;
	clock?: GalleryClock;
	coalesceMs?: number;
}

const systemClock: GalleryClock = {
	now: () => Date.now(),
	setTimeout: (callback, delay) => setTimeout(callback, delay),
	clearTimeout: (timer) => clearTimeout(timer),
};

/**
 * Owns one widget mount and coalesces complete draft snapshots. The first update
 * is applied synchronously; later updates share a fixed, non-extending window.
 */
export class GalleryPresenter {
	private readonly widget: GalleryWidgetHost;
	private readonly key: string;
	private readonly createGallery: (theme: GalleryTheme) => ImageGallery;
	private readonly clock: GalleryClock;
	private readonly coalesceMs: number;
	private snapshot: readonly GalleryImage[] = [];
	private gallery: ImageGallery | undefined;
	private requestRender: (() => void) | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private deadline: number | undefined;
	private mounted = false;
	private disposed = false;
	/** Increments before every mount/clear so an old widget factory cannot regain ownership. */
	private mountGeneration = 0;

	constructor(options: GalleryPresenterOptions) {
		this.widget = options.widget;
		this.key = options.key;
		this.createGallery = options.createGallery ?? ((theme) => new ImageGallery(theme));
		this.clock = options.clock ?? systemClock;
		this.coalesceMs = options.coalesceMs ?? 50;
	}

	update(snapshot: readonly GalleryImage[]): void {
		if (this.disposed) return;
		this.snapshot = [...snapshot];
		if (snapshot.length === 0) {
			this.clear();
			return;
		}
		if (!this.mounted) {
			this.mounted = true;
			const generation = ++this.mountGeneration;
			// Open the window before setWidget because its factory may synchronously reenter update().
			this.openWindow(generation);
			this.widget.setWidget(this.key, (tui, theme) => this.mount(generation, tui, theme), { placement: "aboveEditor" });
			return;
		}
		if (this.deadline === undefined || this.clock.now() >= this.deadline) {
			this.cancelWindow();
			this.apply();
			this.openWindow(this.mountGeneration);
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clear();
	}

	private mount(generation: number, tui: { requestRender?: () => void }, theme: any): ImageGallery {
		const galleryTheme: GalleryTheme = {
			accent: (text) => theme.fg("accent", text),
			muted: (text) => theme.fg("muted", text),
			dim: (text) => theme.fg("dim", text),
			bold: (text) => theme.bold(text),
		};
		const localGallery = this.createGallery(galleryTheme);
		if (this.disposed || !this.mounted || generation !== this.mountGeneration) {
			localGallery.dispose();
			return localGallery;
		}
		this.gallery?.dispose();
		this.gallery = localGallery;
		this.requestRender = tui.requestRender?.bind(tui);
		this.apply();
		return localGallery;
	}

	private apply(): void {
		if (this.disposed || this.snapshot.length === 0 || !this.gallery) return;
		this.gallery.setImages(this.snapshot);
		this.requestRender?.();
	}

	private openWindow(generation: number): void {
		if (this.deadline !== undefined) return;
		this.deadline = this.clock.now() + this.coalesceMs;
		let timer!: ReturnType<typeof setTimeout>;
		timer = this.clock.setTimeout(() => {
			if (this.disposed || generation !== this.mountGeneration || this.timer !== timer) return;
			this.timer = undefined;
			this.deadline = undefined;
			if (this.snapshot.length > 0) this.apply();
		}, this.coalesceMs);
		this.timer = timer;
		timer.unref?.();
	}

	private cancelWindow(): void {
		if (this.timer) this.clock.clearTimeout(this.timer);
		this.timer = undefined;
		this.deadline = undefined;
	}

	private clear(): void {
		this.cancelWindow();
		const wasMounted = this.mounted;
		this.mounted = false;
		this.mountGeneration += 1;
		this.snapshot = [];
		this.gallery?.dispose();
		this.gallery = undefined;
		this.requestRender = undefined;
		if (wasMounted) this.widget.setWidget(this.key, undefined);
	}
}
