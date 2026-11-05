import { GwrError } from './errors.js';
import { KNOWN_KEYS } from './config.js';

const DEFAULT_OPTIONS = {
  inputs: [],
  output: null,
  outDir: null,
  suffix: null,
  inPlace: false,
  overwrite: false,
  json: false,
  quiet: false,
  dryRun: false,
  jobs: 1,
  video: false,
  allowLowConfidence: false,
  noColor: false,
};

// Value flags consume the next argv element (or an `=` form); boolean flags don't.
const VALUE_FLAGS = new Map([
  ['--output', 'output'],
  ['-o', 'output'],
  ['--out-dir', 'outDir'],
  ['-d', 'outDir'],
  ['--suffix', 'suffix'],
  ['--jobs', 'jobs'],
  ['-j', 'jobs'],
]);

const BOOLEAN_FLAGS = new Map([
  ['--in-place', 'inPlace'],
  ['-i', 'inPlace'],
  ['--overwrite', 'overwrite'],
  ['-f', 'overwrite'],
  ['--json', 'json'],
  ['--quiet', 'quiet'],
  ['-q', 'quiet'],
  ['--dry-run', 'dryRun'],
  ['-n', 'dryRun'],
  ['--video', 'video'],
  ['--allow-low-confidence', 'allowLowConfidence'],
  ['--no-color', 'noColor'],
  ['--help', 'help'],
  ['-h', 'help'],
  ['--version', 'version'],
  ['-v', 'version'],
]);

const SUBCOMMANDS = new Set(['config', 'doctor', 'help', 'version']);

function usageError(message, hint) {
  return new GwrError(message, { code: 'E_USAGE', hint });
}

/**
 * Parses raw CLI argv into a command plus normalized options.
 * Hand-rolled so the package carries no CLI-framework dependency.
 * @param {string[]} argv typically process.argv.slice(2)
 * @returns {{ command: string, options: object, configAction: object|null }}
 *   command is 'run'|'config'|'doctor'|'help'|'version'; configAction is null
 *   except for 'config', where it is { subcommand, key, value } (subcommand
 *   null means "print whole config").
 */
export function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS, inputs: [] };
  const positional = [];
  let command = null;
  let configAction = null;
  let configKey = null;
  let onlyPositional = false; // everything after a bare `--` is an input path

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (onlyPositional) {
      positional.push(arg);
      continue;
    }

    if (arg === '--') {
      onlyPositional = true;
      continue;
    }

    if (command === 'config' && positional.length > 0) {
      // After the action word (first positional), everything is a literal
      // (so `config set suffix -x` works); flags stop being parsed.
      positional.push(arg);
      continue;
    }

    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      const name = arg.slice(0, eq);
      const value = arg.slice(eq + 1);
      if (VALUE_FLAGS.has(name)) {
        assignValue(options, VALUE_FLAGS.get(name), value);
        continue;
      }
      if (BOOLEAN_FLAGS.has(name)) {
        if (value === 'true' || value === 'false') {
          options[BOOLEAN_FLAGS.get(name)] = value === 'true';
          continue;
        }
        throw usageError(`Unknown flag: ${name}`, `Boolean flags do not take '=value'. Use ${name} alone. Did you mean --${name.slice(2)}?`);
      }
      throw unknownFlag(name);
    }

    if (VALUE_FLAGS.has(arg) && !(command === 'config' && positional.length > 0)) {
      const next = argv[i + 1];
      if (next === undefined) {
        throw usageError(`Missing value for ${arg}`, `Pass a value: ${arg} <value>`);
      }
      assignValue(options, VALUE_FLAGS.get(arg), next);
      i++;
      continue;
    }

    if (BOOLEAN_FLAGS.has(arg) && !(command === 'config' && positional.length > 0)) {
      const key = BOOLEAN_FLAGS.get(arg);
      if (key === 'help') { command = 'help'; continue; }
      if (key === 'version') { command = 'version'; continue; }
      options[key] = true;
      continue;
    }

    if (command === 'config' && configAction !== null) {
      // After the action word, everything is a literal (so `set suffix -x` works).
      positional.push(arg);
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      throw unknownFlag(arg);
    }

    if (command === null && SUBCOMMANDS.has(arg)) {
      command = arg;
      continue;
    }

    positional.push(arg);
  }

  if (command === 'config') {
    // config accepts: (nothing → print whole config) | get <key> | set <key> <value> | reset | path
    const rest = positional;
    let subcommand = null;
    let key = null;
    let value = null;
    if (rest.length > 0) {
      subcommand = rest[0];
      if (subcommand === 'get') {
        if (rest.length < 2) throw usageError('config get needs a key', 'Usage: gwr config get <key>  (keys: ' + KNOWN_KEYS.join(', ') + ')');
        key = rest[1];
        if (rest.length > 2) throw usageError('config get takes one key', `Did you mean: gwr config set ${rest[1]} ${rest[2]}?`);
      } else if (subcommand === 'set') {
        if (rest.length < 3) throw usageError('config set needs a key and a value', 'Usage: gwr config set <key> <value>');
        key = rest[1];
        value = rest[2];
      } else if (subcommand !== 'reset' && subcommand !== 'path') {
        throw usageError(`Unknown config subcommand: ${subcommand}`, 'Valid subcommands: get, set, reset, path');
      }
    }
    configAction = { subcommand, key, value };
  } else {
    options.inputs = positional;
  }

  if (command === null) command = 'run';

  validate(options, command);
  return { command, options, configAction };
}

