import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBeatScript } from '../beat-protocol.js';
import { parseBeatEditorSource, serializeBeatEditorScript } from '../beat-editor-model.js';

const beat = (attrs, text = '台词') => `<beat speaker="narrator" ${attrs}>${text}</beat>`;

test('transition="none" and its aliases parse to a hard cut', () => {
    for (const value of ['none', 'NONE', 'cut', '无', '无转场', '不转场', '直接切换', '硬切']) {
        const parsed = parseBeatScript(beat(`background="宿舍门口-午" transition="${value}"`));
        assert.equal(parsed.beats[0].transition, 'none', value);
        assert.deepEqual(parsed.errors.filter(error => error.code === 'unknown-transition'), [], value);
    }
});

test('clock transition and the default are unchanged', () => {
    assert.equal(parseBeatScript(beat('transition="clock"')).beats[0].transition, 'clock');
    assert.equal(parseBeatScript(beat('')).beats[0].transition, undefined);
    const unknown = parseBeatScript(beat('transition="fade"'));
    assert.equal(unknown.beats[0].transition, undefined);
    assert.equal(unknown.errors.filter(error => error.code === 'unknown-transition').length, 1);
});

test('editor keeps transition="none" through import and export', () => {
    const source = '<beat id="b01" speaker="narrator" background="宿舍门口-午" transition="直接切换"><display lang="zh">直接切换</display></beat>';
    const document = parseBeatEditorSource(source, { allowOtherSpeakers: true });
    assert.equal(document.beats[0].transition, 'none');
    assert.match(serializeBeatEditorScript(document), /transition="none"/u);
});
