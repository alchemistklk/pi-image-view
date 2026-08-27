#!/usr/bin/env python3
"""Render OCR benchmark JSON as a decision-oriented Markdown report."""
from __future__ import annotations
import argparse,json,statistics
from collections import defaultdict
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def median(xs):return statistics.median(xs) if xs else None
def p90(xs):
 xs=sorted(xs);return xs[min(len(xs)-1,max(0,int((len(xs)-1)*.9+.999)))] if xs else None
def pct(v):return 'n/a' if v is None else f'{v:.1%}'
def num(v,d=0):return 'n/a' if v is None else f'{v:,.{d}f}'
def main():
 p=argparse.ArgumentParser();p.add_argument('--input',default='benchmarks/ocr/results/baseline.json');p.add_argument('--output',default='docs/research/ocr-quality-baseline.md');a=p.parse_args();data=json.loads((ROOT/a.input).read_text());results=data['results'];models=data.get('models') or sorted({r['model'] for r in results});samples=data.get('samples') or sorted({r['sample'] for r in results});variants=data.get('variants') or sorted({r['variant'] for r in results});repeats=data.get('repeats',0);requested=data.get('requestedTrials',len(models)*len(samples)*len(variants)*repeats);valid=[r for r in results if r.get('ok') and r.get('formatValid',True)];complete=len(results)==requested and len(valid)==requested and data.get('status','complete')=='complete'
 lines=['# OCR and small-text quality baseline','',f"Run: `{data.get('createdAt','unknown')}` · Pi `{data.get('piVersion','unknown')}` · commit `{data.get('extensionCommit','unknown')[:12]}` · repeats `{repeats}` · concurrency `{data.get('concurrency','unknown')}` · seed `{data.get('seed','unknown')}`",'',f"Models: {', '.join(f'`{m}`' for m in models)}",'',f"Matrix completeness: **{len(valid)}/{requested} valid trials** · strict format-valid rate **{len([r for r in results if r.get('formatValid')]) / max(1,len(results)):.1%}**.",'','This is a synthetic, two-repeat **quality-only screening baseline**. Strict exact-item rate preserves whitespace after Unicode NFC; strict CER is character edit distance divided by reference characters. Cost, tokens, and latency are descriptive and are not used to authorize automatic escalation.','','## Overall by model and payload','','| Model | Variant | Trials | Strict exact items | All-target trial exact | Strict CER | Median bytes | Median input | Median cache read | Median total cost | p50 latency | p90 latency |','| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
 groups=defaultdict(list)
 for r in valid:groups[(r['model'],r['variant'])].append(r)
 for (model,var),g in sorted(groups.items()):
  usage=[x.get('usage') for x in g if x.get('usage')];costs=[u.get('cost',{}).get('total') for u in usage if u.get('cost',{}).get('total') is not None]
  lines.append(f"| `{model.split('/')[-1]}` | {var} | {len(g)} | {pct(statistics.mean(x.get('strictExactItemRate',x['exactItemRate']) for x in g))} | {pct(statistics.mean(x.get('strictExactItems',x['exactItems'])==x['expectedCount'] for x in g))} | {pct(statistics.mean(x.get('strictCharacterErrorRate',x['characterErrorRate']) for x in g))} | {num(median([x['bytes'] for x in g]))} | {num(median([u.get('input',0) for u in usage]))} | {num(median([u.get('cacheRead',0) for u in usage]))} | {'n/a' if not costs else '$'+num(median(costs),4)} | {num(median([x['elapsedSeconds'] for x in g]),2)}s | {num(p90([x['elapsedSeconds'] for x in g]),2)}s |")
 lines += ['','## Quality by fixture (models and repeats combined)','','| Fixture | Variant | Trials | Strict exact items | All-target trial exact | Strict CER |','| --- | --- | ---: | ---: | ---: | ---: |'];fixture=defaultdict(list)
 for r in valid:fixture[(r['sample'],r['variant'])].append(r)
 for (sample,var),g in sorted(fixture.items()):lines.append(f"| {sample} | {var} | {len(g)} | {pct(statistics.mean(x.get('strictExactItemRate',x['exactItemRate']) for x in g))} | {pct(statistics.mean(x.get('strictExactItems',x['exactItems'])==x['expectedCount'] for x in g))} | {pct(statistics.mean(x.get('strictCharacterErrorRate',x['characterErrorRate']) for x in g))} |")
 checks=[]
 for model in models:
  for sample in samples:
   by={v:[r for r in valid if r['model']==model and r['sample']==sample and r['variant']==v] for v in ['source','preview480','detail1280']};cell_complete=all(len(by[v])==repeats for v in by)
   if not cell_complete:checks.append((model,sample,False,None,None,'incomplete'));continue
   cer={v:median([r.get('strictCharacterErrorRate',r['characterErrorRate']) for r in g]) for v,g in by.items()};exact={v:median([r.get('strictExactItemRate',r['exactItemRate']) for r in g]) for v,g in by.items()};bytes_ok=median([r['bytes'] for r in by['preview480']])<median([r['bytes'] for r in by['detail1280']]);passed=cer['preview480']<=cer['source']+.05 and exact['preview480']>=exact['source']-.10 and cer['preview480']<=.05 and exact['preview480']>=.80 and bytes_ok;checks.append((model,sample,passed,cer,exact,'quality'))
 lines += ['','## Pre-registered quality-only 480px checks','','Pass requires a complete cell, median 480px strict CER ≤5%, strict exact-item recovery ≥80%, no more than 5 CER points or 10 exact-recovery points worse than source, and a smaller payload than 1280px. Latency and cost remain descriptive because two concurrent repeats cannot establish stable regressions.','','| Model | Fixture | Pass | Source CER | 480 CER | 1280 CER | Source exact | 480 exact | 1280 exact |','| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: |']
 for model,sample,ok,cer,exact,reason in checks:
  lines.append(f"| `{model.split('/')[-1]}` | {sample} | {'✓' if ok else '✗'} | {pct(None if cer is None else cer['source'])} | {pct(None if cer is None else cer['preview480'])} | {pct(None if cer is None else cer['detail1280'])} | {pct(None if exact is None else exact['source'])} | {pct(None if exact is None else exact['preview480'])} | {pct(None if exact is None else exact['detail1280'])} |")
 failed=[x for x in checks if not x[2]];lines += ['','## Screening conclusion','']
 if not complete:lines.append('**Inconclusive:** the requested matrix is incomplete or contains failed/format-invalid trials. No default-resolution conclusion is allowed.')
 elif failed:lines.append('The 480px payload fails at least one quality-only guard in this screening run. Keep the explicit `/pi-image-view detail` path; do not add automatic escalation until a five-repeat held-out detector study passes.')
 else:lines.append('The 480px payload passes every quality-only guard in this synthetic screening run. Keep 480px as the default and retain `/pi-image-view detail` for user-identified dense or small-text screenshots. This does **not** authorize automatic escalation or claim stable latency superiority.')
 lines += ['', 'Observed efficiency is descriptive: compare payload, usage, cost, and latency rows above. Concurrent two-repeat latency is visibly noisy and is not a release gate.', '',f"Completed/valid trials: {len(valid)}/{requested}. A decision-grade policy still requires five repeats, a consented redacted held-out corpus, and a frozen local detector with false-positive/false-negative analysis.",'', 'Raw results: [`benchmarks/ocr/results/baseline.json`](../../benchmarks/ocr/results/baseline.json)', 'Methodology: [`ocr-benchmark-methodology.md`](ocr-benchmark-methodology.md)','']
 out=ROOT/a.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text('\n'.join(lines));print(out)
if __name__=='__main__':main()
