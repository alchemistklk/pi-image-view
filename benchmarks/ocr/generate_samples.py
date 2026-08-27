#!/usr/bin/env python3
"""Generate deterministic OCR benchmark images and ground truth."""
from __future__ import annotations

import hashlib
import json
import platform
import sys
from pathlib import Path
import PIL
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "benchmarks/ocr/generated/source"
MANIFEST = ROOT / "benchmarks/ocr/generated/manifest.json"
SIZE = (1920, 1080)

SELECTED_FONTS = {}
FONT_CANDIDATES = {
    "sans": ["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"],
    "mono": ["/System/Library/Fonts/SFNSMono.ttf", "/System/Library/Fonts/Menlo.ttc"],
    "cjk": ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"],
}

def font(kind: str, size: int):
    for candidate in FONT_CANDIDATES[kind]:
        if Path(candidate).exists():
            SELECTED_FONTS[kind] = candidate
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size=size)

def base(bg=(246, 247, 249)):
    return Image.new("RGB", SIZE, bg)

def numbered(draw, xy, number, text, *, kind="sans", size=22, fill=(28, 32, 38)):
    x, y = xy
    draw.text((x, y), f"{number}.", font=font("sans", size), fill=(48, 105, 220))
    draw.text((x + 42, y), text, font=font(kind, size), fill=fill)

def ui_sample():
    targets = [
        "Workspace: Northstar Migration",
        "Environment: Production · us-west-2",
        "Release: 2026.08.27-rc3",
        "Owner: Platform Reliability",
        "Error budget remaining: 99.87%",
        "Deploy window: 14:30–15:00 UTC",
        "Rollback token: RBK-7Q4M-29",
        "Approve and deploy",
    ]
    im = base(); d = ImageDraw.Draw(im)
    d.rounded_rectangle((110, 80, 1810, 1000), radius=28, fill=(255,255,255), outline=(210,214,220), width=2)
    d.text((170, 125), "Release approval", font=font("sans", 42), fill=(20,24,30))
    d.text((170, 185), "Review the production change set before deployment.", font=font("sans", 20), fill=(96,103,112))
    for i, text in enumerate(targets[:7], 1):
        col = 170 if i <= 4 else 980
        row = 280 + ((i - 1) % 4) * 125
        d.rounded_rectangle((col-20, row-18, col+690, row+66), radius=14, fill=(247,249,252), outline=(224,228,234))
        numbered(d, (col, row), i, text, size=20 if i != 7 else 18)
    d.rounded_rectangle((1250, 835, 1690, 920), radius=14, fill=(44,102,220))
    numbered(d, (1290, 858), 8, targets[7], size=21, fill=(255,255,255))
    return im, targets

def terminal_sample():
    targets = [
        "$ kubectl get deploy api-gateway -n prod",
        "READY 3/3 · UP-TO-DATE 3 · AVAILABLE 3",
        "IMAGE registry.example/api:7f3c9a2",
        "P95 latency: 184.7 ms",
        "Error rate: 0.013%",
        "Trace ID: 4bf92f3577b34da6a3ce929d0e0e4736",
        "Region failover: eu-central-1 → us-east-1",
        "Checksum: sha256:9d7a1c4e82bf",
        "Retry budget: 17 / 250",
        "STATUS healthy — no action required",
    ]
    im = base((20,23,28)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((100,70,1820,1010), radius=24, fill=(29,33,40), outline=(72,78,88), width=2)
    d.ellipse((145,112,169,136), fill=(255,95,86)); d.ellipse((181,112,205,136), fill=(255,189,46)); d.ellipse((217,112,241,136), fill=(39,201,63))
    d.text((285,105), "production diagnostics", font=font("mono", 22), fill=(180,186,196))
    for i, text in enumerate(targets, 1):
        numbered(d, (155, 195 + (i-1)*75), i, text, kind="mono", size=19, fill=(220,225,232))
    return im, targets

def diagram_sample():
    targets = [
        "Ingress Gateway",
        "Policy Engine",
        "Primary Queue",
        "Worker Pool A",
        "Worker Pool B",
        "Audit Store",
        "route: tenant+priority",
        "dead-letter after 5 attempts",
    ]
    im = base((250,248,244)); d = ImageDraw.Draw(im)
    positions=[(130,150),(650,150),(1170,150),(520,480),(1050,480),(780,790)]
    colors=[(226,239,255),(239,231,255),(228,247,235),(255,241,218),(255,241,218),(231,238,244)]
    for i,(text,pos,color) in enumerate(zip(targets[:6],positions,colors),1):
        x,y=pos; d.rounded_rectangle((x,y,x+390,y+145),radius=22,fill=color,outline=(80,92,108),width=3)
        numbered(d,(x+28,y+52),i,text,size=19 if i>2 else 21)
    # arrows and small edge labels
    for a,b in [(positions[0],positions[1]),(positions[1],positions[2]),(positions[2],positions[3]),(positions[2],positions[4]),(positions[3],positions[5]),(positions[4],positions[5])]:
        ax,ay=a[0]+390,a[1]+72; bx,by=b[0],b[1]+72; d.line((ax,ay,bx,by),fill=(87,96,108),width=4)
    numbered(d,(740,350),7,targets[6],kind="mono",size=17)
    numbered(d,(1160,700),8,targets[7],kind="mono",size=16)
    return im, targets

def mixed_sample():
    targets = [
        "构建状态：已通过 128 项检查",
        "部署区域：东京 ap-northeast-1",
        "回滚编号：回滚-甲辰-0427",
        "担当者：佐藤・李 / Platform Team",
        "错误率：0.021％（阈值 0.10％）",
        "次回確認：2026年8月27日 16:45",
        "Résumé de livraison : prêt",
        "승인 코드: SEOUL-배포-731",
    ]
    im=base((243,246,250));d=ImageDraw.Draw(im)
    d.text((120,90),"多语言发布检查 / Multilingual release check",font=font("cjk",34),fill=(24,30,40))
    for i,text in enumerate(targets,1):
        y=190+(i-1)*100
        d.rounded_rectangle((120,y-15,1800,y+62),radius=12,fill=(255,255,255),outline=(215,221,229))
        numbered(d,(155,y),i,text,kind="cjk",size=20)
    return im,targets

SAMPLES={"ui":ui_sample,"terminal":terminal_sample,"diagram":diagram_sample,"mixed-language":mixed_sample}

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    manifest={"schemaVersion":1,"sourceSize":list(SIZE),"samples":[]}
    for name,make in SAMPLES.items():
        image,targets=make(); path=OUT/f"{name}.png"; image.save(path,optimize=False)
        manifest["samples"].append({"id":name,"source":str(path.relative_to(ROOT)),"targets":targets})
    manifest["environment"] = {
        "pythonVersion": platform.python_version(), "pillowVersion": PIL.__version__,
        "platform": platform.platform(),
        "fonts": {kind: {"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()} for kind, path in sorted(SELECTED_FONTS.items())},
    }
    MANIFEST.parent.mkdir(parents=True,exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
    print(MANIFEST)

if __name__=="__main__":main()
