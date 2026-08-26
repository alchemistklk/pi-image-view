import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { convertToPng, resizeImage } from "@earendil-works/pi-coding-agent";
import { getCapabilities, matchesKey } from "@earendil-works/pi-tui";
import {
	putImageBlob,
	resolveImageReference,
} from "./src/blob-store.ts";
import {
	loadImageContentFromPath,
	readImageContentFromPathAsync,
	type ImageResizer,
} from "./src/image-content.ts";
import { registerImagePreviewExtension } from "./src/extension-runtime.ts";
import { resizeForDetail, resizeForPreview } from "./src/preview-resize.ts";
import { createAtomicMarkerEditor } from "./src/atomic-editor.ts";
import { readDirectClipboard, supportsDirectClipboard } from "./src/clipboard.ts";

// pi bundles the WASM image resizer and PNG converter and exposes them on its
// package entry. The extension is loaded through jiti, which aliases the
// "@earendil-works/*" specifier to the host build, so this import resolves to the
// running agent's implementation (no fragile filesystem lookup needed).
const buildPreviewThumbnail: ImageResizer = (image) =>
	resizeForPreview(image, { resizeImage, convertToPng });

const buildDetailImage: ImageResizer = (image) =>
	resizeForDetail(image, { resizeImage });

const normalizeImageForMatching: ImageResizer = async (image) => {
	try {
		const normalized = await resizeImage(Buffer.from(image.data, "base64"), image.mimeType);
		return normalized
			? { type: "image", data: normalized.data, mimeType: normalized.mimeType }
			: image;
	} catch {
		return image;
	}
};


async function persistImage(image: Parameters<typeof putImageBlob>[0]): Promise<string> {
	return pathToFileURL((await putImageBlob(image)).displayPath).href;
}

function resolvePersistedImage(reference: string): string | undefined {
	try {
		if (!getCapabilities().hyperlinks) return undefined;
	} catch {
		// Capability probing can be unavailable during transcript reconstruction.
		// Continue with the safe file target instead of leaking the internal scheme.
	}
	const filePath = resolveImageReference(reference);
	return filePath && existsSync(filePath) ? filePath : undefined;
}


export interface ImageViewOptions {
	/** Replace Pi's editor so [Image #N] moves/deletes as one token. Disabled by default to avoid editor conflicts. */
	atomicMarkers?: boolean;
}

export function createImageView(options: ImageViewOptions = {}) {
	const envAtomic = process.env.PI_IMAGE_VIEW_ATOMIC_MARKERS;
	const atomicMarkers = options.atomicMarkers ?? (envAtomic === "0" ? false : envAtomic === "1" ? true : supportsDirectClipboard());
	return (pi: any): void => registerImagePreviewExtension(pi, {
		readImageContentFromPathAsync,
		maybeResizeImage: buildPreviewThumbnail,
		resizeDetailImage: buildDetailImage,
		normalizeImageForMatching,
		isImagePasteInput: (data) => matchesKey(data, "ctrl+v") || matchesKey(data, "alt+v"),
		createAtomicEditor: atomicMarkers
			? (tui, theme, keys, attachImage) => createAtomicMarkerEditor(tui as any, theme as any, keys as any, { readClipboard: readDirectClipboard, attachImage })
			: undefined,
		storeImage: persistImage,
		resolveImageReference: resolvePersistedImage,
		loadImageContentFromPath: (filePath) => loadImageContentFromPath(filePath),
	});
}

export default createImageView();
