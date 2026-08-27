# OCR and small-text quality baseline

Run: `2026-08-27T06:21:35Z` · Pi `0.84.3` · commit `833b30f2fb4f` · repeats `2` · concurrency `4` · seed `20260827`

Models: `openai-codex/gpt-5.6-luna`, `openai-codex/gpt-5.6-sol`

Provenance: git dirty `False` · runner `71b1d17322c1` · variant manifest `7d270baef3f8`

Matrix completeness: **48/48 valid trials** · exact matrix keys **yes** · strict format-valid rate **100.0%**.

This is a synthetic, two-repeat **quality-only screening baseline**. Strict exact-item rate preserves whitespace after Unicode NFC; strict CER is character edit distance divided by reference characters. Cost, tokens, and latency are descriptive and are not used to authorize automatic escalation.

## Overall by model and payload

| Model | Variant | Trials | Strict exact items | All-target trial exact | Strict CER | Median bytes | Median input | Median cache read | Median total cost | p50 latency | p90 latency |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-5.6-luna` | detail1280 | 8 | 92.2% | 87.5% | 1.5% | 102,971 | 2,301 | 0 | $0.0009 | 12.45s | 22.06s |
| `gpt-5.6-luna` | preview480 | 8 | 93.8% | 87.5% | 4.6% | 26,020 | 1,378 | 7,104 | $0.0006 | 43.71s | 93.30s |
| `gpt-5.6-luna` | source | 8 | 90.9% | 75.0% | 1.6% | 52,975 | 3,643 | 0 | $0.0011 | 12.09s | 26.15s |
| `gpt-5.6-sol` | detail1280 | 8 | 92.2% | 87.5% | 1.5% | 102,971 | 2,301 | 0 | $0.0170 | 11.46s | 33.83s |
| `gpt-5.6-sol` | preview480 | 8 | 100.0% | 100.0% | 0.0% | 26,020 | 3,178 | 0 | $0.0205 | 23.55s | 51.27s |
| `gpt-5.6-sol` | source | 8 | 90.6% | 75.0% | 1.6% | 52,975 | 3,643 | 0 | $0.0205 | 9.44s | 36.46s |

## Quality by fixture (models and repeats combined)

| Fixture | Variant | Trials | Strict exact items | All-target trial exact | Strict CER |
| --- | --- | ---: | ---: | ---: | ---: |
| diagram | detail1280 | 4 | 100.0% | 100.0% | 0.0% |
| diagram | preview480 | 4 | 87.5% | 75.0% | 9.2% |
| diagram | source | 4 | 100.0% | 100.0% | 0.0% |
| mixed-language | detail1280 | 4 | 68.8% | 50.0% | 6.1% |
| mixed-language | preview480 | 4 | 100.0% | 100.0% | 0.0% |
| mixed-language | source | 4 | 68.8% | 50.0% | 6.3% |
| terminal | detail1280 | 4 | 100.0% | 100.0% | 0.0% |
| terminal | preview480 | 4 | 100.0% | 100.0% | 0.0% |
| terminal | source | 4 | 97.5% | 75.0% | 0.1% |
| ui | detail1280 | 4 | 100.0% | 100.0% | 0.0% |
| ui | preview480 | 4 | 100.0% | 100.0% | 0.0% |
| ui | source | 4 | 96.9% | 75.0% | 0.1% |

## Pre-registered quality-only 480px checks

Pass requires a complete cell, median 480px strict CER ≤5%, strict exact-item recovery ≥80%, no more than 5 CER points or 10 exact-recovery points worse than source, and a smaller payload than 1280px. Latency and cost remain descriptive because two concurrent repeats cannot establish stable regressions.

| Model | Fixture | Pass | Source CER | 480 CER | 1280 CER | Source exact | 480 exact | 1280 exact |
| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-5.6-luna` | diagram | ✗ | 0.0% | 18.4% | 0.0% | 100.0% | 75.0% | 100.0% |
| `gpt-5.6-luna` | mixed-language | ✓ | 6.4% | 0.0% | 6.1% | 68.8% | 100.0% | 68.8% |
| `gpt-5.6-luna` | terminal | ✓ | 0.2% | 0.0% | 0.0% | 95.0% | 100.0% | 100.0% |
| `gpt-5.6-luna` | ui | ✓ | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| `gpt-5.6-sol` | diagram | ✓ | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| `gpt-5.6-sol` | mixed-language | ✓ | 6.1% | 0.0% | 6.1% | 68.8% | 100.0% | 68.8% |
| `gpt-5.6-sol` | terminal | ✓ | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| `gpt-5.6-sol` | ui | ✓ | 0.2% | 0.0% | 0.0% | 93.8% | 100.0% | 100.0% |

## Screening conclusion

The 480px payload fails at least one quality-only guard in this screening run (gpt-5.6-luna / diagram). Keep 480px as the ordinary default, use explicit `/pi-image-view detail` for dense/small-text cases, and do not add automatic escalation until a five-repeat held-out detector study passes.

Observed efficiency is descriptive: compare payload, usage, cost, and latency rows above. Concurrent two-repeat latency is visibly noisy and is not a release gate.

Completed/valid trials: 48/48. A decision-grade policy still requires five repeats, a consented redacted held-out corpus, and a frozen local detector with false-positive/false-negative analysis.

Raw results: [`benchmarks/ocr/results/baseline.json`](../../benchmarks/ocr/results/baseline.json)
Methodology: [`ocr-benchmark-methodology.md`](ocr-benchmark-methodology.md)
