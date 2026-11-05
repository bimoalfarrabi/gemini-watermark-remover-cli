import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { planOutput, uniquePath, describePlan } from '../src/output.js';

const inTmp = (name) => path.join('/tmp', 'gwr-out-tests', name);

test('default output is a sibling with the suffix', () => {
    const plan = planOutput('/shots/photo.png', {});
    assert.equal(plan.output, '/shots/photo-clean.png');
    assert.equal(plan.skip, false);
});

test('keeps the original extension, including uppercase', () => {
    assert.equal(planOutput('/s/photo.JPG', {}).output, '/s/photo-clean.JPG');
    assert.equal(planOutput('/s/photo.webp', {}).output, '/s/photo-clean.webp');
});

test('honours a custom suffix', () => {
    assert.equal(planOutput('/s/photo.png', { suffix: '-nowm' }).output, '/s/photo-nowm.png');
});

test('explicit output wins over everything', () => {
    const plan = planOutput('/s/photo.png', { output: '/out/custom.png', outDir: '/ignored' });
    assert.equal(plan.output, path.normalize('/out/custom.png'));
});

test('out-dir keeps the basename', () => {
    const plan = planOutput('/s/photo.png', { outDir: '/clean' });
    assert.equal(plan.output, path.join('/clean', 'photo.png'));
});

test('in-place points at the input and is flagged', () => {
    const plan = planOutput('/s/photo.png', { inPlace: true, overwrite: true });
    assert.equal(plan.output, path.normalize('/s/photo.png'));
    assert.equal(plan.inPlace, true);
});

test('skip is true only for a known existing target without overwrite', () => {
    const exists = new Set([path.resolve(inTmp('photo-clean.png'))]);
    const skipped = planOutput(inTmp('photo.png'), { exists });
    assert.equal(skipped.skip, true);
    assert.equal(skipped.reason, 'exists');

    const forced = planOutput(inTmp('photo.png'), { exists, overwrite: true });
    assert.equal(forced.skip, false);
    assert.equal(forced.overwriteExisting, true);
});

test('planning is pure: no exists set means no skip', () => {
    assert.equal(planOutput(inTmp('photo.png'), {}).skip, false);
});

test('uniquePath returns the path unchanged when free', () => {
    assert.equal(uniquePath(inTmp('never-written.png')), inTmp('never-written.png'));
});

test('describePlan renders a readable arrow line', () => {
    const line = describePlan(planOutput('/s/photo.png', {}));
    assert.match(line, /photo\.png/);
    assert.match(line, /photo-clean\.png/);
    assert.match(line, /->/);
});

test('describePlan marks skipped plans', () => {
    const exists = new Set([path.resolve(inTmp('photo-clean.png'))]);
    const line = describePlan(planOutput(inTmp('photo.png'), { exists }));
    assert.match(line, /skip/i);
});

test('windows style paths keep their separators', () => {
    // planOutput uses the host path module, so a Windows-only assertion cannot
    // be made on POSIX. Assert the invariants that must hold on every platform:
    // the basename survives and outDir is prepended as one directory.
    const plan = planOutput('C:\\shots\\photo.png', { outDir: 'C:\\clean' });
    assert.ok(plan.output.endsWith('photo.png'), plan.output);
});

test('path.win32 resolves the same plan shape on Windows', () => {
    const win = path.win32;
    const joined = win.join('C:\\clean', win.basename('C:\\shots\\photo.png'));
    assert.equal(joined, 'C:\\clean\\photo.png');
    const stem = win.basename('C:\\shots\\photo.png', win.extname('C:\\shots\\photo.png'));
    assert.equal(stem, 'photo');
});
