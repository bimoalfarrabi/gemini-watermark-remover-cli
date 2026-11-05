import { readFile, writeFile, stat, readdir, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { inferMimeTypeFromPath } from '@pilio/gemini-watermark-remover/node';
import { removeWatermarkFromImageDataSync } from '@pilio/gemini-watermark-remover/image-data';
import { GwrError, toGwrError } from './errors.js';
import { resolveCodec } from './codec.js';
import { planOutput } from './output.js';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const VIDEO_EXTS = ['.mp4', '.mov', '.webm'];

/**
 * Check whether a path looks like a supported image input (case-insensitive).
 * @param {string} filePath
 * @returns {boolean}
 */
export function isSupportedInput(filePath) {
  return IMAGE_EXTS.includes(path.extname(filePath).toLowerCase());
}

/**
 * Expand path list: directories become their supported files (sorted, flat),
 * files pass through untouched, missing paths throw.
 * @param {string[]} paths
 * @returns {Promise<string[]>} deduped, order-preserving file list
 */
export async function expandInputs(paths) {
  const out = [];
  const seen = new Set();
  for (const p of paths) {
    let st;
    try {
      st = await stat(p);
    } catch {
      throw new GwrError(`Input not found: ${p}`, {
        code: 'E_INPUT',
        hint: 'Check the path. Directories are scanned non-recursively.',
      });
    }
    let candidates;
    if (st.isDirectory()) {
      const entries = await readdir(p);
      candidates = entries
        .filter((e) => isSupportedInput(e) || VIDEO_EXTS.includes(path.extname(e).toLowerCase()))
        .map((e) => path.join(p, e))
        .sort((a, b) => a.localeCompare(b));
    } else {
      // keep unsupported files too so the caller can report them per-file
      candidates = [p];
    }
    for (const c of candidates) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

/**
 * Process one image end-to-end: decode, watermark removal, encode, write.
 * Never throws for processing errors — failures come back as
 * `{ ok: false, error }`.
 * @param {string} inputPath
 * @param {object} options planOutput options plus { overwrite, allowLowConfidence, video }
 * @returns {Promise<object>} result record
 */
export async function processImage(inputPath, options = {}) {
  const started = performance.now();
  let output = null;
  try {
    if (!isSupportedInput(inputPath)) {
      throw new GwrError(`Unsupported input format: ${inputPath}`, {
        code: 'E_INPUT',
        hint: 'Supported image formats: .png .jpg .jpeg .webp',
      });
    }

    if (options.video && VIDEO_EXTS.includes(path.extname(inputPath).toLowerCase())) {
      // lazy import so bundlers can drop the video stack entirely
      const { processVideo } = await import('./video.js');
      return await processVideo(inputPath, options);
    }

    const plan = planOutput(inputPath, options);
    output = plan.output;
    // planOutput is pure: overwrite policy lives here. Refuse before reading
    // the input so an existing target is never touched.
    if (!options.overwrite) {
      try {
        await access(output);
        throw new GwrError(`Output already exists: ${output}`, {
          code: 'E_OUTPUT_EXISTS',
          hint: 'Pass --overwrite to replace existing files.',
        });
      } catch (err) {
        if (err instanceof GwrError) throw err;
        // ENOENT — target free, proceed
      }
    }

    const mimeType = inferMimeTypeFromPath(inputPath);
    const codec = await resolveCodec();
    if (!codec.supports(mimeType)) {
      throw new GwrError(`Format not supported by the ${codec.name} codec: ${mimeType}`, {
        code: 'E_CODEC',
        hint: 'WebP needs the native sharp codec. Install it with: npm i -g sharp',
      });
    }

    const buffer = await readFile(inputPath);
    const imageData = await codec.decode(buffer, { mimeType });
    const { imageData: cleaned, meta } = removeWatermarkFromImageDataSync(imageData);
    const encoded = await codec.encode(cleaned, { mimeType, filePath: output });

    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, encoded);

    return {
      input: inputPath,
      output,
      ok: true,
      kind: 'image',
      meta,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    return {
      input: inputPath,
      output,
      ok: false,
      kind: 'image',
      error: toGwrError(err),
      durationMs: Math.round(performance.now() - started),
    };
  }
}

/**
 * Process files with a bounded worker pool. Results keep input order no matter
 * which worker finishes first (they are written into slots, not appended).
 * Never rejects.
 * @param {string[]} inputPaths
 * @param {object} options
 * @param {Function} [onProgress] called as onProgress({ index, total, result })
 * @returns {Promise<object[]>}
 */
export async function processBatch(inputPaths, options = {}, onProgress) {
  const total = inputPaths.length;
  const results = new Array(total);
  const jobs = Math.min(8, Math.max(1, Number(options.jobs) || 1));

  if (jobs <= 1 || total <= 1) {
    for (let i = 0; i < total; i++) {
      const result = await processImage(inputPaths[i], options);
      results[i] = result;
      if (onProgress) onProgress({ index: i, total, result });
    }
    return results;
  }

  let next = 0;
  async function worker() {
    while (next < total) {
      const index = next++;
      const result = await processImage(inputPaths[index], options);
      results[index] = result;
      if (onProgress) onProgress({ index, total, result });
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, total) }, worker));
  return results;
}
