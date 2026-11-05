#!/usr/bin/env node
/**
 * Command entry point. Keeps the orchestration thin: parsing lives in args.js,
 * every write to the terminal lives in ui.js.
 */

import path from 'node:path';
import fs from 'node:fs';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseArgs, usageText } from './args.js';
import { loadConfig, saveConfig, resetConfig, configPath, getConfigValue, setConfigValue, KNOWN_KEYS } from './config.js';
import { GwrError, toGwrError } from './errors.js';
import { expandInputs, processBatch } from './pipeline.js';
import { planOutput, describePlan, collisionKey } from './output.js';
import { describeCodec } from './codec.js';
import { videoAvailable } from './video.js';
import * as ui from './ui.js';

const VERSION = '0.1.0';

export async function main(argv = process.argv.slice(2)) {
    let parsed;
    try {
        parsed = parseArgs(argv);
    } catch (error) {
        return ui.fail(toGwrError(error));
    }

    const { command, options } = parsed;
    // Only an explicit --no-color forces colour off; otherwise leave it on
    // auto-detect so piped output and NO_COLOR behave.
    if (options.noColor) {
        ui.setColorEnabled(false);
    }

    if (command === 'help') {
        process.stdout.write(`${usageText()}\n\nVersion ${VERSION}\n`);
        return 0;
    }
    if (command === 'version') {
        process.stdout.write(`${VERSION}\n`);
        return 0;
    }
    if (command === 'config') {
        return runConfigCommand(parsed);
    }
    if (command === 'doctor') {
        return runDoctor();
    }

    return runRemove(options);
}

async function runRemove(options) {
    const stored = await loadConfig();
    const merged = mergeWithConfig(options, stored);

    if (merged.json) {
        ui.setColorEnabled(false);
    }

    let inputs = merged.inputs;
    if (inputs.length === 0) {
        if (!ui.isInteractive() || merged.json || merged.quiet) {
            process.stdout.write(`${usageText()}\n`);
            return 2;
        }
        ui.intro(VERSION);
        inputs = await ui.promptInputs(process.cwd());
        if (inputs.length === 0) {
            ui.outro('Nothing selected.');
            return 0;
        }
    } else if (ui.isInteractive() && !merged.quiet && !merged.json) {
        ui.intro(VERSION);
    }

    // A missing path must not kill a batch that otherwise has work to do:
    // it becomes a per-file failure so the rest still runs.
    const missing = [];
    const present = [];
    for (const input of inputs) {
        if (await pathExists(input)) present.push(input);
        else missing.push(input);
    }

    if (present.length === 0 && missing.length > 0) {
        return reportError(new GwrError(`Input not found: ${missing[0]}`, {
            code: 'E_INPUT',
            hint: 'Check the path. Directories are scanned non-recursively.'
        }), merged);
    }

    let expanded;
    try {
        expanded = await expandInputs(present);
    } catch (error) {
        return reportError(toGwrError(error), merged);
    }

    if (expanded.length === 0) {
        return reportError(new GwrError('No supported files found in the given path.', {
            code: 'E_INPUT',
            hint: 'Supported input formats: .png .jpg .jpeg .webp'
        }), merged);
    }

    const existing = await collectExisting(expanded, merged);
    const plans = expanded.map((input) => planOutput(input, { ...merged, exists: existing }));
    const runnable = plans.filter((plan) => !plan.skip);

    if (merged.dryRun) {
        ui.renderSummary(
            plans.map((plan) => ({ ...plan, ok: true, dryRun: true })),
            { quiet: merged.quiet, json: merged.json, dryRun: true }
        );
        return 0;
    }

    if (runnable.length === 0) {
        ui.renderSummary(
            plans.map((plan) => ({
                ok: false,
                input: plan.input,
                output: plan.output,
                error: new GwrError(`Output already exists: ${plan.output}`, {
                    code: 'E_OUTPUT_EXISTS',
                    hint: 'Pass --overwrite to replace existing files.'
                })
            })),
            { quiet: merged.quiet, json: merged.json, dryRun: false }
        );
        return 1;
    }

    if (ui.isInteractive() && !merged.json && !merged.quiet && needsConfirmation(plans, expanded)) {
        const proceed = await ui.confirmPlan(plans, merged);
        if (!proceed) {
            ui.outro('Cancelled.');
            return 0;
        }
    }

    const reporter = ui.progressReporter({
        total: runnable.length,
        quiet: merged.quiet,
        json: merged.json
    });

    const toRun = runnable.map((plan) => plan.input);
    const processed = await processBatch(toRun, merged, reporter);

    // Re-merge skipped plans so the summary and --json describe every input,
    // not only the ones that were attempted.
    const skippedResults = plans
        .filter((plan) => plan.skip)
        .map((plan) => ({
            ok: false,
            input: plan.input,
            output: plan.output,
            error: new GwrError(`Output already exists: ${plan.output}`, {
                code: 'E_OUTPUT_EXISTS',
                hint: 'Pass --overwrite to replace existing files.'
            })
        }));

    // Files that never reached planning because their path was missing.
    for (const input of missing) {
        skippedResults.push({
            ok: false,
            input,
            output: null,
            error: new GwrError(`Input not found: ${input}`, {
                code: 'E_INPUT',
                hint: 'Check the path. Directories are scanned non-recursively.'
            })
        });
    }
    const results = mergeResultsInInputOrder([...expanded, ...missing], processed, skippedResults);

    ui.renderSummary(results, { quiet: merged.quiet, json: merged.json, dryRun: false });

    const failed = results.filter((result) => !result.ok).length;
    if (failed === 0) return 0;
    return failed === results.length ? 4 : 1;
}

