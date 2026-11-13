import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSharedStageMode } from '../stage-mode.js';

test('shared stage is the default, with URL override ahead of saved preference', () => {
    assert.equal(resolveSharedStageMode(), true);
    assert.equal(resolveSharedStageMode({ search: '?stage=private', storedPreference: 'shared' }), false);
    assert.equal(resolveSharedStageMode({ search: '?stage=shared', storedPreference: 'private' }), true);
});

test('saved private mode remains an explicit compatibility fallback', () => {
    assert.equal(resolveSharedStageMode({ storedPreference: 'private' }), false);
    assert.equal(resolveSharedStageMode({ storedPreference: 'shared' }), true);
});
