import path from 'node:path';
import fs from 'node:fs';
import { GwrError } from './errors.js';

/**
 * Canonical form used to compare two paths that should be considered the same
 * file. Forward slashes so mixed Windows separators compare equal, no trailing
 * separator, and lower-cased because Windows and macOS filesystems are
 * case-insensitive by default. Exported so callers build their lookup sets with
 * exactly the same rule.
 * @param {string} target a file path, relative or absolute
 * @returns {string}
 */
export function collisionKey(target) {
  const absolute = path.resolve(target);
  const slashed = absolute.split(path.sep).join('/');
  return slashed.replace(/\/+$/, '').toLowerCase();
}

/**
 * Computes the output path for one input. Synchronous and pure: it never
 * touches the filesystem. Collision detection is opt-in via
 * `options.exists` — a Set of normalized existing paths the caller supplies
 * (from its own stat calls) — so this function stays deterministic and
 * testable. Without `options.exists`, skip is always false.
 * @param {string} inputPath source file path
 * @param {object} [options] { output, outDir, suffix, inPlace, overwrite, exists }
 * @returns {{ input: string, output: string, skip: boolean, reason: string|null, inPlace: boolean, overwriteExisting: boolean }}
 *   `overwriteExisting` is true when the resolved output is present in
 *   options.exists, regardless of `overwrite`; `skip` additionally requires
 *   !options.overwrite.
 */
export function planOutput(inputPath, options = {}) {
  const {
    output = null,
    outDir = null,
    suffix = '-clean',
    inPlace = false,
    overwrite = false,
    exists = null,
  } = options;
  // suffix defaults to '-clean' also when explicitly passed as null/undefined
  const effectiveSuffix = suffix == null ? '-clean' : suffix;

  let target;
  if (output !== null && output !== undefined) {
    target = output;
  } else if (inPlace) {
    target = inputPath;
  } else if (outDir !== null && outDir !== undefined) {
    target = path.join(outDir, path.basename(inputPath));
  } else {
    const ext = path.extname(inputPath);
    const name = path.basename(inputPath, ext);
    target = path.join(path.dirname(inputPath), name + effectiveSuffix + ext);
  }

  // exists is a caller-provided Set of normalized paths. Comparing raw strings
  // misses case differences (Windows), separator differences (a relative input
  // yields "photo-clean.png" while the caller probed an absolute path), and
  // trailing-separator noise. Normalize the same way on both sides.
  const key = collisionKey;

  const overwriteExisting = exists instanceof Set && (exists.has(key(target)) || exists.has(key(path.resolve(target))));
  let skip = false;
  let reason = null;
  if (!overwrite && overwriteExisting) {
    skip = true;
    reason = 'exists';
  }

  return { input: inputPath, output: target, skip, reason, inPlace: Boolean(inPlace), overwriteExisting };
}

/**
 * Returns a non-colliding variant of the target path by appending
 * " (2)", " (3)", ... before the extension. Gives up after 999 tries.
 * Synchronous on purpose: callers use it while building a plan.
 * @param {string} target desired output path
 * @returns {string} the first free path, or the target itself
 * @throws {GwrError} code E_OUTPUT_EXISTS when all 999 variants are taken
 */
export function uniquePath(target) {
  const taken = (p) => fs.existsSync(p);
  if (!taken(target)) return target;
  const ext = path.extname(target);
  const stem = target.slice(0, target.length - ext.length);
  for (let n = 2; n <= 999; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken(candidate)) return candidate;
  }
  throw new GwrError(`No free filename for ${target} (tried 998 variants)`, {
    code: 'E_OUTPUT_EXISTS',
    hint: 'Delete old outputs or pass --overwrite.',
  });
}

/**
 * Renders one plan as a single human-readable line.
 * @param {{ input: string, output: string, skip?: boolean, reason?: string|null }} plan
 * @returns {string} e.g. "photo.png  ->  photo-clean.png"
 */
export function describePlan(plan) {
  const line = `${plan.input}  ->  ${plan.output}`;
  return plan.skip ? `${line}  (skipped: output exists)` : line;
}

/**
 * Creates the parent directory of a path when missing (mkdir -p).
 * @param {string} filePath any path whose dirname should exist
 * @returns {Promise<void>}
 */
export async function ensureParentDir(filePath) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}
