#!/usr/bin/env python3
"""Render the Pi Gallery image from scripts/gallery-image.html.

The card is laid out in HTML/CSS rather than drawn at absolute pixel
coordinates, so a host without Apple's system fonts substitutes a fallback and
the layout reflows instead of overlapping.

Requires a Chrome/Chromium binary and Pillow. Set CHROME to point at a specific
binary when auto-detection picks the wrong one.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "gallery-image.html"
TARGET = ROOT / "screenshot.png"
WIDTH, HEIGHT, SCALE = 1600, 900, 2

CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
)


def find_chrome() -> str:
    override = os.environ.get("CHROME")
    if override:
        if not Path(override).exists():
            sys.exit(f"CHROME is set to {override!r}, which does not exist.")
        return override
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    for path in CANDIDATES:
        if Path(path).exists():
            return path
    sys.exit(
        "No Chrome or Chromium binary found. Install one, or set CHROME to its path."
    )


def main() -> None:
    if not SOURCE.exists():
        sys.exit(f"Missing {SOURCE.relative_to(ROOT)}")
    chrome = find_chrome()
    with tempfile.TemporaryDirectory() as work:
        raw = Path(work) / "raw.png"
        subprocess.run(
            [
                chrome,
                "--headless",
                "--disable-gpu",
                "--hide-scrollbars",
                f"--force-device-scale-factor={SCALE}",
                f"--window-size={WIDTH},{HEIGHT}",
                f"--screenshot={raw}",
                SOURCE.as_uri(),
            ],
            check=True,
            capture_output=True,
        )
        if not raw.exists():
            sys.exit("Chrome exited without writing a screenshot.")
        # Rendering at 2x and downsampling keeps the text crisp at gallery size.
        with Image.open(raw) as shot:
            shot.convert("RGB").resize(
                (WIDTH, HEIGHT), Image.Resampling.LANCZOS
            ).save(TARGET, optimize=True)
    print(f"{TARGET.relative_to(ROOT)}  {TARGET.stat().st_size:,} bytes  {WIDTH}x{HEIGHT}")


if __name__ == "__main__":
    main()
