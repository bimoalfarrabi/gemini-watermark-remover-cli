const VALID_CODES = new Set([
  'E_USAGE',
  'E_INPUT',
  'E_OUTPUT_EXISTS',
  'E_CODEC',
  'E_PROCESS',
  'E_VIDEO',
]);

/**
 * Error type thrown across the CLI. Carries a machine-readable code so
 * cli.js can map it to an exit code, and an optional human hint so ui.js
 * can suggest a fix without callers formatting messages themselves.
 */
export class GwrError extends Error {
  /**
   * @param {string} message human-readable message
   * @param {object} [options]
   * @param {string} [options.code] one of the E_* codes; defaults to E_GENERIC
   * @param {string|null} [options.hint] short actionable suggestion for the user
   * @param {Error|null} [options.cause] underlying error, preserved for debugging
   */
  constructor(message, { code = 'E_GENERIC', hint = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GwrError';
    this.code = VALID_CODES.has(code) ? code : 'E_GENERIC';
    this.hint = hint;
  }
}

/**
 * Normalizes an unknown thrown value into a GwrError without ever throwing.
 * GwrError instances pass through untouched; Errors are wrapped keeping their
 * message and cause under E_PROCESS; strings become the message directly.
 * @param {unknown} error anything caught from a throw site
 * @returns {GwrError} a GwrError in every case
 */
export function toGwrError(error) {
  if (error instanceof GwrError) return error;
  if (error instanceof Error) {
    // Preserve the original error itself as cause, not error.cause — for a
    // plain Error that field is undefined and the stack trace would be lost.
    return new GwrError(error.message, { code: 'E_PROCESS', cause: error });
  }
  if (typeof error === 'string') {
    return new GwrError(error, { code: 'E_PROCESS' });
  }
  // e.g. a number or object thrown by a dependency; stringify what we can
  return new GwrError(String(error), { code: 'E_PROCESS' });
}

/**
 * Flattens any thrown value into the plain shape ui.js renders.
 * @param {unknown} error anything caught
 * @returns {{ message: string, hint: string|null, code: string }}
 */
export function formatError(error) {
  const err = toGwrError(error);
  return { message: err.message, hint: err.hint, code: err.code };
}
