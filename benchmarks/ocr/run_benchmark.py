#!/usr/bin/env python3
"""Run the pi-image-view OCR quality benchmark through Pi's JSON mode."""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import platform
import random
import statistics
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODELS = ["openai-codex/gpt-5.6-luna", "openai-codex/gpt-5.6-sol"]
PROMPT = """OCR benchmark. The image contains exactly {count} numbered targets, from 1 through {count}. Return ONLY one valid JSON array of {count} strings in numerical order. Each string must contain the text after its number exactly as shown, preserving case, punctuation, symbols, spacing within the target, and non-English characters. Do not include the numbers, Markdown, commentary, or extra fields."""

def nfc(value: str) -> str: return unicodedata.normalize("NFC", value)
def normalized(value: str) -> str: return " ".join(nfc(value).split())
def sha256_bytes(value: bytes) -> str: return hashlib.sha256(value).hexdigest()
def command_output(command: list[str], cwd: Path | None = None) -> str | None:
    try: return subprocess.check_output(command, cwd=cwd, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.SubprocessError): return None

def levenshtein(a: str, b: str) -> int:
    if len(a) < len(b): a, b = b, a
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        nxt = [i]
        for j, cb in enumerate(b, 1): nxt.append(min(nxt[-1] + 1, row[j] + 1, row[j - 1] + (ca != cb)))
        row = nxt
    return row[-1]

def parse_array(text: str, expected_count: int) -> tuple[list[str], bool]:
    try: value = json.loads(text.strip())
    except json.JSONDecodeError: return [], False
    valid = isinstance(value, list) and len(value) == expected_count and all(isinstance(item, str) for item in value)
    return (value if valid else []), valid

def score(expected: list[str], predicted: list[str]) -> dict[str, Any]:
    aligned = predicted[:len(expected)] + [""] * max(0, len(expected) - len(predicted))
    strict_pairs = [(nfc(a), nfc(b)) for a, b in zip(expected, aligned)]
    normalized_pairs = [(normalized(a), normalized(b)) for a, b in zip(expected, aligned)]
    strict_errors = sum(levenshtein(a, b) for a, b in strict_pairs)
    normalized_errors = sum(levenshtein(a, b) for a, b in normalized_pairs)
    strict_chars = sum(len(a) for a, _ in strict_pairs)
    normalized_chars = sum(len(a) for a, _ in normalized_pairs)
    strict_exact = sum(a == b for a, b in strict_pairs)
    normalized_exact = sum(a == b for a, b in normalized_pairs)
    return {
        "expectedCount": len(expected), "predictedCount": len(predicted),
        "strictExactItems": strict_exact, "strictExactItemRate": strict_exact / len(expected),
        "strictCharacterErrors": strict_errors, "strictCharacterErrorRate": strict_errors / max(1, strict_chars),
        "exactItems": normalized_exact, "exactItemRate": normalized_exact / len(expected),
        "characterErrors": normalized_errors, "characterErrorRate": normalized_errors / max(1, normalized_chars),
    }

def failed_result(job: dict[str, Any], elapsed: float, error: str) -> dict[str, Any]:
    result = {**job, "ok": False, "formatValid": False, "elapsedSeconds": elapsed,
              "response": "", "predicted": [], "usage": None, "error": error}
    result.update(score(job["targets"], [])); return result

def run_one(job: dict[str, Any]) -> dict[str, Any]:
    image = ROOT / job["path"]
    command = ["pi", "--mode", "json", "--no-extensions", "--no-session", "--no-context-files",
               "--no-skills", "--no-prompt-templates", "--model", job["model"], "--thinking", "off",
               f"@{image}", PROMPT.format(count=len(job["targets"]))]
    started = time.perf_counter()
    try:
        completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=180)
    except subprocess.TimeoutExpired as error:
        return failed_result(job, time.perf_counter() - started, f"timeout after {error.timeout}s")
    except OSError as error:
        return failed_result(job, time.perf_counter() - started, f"process launch failed: {error}")
    elapsed = time.perf_counter() - started
    assistant: dict[str, Any] | None = None
    for line in completed.stdout.splitlines():
        try: event = json.loads(line)
        except json.JSONDecodeError: continue
        if event.get("type") == "message_end" and event.get("message", {}).get("role") == "assistant": assistant = event["message"]
    text = "" if not assistant else "".join(part.get("text", "") for part in assistant.get("content", []) if part.get("type") == "text")
    predicted, format_valid = parse_array(text, len(job["targets"]))
    ok = completed.returncode == 0 and assistant is not None
    result = {**job, "ok": ok, "formatValid": format_valid, "elapsedSeconds": elapsed,
              "response": text, "predicted": predicted, "usage": (assistant or {}).get("usage")}
    result.update(score(job["targets"], predicted if format_valid else []))
    if not ok or not format_valid:
        result["error"] = (completed.stderr[-2000:] or "missing finalized assistant message" if not ok else "response was not exactly one JSON string array of the expected length")
    return result

def atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True); temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n"); os.replace(temporary, path)

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--models", default=",".join(DEFAULT_MODELS)); parser.add_argument("--repeats", type=int, default=2); parser.add_argument("--concurrency", type=int, default=4); parser.add_argument("--samples", default=""); parser.add_argument("--variants", default="source,preview480,detail1280"); parser.add_argument("--output", default="benchmarks/ocr/results/baseline.json"); parser.add_argument("--seed", type=int, default=20260827); parser.add_argument("--allow-dirty", action="store_true"); args = parser.parse_args()
    if args.repeats <= 0 or args.concurrency <= 0: parser.error("--repeats and --concurrency must be positive")
    manifest_path = ROOT / "benchmarks/ocr/generated/variants.json"
    manifest = json.loads(manifest_path.read_text())
    samples_manifest = manifest.get("samples") or []
    sample_ids = [sample.get("id") for sample in samples_manifest]
    if not sample_ids or any(not isinstance(value, str) or not value.strip() for value in sample_ids) or len(sample_ids) != len(set(sample_ids)): parser.error("manifest sample IDs must be unique nonempty strings")
    for sample in samples_manifest:
        if not sample.get("targets") or any(not isinstance(target, str) or not target for target in sample["targets"]): parser.error(f"sample {sample.get('id')} has empty/invalid targets")
        if set((sample.get("variants") or {}).keys()) != {"source", "preview480", "detail1280"}: parser.error(f"sample {sample.get('id')} has incomplete variants")
    known_samples = set(sample_ids)
    sample_tokens = [value.strip() for value in args.samples.split(",")]
    if args.samples and any(not value for value in sample_tokens): parser.error("--samples contains an empty selection")
    selected = set(sample_tokens) if args.samples else known_samples
    models = [value.strip() for value in args.models.split(",")]
    variants = [value.strip() for value in args.variants.split(",")]
    if any(not value for value in models) or len(models) != len(set(models)): parser.error("--models must contain unique nonempty values")
    if any(not value for value in variants) or len(variants) != len(set(variants)) or any(value not in {"source", "preview480", "detail1280"} for value in variants): parser.error("--variants must contain unique known values")
    if not selected <= known_samples: parser.error(f"unknown samples: {sorted(selected - known_samples)}")
    jobs = []
    for sample in samples_manifest:
        if sample["id"] not in selected: continue
        for variant in variants:
            for model in models:
                for repeat in range(1, args.repeats + 1): jobs.append({"sample": sample["id"], "variant": variant, "model": model, "repeat": repeat, "targets": sample["targets"], **sample["variants"][variant]})
    if not jobs: parser.error("selected matrix has no jobs")
    for job in jobs:
        image_path = ROOT / job["path"]
        try: image_bytes = image_path.read_bytes()
        except OSError as error: parser.error(f"cannot read {job['path']}: {error}")
        if len(image_bytes) != job.get("bytes") or sha256_bytes(image_bytes) != job.get("sha256"): parser.error(f"variant metadata mismatch: {job['path']}")
    random.Random(args.seed).shuffle(jobs)
    for index, job in enumerate(jobs): job["jobIndex"] = index
    script_bytes = Path(__file__).read_bytes(); diff = command_output(["git", "diff", "--binary", "HEAD"], ROOT) or ""
    pi_version = command_output(["pi", "--version"]); commit = command_output(["git", "rev-parse", "HEAD"], ROOT); node_version = command_output(["node", "--version"]); dirty = bool(command_output(["git", "status", "--porcelain"], ROOT))
    if not pi_version or not commit or not node_version or not manifest.get("fixtureEnvironment"): parser.error("required runtime/fixture provenance is unavailable")
    if dirty and not args.allow_dirty: parser.error("working tree is dirty; commit benchmark code first or use --allow-dirty for a non-attested smoke run")
    provenance = {"piVersion": pi_version, "extensionCommit": commit, "gitDirty": dirty, "gitDiffSha256": sha256_bytes(diff.encode()),
                  "runnerSha256": sha256_bytes(script_bytes), "pythonVersion": platform.python_version(), "nodeVersion": node_version,
                  "platform": platform.platform(), "fixtureEnvironment": manifest.get("fixtureEnvironment"),
                  "variantManifestSha256": sha256_bytes(manifest_path.read_bytes()), "models": models, "samples": sorted(selected), "variants": variants,
                  "repeats": args.repeats, "concurrency": args.concurrency, "seed": args.seed, "requestedTrials": len(jobs), "prompt": PROMPT}
    output = ROOT / args.output; results: list[dict[str, Any]] = []
    def payload(status: str): return {"schemaVersion": 2, "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "status": status, **provenance, "results": sorted(results, key=lambda r: r["jobIndex"])}
    atomic_write(output, payload("running"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(run_one, job) for job in jobs]
        for future in concurrent.futures.as_completed(futures):
            try: results.append(future.result())
            except Exception as error: results.append(failed_result(jobs[futures.index(future)], 0, f"unexpected worker failure: {error}"))
            atomic_write(output, payload("running"))
    atomic_write(output, payload("complete")); complete = sum(r["ok"] and r["formatValid"] for r in results)
    print(f"{output}: {complete}/{len(results)} completed with valid format")
    for variant in variants:
        group = [r for r in results if r["variant"] == variant and r["ok"] and r["formatValid"]]
        if group: print(variant, "strict exact", f"{statistics.mean(r['strictExactItemRate'] for r in group):.3f}", "strict CER", f"{statistics.mean(r['strictCharacterErrorRate'] for r in group):.3f}", "latency", f"{statistics.median(r['elapsedSeconds'] for r in group):.2f}s")
    raise SystemExit(0 if complete == len(results) else 1)
if __name__ == "__main__": main()
