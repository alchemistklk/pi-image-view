#!/usr/bin/env python3
"""Re-score saved OCR responses after scorer changes; never reruns model calls."""
from __future__ import annotations
import argparse,hashlib,importlib.util,json,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
RUNNER=ROOT/'benchmarks/ocr/run_benchmark.py'
spec=importlib.util.spec_from_file_location('ocr_runner',RUNNER);runner=importlib.util.module_from_spec(spec);assert spec.loader;spec.loader.exec_module(runner)
def main():
 p=argparse.ArgumentParser();p.add_argument('--input',default='benchmarks/ocr/results/baseline.json');a=p.parse_args();path=ROOT/a.input;data=json.loads(path.read_text());old_schema=data.get('schemaVersion',1);original_status=data.get('status','complete');original_requested=data.get('requestedTrials',len(data.get('results',[])))
 data.setdefault('originalRunSchemaVersion',old_schema);data.setdefault('originalRunnerSha256',data.get('runnerSha256'))
 for result in data.get('results',[]):
  predicted,valid=runner.parse_array(result.get('response',''),len(result['targets']));result['formatValid']=valid;result['predicted']=predicted;result.update(runner.score(result['targets'],predicted if valid else []))
 data['schemaVersion']=max(2,old_schema);data['status']=original_status;data['requestedTrials']=original_requested;data['rescoredAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());data['scorerSha256']=hashlib.sha256(RUNNER.read_bytes()).hexdigest()
 runner.atomic_write(path,data);print(path)
if __name__=='__main__':main()
