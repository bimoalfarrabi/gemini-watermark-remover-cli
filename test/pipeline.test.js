import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';

import { resolveCodec, describeCodec, resetCodecCache } from '../src/codec.js';
import { processImage, processBatch, expandInputs, isSupportedInput } from '../src/pipeline.js';

const fixture = (name) => path.join(process.cwd(), 'test', 'fixtures', name);
const sample = fixture('sample-1k.png');

async function tempDir() {
    return mkdtemp(path.join(os.tmpdir(), 'gwr-pipeline-'));
}

test('the codec reports a usable name and formats', async () => {
    const info = await describeCodec();
    assert.ok(['sharp', 'pure'].includes(info.name));
    assert.ok(info.formats.includes('image/png'));
    assert.ok(info.formats.includes('image/jpeg'));
});

test('codec decodes to 4-channel RGBA of the right size', async () => {
    const codec = await resolveCodec();
    const buffer = await readFile(sample);
    const image = await codec.decode(buffer, { mimeType: 'image/png' });
    assert.equal(image.data.length, image.width * image.height * 4);
    assert.ok(image.data instanceof Uint8ClampedArray);
});

test('codec round-trips png through encode and decode', async () => {
    const codec = await resolveCodec();
    const buffer = await readFile(sample);
    const image = await codec.decode(buffer, { mimeType: 'image/png' });
    const encoded = await codec.encode(image, { mimeType: 'image/png', filePath: 'x.png' });
    const again = await codec.decode(encoded, { mimeType: 'image/png' });
    assert.equal(again.width, image.width);
    assert.equal(again.height, image.height);
});

test('resetCodecCache lets the codec be resolved again', async () => {
    resetCodecCache();
    const a = await resolveCodec();
    resetCodecCache();
    const b = await resolveCodec();
    assert.equal(typeof a.name, typeof b.name);
});

test('processImage writes a cleaned file and reports engine metadata', async () => {
    const dir = await tempDir();
    try {
        const output = path.join(dir, 'out.png');
        const result = await processImage(sample, { output });
        assert.equal(result.ok, true, result.error?.message);
        assert.equal(result.kind, 'image');
        assert.equal(result.output, output);
        assert.ok(result.meta, 'meta is missing');
        assert.equal(typeof result.meta.applied, 'boolean');
        assert.ok(result.durationMs >= 0);
        const written = await stat(output);
        assert.ok(written.size > 1000);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('processImage refuses to clobber an existing file without overwrite', async () => {
    const dir = await tempDir();
    try {
        const output = path.join(dir, 'out.png');
        await writeFile(output, 'sentinel');
        const result = await processImage(sample, { output });
        assert.equal(result.ok, false);
        assert.equal(result.error.code, 'E_OUTPUT_EXISTS');
        assert.equal(await readFile(output, 'utf8'), 'sentinel');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('overwrite replaces an existing file', async () => {
    const dir = await tempDir();
    try {
        const output = path.join(dir, 'out.png');
        await writeFile(output, 'sentinel');
        const result = await processImage(sample, { output, overwrite: true });
        assert.equal(result.ok, true, result.error?.message);
        assert.notEqual(await readFile(output, 'utf8'), 'sentinel');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('a missing input becomes a failed result, not a throw', async () => {
    const result = await processImage('/definitely/not/here.png', { output: '/tmp/x.png' });
    assert.equal(result.ok, false);
    assert.ok(result.error);
});

test('an unsupported extension is rejected with a hint', async () => {
    const result = await processImage(fixture('sample-1k.png').replace('.png', '.gif'), { output: '/tmp/x.png' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'E_INPUT');
});

test('isSupportedInput covers the documented formats only', () => {
    for (const name of ['a.png', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.webp']) {
        assert.equal(isSupportedInput(name), true, name);
    }
    for (const name of ['a.gif', 'a.txt', 'a.mp4', 'a']) {
        assert.equal(isSupportedInput(name), false, name);
    }
});

test('expandInputs expands a directory into sorted supported files', async () => {
    const dir = await tempDir();
    try {
        await writeFile(path.join(dir, 'b.png'), 'x');
        await writeFile(path.join(dir, 'a.png'), 'x');
        await writeFile(path.join(dir, 'notes.txt'), 'x');
        const files = await expandInputs([dir]);
        assert.deepEqual(files.map((f) => path.basename(f)), ['a.png', 'b.png']);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('expandInputs dedupes and keeps explicit order', async () => {
    const files = await expandInputs([sample, sample]);
    assert.equal(files.length, 1);
});

test('expandInputs fails clearly for a missing path', async () => {
    await assert.rejects(() => expandInputs(['/nope/missing.png']), (e) => e.code === 'E_INPUT');
});

test('processBatch keeps input order and never rejects', async () => {
    const dir = await tempDir();
    try {
        const inputs = ['sample-1k.png', 'sample-16-9.png', 'sample-2-3.png'].map(fixture);
        inputs.push('/missing/nope.png');
        const events = [];
        const results = await processBatch(inputs, { outDir: dir, jobs: 4 }, (event) => events.push(event));
        assert.equal(results.length, inputs.length);
        assert.deepEqual(results.map((r) => r.input), inputs);
        assert.equal(results[0].ok, true);
        assert.equal(results[3].ok, false);
        assert.equal(events.length, inputs.length);
        assert.deepEqual(events.map((e) => e.index).sort((a, b) => a - b), [0, 1, 2, 3]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('processBatch reports progress with a one-based total', async () => {
    const dir = await tempDir();
    try {
        const seen = [];
        await processBatch([sample], { outDir: dir }, (event) => seen.push(event));
        assert.equal(seen[0].total, 1);
        assert.equal(seen[0].result.ok, true);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
