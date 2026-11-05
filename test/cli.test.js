import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = process.cwd();
const cli = path.join(root, 'src', 'cli.js');
const fixture = (name) => path.join(root, 'test', 'fixtures', name);

/** Runs the real binary the way a user would, capturing both streams. */
async function gwr(args, options = {}) {
    try {
        const { stdout, stderr } = await run(process.execPath, [cli, ...args], {
            cwd: options.cwd ?? root,
            env: { ...process.env, NO_COLOR: '1', ...options.env },
            maxBuffer: 16 * 1024 * 1024
        });
        return { code: 0, stdout, stderr };
    } catch (error) {
        return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
    }
}

async function tempDir() {
    return mkdtemp(path.join(os.tmpdir(), 'gwr-cli-'));
}

test('--version prints a bare semver and exits 0', async () => {
    const { code, stdout } = await gwr(['--version']);
    assert.equal(code, 0);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('--help lists usage, flags and exit codes', async () => {
    const { code, stdout } = await gwr(['--help']);
    assert.equal(code, 0);
    assert.match(stdout, /USAGE/i);
    assert.match(stdout, /--output/);
    assert.match(stdout, /EXIT CODES/i);
});

test('no arguments and no tty prints help with exit 2', async () => {
    const { code, stdout } = await gwr([]);
    assert.equal(code, 2);
    assert.match(stdout, /USAGE/i);
});

test('a single file with -o writes the output and exits 0', async () => {
    const dir = await tempDir();
    try {
        const output = path.join(dir, 'out.png');
        const { code, stderr } = await gwr([fixture('sample-1k.png'), '-o', output]);
        assert.equal(code, 0, stderr);
        assert.ok((await stat(output)).size > 1000);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('default output lands next to the input with -clean', async () => {
    const dir = await tempDir();
    try {
        const input = path.join(dir, 'photo.png');
        await writeFile(input, await (await import('node:fs/promises')).readFile(fixture('sample-1k.png')));
        const { code, stderr } = await gwr([input]);
        assert.equal(code, 0, stderr);
        const names = await readdir(dir);
        assert.ok(names.includes('photo-clean.png'), names.join(','));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('--json emits parseable output and nothing else on stdout', async () => {
    const dir = await tempDir();
    try {
        const output = path.join(dir, 'out.png');
        const { code, stdout } = await gwr([fixture('sample-1k.png'), '-o', output, '--json']);
        assert.equal(code, 0);
        const parsed = JSON.parse(stdout);
        assert.equal(parsed.ok, true);
        assert.equal(parsed.kind, 'image');
        assert.equal(typeof parsed.meta.applied, 'boolean');
        assert.ok(parsed.error === undefined);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('--json never serialises an Error as an empty object', async () => {
    const { stdout } = await gwr(['/missing/nope.png', '-o', '/tmp/nope.png', '--json']);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, false);
    assert.equal(typeof parsed.error.message, 'string');
    assert.ok(parsed.error.message.length > 0);
});

test('a batch reports every file and exits 1 when one fails', async () => {
    const dir = await tempDir();
    try {
        const { code, stdout } = await gwr([
            fixture('sample-1k.png'), fixture('sample-16-9.png'), '/missing/nope.png',
            '-d', dir, '--json'
        ]);
        assert.equal(code, 1);
        const parsed = JSON.parse(stdout);
        assert.equal(parsed.length, 3);
        assert.deepEqual(parsed.map((r) => r.ok), [true, true, false]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('an existing target exits 1 with an actionable hint', async () => {
    const dir = await tempDir();
    try {
        const output = path.join(dir, 'taken.png');
        await writeFile(output, 'sentinel');
        const { code, stderr } = await gwr([fixture('sample-1k.png'), '-o', output]);
        assert.equal(code, 1);
        assert.match(stderr, /--overwrite/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('--overwrite replaces the target', async () => {
    const dir = await tempDir();
    try {
        const output = path.join(dir, 'taken.png');
        await writeFile(output, 'sentinel');
        const { code, stderr } = await gwr([fixture('sample-1k.png'), '-o', output, '--overwrite']);
        assert.equal(code, 0, stderr);
        assert.ok((await stat(output)).size > 1000);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('--dry-run writes nothing', async () => {
    const dir = await tempDir();
    try {
        const { code, stdout } = await gwr([fixture('sample-1k.png'), '-d', dir, '--dry-run']);
        assert.equal(code, 0);
        assert.deepEqual(await readdir(dir), []);
        assert.match(stdout, /dry run/i);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('--quiet prints only written paths', async () => {
    const dir = await tempDir();
    try {
        const { code, stdout } = await gwr([fixture('sample-1k.png'), '-d', dir, '--quiet']);
        assert.equal(code, 0);
        const lines = stdout.trim().split('\n').filter(Boolean);
        assert.equal(lines.length, 1);
        assert.ok(lines[0].endsWith('.png'));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('a usage mistake exits 2 with a hint', async () => {
    const { code, stderr } = await gwr(['a.png', '-o', 'x.png', '-d', 'out']);
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
});

test('an unsupported input exits 4', async () => {
    const dir = await tempDir();
    try {
        const input = path.join(dir, 'notes.txt');
        await writeFile(input, 'hello');
        const { code } = await gwr([input]);
        assert.equal(code, 4);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('piped output carries no ANSI escapes', async () => {
    const dir = await tempDir();
    try {
        const output = path.join(dir, 'out.png');
        const { stdout, stderr } = await gwr([fixture('sample-1k.png'), '-o', output]);
        assert.ok(!/\u001b\[/.test(stdout), `ANSI in stdout: ${JSON.stringify(stdout)}`);
        assert.ok(!/\u001b\[/.test(stderr), `ANSI in stderr: ${JSON.stringify(stderr)}`);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('NO_COLOR and --no-color both keep the output plain', async () => {
    const dir = await tempDir();
    try {
        const output = path.join(dir, 'out.png');
        const withEnv = await gwr([fixture('sample-1k.png'), '-o', output, '-f'], { env: { NO_COLOR: '1' } });
        const withFlag = await gwr([fixture('sample-1k.png'), '-o', output, '-f', '--no-color']);
        for (const run of [withEnv, withFlag]) {
            assert.ok(!/\u001b\[/.test(run.stdout), 'expected plain stdout');
            assert.ok(!/\u001b\[/.test(run.stderr), 'expected plain stderr');
        }
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('a failure explains itself on stderr', async () => {
    const dir = await tempDir();
    try {
        const input = path.join(dir, 'broken.png');
        await writeFile(input, 'not an image');
        const { code, stderr } = await gwr([input, '-o', path.join(dir, 'out.png')]);
        assert.equal(code, 4);
        assert.match(stderr, /error:/i);
        assert.ok(stderr.trim().length > 10, `no explanation: ${JSON.stringify(stderr)}`);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('doctor reports the codec and config location', async () => {
    const { code, stdout } = await gwr(['doctor']);
    assert.equal(code, 0);
    assert.match(stdout, /codec/);
    assert.match(stdout, /node/);
    assert.match(stdout, /config/);
});

test('config path prints a writable location', async () => {
    const { code, stdout } = await gwr(['config', 'path'], { env: { XDG_CONFIG_HOME: '' } });
    assert.equal(code, 0);
    assert.match(stdout.trim(), /config\.json$/);
});

test('config set then get round-trips through the file', async () => {
    const dir = await tempDir();
    try {
        const env = { XDG_CONFIG_HOME: dir };
        assert.equal((await gwr(['config', 'set', 'suffix', '-nowm'], { env })).code, 0);
        const { stdout } = await gwr(['config', 'get', 'suffix'], { env });
        assert.equal(JSON.parse(stdout), '-nowm');
        assert.equal((await gwr(['config', 'reset'], { env })).code, 0);
        const after = await gwr(['config', 'get', 'suffix'], { env });
        assert.equal(after.stdout.trim(), '');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('a stored suffix becomes the default output naming', async () => {
    const dir = await tempDir();
    const cfg = path.join(dir, 'cfg');
    try {
        const env = { XDG_CONFIG_HOME: cfg };
        await gwr(['config', 'set', 'suffix', '-nowm'], { env });
        const input = path.join(dir, 'photo.png');
        await writeFile(input, await (await import('node:fs/promises')).readFile(fixture('sample-1k.png')));
        const { code, stderr } = await gwr([input], { env });
        assert.equal(code, 0, stderr);
        assert.ok((await readdir(dir)).includes('photo-nowm.png'));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('a corrupt config file does not break a run', async () => {
    const dir = await tempDir();
    try {
        const cfg = path.join(dir, 'cfg', 'gwr');
        await writeFile(path.join(dir, 'placeholder'), '');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(cfg, { recursive: true });
        await writeFile(path.join(cfg, 'config.json'), '{not json');
        const output = path.join(dir, 'out.png');
        const { code, stderr } = await gwr([fixture('sample-1k.png'), '-o', output], {
            env: { XDG_CONFIG_HOME: path.join(dir, 'cfg') }
        });
        assert.equal(code, 0, stderr);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
