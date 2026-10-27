import {
	type Component,
	getCapabilities,
	type ImageProtocol,
	getImageDimensions,
	calculateImageRows,
	getCellDimensions,
} from "@earendil-works/pi-tui";

function isKittyUnicodeTerminal(): boolean {
	const program = process.env.TERM_PROGRAM?.toLowerCase() || "";
	const term = process.env.TERM?.toLowerCase() || "";
	return Boolean(
		program === "kitty" ||
		process.env.KITTY_WINDOW_ID ||
		term.includes("kitty") ||
		program === "ghostty" ||
		process.env.GHOSTTY_RESOURCES_DIR ||
		term.includes("ghostty") ||
		program === "cmux" ||
		process.env.CMUX_SURFACE_ID ||
		process.env.CMUX_WORKSPACE_ID ||
		program === "orca" ||
		process.env.ORCA_IMAGE_PROTOCOL?.toLowerCase() === "kitty",
	);
}

export function supportsKittyUnicodePlaceholders(): boolean {
	const program = process.env.TERM_PROGRAM?.toLowerCase() || "";
	if (program === "wezterm" || program === "warpterminal") return false;
	if (isKittyUnicodeTerminal()) return true;
	if (
		process.env.WEZTERM_PANE ||
		process.env.WARP_SESSION_ID ||
		process.env.WARP_TERMINAL_SESSION_UUID
	) {
		return false;
	}
	return true;
}

/** Detects a tmux session: tmux rewrites the pane's TERM, which hides the outer terminal
 * from capability detection and requires DCS passthrough for Kitty APC sequences. */
function inTmux(): boolean {
	return Boolean(process.env.TMUX) || (process.env.TERM?.toLowerCase() || "").startsWith("tmux");
}

/** True for WezTerm, which supports Kitty graphics but not U=1 Unicode placeholders. */
function isWezTerm(): boolean {
	return process.env.TERM_PROGRAM?.toLowerCase() === "wezterm" || Boolean(process.env.WEZTERM_PANE);
}

export function detectImageProtocol(): ImageProtocol | null {
	// An explicit opt-out and Herdr must win over leaked outer-terminal hints.
	if (process.env.TERM_PROGRAM?.toLowerCase() === "herdr" || /^(none|0)$/i.test(process.env.PI_IMAGE_PROTOCOL ?? "")) return null;
	const caps = getCapabilities();
	if (caps.images) return caps.images;
	if (isKittyUnicodeTerminal()) return "kitty";
	// tmux reports the pane terminal, not the outer one, so getCapabilities() loses Kitty
	// graphics support. WezTerm keeps its own hints and renders through direct placement.
	if (inTmux() && isWezTerm()) return "kitty";
	return null;
}

export function supportsTerminalHyperlinks(): boolean {
	if (/^(0|false|none)$/i.test(process.env.PI_HYPERLINKS ?? "")) return false;
	if (getCapabilities().hyperlinks) return true;
	const program = process.env.TERM_PROGRAM?.toLowerCase() || "";
	return Boolean(
		program === "orca" ||
		process.env.ORCA_IMAGE_PROTOCOL ||
		program === "cmux" ||
		process.env.CMUX_SURFACE_ID ||
		process.env.CMUX_WORKSPACE_ID,
	);
}

export interface GalleryTheme {
	accent: (s: string) => string;
	muted: (s: string) => string;
	dim: (s: string) => string;
	bold: (s: string) => string;
}

/** A draft-scoped key makes duplicate attachments and raw-to-preview updates unambiguous. */
export interface GalleryImage {
	key: string;
	data: string;
	mimeType: string;
	label: string;
}

const THUMB_MAX_WIDTH = 25;
const THUMB_MAX_ROWS = 15;
const GAP = 2;
let nextImageId = 1;

function allocateImageId(): number {
	const id = nextImageId;
	nextImageId = (nextImageId % 0xffffff) + 1;
	return id;
}

const ROW_COL_DIACRITICS = [0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f, 0x0346, 0x034a, 0x034b, 0x034c, 0x0350, 0x0351, 0x0352, 0x0353];
const PLACEHOLDER_CHAR = String.fromCodePoint(0x10eeee);
const diacriticFor = (n: number) => String.fromCodePoint(ROW_COL_DIACRITICS[n] ?? ROW_COL_DIACRITICS[0]!);

