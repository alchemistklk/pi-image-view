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
- Stores images in a content-addressed SHA-256 blob store
- Deduplicates identical image content
- Removes internal blob targets from model-facing context
- Cleans up only blobs no longer referenced by any Pi session
- Handles immediate submit before the editor polling cycle runs
- Supports multiple images and removal by deleting a placeholder
- Shows inline draft thumbnails in Kitty-compatible terminals
- Supports tmux through Kitty's Unicode placeholder protocol
- Downscales oversized images before provider submission

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
3. On submit, the provider-safe image is written to:

   ```text
   ~/.pi/agent/image-view/blobs/<sha256>.<ext>
   ```

4. Session text stores a clickable `file://` link to that persistent blob behind `[Image #N]`.
5. Before each model call, a context hook removes the local target, leaving the model only `[Image #N]` plus the image attachment.
6. A display-only Markdown transformer keeps compatibility with pre-release `image-view://` references.

The original `/var/folders/...` clipboard path is neither persisted in message text nor sent to the model. The persistent blob path is stored only as history display metadata and is stripped from model-facing context.

## Blob lifecycle

Blob cleanup is reference-driven rather than age-driven. At session startup, the extension scans Pi session JSONL files and deletes image blobs that:

- are not referenced by any session, and
- are older than a five-minute write-safety grace period.

Referenced images remain available so old conversation links do not expire unexpectedly. Identical images share one blob.

## Terminal support

Pure-text references work in every Pi-supported terminal. Clickable links require terminal OSC 8 support; on macOS, use the terminal's normal link modifier such as `Command`-click.

Inline draft thumbnails require Kitty 0.28 or newer. In tmux 3.3a or newer, add:

```tmux
set -g allow-passthrough all
```

Other terminals receive a text-only preview label while keeping compact references and links where OSC 8 is supported.

## Supported formats

PNG, JPEG/JPG, GIF (first frame), and WebP. Files larger than 50 MB are ignored.

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
