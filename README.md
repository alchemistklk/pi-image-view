# pi-image-view

Compact image attachments and inline previews for the [Pi coding agent](https://pi.dev).

When an image is pasted or dragged into Pi, the editor normally contains a long local path. `pi-image-view` replaces that path with a stable, readable placeholder while retaining the same image attachment internally:

```text
[Image #1]
Help me resolve this conflict.
```

On submit, the placeholder is removed from the prompt and the original image content is attached to the message. The agent receives the image, not the temporary local path.

## Features

- Replaces pasted and dragged image paths with `[Image #N]` placeholders
- Preserves the original image attachment sent to the model
- Handles immediate submit before the editor polling cycle runs
- Supports multiple images and removal by deleting a placeholder
- Shows inline thumbnails above the editor in Kitty-compatible terminals
- Supports tmux through Kitty's Unicode placeholder protocol
- Downscales oversized images before provider submission
- Upgrades compatible screenshot tool results to inline images

## Install

```bash
pi install npm:pi-image-view
```

Try it for one run:

```bash
pi -e npm:pi-image-view
```

Then paste an image with `Ctrl+V` (`Alt+V` on Windows/WSL). If Pi is already running after installation, use `/reload`.

## Terminal support

Compact editor placeholders work in every Pi-supported terminal.

Inline thumbnail rendering requires Kitty 0.28 or newer. In tmux 3.3a or newer, add:

```tmux
set -g allow-passthrough all
```

Other terminals receive a text-only preview label while keeping compact editor placeholders.

## Behavior and privacy

The temporary filesystem path is used only inside the local extension to load the image. Before the prompt reaches the model, `pi-image-view` removes `[Image #N]` and attaches the image content. Existing image attachments on the input event are preserved.

If the user submits immediately after pasting, before the 250 ms preview scan runs, the extension detects the raw path during submission and applies the same transformation.

## Supported formats

PNG, JPEG/JPG, GIF (first frame), and WebP. Files larger than 50 MB are ignored.

## Development

```bash
npm install
npm test
pi -e .
```

## Credits

Forked from [RielJ/pi-image-preview](https://github.com/RielJ/pi-image-preview). The original Kitty/tmux preview, image loading, resizing, and screenshot integration remain under the MIT license.

## License

MIT