function wrapForTmux(sequence: string): string {
	if (!inTmux()) return sequence;
	return sequence.replace(/\x1b_G([^\x1b]*)\x1b\\/g, (_match, content) => `\x1bPtmux;\x1b\x1b_G${content}\x1b\x1b\\\x1b\\`);
}

function write(sequence: string): void {
	process.stdout.write(wrapForTmux(sequence));
}

function transmit(data: string, id: number, columns: number, rows: number): void {
	const chunkSize = 4096;
	if (data.length <= chunkSize) {
		write(`\x1b_Ga=T,U=1,f=100,i=${id},c=${columns},r=${rows},q=2;${data}\x1b\\`);
		return;
	}
	for (let offset = 0; offset < data.length; offset += chunkSize) {
		const chunk = data.slice(offset, offset + chunkSize);
		const first = offset === 0;
		const last = offset + chunkSize >= data.length;
		const controls = first
			? `a=T,U=1,f=100,i=${id},c=${columns},r=${rows},q=2,m=1`
			: `m=${last ? 0 : 1}`;
		write(`\x1b_G${controls};${chunk}\x1b\\`);
	}
}

/**
 * Encodes a direct-placement Kitty graphics sequence (without U=1 Unicode placeholders)
 * compatible with @earendil-works/pi-tui's TuiMainScreen / TuiAltScreen image-line renderer
 * on terminals like WezTerm that support Kitty graphics but not U+10EEEE placeholders.
 */
function encodeDirectKitty(data: string, id: number, columns: number, rows: number, extraIds?: readonly number[]): string {
	const chunkSize = 4096;
	const idParams = extraIds && extraIds.length > 0
		? `${extraIds.map((extraId) => `i=${extraId}`).join(",")},i=${id}`
		: `i=${id}`;
	const controls = `a=T,f=100,q=2,C=1,c=${columns},r=${rows},${idParams}`;
	if (data.length <= chunkSize) {
		return `\x1b_G${controls};${data}\x1b\\`;
	}
	const chunks: string[] = [];
	for (let offset = 0; offset < data.length; offset += chunkSize) {
		const chunk = data.slice(offset, offset + chunkSize);
		const first = offset === 0;
		const last = offset + chunkSize >= data.length;
		const header = first ? `${controls},m=1` : `m=${last ? 0 : 1}`;
		chunks.push(`\x1b_G${header};${chunk}\x1b\\`);
	}
	return chunks.join("");
}

/** Repositions an already transmitted Unicode-placeholder image without sending PNG bytes. */
function place(id: number, columns: number, rows: number): void {
	write(`\x1b_Ga=p,U=1,i=${id},c=${columns},r=${rows},q=2\x1b\\`);
}

function deleteImage(id: number): void {
	write(`\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`);
}

function placeholderRow(imageId: number, row: number, columns: number): string {
	const r = (imageId >> 16) & 0xff;
	const g = (imageId >> 8) & 0xff;
	const b = imageId & 0xff;
	const start = imageId < 256 ? `\x1b[38;5;${imageId}m` : `\x1b[38;2;${r};${g};${b}m`;
	return start + PLACEHOLDER_CHAR + diacriticFor(row) + diacriticFor(0) + PLACEHOLDER_CHAR.repeat(Math.max(0, columns - 1)) + "\x1b[39m";
}

type Resource = {
	image: GalleryImage;
	id: number;
	columns: number;
	rows: number;
};

/**
 * A keyed gallery retains terminal resources across draft updates. `setImages` is
 * reconciliation input; removing an absent key releases that key immediately, while
 * transmission and placement writes occur from `render` or `dispose`.
 */
export class ImageGallery implements Component {
	private images: GalleryImage[] = [];
	private readonly theme: GalleryTheme;
	private cachedLines?: string[];
	private cachedWidth?: number;
	private readonly resources = new Map<string, Resource>();
	private renderedProtocol: ImageProtocol | null | undefined;
	private renderedUnicodePlaceholders: boolean | undefined;
	/** False after a renderer reset: IDs remain ours, but terminal image data must be sent again. */
	private terminalResidencyKnown = true;
	private disposed = false;

