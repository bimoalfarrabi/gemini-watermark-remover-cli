// Video support stays behind a dynamic import so bundlers can drop the
// Playwright/mediabunny dependency tree from the standalone binary; the image
// path never pays for it.

/**
 * Check that video removal can run: the SDK video entry exists and its
 * preview runtime asset is present. Never throws.
 * @returns {Promise<boolean>}
 */
export async function videoAvailable() {
  try {
    const { createRequire } = await import('node:module');
    const fs = await import('node:fs');
    const require = createRequire(import.meta.url);

    const mod = await import('@pilio/gemini-watermark-remover/node');
    if (typeof mod.removeVideoWatermarkFromFile !== 'function') return false;

    let pkgDir = null;
    try {
      const pkgPath = require.resolve('@pilio/gemini-watermark-remover/package.json');
      pkgDir = pkgPath.replace(/[/\\]package\.json$/, '');
    } catch {
      return false;
    }
    return (
      fs.existsSync(pkgDir + '/dist/video-preview.html') ||
      fs.existsSync('dist/video-preview.html')
    );
  } catch {
    return false;
  }
}

/**
 * Remove a watermark from a video via the SDK.
 * @param {string} inputPath
 * @param {{ outputPath?: string, mimeType?: string, onProgress?: Function,
 *           timeoutMs?: number, videoBitrate?: string|number,
 *           allowLowConfidence?: boolean }} options
 * @returns {Promise<object>} same shape as the image pipeline result
 */
export async function processVideo(inputPath, options = {}) {
  const available = await videoAvailable();
  if (!available) {
    const error = new Error('Video removal is not available in this install.');
    error.code = 'E_VIDEO';
    error.hint = 'Video removal needs the Playwright Chromium runtime. Run: npx playwright install chromium';
    return { input: inputPath, output: options.outputPath ?? null, ok: false, kind: 'video', error };
  }

  const start = Date.now();
  try {
    const mod = await import('@pilio/gemini-watermark-remover/node');
    const result = await mod.removeVideoWatermarkFromFile(inputPath, {
      outputPath: options.outputPath,
      mimeType: options.mimeType,
      onProgress: options.onProgress,
      timeoutMs: options.timeoutMs,
      videoBitrate: options.videoBitrate,
      allowLowConfidence: options.allowLowConfidence,
    });
    return {
      input: inputPath,
      output: result.output ?? options.outputPath ?? null,
      ok: true,
      kind: 'video',
      meta: result.meta ?? {},
      durationMs: Date.now() - start,
    };
  } catch (cause) {
    const error = new Error(cause && cause.message ? cause.message : 'Video processing failed.');
    error.code = 'E_VIDEO';
    error.cause = cause;
    return { input: inputPath, output: options.outputPath ?? null, ok: false, kind: 'video', error, durationMs: Date.now() - start };
  }
}
