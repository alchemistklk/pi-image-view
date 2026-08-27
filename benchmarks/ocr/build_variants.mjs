#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { resizeImage, convertToPng } from "@earendil-works/pi-coding-agent";
import { getImageDimensions } from "@earendil-works/pi-tui";
import { resizeForPreview, resizeForDetail } from "../../src/preview-resize.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const generated = resolve(root, "benchmarks/ocr/generated");
const manifestPath = resolve(generated, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const outDir = resolve(generated, "variants");
await mkdir(outDir, { recursive: true });

const extensionFor = (mime) => mime === "image/jpeg" ? "jpg" : mime.split("/")[1] || "bin";
const records = [];
for (const sample of manifest.samples) {
  const sourcePath = resolve(root, sample.source);
  const sourceBytes = await readFile(sourcePath);
  const source = { type: "image", data: sourceBytes.toString("base64"), mimeType: "image/png" };
  const variants = {
    source,
    preview480: await resizeForPreview(source, { resizeImage, convertToPng }),
    detail1280: await resizeForDetail(source, { resizeImage }),
  };
  const files = {};
  for (const [variant, image] of Object.entries(variants)) {
    const file = resolve(outDir, `${sample.id}-${variant}.${extensionFor(image.mimeType)}`);
    const bytes = Buffer.from(image.data, "base64");
    await writeFile(file, bytes);
    const dimensions = getImageDimensions(image.data, image.mimeType);
    files[variant] = {
      path: relative(root, file), mimeType: image.mimeType, bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: dimensions?.widthPx ?? null, height: dimensions?.heightPx ?? null,
      fallbackSource: variant !== "source" && bytes.equals(sourceBytes),
    };
  }
  records.push({ id: sample.id, targets: sample.targets, variants: files });
}
await writeFile(resolve(generated, "variants.json"), JSON.stringify({ schemaVersion: 1, fixtureEnvironment: manifest.environment, samples: records }, null, 2) + "\n");
console.log(resolve(generated, "variants.json"));