	constructor(theme: GalleryTheme) {
		this.theme = theme;
	}

	setImages(images: readonly GalleryImage[]): void {
		if (this.disposed) return;
		const next = [...images];
		const keys = new Set(next.map((image) => image.key));
		for (const [key, resource] of this.resources) {
			if (!keys.has(key)) {
				deleteImage(resource.id);
				this.resources.delete(key);
			}
		}
		this.images = next;
		this.cachedLines = undefined;
		this.cachedWidth = undefined;
	}

	invalidate(): void {
		// Renderers may clear terminal images before invalidating components. Keep stable
		// IDs but require the next Kitty render to repopulate their image data.
		this.terminalResidencyKnown = false;
		this.cachedLines = undefined;
		this.cachedWidth = undefined;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const resource of this.resources.values()) deleteImage(resource.id);
		this.resources.clear();
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		if (this.disposed) return [];
		const protocol = detectImageProtocol();
		const unicodePlaceholders = protocol === "kitty" && supportsKittyUnicodePlaceholders();
		if (
			this.cachedLines &&
			this.cachedWidth === width &&
			this.renderedProtocol === protocol &&
			this.renderedUnicodePlaceholders === unicodePlaceholders
		) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		if (this.images.length === 0) return this.cache(lines, width, protocol, unicodePlaceholders);
		lines.push(this.theme.accent(this.images.length === 1 ? " 📎 1 image attached" : ` 📎 ${this.images.length} images attached`));
		const kitty = protocol === "kitty" && this.images.every((image) => image.mimeType === "image/png");
		if (!kitty) {
			this.releaseAll();
			for (const image of this.images) lines.push(this.theme.muted(`  ${image.label}`));
			return this.cache(lines, width, protocol, unicodePlaceholders);
		}
		if (
			(this.renderedProtocol !== undefined && this.renderedProtocol !== protocol) ||
			(this.renderedUnicodePlaceholders !== undefined && this.renderedUnicodePlaceholders !== unicodePlaceholders)
		) {
			this.releaseAll();
		}
		if (unicodePlaceholders) {
			this.renderKitty(lines, width);
		} else {
			this.renderDirectKitty(lines, width);
		}
		this.terminalResidencyKnown = true;
		return this.cache(lines, width, protocol, unicodePlaceholders);
	}

	private cache(lines: string[], width: number, protocol: ImageProtocol | null, unicodePlaceholders: boolean): string[] {
		this.cachedLines = lines;
		this.cachedWidth = width;
		this.renderedProtocol = protocol;
		this.renderedUnicodePlaceholders = unicodePlaceholders;
		return lines;
	}

	private releaseAll(): void {
		for (const resource of this.resources.values()) deleteImage(resource.id);
		this.resources.clear();
	}

	private appendLabels(lines: string[], infos: readonly Resource[]): void {
		let labels = " ";
		for (let index = 0; index < infos.length; index += 1) {
			const columns = infos[index]!.columns;
			let label = this.images[index]!.label;
			if (label.length > columns) label = label.slice(0, Math.ceil((columns - 1) / 2)) + "…" + label.slice(-Math.floor((columns - 1) / 2));
			const left = Math.floor(Math.max(0, columns - label.length) / 2);
			labels += this.theme.dim(" ".repeat(left) + label + " ".repeat(Math.max(0, columns - label.length - left)));
			if (index < infos.length - 1) labels += " ".repeat(GAP);
		}
		lines.push(labels);
	}

	private renderDirectKitty(lines: string[], width: number): void {
		const available = width - 2;
		const thumbWidth = Math.min(THUMB_MAX_WIDTH, Math.floor((available - Math.max(0, this.images.length - 1) * GAP) / this.images.length));
		if (thumbWidth < 4) {
			this.releaseAll();
			for (const image of this.images) lines.push(this.theme.muted(`  ${image.label}`));
			return;
		}

		const placements: Array<{ resource: Resource; col: number }> = [];
		const infos: Resource[] = [];
		for (let index = 0; index < this.images.length; index += 1) {
			const image = this.images[index]!;
			const dimensions = getImageDimensions(image.data, image.mimeType) ?? { widthPx: 800, heightPx: 600 };
			const rows = Math.min(calculateImageRows(dimensions, thumbWidth, getCellDimensions()), THUMB_MAX_ROWS);
			let resource = this.resources.get(image.key);
			const changed = resource && (resource.image.data !== image.data || resource.image.mimeType !== image.mimeType);
			if (changed && resource) {
				deleteImage(resource.id);
				this.resources.delete(image.key);
				resource = undefined;
			}
			if (resource) {
				resource.image = image;
				resource.columns = thumbWidth;
				resource.rows = rows;
			} else {
				resource = { image, id: allocateImageId(), columns: thumbWidth, rows };
				this.resources.set(image.key, resource);
			}
			const col = 2 + index * (thumbWidth + GAP);
			placements.push({ resource, col });
			infos.push(resource);
		}

		const maxRows = Math.max(...placements.map((p) => p.resource.rows));
		const ordered = [...placements].sort((a, b) => b.resource.rows - a.resource.rows);
		const firstId = ordered[0]!.resource.id;
		const extraIds = ordered.slice(1).map((p) => p.resource.id);
		let line = "";
		for (let i = 0; i < ordered.length; i += 1) {
			const { resource, col } = ordered[i]!;
			const headerExtraIds = i === 0 && extraIds.length > 0 && resource.id === firstId ? extraIds : undefined;
			// The cursor-positioning escape stays outside tmux's DCS wrapper; only the
			// Kitty APC chunks need passthrough.
			const encoded = wrapForTmux(encodeDirectKitty(resource.image.data, resource.id, resource.columns, resource.rows, headerExtraIds));
			line += `\x1b[${col}G${encoded}`;
		}
		lines.push(line);
		for (let row = 1; row < maxRows; row += 1) {
			lines.push("");
		}
		this.appendLabels(lines, infos);
	}

	private renderKitty(lines: string[], width: number): void {
		const available = width - 2;
		const thumbWidth = Math.min(THUMB_MAX_WIDTH, Math.floor((available - Math.max(0, this.images.length - 1) * GAP) / this.images.length));
		if (thumbWidth < 4) {
			this.releaseAll();
			for (const image of this.images) lines.push(this.theme.muted(`  ${image.label}`));
			return;
		}

		const infos: Resource[] = [];
		for (const image of this.images) {
			const dimensions = getImageDimensions(image.data, image.mimeType) ?? { widthPx: 800, heightPx: 600 };
			const rows = Math.min(calculateImageRows(dimensions, thumbWidth, getCellDimensions()), THUMB_MAX_ROWS);
			let resource = this.resources.get(image.key);
			const changed = resource && (resource.image.data !== image.data || resource.image.mimeType !== image.mimeType);
			if (changed && resource) {
				deleteImage(resource.id);
				this.resources.delete(image.key);
				resource = undefined;
			}
			if (resource) {
				const geometryChanged = resource.columns !== thumbWidth || resource.rows !== rows;
				resource.image = image;
				resource.columns = thumbWidth;
				resource.rows = rows;
				if (!this.terminalResidencyKnown) transmit(image.data, resource.id, thumbWidth, rows);
				else if (geometryChanged) place(resource.id, thumbWidth, rows);
			} else {
				resource = { image, id: allocateImageId(), columns: thumbWidth, rows };
				this.resources.set(image.key, resource);
				transmit(image.data, resource.id, thumbWidth, rows);
			}
			infos.push(resource);
		}

		const maxRows = Math.max(...infos.map((info) => info.rows));
		for (let row = 0; row < maxRows; row += 1) {
			let line = " ";
			for (let index = 0; index < infos.length; index += 1) {
				const info = infos[index]!;
				line += row < info.rows ? placeholderRow(info.id, row, info.columns) : " ".repeat(info.columns);
				if (index < infos.length - 1) line += " ".repeat(GAP);
			}
			lines.push(line);
		}
		this.appendLabels(lines, infos);
	}
}
