# Gallery responsiveness check

This manual check covers the acceptance seam that unit tests cannot measure: paste and
editor typing responsiveness in a real Pi TUI. Record the same host and terminal for
both baseline and candidate runs. **No manual responsiveness, Ghostty, or tmux gate is
claimed passed until samples are recorded.**

## Deterministic fixture source

The automated resource benchmark uses the two valid 1×1 PNG base64 values in
`test/image-gallery.test.ts` (`PNG_FIXTURES`). The newline-terminated two-line fixture
list has SHA-256:

```text
9ff65fcf0158ee0393cf20703871971d7a2ab35a5fb4ea2ed15ecba70e182be7
```

Recreate and verify it exactly:

```bash
RAW='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/2QAAAABJRU5ErkJggg=='
PREVIEW='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jm3cAAAAASUVORK5CYII='
printf '%s\n%s\n' "$RAW" "$PREVIEW" | shasum -a 256
mkdir -p /tmp/pi-image-view-gallery-fixtures
for i in $(seq 0 19); do
  value="$RAW"; [ $((i % 2)) -eq 1 ] && value="$PREVIEW"
  printf '%s' "$value" | base64 -d > "/tmp/pi-image-view-gallery-fixtures/image-$i.png"
done
```

Use the first 5, 10, or all 20 files in numeric order. The automated staggered
scenario starts each key with `PNG_FIXTURES[i % 2]`, then replaces key `i` with
`PNG_FIXTURES[(i + 1) % 2]`; every raw/preview pair differs while attachment keys remain
stable.

## Environment record

- commit / package version:
- fixture checksum above and fixture directory:
- OS, CPU, and power mode:
- Node version:
- terminal and version (Ghostty when available):
- tmux version, configuration, pane target, and pane dimensions (or `none`):
- terminal columns/rows and cell pixel dimensions:
- display refresh rate and recorder/frame rate:

## Repeatable timing procedure

Use this exact 100-character input string:

```text
0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789
```

1. Run `npm test -- test/image-gallery.test.ts test/gallery-presenter.test.ts` before
   manual work. It verifies deterministic 5/10/20 resource accounting.
2. Record the Pi pane at at least 60 fps with a recorder that preserves frame
   timestamps. Record the pane target and recorder command in the environment record.
3. For each 5/10/20 fixture, run five repetitions. Use `tmux send-keys -l` with the
   exact string above when testing in tmux (or paste the same string once in a
   non-tmux terminal). Immediately before each paste/send operation, record a
   monotonic timestamp with `python3 -c 'import time; print(time.monotonic_ns())'`.
4. From the recording, measure paste-start to first thumbnail frame, and send-start to
   the frame where all 100 characters are visibly painted. Convert frames to elapsed
   milliseconds using the recorded frame timestamps; keep all five raw samples.
5. Calculate p50 and p95 for paste-to-first-thumbnail and typing-paint time. Compare
   candidate/baseline on the same recorded environment. Every candidate p50 and p95
   must be `<= 1.10x` its baseline counterpart.
6. Resize narrow/wide, switch tmux panes, then submit, `/new`, reload/resume, and
   shut down. Record ghost images, wrong placement, cross-session images, or stale
   thumbnails. Run this in Ghostty and tmux when available.

The automated 20-image test measures gallery creation, render/update requests, PNG
payload bytes, control/placement bytes, deletes, and live IDs. It deliberately does
not claim interactive input latency or terminal protocol behavior.
