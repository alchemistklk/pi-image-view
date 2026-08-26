import { pathToFileURL } from "node:url";

const BLOB_NAME = String.raw`[a-f0-9]{64}\.(?:png|jpg|gif|webp)`;
const INTERNAL_REFERENCE = String.raw`image-view:\/\/sha256\/${BLOB_NAME}`;
const FILE_REFERENCE = String.raw`file:\/\/\/[^)\n]*\/image-view\/blobs\/${BLOB_NAME}`;
const TARGET = `(?:${INTERNAL_REFERENCE}|${FILE_REFERENCE})`;
const BRACKETED_REFERENCE_RE = new RegExp(
	String.raw`\[\[Image #(\d+)\]\]\((${TARGET})\)`,
	"g",
);
const LEGACY_REFERENCE_RE = new RegExp(
	String.raw`\[Image #(\d+)\]\((${TARGET})\)`,
	"g",
);

function isSupportedReference(reference: string): boolean {
	return new RegExp(String.raw`^${TARGET}$`).test(reference);
}

export function createImageMarkerLink(label: string, reference: string): string {
	if (!/^\[Image #\d+\]$/.test(label) || !isSupportedReference(reference)) return label;
	return `[${label}](${reference})`;
}

export function stripImageMarkerLinks(text: string): string {
	return text
		.replace(BRACKETED_REFERENCE_RE, "[Image #$1]")
		.replace(LEGACY_REFERENCE_RE, "[Image #$1]");
}

function renderReference(
	match: string,
	index: string,
	reference: string,
	resolvePath: (reference: string) => string | undefined,
): string {
	if (reference.startsWith("file://")) {
		return `[[Image #${index}]](${reference})`;
	}
	const filePath = resolvePath(reference);
	return filePath
		? `[[Image #${index}]](${pathToFileURL(filePath).href})`
		: `[Image #${index}]`;
}

export function renderImageMarkerLinks(
	markdown: string,
	resolvePath: (reference: string) => string | undefined,
): string {
	return markdown
		.replace(BRACKETED_REFERENCE_RE, (match, index: string, reference: string) =>
			renderReference(match, index, reference, resolvePath),
		)
		.replace(LEGACY_REFERENCE_RE, (match, index: string, reference: string) =>
			renderReference(match, index, reference, resolvePath),
		);
}

export function sanitizeModelMessages<T extends { content?: unknown }>(messages: T[]): T[] {
	return messages.map((message) => {
		if (typeof message.content === "string") {
			const content = stripImageMarkerLinks(message.content);
			return content === message.content ? message : { ...message, content };
		}
		if (!Array.isArray(message.content)) return message;
		let changed = false;
		const content = message.content.map((block) => {
			if (!block || typeof block !== "object" || !("type" in block) || block.type !== "text" || !("text" in block) || typeof block.text !== "string") return block;
			const text = stripImageMarkerLinks(block.text);
			if (text === block.text) return block;
			changed = true;
			return { ...block, text };
		});
		return changed ? { ...message, content } : message;
	});
}
