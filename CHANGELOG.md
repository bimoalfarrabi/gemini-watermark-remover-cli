# Changelog

## 0.1.0

First release.

- `gwr <file>` removes the Gemini watermark and writes `<name>-clean<ext>`
- Interactive picker when run with no arguments
- Batch processing of folders, bounded parallelism with `--jobs`
- `--json`, `--quiet`, `--dry-run` and stable exit codes for scripting
- Per-user defaults in `gwr config` (suffix, outDir, jobs, overwrite)
- `gwr doctor` reports codec, video availability and config location
- Works without native dependencies: pure-JS PNG/JPEG fallback when `sharp`
  is unavailable; `sharp` used automatically when present
- Standalone binaries for Linux, macOS and Windows built with bun
