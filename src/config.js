import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Settings the CLI documents; unknown keys are still preserved. */
export const KNOWN_KEYS = ['suffix', 'outDir', 'overwrite', 'jobs', 'video', 'color'];

/**
 * Resolves the config file location. Honors XDG_CONFIG_HOME everywhere,
 * including Windows, and falls back to %APPDATA% there when unset.
 * @returns {string} absolute path to config.json
 */
export function configPath() {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, 'gwr', 'config.json');
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'gwr', 'config.json');
  }
  return path.join(os.homedir(), '.config', 'gwr', 'config.json');
}

/**
 * Reads the config file, returning {} when missing, corrupt, or not an
 * object. Never throws: a broken config must not brick the CLI.
 * @returns {Promise<object>} merged settings map
 */
export async function loadConfig() {
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Shallow-merges a patch into the existing config and writes it atomically
 * (tmp file + rename) so a crash mid-write never truncates the file.
 * @param {object} patch keys to set
 * @returns {Promise<object>} the full saved config
 */
export async function saveConfig(patch) {
  const current = await loadConfig();
  const merged = { ...current, ...patch };
  const file = configPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
  return merged;
}

/**
 * Deletes the config file.
 * @returns {Promise<boolean>} true when a file was removed
 */
export async function resetConfig() {
  try {
    await fs.unlink(configPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Coerces a raw string (as typed on the CLI) into a JSON value and saves it.
 * 'true'/'false' become booleans, integer-looking strings become numbers,
 * everything else is stored as a string.
 * @param {string} key config key
 * @param {string} rawValue value as typed by the user
 * @returns {Promise<object>} the full saved config
 */
export async function setConfigValue(key, rawValue) {
  let value;
  if (rawValue === 'true') value = true;
  else if (rawValue === 'false') value = false;
  else if (/^-?\d+$/.test(rawValue)) value = Number(rawValue);
  else value = rawValue;
  return saveConfig({ [key]: value });
}

/**
 * Reads a single config value.
 * @param {string} key config key
 * @returns {Promise<any>} the value, or undefined when unset
 */
export async function getConfigValue(key) {
  const config = await loadConfig();
  return config[key];
}
