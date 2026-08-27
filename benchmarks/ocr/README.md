# OCR quality benchmark

This benchmark answers whether the production 480px payload preserves enough small text compared with source and one-shot 1280px detail mode.

## Generate fixtures and production variants

The checked baseline was generated on macOS with the font paths and SHA-256 values recorded in the result. Install the pinned Python imaging dependency first:

```bash
python3 -m pip install -r benchmarks/ocr/requirements.txt
```

```bash
python3 benchmarks/ocr/generate_samples.py
node benchmarks/ocr/build_variants.mjs
```

The four deterministic fixtures cover UI text, terminal output, a dense architecture diagram, and mixed-language text. `build_variants.mjs` calls the production `resizeForPreview` and `resizeForDetail` functions with Pi's host `resizeImage`/`convertToPng`; it records dimensions, bytes, SHA-256, MIME type, and source-fallback status.

Generated images live under `benchmarks/ocr/generated/` and are intentionally not committed. Ground truth is embedded in the deterministic generator and copied into each raw result.

## Screening run

```bash
python3 benchmarks/ocr/run_benchmark.py \
  --models openai-codex/gpt-5.6-luna,openai-codex/gpt-5.6-sol \
  --repeats 2 \
  --concurrency 4 \
  --output benchmarks/ocr/results/baseline.json
python3 benchmarks/ocr/summarize_results.py
```

Each trial starts an isolated Pi JSON-mode process with no extensions, context files, skills, prompt templates, or saved session. The runner parses only the finalized assistant `message_end`, records provider usage/cost and wall-clock latency, and scores exact target recovery plus character error rate.

Use `--samples ui` or `--variants preview480` for a smoke test. The default matrix makes paid model calls.

## Decision run

Before changing automatic behavior, use at least five repeats and add a consented, redacted held-out corpus:

```bash
python3 benchmarks/ocr/run_benchmark.py --repeats 5 --concurrency 4
python3 benchmarks/ocr/summarize_results.py
```

See [`docs/research/ocr-benchmark-methodology.md`](../../docs/research/ocr-benchmark-methodology.md) for thresholds and validity limits.
