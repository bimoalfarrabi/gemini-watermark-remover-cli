import test from 'node:test';
import assert from 'node:assert/strict';

import { GwrError, toGwrError, formatError } from '../src/errors.js';

test('GwrError carries a code, a hint and the original cause', () => {
    const cause = new Error('root');
    const error = new GwrError('outer', { code: 'E_INPUT', hint: 'try a path', cause });
    assert.equal(error.message, 'outer');
    assert.equal(error.code, 'E_INPUT');
    assert.equal(error.hint, 'try a path');
    assert.equal(error.cause, cause);
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'GwrError');
});

test('the code defaults to E_GENERIC and hint to null', () => {
    const error = new GwrError('plain');
    assert.equal(error.code, 'E_GENERIC');
    assert.equal(error.hint, null);
});

test('toGwrError passes a GwrError through untouched', () => {
    const error = new GwrError('same', { code: 'E_USAGE' });
    assert.equal(toGwrError(error), error);
});

test('toGwrError wraps a plain Error and keeps the cause', () => {
    const original = new Error('boom');
    const wrapped = toGwrError(original);
    assert.equal(wrapped.message, 'boom');
    assert.equal(wrapped.code, 'E_PROCESS');
    assert.equal(wrapped.cause, original);
});

test('toGwrError accepts a string', () => {
    const wrapped = toGwrError('something broke');
    assert.equal(wrapped.message, 'something broke');
    assert.equal(wrapped.code, 'E_PROCESS');
});

test('toGwrError never throws on odd input', () => {
    for (const value of [null, undefined, 0, {}, []]) {
        const wrapped = toGwrError(value);
        assert.ok(wrapped instanceof GwrError);
        assert.equal(typeof wrapped.message, 'string');
    }
});

test('formatError flattens to message, hint and code', () => {
    const shaped = formatError(new GwrError('m', { code: 'E_CODEC', hint: 'h' }));
    assert.deepEqual(shaped, { message: 'm', hint: 'h', code: 'E_CODEC' });
});

test('formatError works on a plain Error', () => {
    const shaped = formatError(new Error('plain'));
    assert.equal(shaped.message, 'plain');
    assert.equal(shaped.hint, null);
    assert.equal(shaped.code, 'E_PROCESS');
});