function unknownFlag(flag) {
  return usageError(`Unknown flag: ${flag}`, 'Run `gwr --help` to list valid options.');
}

function assignValue(options, key, raw) {
  if (key === 'jobs') {
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      throw usageError(`--jobs expects an integer, got "${raw}"`, 'Example: --jobs 4');
    }
    options.jobs = n;
    return;
  }
  options[key] = raw;
}

function validate(options, command) {
  if (command !== 'run') return;
  if (options.output !== null && options.outDir !== null) {
    throw usageError('Use either --output or --out-dir, not both', '--output names one exact file; --out-dir redirects a batch. Pick one.');
  }
  if (options.inPlace && (options.output !== null || options.outDir !== null)) {
    throw usageError('--in-place cannot be combined with --output or --out-dir', '--in-place rewrites the input file where it is; it takes no destination.');
  }
  if (!Number.isInteger(options.jobs) || options.jobs < 1 || options.jobs > 64) {
    throw usageError(`--jobs must be an integer between 1 and 64, got ${options.jobs}`, 'Example: --jobs 4');
  }
}

/**
 * Multi-line help body. The version line is intentionally omitted —
 * cli.js appends it so the version lives in one place.
 * @returns {string} help text ending with a newline
 */
export function usageText() {
  return `gwr — remove Gemini watermarks from images
═══════════════════════════════════════════════════

USAGE
  gwr [options] <input...>          remove watermark from files
  gwr config get|set|reset|path     read or write settings
  gwr doctor                        check environment health

  Running with no arguments opens an interactive file picker.

EXAMPLES
  gwr photo.png                     photo.png -> photo-clean.png
  gwr screenshots/                  whole folder (non-recursive)
  gwr -i shot.png                   rewrite shot.png where it is
  gwr --json a.png b.png            machine-readable output for scripts

OPTIONS
  -o, --output <file>      exact output path (single input only)
  -d, --out-dir <dir>      write results into this directory
      --suffix <text>      filename suffix before the extension (default: -clean)
  -i, --in-place           overwrite the input file directly
  -f, --overwrite          allow overwriting existing outputs
  -j, --jobs <n>           parallel files processed at once (default: 1)
  -n, --dry-run            show the plan without writing anything
      --video              treat inputs as videos (experimental)
      --allow-low-confidence
                           proceed when watermark detection is unsure
      --json               print results as JSON (for scripting)
  -q, --quiet              print only output paths
      --no-color           disable colour output
  -h, --help               show this help
  -v, --version            print version

EXIT CODES
  0  all good
  1  some files failed
  2  usage error
  3  input not found
  4  nothing could be processed
`;
}

// Re-exported for convenience; cli.js reads it to validate config keys.
export { KNOWN_KEYS };
