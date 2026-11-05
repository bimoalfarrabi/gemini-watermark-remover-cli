import test from 'node:test';
import assert from 'node:assert/strict';

import { table } from '../src/ui.js';
import { describeCodec } from '../src/codec.js';
import * as barrel from '../src/index.js';

test('table aligns columns to the widest cell', () => {
    const output = table([
        ['status', 'file', 'size'],
        ['ok', 'a-very-long-name.png', '48px'],
        ['fail', 'b.png', '-']
    ]);
    const lines = output.split('\n');
    assert.equal(lines.length, 3);
    // Column starts must line up even though trailing padding is trimmed.
    const starts = lines.map((line) => {
        const cells = line.split(/\s{2,}/);
        return cells.length;
    });
    assert.ok(starts.every((count) => count === 3), `column count drifted:\n${output}`);
    const firstColumnWidth = lines[0].indexOf('file');
    assert.ok(lines[1].indexOf('a-very-long') === firstColumnWidth, `first column width drifted:\n${output}`);
});

test('table pads every column, not only the last', () => {
    const output = table([['a', 'bb'], ['ccc', 'd']]);
    const [first, second] = output.split('\n');
    assert.equal(first.indexOf('bb') - first.indexOf('a'), second.indexOf('d') - second.indexOf('ccc'));
});

test('table handles a single column and a single row', () => {
    assert.equal(table([['only']]), 'only');
    assert.equal(table([['a'], ['b']]), 'a\nb');
});

test('the public barrel exposes the documented API surface', () => {
    for (const name of ['processImage', 'processBatch', 'expandInputs', 'isSupportedInput',
        'resolveCodec', 'describeCodec', 'planOutput', 'describePlan', 'uniquePath',
        'loadConfig', 'saveConfig', 'resetConfig', 'GwrError']) {
        assert.equal(typeof barrel[name], 'function', `missing export: ${name}`);
    }
});

test('importing the barrel has no side effects on stdout', async () => {
    const { execFileSync } = await import('node:child_process');
    const output = execFileSync(process.execPath, ['-e', "await import('./src/index.js')"], {
        cwd: process.cwd(),
        encoding: 'utf8'
    });
    assert.equal(output, '');
});

test('describeCodec names a supported codec', async () => {
    const info = await describeCodec();
    assert.ok(['sharp', 'pure'].includes(info.name));
});
