/**
 * gwr-cli — public library surface.
 *
 * Barrel only: re-exports the image pipeline, codec, output planning,
 * config and error types. No side effects at import time; the video stack
 * is lazy-loaded inside pipeline.js so bundlers can drop it.
 */

export { processImage, processBatch, expandInputs, isSupportedInput } from './pipeline.js';
export { resolveCodec, describeCodec, resetCodecCache } from './codec.js';
export { planOutput, describePlan, uniquePath } from './output.js';
export { loadConfig, saveConfig, resetConfig } from './config.js';
export { GwrError } from './errors.js';
