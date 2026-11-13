import test from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOM_BACKGROUND_MAX_BYTES, fitWithin, nextCustomBackgroundId, validateCustomBackgroundFile } from '../custom-background.js';
import { parseBeatScript } from '../beat-protocol.js';
import { parseBeatEditorSource, serializeBeatEditorScript } from '../beat-editor-model.js';

test('validateCustomBackgroundFile accepts common image types', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']) {
        assert.equal(validateCustomBackgroundFile({ type, size: 1024 }), '');
    }
});

test('validateCustomBackgroundFile rejects non-images, empty and oversized files', () => {
    assert.match(validateCustomBackgroundFile(null), /没有选择/u);
    assert.match(validateCustomBackgroundFile({ type: 'image/svg+xml', size: 10 }), /只支持/u);
    assert.match(validateCustomBackgroundFile({ type: 'text/plain', size: 10 }), /只支持/u);
    assert.match(validateCustomBackgroundFile({ type: 'image/png', size: 0 }), /空的/u);
    assert.match(validateCustomBackgroundFile({ type: 'image/png', size: CUSTOM_BACKGROUND_MAX_BYTES + 1 }), /超过/u);
});

test('fitWithin keeps small images and shrinks the longest side to the limit', () => {
    assert.deepEqual(fitWithin(1920, 1080), { width: 1920, height: 1080, scaled: false });
    assert.deepEqual(fitWithin(8192, 4608), { width: 4096, height: 2304, scaled: true });
    assert.deepEqual(fitWithin(3000, 9000, 4096), { width: 1365, height: 4096, scaled: true });
});

test('nextCustomBackgroundId keeps existing Beat references stable', () => {
    assert.equal(nextCustomBackgroundId([]), 'custom1');
    assert.equal(nextCustomBackgroundId([{ id: 'custom1' }, { id: 'custom3' }]), 'custom4');
    assert.equal(nextCustomBackgroundId([{ id: 'custom1' }], 3), 'custom4');
    assert.equal(nextCustomBackgroundId([{ id: 'custom2' }, { id: 'invalid' }]), 'custom3');
});

test('Beat background customN resolves only when the browser has that image', () => {
    const source = '<beat speaker="narrator" background="custom1">first</beat>\n'
        + '<beat speaker="narrator" background="custom2">second</beat>';
    const parsed = parseBeatScript(source, { customBackgrounds: ['custom1'] });
    assert.deepEqual(parsed.beats.map(beat => beat.background), ['custom1', 'custom1']);
    assert.equal(parsed.errors.filter(error => error.code === 'unknown-background').length, 1);

    const unavailable = parseBeatScript('<beat speaker="narrator" background="custom1">first</beat>');
    assert.equal(unavailable.errors.filter(error => error.code === 'unknown-background').length, 1);
});

test('播放器等待本地 Custom 仓库时保留 customN 的背景继承', () => {
    const source = '<beat speaker="narrator" background="custom1">first</beat>\n'
        + '<beat speaker="narrator">second</beat>';
    const pending = parseBeatScript(source, { customBackgrounds: [], customBackgroundsReady: false });
    assert.deepEqual(pending.beats.map(beat => beat.background), ['custom1', 'custom1']);
    assert.deepEqual(pending.beats.map(beat => beat.backgroundExplicit), [true, false]);
    assert.deepEqual(pending.errors, []);

    const ready = parseBeatScript(source, { customBackgrounds: [], customBackgroundsReady: true });
    assert.deepEqual(ready.beats.map(beat => beat.background || ''), ['', '']);
    assert.equal(ready.errors.filter(error => error.code === 'unknown-background').length, 1);
});

test('editor preserves customN references through import and export', () => {
    const source = '<beat id="b01" speaker="narrator" background="custom2"><display lang="zh">本地背景</display></beat>';
    const document = parseBeatEditorSource(source, { allowOtherSpeakers: true, customBackgrounds: ['custom2'] });
    assert.equal(document.beats[0].background, 'custom2');
    assert.match(serializeBeatEditorScript(document), /background="custom2"/u);

    const missing = parseBeatEditorSource(source, { allowOtherSpeakers: true });
    assert.equal(missing.beats[0].background, 'custom2');
    assert.match(serializeBeatEditorScript(missing), /background="custom2"/u);
});
