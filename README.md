# gwr — Gemini Watermark Remover CLI

Remove the visible Gemini watermark from images, from your terminal.
PNG, JPEG and WebP. Works on Linux, macOS and Windows.

The removal is not AI inpainting: it inverts Gemini's known alpha blend
mathematically, so the pixels that were covered come back instead of being
guessed. The engine is the open-source
[GargantuaX/gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover)
core (`@pilio/gemini-watermark-remover`), used unmodified.

## Install

```bash
npm install -g gemini-watermark-remover-cli
```

Or run it once without installing:

```bash
npx gemini-watermark-remover-cli photo.png
```

The npm package installs one command, `gemini-watermark`. It deliberately does
not claim the short name `gwr`, because the engine package this CLI depends on
([`@pilio/gemini-watermark-remover`](https://www.npmjs.com/package/@pilio/gemini-watermark-remover))
ships its own `gwr` binary; two packages claiming one bin name resolve to
whichever installed last. The standalone binaries below are called `gwr`, and
you can add a shell alias if you want the short form:

```bash
alias gwr=gemini-watermark
```

Prebuilt standalone binaries (no Node.js required) are attached to each
release: `gwr-linux-x64`, `gwr-linux-arm64`, `gwr-macos-x64`,
`gwr-macos-arm64`, `gwr-windows-x64.exe`.

## Use

```bash
gwr                                  # interactive picker
gwr photo.png                        # writes photo-clean.png next to it
gwr photo.png -o out/photo.png       # explicit output
gwr ./screenshots                    # whole folder, one job per core
gwr ./shots -d ./clean --jobs 4      # folder -> folder, parallel
gwr photo.png -i                     # overwrite in place
gwr *.png --dry-run                  # show what would happen
gwr ./shots --json                   # machine-readable result
```

Every file gets its own outcome. One bad file does not stop the batch.

### Flags

| Flag | Meaning |
| --- | --- |
| `-o, --output <file>` | Exact output path (single input only) |
| `-d, --out-dir <dir>` | Output directory; keeps input filenames |
| `--suffix <text>` | Default `-clean`, appended when no output is set |
| `-i, --in-place` | Overwrite the input file |
| `-f, --overwrite` | Allow replacing existing files |
| `-j, --jobs <n>` | Parallel files (1–64), default 1 |
| `-n, --dry-run` | Print the plan, write nothing |
| `--json` | JSON on stdout, nothing else |
| `-q, --quiet` | Only the written paths |
| `--video` | Experimental: also process Gemini MP4s |
| `--allow-low-confidence` | Keep a low-confidence result instead of skipping |
| `--no-color` | Disable ANSI colour |
| `-h, --help` | Full help |
| `-v, --version` | Version |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Every file succeeded |
| `1` | Some files failed |
| `2` | Bad usage |
| `3` | Input not found |
| `4` | Nothing could be processed |

## Configuration

Defaults persist in one JSON file, so you stop repeating the same flags.

```bash
gwr config                       # show current settings
gwr config set suffix -nowm      # default suffix
gwr config set outDir ~/clean    # always write here
gwr config set jobs 4            # default parallelism
gwr config path                  # where the file lives
gwr config reset                 # back to defaults
```

Location: `$XDG_CONFIG_HOME/gwr/config.json`, or
`~/.config/gwr/config.json` on Linux/macOS,
`%APPDATA%\gwr\config.json` on Windows.

## Diagnostics

```bash
gwr doctor
```

Reports the Node version, which image codec is active, whether the
experimental video pipeline can run, and where the config lives.

## Codecs

The CLI uses [`sharp`](https://sharp.pixelplumbing.com) when it is available
and falls back to pure-JavaScript PNG/JPEG handling otherwise. The fallback
means the standalone binaries work without any native dependency, at the cost
of losing WebP support. If you process WebP files, install sharp:

```bash
npm install -g sharp
```

Both paths produce byte-identical pixels; only the encode/decode library
differs, so a missing sharp costs WebP support, never output quality.

## Video (experimental)

Gemini video watermark removal needs a real Chromium driving the browser
pipeline, which is far heavier than the image path:

```bash
npm install -g playwright
npx playwright install chromium
gwr clip.mp4 --video -o clip-clean.mp4
```

Without that runtime, `--video` fails with an install hint instead of
silently returning the untouched file.

## Limits

- Targets original Gemini image output. Screenshots, re-uploaded images and
  images edited after generation are outside the supported scope.
- A watermark that is not Gemini's visible mark is left untouched, which is
  the correct behaviour but looks like a no-op.
- Removal quality depends on the engine's watermark catalog. New Gemini
  output sizes can need a catalog update.

## License

MIT. Engine © GargantuaX and AllenK (Kwyshell).
