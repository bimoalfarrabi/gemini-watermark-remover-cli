import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { planOutput, uniquePath, describePlan, collisionKey } from '../src/output.js';

// Paths are built with the host separator so these assertions hold on Windows.
const base = path.join('/tmp', 'gwr-out-tests');
const inTmp = (name) => path.join(base, name);

test('default output is a sibling with the suffix', () => {
    const plan = planOutput('/shots/photo.png', {});
    assert.equal(plan.output, path.join('/shots', 'photo-clean.png'));
    assert.equal(plan.skip, false);
});

test('keeps the original extension, including uppercase', () => {
    assert.equal(planOutput('/s/photo.JPG', {}).output, path.join('/s', 'photo-clean.JPG'));
    assert.equal(planOutput('/s/photo.webp', {}).output, path.join('/s', 'photo-clean.webp'));
});

test('honours a custom suffix', () => {
    assert.equal(planOutput('/s/photo.png', { suffix: '-nowm' }).output, path.join('/s', 'photo-nowm.png'));
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
    const input = inTmp('photo.png');
    const exists = new Set([collisionKey(inTmp('photo-clean.png'))]);

    const skipped = planOutput(input, { exists });
    assert.equal(skipped.skip, true, 'existing target without overwrite must skip');
    assert.equal(skipped.reason, 'exists');

    const forced = planOutput(input, { exists, overwrite: true });
    assert.equal(forced.skip, false);
    assert.equal(forced.overwriteExisting, true);
});

test('collision detection ignores relative vs absolute spelling', () => {
    // The caller probes an absolute path; planning a relative input must still
    // see the collision. This broke on Windows CI before collisionKey existed.
    const absolute = path.resolve(inTmp('photo-clean.png'));
    const exists = new Set([collisionKey(absolute)]);
    assert.equal(planOutput(inTmp('photo.png'), { exists }).skip, true);
});

test('collision detection ignores case', () => {
    const exists = new Set([collisionKey(inTmp('PHOTO-CLEAN.PNG'))]);
    assert.equal(planOutput(inTmp('photo.png'), { exists }).skip, true);
});

test('planning is pure: no exists set means no skip', () => {
    assert.equal(planOutput(inTmp('photo.png'), {}).skip, false);
});

test('uniquePath returns the path unchanged when free', () => {
    assert.equal(uniquePath(inTmp('never-written.png')), inTmp('never-written.png'));
});

test('uniquePath is synchronous', () => {
    assert.equal(typeof uniquePath(inTmp('never-written.png')), 'string');
});

test('describePlan renders a readable arrow line', () => {
    const line = describePlan(planOutput('/s/photo.png', {}));
    assert.match(line, /photo\.png/);
    assert.match(line, /photo-clean\.png/);
    assert.match(line, /->/);
});

test('describePlan marks skipped plans', () => {
    const exists = new Set([collisionKey(inTmp('photo-clean.png'))]);
    const line = describePlan(planOutput(inTmp('photo.png'), { exists }));
    assert.match(line, /skip/i);
});

test('collisionKey folds separators, case and trailing slashes', () => {
    const a = collisionKey(path.join('dir', 'File.png'));
    assert.equal(a, collisionKey(path.join('dir', 'file.PNG')));
    assert.ok(!a.includes('\\'), 'key must not contain backslashes');
    assert.ok(!a.endsWith('/'), 'key must not keep a trailing separator');
});

test('a Windows-style path produces a comparable key on any platform', () => {
    // On POSIX a "C:\shots\photo.png" string is just a filename containing
    // backslashes, so the key legitimately keeps them. The invariant that must
    // hold everywhere: two spellings of the same path fold to one key, and a
    // host-separator path never leaves stray separators in the key.
    const native = collisionKey(path.join('shots', 'photo.png'));
    assert.ok(!native.includes('\\'), native);
    assert.equal(native, collisionKey(path.join('SHOTS', 'Photo.PNG')));

    // A win32-style path keys the same under both relative spellings.
    assert.equal(collisionKey('C:\\shots\\photo.png'), collisionKey('C:\\shots\\photo.png'));
});