/** Restores the caller's input order when skipped and processed files are mixed. */
function mergeResultsInInputOrder(inputs, processed, skipped) {
    const byInput = new Map();
    for (const result of [...processed, ...skipped]) {
        byInput.set(path.resolve(result.input), result);
    }
    return inputs.map((input) => byInput.get(path.resolve(input))).filter(Boolean);
}

/**
 * Reports a top-level failure. Under --json the payload still has to be
 * machine-readable, so the error is emitted as JSON on stdout and the message
 * goes to stderr; otherwise it is a normal decorated error.
 */
function reportError(error, options) {
    if (options && options.json) {
        process.stdout.write(`${JSON.stringify({
            ok: false,
            error: { code: error.code, message: error.message, hint: error.hint ?? null }
        }, null, 2)}\n`);
    }
    return ui.fail(error);
}

function mergeWithConfig(options, stored) {
    const merged = { ...options };
    merged.suffix = options.suffix ?? stored.suffix ?? '-clean';
    merged.outDir = options.outDir ?? stored.outDir ?? null;
    merged.overwrite = options.overwrite || stored.overwrite === true;
    merged.jobs = options.jobs > 1 ? options.jobs : Number(stored.jobs) || 1;
    if (options.video !== true) {
        merged.video = stored.video === true;
    }
    return merged;
}

/**
 * Precomputes which targets are taken so output naming can resolve collisions
 * without touching the disk for every plan. Keys must match the normalization
 * planOutput applies, otherwise no collision is ever detected.
 */
async function collectExisting(inputs, options) {
    const taken = new Set();
    for (const input of inputs) {
        const plan = planOutput(input, { ...options, exists: null });
        if (await pathExists(plan.output)) {
            taken.add(collisionKey(plan.output));
        }
    }
    return taken;
}

async function pathExists(target) {
    try {
        await access(target);
        return true;
    } catch {
        return false;
    }
}

function needsConfirmation(plans, inputs) {
    if (plans.length > 8) return true;
    return plans.some((plan) => plan.inPlace || plan.overwriteExisting);
}

async function runConfigCommand(parsed) {
    const { subcommand, key, value } = parsed.configAction ?? {};
    if (!subcommand) {
        const current = await loadConfig();
        process.stdout.write(`${JSON.stringify(current, null, 2)}\n`);
        return 0;
    }
    if (subcommand === 'path') {
        process.stdout.write(`${configPath()}\n`);
        return 0;
    }
    if (subcommand === 'reset') {
        await resetConfig();
        process.stdout.write('Config reset.\n');
        return 0;
    }
    if (subcommand === 'get') {
        const found = await getConfigValue(key);
        process.stdout.write(`${found === undefined ? '' : JSON.stringify(found)}\n`);
        return 0;
    }
    if (subcommand === 'set') {
        if (!KNOWN_KEYS.includes(key)) {
            return ui.fail(new GwrError(`Unknown config key: ${key}`, {
                code: 'E_USAGE',
                hint: `Known keys: ${KNOWN_KEYS.join(', ')}`
            }));
        }
        await setConfigValue(key, value);
        await saveConfig({});
        process.stdout.write(`${key} saved.\n`);
        return 0;
    }
    return ui.fail(new GwrError(`Unknown config action: ${subcommand}`, { code: 'E_USAGE' }));
}

async function runDoctor() {
    const codec = await describeCodec();
    const video = await videoAvailable();
    const rows = [
        ['node', process.version, process.platform],
        ['codec', codec.name, codec.formats.join(' ')],
        ['video', video ? 'available' : 'unavailable', video ? '' : 'run: npx playwright install chromium'],
        ['config', configPath(), '']
    ];
    process.stdout.write(`${ui.table(rows)}\n`);
    return 0;
}

// Runs only when executed directly (bin symlink, `node src/cli.js`, or a bun
// standalone binary), never on import. Three comparisons because each runtime
// breaks a different one: realpath is needed for npm's bin symlink, but it
// throws on bun's embedded /$bunfs snapshot, where the raw resolved paths are
// the only thing that matches.
function isDirectRun() {
    if (!process.argv[1]) return false;
    const scriptPath = fileURLToPath(import.meta.url);
    try {
        if (fs.realpathSync(process.argv[1]) === fs.realpathSync(scriptPath)) return true;
    } catch {
        // fall through: bun's virtual FS has no real path to resolve
    }
    if (path.resolve(process.argv[1]) === path.resolve(scriptPath)) return true;
    // bun compile: argv[1] and import.meta.url may differ by the $bunfs prefix
    // while both end in the same embedded entry name.
    const bun = process.versions.bun;
    return Boolean(bun) && path.basename(process.argv[1]) === path.basename(scriptPath);
}

if (isDirectRun()) {
    main().then((code) => {
        process.exitCode = code;
    }).catch((error) => {
        process.exitCode = ui.fail(toGwrError(error));
    });
}
