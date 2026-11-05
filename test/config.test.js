import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { loadConfig, saveConfig, resetConfig, configPath, setConfigValue, getConfigValue, KNOWN_KEYS } from '../src/config.js';

/**
 * Every test points XDG_CONFIG_HOME (or APPDATA) at a throwaway directory so
 * a developer's real settings never leak into assertions.
 */
async function sandbox() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gwr-config-'));
    const previous = { xdg: process.env.XDG_CONFIG_HOME, appdata: process.env.APPDATA };
    process.env.XDG_CONFIG_HOME = dir;
    if (process.platform === 'win32') process.env.APPDATA = dir;
    return {
        dir,
        async restore() {
            if (previous.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
            else process.env.XDG_CONFIG_HOME = previous.xdg;
            if (previous.appdata === undefined) delete process.env.APPDATA;
            else process.env.APPDATA = previous.appdata;
            await rm(dir, { recursive: true, force: true });
        }
    };
}

test('a missing config file reads as an empty object', async () => {
    const box = await sandbox();
    try {
        assert.deepEqual(await loadConfig(), {});
    } finally {
        await box.restore();
    }
});

test('saveConfig creates the directory and the file', async () => {
    const box = await sandbox();
    try {
        await saveConfig({ suffix: '-x' });
        const onDisk = JSON.parse(await readFile(configPath(), 'utf8'));
        assert.deepEqual(onDisk, { suffix: '-x' });
    } finally {
        await box.restore();
    }
});

test('saveConfig merges instead of replacing', async () => {
    const box = await sandbox();
    try {
        await saveConfig({ suffix: '-x' });
        await saveConfig({ jobs: 4 });
        assert.deepEqual(await loadConfig(), { suffix: '-x', jobs: 4 });
    } finally {
        await box.restore();
    }
});

test('corrupt json degrades to an empty object', async () => {
    const box = await sandbox();
    try {
        await saveConfig({ ok: true });
        await writeFile(configPath(), '}{ broken');
        assert.deepEqual(await loadConfig(), {});
    } finally {
        await box.restore();
    }
});

test('a json array is not a valid config', async () => {
    const box = await sandbox();
    try {
        await saveConfig({ ok: true });
        await writeFile(configPath(), '[1,2,3]');
        assert.deepEqual(await loadConfig(), {});
    } finally {
        await box.restore();
    }
});

test('resetConfig removes the file and stays idempotent', async () => {
    const box = await sandbox();
    try {
        await saveConfig({ suffix: '-x' });
        assert.equal(await resetConfig(), true);
        assert.equal(await resetConfig(), false);
        assert.deepEqual(await loadConfig(), {});
    } finally {
        await box.restore();
    }
});

test('values are coerced to booleans, numbers and strings', async () => {
    const box = await sandbox();
    try {
        await setConfigValue('overwrite', 'true');
        await setConfigValue('jobs', '8');
        await setConfigValue('suffix', '-nowm');
        const config = await loadConfig();
        assert.equal(config.overwrite, true);
        assert.equal(config.jobs, 8);
        assert.equal(config.suffix, '-nowm');
    } finally {
        await box.restore();
    }
});

test('getConfigValue returns undefined for an unknown key', async () => {
    const box = await sandbox();
    try {
        assert.equal(await getConfigValue('nope'), undefined);
    } finally {
        await box.restore();
    }
});

test('unknown keys survive a write', async () => {
    const box = await sandbox();
    try {
        await saveConfig({ experimental: 'keep-me' });
        await saveConfig({ jobs: 2 });
        assert.equal((await loadConfig()).experimental, 'keep-me');
    } finally {
        await box.restore();
    }
});

test('configPath honours XDG_CONFIG_HOME and ends with gwr/config.json', async () => {
    const box = await sandbox();
    try {
        const target = configPath();
        assert.ok(target.endsWith(path.join('gwr', 'config.json')), target);
        assert.ok(target.startsWith(box.dir), target);
    } finally {
        await box.restore();
    }
});

test('KNOWN_KEYS matches the documented settings', () => {
    assert.deepEqual(
        [...KNOWN_KEYS].sort(),
        ['color', 'jobs', 'outDir', 'overwrite', 'suffix', 'video'].sort()
    );
});
