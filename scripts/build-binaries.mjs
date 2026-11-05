/**
 * Builds standalone executables with `bun build --compile`, one per target.
 *
 * Why bun and not Node SEA: SEA needs a matching Node binary on the build
 * host for every platform, while bun cross-compiles all targets from one
 * machine. The image engine is plain ESM with no native addon in the fallback
 * path, which is exactly what a single-file bundle can carry.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'release');
const entry = path.join(root, 'src', 'cli.js');

const targets = [
    { id: 'linux-x64', bunTarget: 'bun-linux-x64', out: 'gwr-linux-x64' },
    { id: 'linux-arm64', bunTarget: 'bun-linux-arm64', out: 'gwr-linux-arm64' },
    { id: 'darwin-x64', bunTarget: 'bun-darwin-x64', out: 'gwr-macos-x64' },
    { id: 'darwin-arm64', bunTarget: 'bun-darwin-arm64', out: 'gwr-macos-arm64' },
    { id: 'windows-x64', bunTarget: 'bun-windows-x64', out: 'gwr-windows-x64.exe' }
];

function bunAvailable() {
    try {
        execFileSync('bun', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

export function build({ only = null } = {}) {
    if (!bunAvailable()) {
        throw new Error('bun is required to build standalone binaries: https://bun.sh');
    }
    mkdirSync(outDir, { recursive: true });

    const built = [];
    for (const target of targets) {
        if (only && !only.includes(target.id)) continue;
        const outfile = path.join(outDir, target.out);
        // esbuild-era bundlers cannot drop the optional sharp import on their
        // own; bun externalizes native modules, so the fallback codec is what
        // ends up inside the binary.
        execFileSync('bun', [
            'build',
            '--compile',
            `--target=${target.bunTarget}`,
            '--minify',
            `--outfile=${outfile}`,
            entry
        ], { stdio: 'inherit', cwd: root });
        built.push(target);
        console.log(`built ${target.out}`);
    }
    writeChecksums(outDir);
    return built;
}

/**
 * Writes SHA256SUMS.txt for the binaries that exist. Done here rather than in
 * shell so the same manifest is produced locally and in CI, and so a stray
 * non-binary file in release/ never ends up in the manifest.
 */
export function writeChecksums(dir = outDir) {
    const files = readdirSync(dir).filter((name) => targets.some((t) => t.out === name)).sort();
    const lines = files.map((name) => {
        const hash = createHash('sha256').update(readFileSync(path.join(dir, name))).digest('hex');
        return `${hash}  ${name}`;
    });
    if (lines.length > 0) {
        writeFileSync(path.join(dir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
        console.log(`wrote SHA256SUMS.txt for ${lines.length} binaries`);
    }
    return lines;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
    const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;
    try {
        build({ only });
    } catch (error) {
        console.error(`build failed: ${error.message}`);
        process.exitCode = 1;
    }
}
