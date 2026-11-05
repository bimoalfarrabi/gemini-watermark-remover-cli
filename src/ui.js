// Presentation layer. Only module that writes to stdout/stderr.

import pc from 'picocolors';
import { basename } from 'node:path';

let colorEnabled = null; // null = auto-detect

// Identity wrapper used whenever decorations are off; never relies on
// picocolors' own global detection so colour is deterministic here.
const plain = new Proxy({}, { get: () => (s) => String(s) });

/**
 * Explicitly force colours on or off, overriding auto-detection.
 * @param {boolean} enabled
 */
export function setColorEnabled(enabled) {
  colorEnabled = Boolean(enabled);
}

function autoColor() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === '0') return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

function decorationsEnabled() {
  return colorEnabled === true || (colorEnabled === null && autoColor());
}

function c() {
  return decorationsEnabled() ? pc : plain;
}

// Writer helpers so no other code path needs console.log.
function out(text) {
  process.stdout.write(text + '\n');
}

/**
 * True when prompts may be shown.
 * @returns {boolean}
 */
export function isInteractive() {
  if (process.env.GWR_NO_INPUT === '1') return false;
  if (process.env.CI) return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Print a short banner: name, tagline, version. No-op when decorations are off,
 * so --json output stays parseable.
 * @param {string} version
 */
export function intro(version) {
  if (!decorationsEnabled()) return;
  const col = c();
  const name = col.bold('gwr');
  out('');
  out(`  ${name} ${col.dim('gemini watermark remover')}`);
  out(`  ${col.dim('v' + version)}`);
  out('');
}

/**
 * Print one closing line with a check glyph when colour is on. No-op on empty
 * message or when decorations are off.
 * @param {string} message
 */
export function outro(message) {
  if (!message || !decorationsEnabled()) return;
  const col = c();
  out(`${col.green('✔')} ${message}`);
}

/**
 * Print a warning to stderr with optional dimmed hint. Suppressed when
 * decorations are off so machine-readable output stays clean.
 * @param {string} message
 * @param {string|null} [hint]
 */
export function warn(message, hint) {
  if (!decorationsEnabled()) return;
  const col = c();
  process.stderr.write(`${col.yellow('warning:')} ${message}\n`);
  if (hint) process.stderr.write(`  ${col.dim(hint)}\n`);
}

// Exit code per error code, per contract.
const EXIT_CODES = {
  E_USAGE: 2,
  E_INPUT: 3,
  E_CODEC: 4,
  E_VIDEO: 4,
};

/**
 * Print an error to stderr and return the process exit code.
 * Accepts any thrown value; reads .code/.hint defensively (no import of errors.js).
 * Suppressed when decorations are off.
 * @param {unknown} error
 * @returns {number}
 */
export function fail(error) {
  // Error text always goes to stderr: suppressing it under --json leaves the
  // user with a non-zero exit and no explanation. Only colour is gated.
  const col = c();
  const err = (error && typeof error === 'object' ? error : {});
  const message = err.message || String(error ?? 'unknown error');
  process.stderr.write(`${col.red('error:')} ${message}\n`);
  if (err.hint) process.stderr.write(`  ${col.dim(String(err.hint))}\n`);
  return EXIT_CODES[err.code] ?? 1;
}

/**
 * Render rows as an aligned plain-text table (returns string, does not print).
 * @param {string[][]} rows
 * @returns {string}
 */
export function table(rows) {
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, String(cell).length);
    });
  }
  return rows
    .map((row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd())
    .join('\n');
}

/**
 * Create a per-file progress printer for batch runs.
 * @param {{ total: number, quiet?: boolean, json?: boolean }} opts
 * @returns {(event: { index: number, total: number, result: object }) => void}
 */
export function progressReporter({ total, quiet, json } = {}) {
  if (json || quiet || total <= 1) return () => {};

  let lastDraw = 0;
  let finished = false;

  const tty = Boolean(process.stderr.isTTY);

  const draw = (event, isLast) => {
    const now = Date.now();
    if (tty && !isLast && now - lastDraw < 60) return;
    lastDraw = now;

    const { index, result } = event;
    const name = result.input ? basename(result.input) : (result.output ? basename(result.output) : '-');
    const status = result.ok ? 'ok' : (result.error && result.error.code === 'E_OUTPUT_EXISTS' ? 'skip' : 'fail');
    const line = `  [${index + 1}/${total}] ${name} ${status}`;
    if (tty && !isLast) {
      process.stderr.write('\r' + line);
    } else if (tty && isLast) {
      // clear the in-place line, then print final line with newline
      process.stderr.write('\r' + ' '.repeat(line.length + 2) + '\r' + line + '\n');
      finished = true;
    } else {
      process.stderr.write(line + '\n');
    }
  };

  return (event) => {
    if (finished) return;
    const isLast = event.index >= total - 1;
    draw(event, isLast);
  };
}

