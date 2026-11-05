/**
 * Runs the test suite with an explicit file list.
 *
 * Why not `node --test test/` or a quoted glob: the directory form is not
 * supported by the Node 20 test runner, and the unquoted `test/**` glob is only
 * expanded by Node 21+. Enumerating the files works on every supported version.
 */

import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'test');

const files = readdirSync(testDir)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join('test', name));

if (files.length === 0) {
    console.error('no test files found');
    process.exit(1);
}

try {
    execFileSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
} catch {
    // execFileSync already forwarded the runner's output and exit status.
    process.exit(1);
}
