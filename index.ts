import { convertToPng, resizeImage } from "@earendil-works/pi-coding-agent";
import {
	loadImageContentFromPath,
	readImageContentFromPathAsync,
	type ImageResizer,
} from "./src/image-content.ts";
import { registerImagePreviewExtension } from "./src/extension-runtime.ts";
import { resizeForPreview } from "./src/preview-resize.ts";
import { resizeForSubmission } from "./src/submission-resize.ts";

// pi bundles the WASM image resizer and PNG converter and exposes them on its
// package entry. The extension is loaded through jiti, which aliases the
// "@earendil-works/*" specifier to the host build, so this import resolves to the
// running agent's implementation (no fragile filesystem lookup needed).
const buildPreviewThumbnail: ImageResizer = (image) =>
	resizeForPreview(image, { resizeImage, convertToPng });

// Cap the full-size attachment below the provider's per-image byte limit so a
// large image is downscaled before it is submitted (no PNG conversion needed).
const shrinkAttachmentForSubmission: ImageResizer = (image) =>
	resizeForSubmission(image, { resizeImage });

export default function (pi: any): void {
	registerImagePreviewExtension(pi, {
		readImageContentFromPathAsync,
		maybeResizeImage: buildPreviewThumbnail,
		resizeForSubmission: shrinkAttachmentForSubmission,
		loadImageContentFromPath: (filePath) => loadImageContentFromPath(filePath),
	});
}
