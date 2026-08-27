import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	pi?: { image?: string };
};

describe("package metadata", () => {
	it("declares Pi host packages as wildcard peers instead of installable dependencies", () => {
		expect(packageJson.peerDependencies).toMatchObject({
		"@earendil-works/pi-coding-agent": "*",
		"@earendil-works/pi-tui": "*",
	});
		expect(packageJson.dependencies ?? {}).not.toHaveProperty("@earendil-works/pi-coding-agent");
		expect(packageJson.dependencies ?? {}).not.toHaveProperty("@earendil-works/pi-tui");
	});
	it("publishes a stable Pi Gallery image", () => {
		expect(packageJson.pi?.image).toBe(
			"https://raw.githubusercontent.com/alchemistklk/pi-image-view/main/screenshot.png",
		);
	});
});
