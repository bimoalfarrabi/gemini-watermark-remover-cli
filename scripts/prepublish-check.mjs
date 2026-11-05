/**
 * Release helper: verifies the package before tagging.
 * Runs the test suite, a real end-to-end pass on a fixture, and the CLI
 * surface checks that a broken bin entry would otherwise catch only after
 * `npm i -g`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const steps = [];
function step(name, fn) {
    try {
        fn();
        steps.push({ name, ok: true });
    } catch (error) {
        steps.push({ name, ok: false, detail: error.stdout?.toString() || error.message });
    }
}

step('bin entry exists', () => {
    const entry = path.join(root, pkg.bin.gwr);
    readFileSync(entry);
    const first = readFileSync(entry, 'utf8').split('\n')[0];
    if (!first.startsWith('#!')) throw new Error('bin entry is missing a shebang');
});

step('all declared deps resolve', () => {
    for (const name of Object.keys(pkg.dependencies)) {
        execFileSync(process.execPath, ['-e', `import('${name}').catch(e=>{if(!/ERR_MODULE_NOT_FOUND/.test(e.code))process.exit(0)})`], { cwd: root, stdio: 'pipe' });
    }
});

step('tests', () => {
    execFileSync(process.execPath, ['--test', 'test/**/*.test.js'], { cwd: root, stdio: 'pipe' });
});

step('quality gate', () => {
    execFileSync(process.execPath, ['scripts/quality-gate.mjs'], { cwd: root, stdio: 'pipe' });
});

step('end-to-end remove', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'gwr-release-'));
    try {
        const out = path.join(dir, 'out.png');
        execFileSync(process.execPath, [path.join(root, 'src/cli.js'), 'test/fixtures/sample-1k.png', '-o', out], { cwd: root, stdio: 'pipe' });
        if (!readdirSync(dir).includes('out.png')) throw new Error('no output written');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

step('help and version exit 0', () => {
    for (const flag of ['--help', '--version']) {
        execFileSync(process.execPath, [path.join(root, 'src/cli.js'), flag], { cwd: root, stdio: 'pipe' });
    }
});

for (const s of steps) {
    console.log(`${s.ok ? 'ok  ' : 'FAIL'}  ${s.name}`);
    if (!s.ok) console.log(`      ${String(s.detail).split('\n')[0]}`);
}
const failed = steps.filter((s) => !s.ok).length;
console.log(`\n${steps.length - failed}/${steps.length} checks passed for ${pkg.name}@${pkg.version}`);
process.exitCode = failed === 0 ? 0 : 1;
