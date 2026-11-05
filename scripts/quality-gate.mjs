/**
 * Quality gate. Proves the removal is real and surgical, using properties that
 * do not depend on how much scene detail happens to sit under the watermark.
 *
 * Why not "did local contrast drop": the mark is blended over arbitrary photo
 * content, so contrast in that box is dominated by the scenery. It can rise
 * even when the mark is gone. The invariants that actually matter are:
 *   - the engine says it applied a removal,
 *   - pixels changed inside the watermark box,
 *   - pixels did NOT change outside it (no global re-touch / colour shift),
 *   - changed pixels got darker where a light overlay was removed,
 *   - the output is a valid image of the same size.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCodec } from '../src/codec.js';
import { processImage } from '../src/pipeline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'test', 'fixtures', 'sample-1k.png');
const outPath = process.env.GWR_QUALITY_OUT || '/tmp/gwr-quality-out.png';

const codec = await resolveCodec();
const result = await processImage(fixture, { output: outPath, overwrite: true });
if (!result.ok) {
    console.error(`FAIL processImage: ${result.error.message}`);
    process.exit(1);
}

const before = await codec.decode(await readFile(fixture), { mimeType: 'image/png' });
const after = await codec.decode(await readFile(outPath), { mimeType: 'image/png' });

const meta = result.meta;
const size = meta.size ?? 48;
const box = meta.position ?? { x: before.width - 96 - size, y: before.height - 96 - size, width: size, height: size };

let changedInside = 0;
let changedOutside = 0;
let maxDeltaInside = 0;
let luminanceDelta = 0;

for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
        const i = (y * before.width + x) * 4;
        const dr = Math.abs(before.data[i] - after.data[i]);
        const dg = Math.abs(before.data[i + 1] - after.data[i + 1]);
        const db = Math.abs(before.data[i + 2] - after.data[i + 2]);
        const delta = Math.max(dr, dg, db);
        const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;

        if (delta > 0) {
            if (inside) {
                changedInside++;
                if (delta > maxDeltaInside) maxDeltaInside = delta;
                const lumBefore = 0.2126 * before.data[i] + 0.7152 * before.data[i + 1] + 0.0722 * before.data[i + 2];
                const lumAfter = 0.2126 * after.data[i] + 0.7152 * after.data[i + 1] + 0.0722 * after.data[i + 2];
                luminanceDelta += lumAfter - lumBefore;
            } else {
                changedOutside++;
            }
        }
    }
}

const meanLuminanceDelta = changedInside > 0 ? luminanceDelta / changedInside : 0;
const boxArea = box.width * box.height;

console.log(`codec              ${codec.name}`);
console.log(`engine applied     ${meta.applied}`);
console.log(`quality status     ${meta.qualityStatus}`);
console.log(`box                ${box.width}x${box.height} at ${box.x},${box.y}`);
console.log(`changed inside     ${changedInside} / ${boxArea} px`);
console.log(`changed outside    ${changedOutside} px`);
console.log(`max delta inside   ${maxDeltaInside}`);
console.log(`mean luma delta    ${meanLuminanceDelta.toFixed(2)}`);

const checks = [
    ['engine reported the mark as applied', meta.applied === true],
    ['pixels changed inside the watermark box', changedInside > 0],
    ['change is confined to the watermark box', changedOutside === 0],
    ['removed overlay made those pixels darker', meanLuminanceDelta < 0],
    ['change is strong enough to matter', maxDeltaInside >= 8],
    ['output dimensions match the input', before.width === after.width && before.height === after.height],
    ['the edit covers a plausible part of the box', changedInside / boxArea >= 0.1]
];

let failed = 0;
for (const [label, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
    if (!ok) failed++;
}

if (process.env.GWR_QUALITY_JSON) {
    console.log(JSON.stringify({ codec: codec.name, applied: meta.applied, changedInside, changedOutside, maxDeltaInside, meanLuminanceDelta }));
}
process.exit(failed === 0 ? 0 : 1);
