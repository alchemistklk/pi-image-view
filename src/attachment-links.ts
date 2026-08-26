import { pathToFileURL } from "node:url";

const IMAGE_REFERENCE_SOURCE =
	String.raw`\[Image #(\d+)\]\((image-view:\/\/sha256\/([a-f0-9]{64}\.(?:png|jpg|gif|webp)))\)`;
const IMAGE_REFERENCE_RE = new RegExp(IMAGE_REFERENCE_SOURCE, "g");

export function createImageMarkerLink(label: string, reference: string): string {
	if (!/^\[Image #\d+\]$/.test(label)) return label;
	if (!/^image-view:\/\/sha256\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/.test(reference)) return label;
	return `${label}(${reference})`;
}

export function stripImageMarkerLinks(text: string): string {
	return text.replace(IMAGE_REFERENCE_RE, "[Image #$1]");
}

export function renderImageMarkerLinks(
	markdown: string,
	resolvePath: (reference: string) => string | undefined,
): string {
	return markdown.replace(
		IMAGE_REFERENCE_RE,
		(_match, index: string, reference: string) => {
			const filePath = resolvePath(reference);
			return filePath
				? `[Image #${index}](${pathToFileURL(filePath).href})`
				: `[Image #${index}]`;
		},
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
