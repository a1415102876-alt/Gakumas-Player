import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { beatAudioAssetUrl } from '../beat-audio.js';
import { parseBeatEditorSource, serializeBeatEditorScript, updateBeat } from '../beat-editor-model.js';
import { parseBeatScript } from '../beat-protocol.js';
import { createPlayerServer } from '../server.mjs';

test('editor audio choices round-trip by file name, independently for each Beat', () => {
    const source = [
        '<beat speaker="producer" bgm="放学后 &amp; 放晴.mp3" sfx="脚步 1.wav|开门, 轻敲.ogg|脚步 1.wav">进来吧。</beat>',
        '<beat speaker="producer">请坐。</beat>',
    ].join('\n');
    const doc = parseBeatEditorSource(source);
    const serialized = serializeBeatEditorScript(doc);
    const { beats, errors } = parseBeatScript(serialized);
    assert.deepEqual(errors, []);
    assert.equal(beats[0].bgm, '放学后 & 放晴.mp3');
    assert.deepEqual(beats[0].sfx, ['脚步 1.wav', '开门, 轻敲.ogg']);
    assert.equal(beats[1].bgm, undefined);
    assert.equal(beats[1].sfx, undefined);
    const cleared = updateBeat(doc, 0, { bgm: '', sfx: [] });
    assert.doesNotMatch(serializeBeatEditorScript(cleared), /\b(?:bgm|sfx)=/);
});

test('only supported audio file names can be referenced', () => {
    const { beats, errors } = parseBeatScript('<beat speaker="producer" bgm="a.mp3|b.mp3" sfx="雨.wav|../other.wav|readme.txt">回来啦。</beat>');
    assert.equal(beats[0].bgm, undefined);
    assert.deepEqual(beats[0].sfx, ['雨.wav']);
    assert.deepEqual(errors.map(error => error.code), ['invalid-bgm', 'invalid-sfx']);
    assert.equal(beatAudioAssetUrl('bgm', 'already encoded%20 #1.MP3').split('/').at(-1), 'already%20encoded%2520%20%231.MP3');
    assert.equal(beatAudioAssetUrl('sfx', '../secret.wav'), '');
    assert.equal(beatAudioAssetUrl('other', 'test.wav'), '');
});

test('editor exports None as an explicit stop and leaves out the default BGM', () => {
    const source = [
        '<beat speaker="producer" bgm="theme.wav">进来吧。</beat>',
        '<beat speaker="producer">请坐。</beat>',
        '<beat speaker="producer" bgm="">到此为止。</beat>',
    ].join('\n');
    let doc = parseBeatEditorSource(source);
    assert.deepEqual(doc.beats.map(beat => beat.bgm), ['theme.wav', '', 'None']);
    assert.equal(parseBeatScript(source).beats.at(-1).bgm, 'None');
    doc = updateBeat(doc, 1, { bgm: 'None' });
    doc = updateBeat(doc, 2, { bgm: '' });
    const serialized = serializeBeatEditorScript(doc);
    assert.equal((serialized.match(/bgm="None"/g) || []).length, 1);
    const { beats, errors } = parseBeatScript(serialized);
    assert.deepEqual(errors, []);
    assert.deepEqual(beats.map(beat => beat.bgm), ['theme.wav', 'None', undefined]);
});

test('local server offers a fresh catalog for each audio folder', async t => {
    const assetRoot = await mkdtemp(path.join(tmpdir(), 'gakumas-beat-audio-'));
    const server = createPlayerServer({ assetRoot }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        await rm(assetRoot, { recursive: true, force: true });
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = `${origin}/api/beat-audio`;
    assert.deepEqual(await (await fetch(url)).json(), { bgm: [], sfx: [] });

    const bgm = path.join(assetRoot, 'audio', 'bgm');
    const sfx = path.join(assetRoot, 'audio', 'sfx');
    await mkdir(path.join(bgm, 'folder.mp3'), { recursive: true });
    await mkdir(sfx, { recursive: true });
    await writeFile(path.join(bgm, 'track 10.mp3'), 'test BGM');
    await writeFile(path.join(bgm, 'track 2.mp3'), 'test BGM');
    await writeFile(path.join(bgm, 'notes.txt'), 'not a track');
    await writeFile(path.join(sfx, '.hidden.wav'), 'hidden track');
    await writeFile(path.join(sfx, '开门 & 脚步.ogg'), 'test SFX');

    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const catalog = await response.json();
    assert.deepEqual(catalog, { bgm: ['track 2.mp3', 'track 10.mp3'], sfx: ['开门 & 脚步.ogg'] });
    const file = await fetch(`${origin}/assets/audio/sfx/${encodeURIComponent(catalog.sfx[0])}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'audio/ogg');
    assert.equal(await file.text(), 'test SFX');

    const methodError = await fetch(url, { method: 'POST' });
    assert.equal(methodError.status, 405);
    assert.equal(methodError.headers.get('allow'), 'GET');
});
