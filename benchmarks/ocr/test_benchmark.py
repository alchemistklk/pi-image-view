from __future__ import annotations
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); assert spec.loader; spec.loader.exec_module(module); return module

runner = load("ocr_runner_test", ROOT / "benchmarks/ocr/run_benchmark.py")

class BenchmarkTests(unittest.TestCase):
    def test_strict_json_array_validation(self):
        self.assertEqual(runner.parse_array('["a", "b"]', 2), (["a", "b"], True))
        for value in ['prefix ["a", "b"]', '["a", "b"] suffix', '["a"]', '[1, 2]', '{"items":["a","b"]}']:
            self.assertEqual(runner.parse_array(value, 2), ([], False))

    def test_strict_and_whitespace_normalized_scores_are_distinct(self):
        score = runner.score(["a  b"], ["a b"])
        self.assertEqual(score["strictExactItemRate"], 0)
        self.assertGreater(score["strictCharacterErrorRate"], 0)
        self.assertEqual(score["exactItemRate"], 1)

    def test_timeout_is_retained_as_failed_trial(self):
        job = {"path": "missing.png", "model": "model", "targets": ["x"], "sample": "s", "variant": "source", "repeat": 1}
        with patch.object(runner.subprocess, "run", side_effect=subprocess.TimeoutExpired("pi", 180)):
            result = runner.run_one(job)
        self.assertFalse(result["ok"]); self.assertFalse(result["formatValid"])
        self.assertIn("timeout", result["error"])

    def test_incomplete_matrix_is_reported_inconclusive(self):
        payload = {"schemaVersion": 2, "status": "complete", "createdAt": "now", "models": ["m"], "samples": ["s"], "variants": ["source", "preview480", "detail1280"], "repeats": 1, "concurrency": 1, "seed": 1, "requestedTrials": 3, "results": []}
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "input.json"; output = Path(temp) / "report.md"; source.write_text(json.dumps(payload))
            completed = subprocess.run(["python3", str(ROOT / "benchmarks/ocr/summarize_results.py"), "--input", str(source), "--output", str(output)], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("Inconclusive", output.read_text())

    def test_rescore_preserves_incomplete_checkpoint(self):
        payload = {"schemaVersion": 2, "status": "running", "requestedTrials": 3, "results": []}
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "partial.json"; source.write_text(json.dumps(payload))
            completed = subprocess.run(["python3", str(ROOT / "benchmarks/ocr/rescore_results.py"), "--input", str(source)], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            rescored = json.loads(source.read_text())
            self.assertEqual(rescored["status"], "running")
            self.assertEqual(rescored["requestedTrials"], 3)
            self.assertIn("scorerSha256", rescored)
            self.assertFalse(source.with_suffix(".json.tmp").exists())

    def test_absolute_floor_rejects_equally_unreadable_source_and_preview(self):
        results = []
        for index, variant in enumerate(["source", "preview480", "detail1280"]):
            results.append({"jobIndex": index, "ok": True, "formatValid": True, "model": "m", "sample": "s", "variant": variant, "repeat": 1, "expectedCount": 1, "strictExactItems": 0, "strictExactItemRate": 0, "strictCharacterErrorRate": 1, "exactItems": 0, "exactItemRate": 0, "characterErrorRate": 1, "bytes": {"source": 100, "preview480": 50, "detail1280": 80}[variant], "elapsedSeconds": 1, "usage": {"input": 1, "cacheRead": 0, "cost": {"total": 0.01}}})
        payload = {"schemaVersion": 2, "status": "complete", "createdAt": "now", "models": ["m"], "samples": ["s"], "variants": ["source", "preview480", "detail1280"], "repeats": 1, "concurrency": 1, "seed": 1, "requestedTrials": 3, "results": results}
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "input.json"; output = Path(temp) / "report.md"; source.write_text(json.dumps(payload))
            subprocess.run(["python3", str(ROOT / "benchmarks/ocr/summarize_results.py"), "--input", str(source), "--output", str(output)], cwd=ROOT, check=True)
            report = output.read_text()
            self.assertIn("| `m` | s | ✗ |", report)
            self.assertIn("fails at least one quality-only guard", report)

    def test_invalid_matrix_and_stale_image_abort_before_paid_calls(self):
        invalid = subprocess.run(["python3", str(ROOT / "benchmarks/ocr/run_benchmark.py"), "--models", " "], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(invalid.returncode, 2)
        self.assertIn("unique nonempty", invalid.stderr)
        manifest = json.loads((ROOT / "benchmarks/ocr/generated/variants.json").read_text())
        image = ROOT / manifest["samples"][0]["variants"]["preview480"]["path"]
        original = image.read_bytes()
        try:
            image.write_bytes(original + b"corrupt")
            stale = subprocess.run(["python3", str(ROOT / "benchmarks/ocr/run_benchmark.py"), "--models", "model", "--samples", manifest["samples"][0]["id"], "--variants", "preview480", "--repeats", "1", "--allow-dirty"], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(stale.returncode, 2)
            self.assertIn("metadata mismatch", stale.stderr)
        finally:
            image.write_bytes(original)

if __name__ == "__main__": unittest.main()
