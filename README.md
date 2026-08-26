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
- Handles immediate submit before the editor polling cycle runs
- Supports multiple images and removal by deleting a placeholder
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

The original `/var/folders/...` clipboard path is never sent to the model. Normally the submitted bytes are a 480px PNG thumbnail. If Pi cannot resize or convert the image, the extension fails open to the source image so the attachment is not lost; the persistent blob then contains that submitted fallback. The local blob path is stored only as history display metadata and is stripped from model-facing context.

## Model image context

Use `/pi-image-view` to inspect or change which existing image attachments are included in model calls:

```text
/pi-image-view status
/pi-image-view all
/pi-image-view latest
/pi-image-view none
```

The default is `all`. `latest` keeps images from only the newest image-bearing user turn, including tool-result images from that turn, while `none` removes every image attachment. The setting is in-memory and applies only to the current extension session; starting another session resets it to `all`.

All modes strip local file and internal image-link targets before model calls. These transformations affect only the model-facing copy: session history, entries, and stored blobs remain unchanged. Image-only messages receive a short text placeholder when their attachment is omitted.

## Blob lifecycle

Identical images share one content-addressed blob. Automatic deletion is currently disabled: a Pi process can use a custom or temporary session directory, so scanning only that directory is not sufficient evidence that a globally stored blob is unreferenced. Until cleanup can coordinate across every configured session root and active process, preserving referenced history links takes priority over reclaiming disk space.

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
