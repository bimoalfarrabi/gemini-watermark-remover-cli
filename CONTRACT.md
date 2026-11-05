# gwr-cli — module contract

Frozen interface. Every lane codes against this file. Do not rename exports.

Package root: `gwr-cli/`. ESM only (`"type": "module"`). Node >= 20.
Engine: `@pilio/gemini-watermark-remover/node` (`removeWatermarkFromImageDataSync`)
— already installed. Never reimplement watermark math.

## Hard rules

- No TypeScript, no build step for the npm package. Plain ESM `.js`.
- `src/cli.js` starts with `#!/usr/bin/env node`.
- Video support is lazy-loaded inside `src/video.js` only. Nothing else may
  import it at module top level, so bundlers can drop mediabunny/playwright.
- Everything user-facing goes through `src/ui.js`. `console.log` outside
  `src/ui.js` is a defect.
- Every function listed below must exist with the exact signature.

## `src/errors.js`

```js
export class GwrError extends Error {
  constructor(message, { code = 'E_GENERIC', hint = null, cause = null } = {})
}
// code is one of: E_USAGE, E_INPUT, E_OUTPUT_EXISTS, E_CODEC, E_PROCESS, E_VIDEO
export function toGwrError(error) // normalizes unknown throws into GwrError
```

## `src/codec.js`

```js
export async function resolveCodec()      // -> Codec, memoized
export function resetCodecCache()          // test seam
export async function describeCodec()      // -> { name: 'sharp'|'pure', formats: string[] }

// Codec
// { name, decode(buffer, { mimeType }) -> Promise<{width,height,data:Uint8ClampedArray}>,
//   encode(imageData, { mimeType, filePath }) -> Promise<Buffer>,
//   supports(mimeType) -> boolean }
```

Rules:
- Try `import('sharp')` inside try/catch. Success → `name: 'sharp'`.
  Failure (missing binary, blocked install script, platform mismatch) → pure JS.
- Pure path: `fast-png` for `image/png`, `jpeg-js` for `image/jpeg`.
- Pure path cannot decode/encode WebP → `supports('image/webp') === false`.
  Callers surface `E_CODEC` with hint: `npm i -g sharp` when a .webp arrives.
- Always hand the engine 4-channel RGBA (`Uint8ClampedArray`), converting
  1/3-channel input and forcing alpha 255.
- Encode: PNG → `fast-png` encode channels 4. JPEG → `jpeg-js` `encode(..., 95)`.
  Preserve alpha only when the source had any non-255 alpha byte.
- Never mutate the caller's buffer.

## `src/output.js`

```js
export function planOutput(inputPath, options) // -> { output, skip, reason }
export function uniquePath(target)             // -> string, adds " (2)" before ext
export function describePlan(plan)             // -> one-line string for the UI
```

`options`: `{ output, outDir, suffix = '-clean', inPlace = false, overwrite = false }`

- explicit `output` → exactly that path
- `inPlace` → same path, requires `overwrite`
- `outDir` → `outDir/basename(input)`
- default → sibling `name + suffix + ext`
- Existing target and `!overwrite` → `skip: true`, `reason: 'exists'`

## `src/pipeline.js`

```js
export async function processImage(inputPath, options)
// -> { input, output, ok, kind: 'image', meta, error?, durationMs }
export async function processBatch(inputPaths, options, onProgress)
// -> array of the above, input order preserved, never throws for a single file
export function isSupportedInput(filePath) // -> boolean (.png .jpg .jpeg .webp)
export async function expandInputs(paths)  // dirs -> sorted files, recursive=false
```

`options` mirrors `planOutput` plus `{ allowLowConfidence, video, onVideoProgress }`.
A per-file failure is captured into `{ ok: false, error: GwrError }`; the batch
continues. `onProgress({ index, total, result })` fires after each file.

## `src/config.js`

```js
export function configPath()        // ~/.config/gwr/config.json (honors XDG_CONFIG_HOME)
export async function loadConfig()  // -> object, {} when absent/corrupt
export async function saveConfig(patch) // merged write, creates dirs
export async function resetConfig()
```

Keys: `{ suffix, outDir, overwrite, jobs, video, color }`. Unknown keys are kept.

## `src/args.js`

```js
export function parseArgs(argv) // -> { command, options }
export function usageText()     // -> string (multi-line help)
```

`command`: `'run' | 'config' | 'doctor' | 'help' | 'version'`.
`options`: `{ inputs: string[], output, outDir, suffix, inPlace, overwrite,
json, quiet, dryRun, jobs, video, allowLowConfidence, noColor }`.
Unknown flag → `GwrError` with `code: 'E_USAGE'`.
`-h/--help`, `-v/--version` are handled here, never crash.

## `src/ui.js`

The only module allowed to write to stdout/stderr.

```js
export function isInteractive()                // TTY && !noColor-not-required && !json
export async function promptInputs(defaultDir) // -> string[] (may be empty)
export async function confirmPlan(plans, options) // -> boolean
export function progressReporter({ total, quiet, json }) // -> fn(event) printer, self-throttled
export function renderSummary(results, { quiet, json, dryRun })
export function intro(version)
export function outro(message)
export function warn(message, hint)
export function fail(error)                    // -> exit code number
export function table(rows)                    // plain-text aligned columns
```

`renderSummary` prints JSON (single object for one file, array for many) and
nothing else when `json` is true. In `quiet` mode it prints one path per line.
Colour via `picocolors`; respect `NO_COLOR`, `FORCE_COLOR`, `--no-color`,
and non-TTY auto-disable.

## `src/cli.js`

```js
#!/usr/bin/env node
export async function main(argv = process.argv.slice(2)) // -> exit code
// when executed directly: await main().then(c => { process.exitCode = c })
```

Exit codes: `0` all good, `1` some files failed, `2` usage error,
`3` input not found, `4` nothing could be processed.

Flow:
1. no inputs and interactive → `promptInputs()` then continue
2. no inputs and not interactive → print `usageText()`, exit 2
3. expand + plan; if `--dry-run`, print plan and stop
4. if interactive and >1 file or overwrite risk → `confirmPlan`
5. run batch with progress; `renderSummary`
6. `config` / `doctor` subcommands

## `src/video.js` (lane C owns; lazy)

```js
export async function processVideo(inputPath, options) // same result shape
export async function videoAvailable()                 // -> boolean, never throws
```

Experimental: only reached when `options.video` is true. Missing
`dist/video-preview.html` or Playwright => `E_VIDEO` with an install hint.

## Tests

`test/*.test.js`, `node:test` + `node:assert/strict`. Fixtures from
`../src/assets/samples/` (read-only). No network. Cover: arg parsing,
output planning and collision, codec round-trip, pipeline success/failure,
summary rendering (json/quiet), exit codes.
