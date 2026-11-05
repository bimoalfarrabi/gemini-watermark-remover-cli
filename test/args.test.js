import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, usageText } from '../src/args.js';

test('defaults to the run command with no inputs', () => {
    const { command, options } = parseArgs([]);
    assert.equal(command, 'run');
    assert.deepEqual(options.inputs, []);
    assert.equal(options.output, null);
    assert.equal(options.jobs, 1);
    assert.equal(options.overwrite, false);
});

test('collects positional inputs in order', () => {
    const { options } = parseArgs(['a.png', 'b.png']);
    assert.deepEqual(options.inputs, ['a.png', 'b.png']);
});

test('parses output and out-dir in both value forms', () => {
    assert.equal(parseArgs(['a.png', '-o', 'x.png']).options.output, 'x.png');
    assert.equal(parseArgs(['a.png', '--output=x.png']).options.output, 'x.png');
    assert.equal(parseArgs(['a.png', '-d', 'out']).options.outDir, 'out');
    assert.equal(parseArgs(['a.png', '--out-dir=out']).options.outDir, 'out');
});

test('parses boolean flags including short aliases', () => {
    const { options } = parseArgs(['a.png', '-f', '-n', '-q', '--json', '--no-color']);
    assert.equal(options.overwrite, true);
    assert.equal(options.dryRun, true);
    assert.equal(options.quiet, true);
    assert.equal(options.json, true);
    assert.equal(options.noColor, true);
});

test('jobs accepts integers in range', () => {
    assert.equal(parseArgs(['a.png', '-j', '4']).options.jobs, 4);
    assert.equal(parseArgs(['a.png', '--jobs=8']).options.jobs, 8);
});

test('rejects jobs outside 1..64', () => {
    for (const bad of ['0', '65', 'abc', '1.5']) {
        assert.throws(() => parseArgs(['a.png', '-j', bad]), (error) => error.code === 'E_USAGE');
    }
});

test('rejects output together with out-dir', () => {
    assert.throws(
        () => parseArgs(['a.png', '-o', 'x.png', '-d', 'out']),
        (error) => error.code === 'E_USAGE'
    );
});

test('rejects in-place together with an explicit target', () => {
    assert.throws(() => parseArgs(['a.png', '-i', '-o', 'x.png']), (e) => e.code === 'E_USAGE');
    assert.throws(() => parseArgs(['a.png', '-i', '-d', 'out']), (e) => e.code === 'E_USAGE');
});

test('rejects a flag that needs a value but has none', () => {
    assert.throws(() => parseArgs(['a.png', '-o']), (error) => error.code === 'E_USAGE');
});

test('rejects unknown flags', () => {
    assert.throws(() => parseArgs(['a.png', '--nope']), (error) => error.code === 'E_USAGE');
});

test('treats everything after -- as input', () => {
    const { options } = parseArgs(['--', '--weird-name.png', '-o.png']);
    assert.deepEqual(options.inputs, ['--weird-name.png', '-o.png']);
    assert.equal(options.output, null);
});

test('help and version become their own commands', () => {
    assert.equal(parseArgs(['--help']).command, 'help');
    assert.equal(parseArgs(['-h']).command, 'help');
    assert.equal(parseArgs(['--version']).command, 'version');
    assert.equal(parseArgs(['-v']).command, 'version');
    assert.equal(parseArgs(['a.png', '--help']).command, 'help');
});

test('help text documents every public flag and the exit codes', () => {
    const text = usageText();
    for (const flag of ['--output', '--out-dir', '--suffix', '--in-place', '--overwrite',
        '--jobs', '--dry-run', '--json', '--quiet', '--video', '--no-color']) {
        assert.ok(text.includes(flag), `help is missing ${flag}`);
    }
    assert.match(text, /EXIT CODES/i);
});

test('config subcommand exposes get, set, reset and path', () => {
    assert.deepEqual(parseArgs(['config']).configAction.subcommand, null);
    assert.equal(parseArgs(['config', 'path']).configAction.subcommand, 'path');
    assert.equal(parseArgs(['config', 'reset']).configAction.subcommand, 'reset');

    const get = parseArgs(['config', 'get', 'suffix']);
    assert.equal(get.command, 'config');
    assert.equal(get.configAction.subcommand, 'get');
    assert.equal(get.configAction.key, 'suffix');

    const set = parseArgs(['config', 'set', 'suffix', '-nowm']);
    assert.equal(set.configAction.subcommand, 'set');
    assert.equal(set.configAction.value, '-nowm');
});

test('config get and set require their arguments', () => {
    assert.throws(() => parseArgs(['config', 'get']), (e) => e.code === 'E_USAGE');
    assert.throws(() => parseArgs(['config', 'set', 'suffix']), (e) => e.code === 'E_USAGE');
});

test('an unknown config action is a usage error', () => {
    assert.throws(() => parseArgs(['config', 'destroy']), (e) => e.code === 'E_USAGE');
});