function fmtDuration(ms) {
  if (ms == null || !isFinite(ms)) return '-';
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function fmtSize(bytes) {
  if (bytes == null || !isFinite(bytes)) return '-';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function statusToken(result) {
  if (result.ok) return 'ok';
  if (result.error && result.error.code === 'E_OUTPUT_EXISTS') return 'skip';
  return 'fail';
}

function defaultSummaryRow(result) {
  const name = result.input ? basename(result.input) : '-';
  return [statusToken(result), name, fmtSize(result.meta && result.meta.size), fmtDuration(result.durationMs)];
}

/**
 * Print the end-of-run summary. Always prints, regardless of decorations.
 * @param {object[]} results
 * @param {{ quiet?: boolean, json?: boolean, dryRun?: boolean }} opts
 */
export function renderSummary(results, { quiet, json, dryRun } = {}) {
  const col = c();

  if (results.length === 0) {
    out('nothing to do');
    return;
  }

  if (json) {
    const stripped = results.map((r) => {
      if (r.ok) return r;
      const { error, ...rest } = r;
      return { ...rest, error: error ? { code: error.code, message: error.message } : null };
    });
    out(JSON.stringify(stripped.length === 1 ? stripped[0] : stripped, null, 2));
    return;
  }

  if (quiet) {
    for (const r of results) {
      if (r.ok) out(r.output);
    }
    return;
  }

  if (dryRun) {
    out(col.dim('dry run - nothing was written'));
    if (results.length > 1) {
      out(table([
        ['PLAN', 'SOURCE', 'OUTPUT'],
        ...results.map((r) => ['planned', r.input ?? '-', r.output ?? '-']),
      ]));
    } else {
      const r = results[0];
      out(`planned: ${r.input ?? '-'} -> ${r.output ?? '-'}`);
    }
    return;
  }

  if (results.length === 1 && results[0].ok) {
    const r = results[0];
    const quality = r.meta && r.meta.qualityStatus ? ' (' + r.meta.qualityStatus + ')' : '';
    out(`wrote ${r.output}${quality ? col.dim(quality) : ''}`);
    return;
  }

  out(table([['STATUS', 'FILE', 'SIZE', 'TIME'], ...results.map(defaultSummaryRow)]));

  const processed = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => !r.ok && r.error && r.error.code === 'E_OUTPUT_EXISTS').length;
  const failed = results.length - processed - skipped;
  const totalMs = results.reduce((sum, r) => sum + (r.durationMs || 0), 0);
  out(`${processed} processed, ${skipped} skipped, ${failed} failed (${fmtDuration(totalMs)})`);

  // Hints are diagnostics, so they go to stderr: stdout stays a clean report
  // that can be piped or captured while the advice remains visible.
  const hints = [...new Set(
    results
      .filter((r) => !r.ok && r.error && r.error.hint)
      .map((r) => r.error.hint)
  )];
  for (const hint of hints) process.stderr.write(col.dim(`  ${hint}`) + '\n');
}

/**
 * Prompt for one or more file/folder paths (space or comma separated).
 * @param {string} [defaultDir] shown as placeholder
 * @returns {Promise<string[]>} paths, or [] on cancel
 */
export async function promptInputs(defaultDir) {
  const { text, isCancel } = await import('@clack/prompts');

  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await text({
      message: 'File or folder to process (separate multiple with spaces or commas)',
      placeholder: defaultDir || process.cwd(),
    });
    if (isCancel(answer)) return [];
    const parsed = String(answer || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length > 0) return parsed;
    if (attempt === 0) {
      process.stderr.write('Enter at least one path.\n');
    }
  }
  return [];
}

/**
 * Show the plan and ask for confirmation.
 * @param {Array<{ source: string, output: string }>} plans
 * @param {{ overwriteRisk?: boolean, exists?: Set<string> }} options
 * @returns {Promise<boolean>}
 */
export async function confirmPlan(plans, options = {}) {
  const { note, confirm, isCancel } = await import('@clack/prompts');

  const MAX = 10;
  const lines = plans.slice(0, MAX).map((p) => `${p.source} -> ${p.output}`);
  if (plans.length > MAX) {
    lines.push(`... and ${plans.length - MAX} more`);
  }
  await note(lines.join('\n'), 'Plan');

  const overwrite = Boolean(options.overwriteRisk);
  const message = overwrite
    ? `Some outputs already exist and will be overwritten. Process ${plans.length} file(s)?`
    : `Process ${plans.length} file(s)?`;

  const answer = await confirm({ message });
  if (isCancel(answer)) return false;
  return Boolean(answer);
}

/**
 * Print a dimmed info line to stderr. Suppressed when decorations are off.
 * @param {string} message
 */
export function log(message) {
  if (!decorationsEnabled()) return;
  const col = c();
  process.stderr.write(col.dim(message) + '\n');
}
