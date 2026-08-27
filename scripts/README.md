# Maintainer scripts

## `generate-gallery-image.py`

Renders `screenshot.png` — the image used by the Pi package gallery
(`pi.image` in `package.json`) and as the README hero — from
`gallery-image.html`.

```bash
python3 scripts/generate-gallery-image.py
```

**Requirements:** Python 3 with [Pillow](https://pypi.org/project/Pillow/)
(`pip install Pillow`) and a Chrome or Chromium binary. The script checks `PATH`
and the usual macOS and Linux install locations; set `CHROME` to override.

Edit the card by editing `gallery-image.html` — open it directly in a browser to
preview. The layout is CSS, not absolute coordinates, so a host missing Apple's
system fonts substitutes from the declared fallback stack and the layout reflows
rather than overlapping.

Output is deterministic on a given host at 1600×900. It is **not** byte-stable
across machines, because text rasterization depends on the available fonts and
the Chrome version. Regenerate and commit `screenshot.png` whenever the card
changes.

`pi.image` points at `main`, so a regenerated image goes live as soon as it is
merged — no release required.
