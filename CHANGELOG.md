# Changelog

All notable changes to `pi-image-view` are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.0 — unreleased

Direct clipboard paste, atomic `[Image #N]` markers, and a one-shot detail mode.

### Added

- **Direct clipboard paste** on macOS, Windows, and WSL. The extension reads image
  clipboard data itself, so Pi never renders a temporary path — `[Image #N]` appears
  immediately. Reads run as bounded asynchronous `execFile` calls and no longer block
  the TUI. Native Linux keeps Pi's default editor and paste-triggered burst scans.
- **Atomic markers.** `←`/`→` jump across a whole `[Image #N]` marker and
  `Backspace`/`Delete` remove it in one undoable action, instead of editing it one
  character at a time.
- **`/pi-image-view detail`** arms the next image batch at 1280px for small text and
  dense diagrams, then reverts to the 480px default automatically.
- **Windows path support.** Drive paths (`C:\...`) and UNC paths (`\\host\share\...`)
  are detected, and drive paths are translated to `/mnt/<drive>/...` under WSL.
- **`~/`, `./`, and `../` paths** are expanded, with `./` and `../` resolved against
  the active Pi session cwd.
- Punctuation directly after an unquoted path no longer swallows the path.
- A [comparison of the Pi image extensions](docs/research/pi-image-plugin-comparison.md)
  covering `pi-image-preview`, `pi-paster`, and `pi-screenshots-picker`.

### Fixed

- Clipboard paste no longer attaches an image to the wrong turn. A read that resolves
  after the draft was submitted is dropped, overlapping pastes are serialized, and a
  failed read is logged instead of raising an unhandled rejection that would end the
  session.
- Shell escapes are resolved before the `~` and `./` prefixes are interpreted, so a
  path dragged in from a file manager (`~/My\ Photo.png`) reads correctly.
- Non-PNG images are no longer sent through Kitty's `f=100` transmission, which
  accepts PNG only and rendered them as a blank block. The gallery falls back to text.
- Whole-marker deletion now requires a verified undo snapshot seam, so an atomic
  delete is always undoable.
- On shutdown the extension restores the editor factory it displaced, and only when it
  still owns the active one — it no longer clears an editor installed by another
  extension.
- The clear boundary is rebased across compacted context prefixes, so
  `/pi-image-view clear` stays anchored after compaction.
- Word and grapheme segmentation is preserved outside atomic image markers.

### Changed

- `peerDependencies` are pinned to `>=0.84.3 <0.85.0`. The custom editor depends on
  host editor internals, so the supported Pi range is now explicit rather than `*`.

### Known limitations

- **`pi-zentui` load order.** Load `pi-image-view` before `pi-zentui` so Zentui wraps
  the image-view editor; the reverse order can destabilize editor/status
  reconciliation. Tracked in [#1](https://github.com/alchemistklk/pi-image-view/issues/1),
  not yet fully resolved.
- **Kitty fallback is all-or-nothing.** A single non-PNG image downgrades the whole
  gallery to text. This only happens when PNG conversion fails.
- **Clipboard read timeouts** (1500 ms macOS, 2500 ms Windows) have not been measured
  against a cold PowerShell start, where `-STA` plus `Add-Type` can approach 2 s. A
  timeout degrades silently to the text clipboard.
- **Automatic blob deletion stays disabled.** See
  [Blob lifecycle](README.md#blob-lifecycle).

### Validation

- 59 automated tests across 12 files
- 0 production dependency vulnerabilities (`npm audit --omit=dev`)
- `npm pack --dry-run` and `npm publish --dry-run --access public` pass
- Isolated Pi load probe passes
- Direct marker paste and atomic deletion confirmed by a real user on macOS

## 0.1.0 — 2026-08-26

First release, forked from
[RielJ/pi-image-preview](https://github.com/RielJ/pi-image-preview).

### Added

- Replaces temporary clipboard paths with `[Image #N]`
- Keeps clickable image references in restored conversation history
- Submits best-effort 480px PNG thumbnails to reduce model payload size
- Stores submitted thumbnails as SHA-256 content-addressed local blobs
- Strips local `file://` targets from model-facing context
- Deduplicates Pi-preprocessed and path-discovered attachments
- Kitty and tmux inline draft previews
- Non-destructive `/pi-image-view clear` for long sessions
