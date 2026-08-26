# pi-image-view

Compact, persistent image references and inline previews for the [Pi coding agent](https://pi.dev).

When an image is pasted or dragged into Pi, the editor normally contains a long local path. `pi-image-view` replaces it with a stable pure-text reference:

```text
[Image #1]
Help me resolve this conflict.
```

The reference remains in conversation history and is clickable. The image itself is still attached to the model; temporary clipboard paths are never sent.

## Features

- Replaces pasted and dragged image paths with `[Image #N]`
- Keeps `[Image #N]` in new and restored conversation history
- Makes historical references clickable through terminal OSC 8 links
- Stores submitted model images in a content-addressed SHA-256 blob store (normally 480px PNG thumbnails)
- Deduplicates identical image content
- Removes internal blob targets from model-facing context
- Provides session-scoped control over which image attachments reach the model
- Converts pasted clipboard paths through a rapid 0–240ms scan burst instead of waiting for the normal poll
- Handles immediate submit before the editor polling cycle runs
- Supports multiple images and removal by deleting a placeholder
- Resizes screenshot tool-result images through the same thumbnail pipeline
- Supports Windows drive, UNC, and WSL-translated image paths
- Offers optional atomic marker navigation/deletion for compatible editor setups
- Offers one-shot 1280px detail mode for small text and dense screenshots
- Uses the same best-effort 480px PNG thumbnail for inline preview and model submission
- Supports tmux through Kitty's Unicode placeholder protocol

## Install

```bash
pi install npm:pi-image-view
```

Try it for one run:

```bash
pi -e npm:pi-image-view
```

Then paste an image with `Ctrl+V` (`Alt+V` on Windows/WSL). If Pi is already running after installation, use `/reload`.

## How it works

1. Pi writes a pasted image to a temporary path.
2. The extension loads it and replaces the editor path with `[Image #N]`.
3. The extension awaits a best-effort 480px PNG preview, submits that model image, and writes the same bytes to:

   ```text
   ~/.pi/agent/image-view/blobs/<sha256>.<ext>
   ```

4. Session text stores a clickable `file://` link to that persistent blob behind `[Image #N]`.
5. Before each model call, a context hook removes the local target, leaving the model only `[Image #N]` plus the image attachment.
6. A display-only Markdown transformer keeps compatibility with pre-release `image-view://` references.

The original `/var/folders/...` clipboard path is never sent to the model. Normally the submitted bytes are a 480px PNG thumbnail. If resizing fails, the extension falls back to the source image so the attachment is not lost. If resizing succeeds but PNG conversion alone fails, it submits the resized image in its available format. The persistent blob contains whichever model image was actually submitted. The local blob path is stored only as history display metadata and is stripped from model-facing context.

## Clear existing model image context

When a long session has accumulated many images, clear the images that already exist from subsequent model requests:

```text
/pi-image-view clear
```

`clear` is non-destructive: session history, clickable references, entries, and stored blobs remain unchanged. Images attached after the command continue to be sent normally. Starting another session or reloading the extension resets the clear boundary.

For a screenshot whose small text needs more detail, arm the next image submission at 1280px:

```text
/pi-image-view detail
```

Detail mode applies to the next submitted image batch only, then automatically returns to the 480px default.

The extension always strips local file and internal image-link targets before model calls. Image-only historical messages receive a short text placeholder when their attachment is omitted.

## Session portability and privacy

Clickable history references store an absolute local `file://` Blob path in the Pi session JSONL. The extension strips that target from model-facing context, so providers receive only `[Image #N]` plus the image attachment. However, exporting or sharing the raw session can reveal the local username/path, and the link will not work on another machine. Review session data before sharing it.

## Blob lifecycle

Identical images share one content-addressed blob. Automatic deletion is currently disabled: a Pi process can use a custom or temporary session directory, so scanning only that directory is not sufficient evidence that a globally stored blob is unreferenced. Until cleanup can coordinate across every configured session root and active process, preserving referenced history links takes priority over reclaiming disk space.

## Performance snapshot

A local benchmark used the production 480px PNG payloads from five UI screenshots (118–157 KB each), isolated Pi sessions, `medium` thinking, and the prompt `Reply with exactly OK`. Each cell ran once cold and once warm; the table below shows the warm/cache-influenced round.

| Model | 0 images | 10 images | 20 images | 40 images |
| --- | ---: | ---: | ---: | ---: |
| GPT-5.6 Luna | 5.61s | 6.98s | 7.51s | 9.44s |
| GPT-5.6 Sol | 6.11s | 7.06s | 11.81s | 9.35s |
| GPT-5.6 Terra | 10.48s | 8.32s | 9.18s | 11.64s |

All 12 measured requests completed successfully and the persisted image count matched the target count. Warm requests used approximately 1,664 / 4,096 / 7,680 cache-read tokens at 10 / 20 / 40 images. These are single-run measurements, not p50/p90 latency claims; provider variance is visible in the non-monotonic Sol and Terra rows.

A representative source image changed from 2114×1040 and 867,917 bytes to 480×236 and 125,889 bytes—about an 85% reduction. Use `/pi-image-view clear` when an unusually image-heavy session still becomes slow.

## Compared with `pi-image-preview`

`pi-image-view` is forked from `pi-image-preview` and keeps its core Kitty/tmux preview behavior. The main differences are:

| Capability | `pi-image-preview` 0.1.5 | `pi-image-view` 0.2.0 |
| --- | --- | --- |
| Draft thumbnail | Yes | Yes |
| Typical model payload | 480px preview | 480px preview |
| Editor text | Local image path | `[Image #N]` |
| Sent-history reference | No stable clickable reference | Clickable `[Image #N]` |
| Persistent local image | No dedicated history Blob | SHA-256 content-addressed Blob |
| Model-visible local path | Path can remain in message text | Link target is stripped before provider calls |
| Duplicate attachment protection | No normalized reconciliation | Exact and Pi-normalized matching |
| Long-session escape hatch | Rely on Pi compaction/new session | Non-destructive `/pi-image-view clear` |
| Automatic Blob deletion | Not applicable | Disabled for safety |

Both extensions still represent N images as N `ImageContent` blocks until Pi compacts the session or the user clears context. `pi-image-view` focuses on persistent, inspectable history without adding an automatic image-count cap.

## Release validation

For v0.2.0:

- 45 automated tests pass across 9 files.
- Production dependency audit reports 0 vulnerabilities.
- `npm pack --dry-run` and `npm publish --dry-run` pass.
- An isolated Pi load probe succeeds.

## Optional atomic markers

By default, `pi-image-view` keeps Pi's active editor untouched so it remains compatible with Vim and other editor extensions. To make `[Image #N]` move and delete as one token, start Pi with:

```bash
PI_IMAGE_VIEW_ATOMIC_MARKERS=1 pi
```

Atomic mode replaces the active editor for that session. Left/right navigation jumps across the whole marker, and Backspace/Delete removes it in one undoable action. Do not enable it together with another extension that replaces Pi's editor.

## Terminal support

Pure-text references work in every Pi-supported terminal. Clickable links require terminal OSC 8 support; on macOS, use the terminal's normal link modifier such as `Command`-click.

Inline draft thumbnails require Kitty 0.28 or newer. In tmux 3.3a or newer, add:

```tmux
set -g allow-passthrough all
```

Other terminals receive a text-only preview label while keeping compact references and links where OSC 8 is supported.

## Supported formats and paths

PNG, JPEG/JPG, GIF (first frame), and WebP are supported. Files larger than 50 MB are ignored. Paths may be Unix absolute/home/relative paths, Windows drive paths, UNC paths, or quoted paths with spaces. Windows drive paths are translated to `/mnt/<drive>/...` when running under WSL.

## Development

```bash
npm install
npm test
pi -e .
```

## Credits

Forked from [RielJ/pi-image-preview](https://github.com/RielJ/pi-image-preview). The original Kitty/tmux preview, image loading, resizing, and screenshot integration remain under the MIT license. Persistent references and hyperlink behavior follow the content-addressed design used by OMP.

## License

MIT
