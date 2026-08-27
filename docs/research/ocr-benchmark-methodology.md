# OCR benchmark methodology for issue #9

## Question

This benchmark measures whether the normal 480px model attachment preserves enough small text compared with the source and the explicit 1280px detail payload. It measures model transcription from the attachment, not terminal thumbnail rendering or a separate OCR engine.

The production seams are [`resizeForPreview`](../../src/preview-resize.ts), which calls Pi `resizeImage` with a 480×480 / 2 MiB cap and then `convertToPng`, and [`resizeForDetail`](../../src/preview-resize.ts), which calls the same resizer with a 1280×1280 / 4.5 MiB cap. The extension imports those functions from the running Pi host in [`index.ts`](../../index.ts). Pi's implementations are the primary source for null/fallback behavior: [resize](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/utils/image-resize.ts) and [PNG conversion](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/utils/image-convert.ts).

## Deterministic screening corpus

`benchmarks/ocr/generate_samples.py` reproducibly generates four synthetic 1920×1080 PNG fixtures. Each contains numbered targets with ground truth embedded in the generator:

| Fixture | Targets | Stress |
| --- | ---: | --- |
| `ui` | 8 | form labels, dates, percentages, release and rollback identifiers |
| `terminal` | 10 | monospace commands, hashes, trace IDs, arrows and punctuation |
| `diagram` | 8 | node and edge labels distributed across a dense flow diagram |
| `mixed-language` | 8 | Chinese, Japanese, Korean, accented Latin, numerals and symbols |

The synthetic corpus is a deterministic regression screen, not evidence that all real screenshots behave the same. Before enabling automatic escalation, add a separately consented and redacted held-out real-world corpus.

## Production variant generation

`benchmarks/ocr/build_variants.mjs` creates exactly three variants per fixture:

1. `source` — original PNG control.
2. `preview480` — `resizeForPreview(source, { resizeImage, convertToPng })`.
3. `detail1280` — `resizeForDetail(source, { resizeImage })`.

For every file it records actual MIME type, byte count, SHA-256, decoded dimensions, and whether the result fell back to source bytes. A fallback remains an observed result but cannot support a claim about reduced resolution.

## Execution protocol

Each trial starts a fresh Pi JSON-mode process with no extensions, session, context files, skills, or prompt templates. Model, Pi version, extension commit, seed, and repeat count are recorded. Jobs are shuffled with the recorded seed.

Every fixture uses this invariant prompt, where `N` is the target count:

```text
OCR benchmark. The image contains exactly N numbered targets, from 1 through N.
Return ONLY one valid JSON array of N strings in numerical order. Each string must
contain the text after its number exactly as shown, preserving case, punctuation,
symbols, spacing within the target, and non-English characters. Do not include the
numbers, Markdown, commentary, or extra fields.
```

A screening baseline uses two completed repeats per model/fixture/variant. A decision run uses at least five repeats plus the held-out corpus. Provider/network failures are retained as failures rather than replaced with favorable outputs.

Pi documents JSONL mode and finalized usage on `message_end.message.usage`; score only the finalized `message_end`, not streaming deltas. [Pi JSON mode, v0.84.3](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/json.md) Token and cost fields come directly from Pi's finalized usage type. [Pi AI usage type, v0.84.3](https://github.com/earendil-works/pi/blob/v0.84.3/packages/ai/src/types.ts)

## Metrics

The runner records every raw response and reports:

- **Exact-item rate:** fraction of complete numbered target strings recovered exactly after Unicode NFC and whitespace normalization.
- **Character error rate (CER):** Levenshtein distance over aligned target strings divided by reference characters.
- **Payload:** actual bytes, MIME, width, height and SHA-256.
- **Usage/cost:** finalized input, output, cache and total cost fields from Pi.
- **Latency:** wall-clock process start through finalized response; this includes local startup and provider variance and is not model-only latency.

Extra prose, malformed JSON, missing items, punctuation errors and `[illegible]` all reduce the objective score. The raw JSON remains available for qualitative readability review.

## Pre-registered decision rule

For every model/fixture cell, compare medians across repeats. The synthetic quality-only screen passes only when:

- 480px strict CER is at most 5% and no more than 5 percentage points worse than source;
- 480px strict exact-item recovery is at least 80% and no more than 10 points below source; and
- the 480px payload is smaller than the 1280px payload.

Tokens, cost, and latency remain descriptive in the two-repeat concurrent screen. A later decision-grade policy study must pre-register quantitative efficiency/non-regression thresholds and use enough repeats to evaluate them.

If only dense diagrams or mixed-language fixtures fail, keep 480px for ordinary images and retain explicit `/pi-image-view detail` for those classes. If 1280px also fails, investigate crop/tiling rather than assuming more pixels solve the problem.

Automatic escalation requires a five-repeat held-out run and a deterministic local pre-send detector. A candidate may use text-region count and estimated glyph height, but it must independently demonstrate at least a 10-point exact-target improvement or 5-point CER improvement for the escalated class. Do not use model self-reported uncertainty to silently resend because that changes request count and cost.

## Threats to validity

- Provider/model preprocessing and behavior can drift; record model, date, Pi version and raw responses and rerun after changes.
- Two screening repeats establish a baseline, not stable p50/p90 claims.
- Synthetic fixtures are cleaner than real screenshots; they cannot authorize automatic policy alone.
- Variant pixels and provider vision preprocessing are confounded; report actual bytes/dimensions and avoid causal claims.
- Parallel requests affect latency; use latency descriptively and keep quality scoring primary.
- Generated fonts depend on the recorded local environment; source and variant hashes make drift visible.
