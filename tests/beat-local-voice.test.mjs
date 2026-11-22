import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { editorPlaybackEntries } from '../beat-editor-model.js';
import { createExportedBeatVoiceCache, getExportedBeatVoice, writeExportedBeatVoice } from '../beat-local-jobs.js';

test('exports compare the old recording while playback rejects stale and unreadable clips', async context => {
    const beat = { speaker: 'krnh', ttsText: 'こんにちは。', irodoriCaption: '静かに。' };
    const audio = new Blob(['saved sample'], { type: 'audio/wav' });
    const clips = [];
    const requested = [];
    let finishMissingFile;
    const missingFile = new Promise(resolve => { finishMissingFile = resolve; });
    context.mock.method(globalThis, 'fetch', async (path, options) => {
        const url = new URL(path, 'http://127.0.0.1');
        if (url.pathname === '/api/beat-tts' && options.method === 'PUT') {
            assert.equal(url.searchParams.get('name'), '休日の会話');
            assert.equal(url.searchParams.get('expectedRevision'), '');
            assert.equal(options.body, audio);
            const index = Number(url.searchParams.get('index'));
            const clip = { index, fingerprint: url.searchParams.get('fingerprint'), revision: 'revision', url: `/voice/${index}` };
            clips.push(clip);
            return Response.json(clip);
        }
        if (url.pathname === '/api/beat-tts') return Response.json({ clips });
        requested.push(url.pathname);
        if (url.pathname === '/voice/2') return missingFile;
        return new Response(audio);
    });
    for (const index of [0, 1, 2, 3]) {
        await writeExportedBeatVoice('休日の会話', beat, index, audio, { expectedRevision: '' });
    }
    const old = await getExportedBeatVoice('休日の会話', 1);
    assert.equal(old.revision, 'revision');
    assert.equal(await old.blob.text(), 'saved sample');
    requested.length = 0;
    const cache = createExportedBeatVoiceCache('休日の会話', [
        beat,
        { ...beat, ttsText: 'おやすみ。' },
        beat,
        { ...beat, irodoriCaption: '大きい声で。' },
    ]);
    assert.equal(await (await cache.read(0)).text(), 'saved sample');
    finishMissingFile(new Response('Missing', { status: 404 }));
    assert.deepEqual([...(await cache.preload).keys()], [0]);
    assert.deepEqual(requested.sort(), ['/voice/0', '/voice/2']);
});

test('manual export uses the configured local voice even with runtime voice disabled', async () => {
    const source = await readFile(new URL('../fish-tts.js', import.meta.url), 'utf8');
    const fish = vm.runInNewContext(`${source}\nHatsuFishTts;`, { URL, AbortController });
    const audio = new Blob(['irodori audio'], { type: 'audio/wav' });
    const controller = new AbortController();
    let exportedRequest;
    const result = await fish.synthesize({ speaker: 'krnh', text: 'おはよう。[invalid]', irodoriCaption: '元気よく。' }, {
        signal: controller.signal,
        settings: {
            irodori: {
                createRequest(request) {
                    exportedRequest = request;
                    return {
                        synthesize(signal) {
                            assert.equal(signal, controller.signal);
                            return audio;
                        },
                    };
                },
            },
        },
    });
    assert.equal(result, audio);
    assert.equal(exportedRequest.text, 'おはよう。');
    assert.equal(exportedRequest.irodoriCaption, '元気よく。');
    assert.equal(fish.getConfig().enabled, false);
});

test('voice indexes follow playable beats while the editor keeps the original row numbers', () => {
    const source = [
        '<beat speaker="kotone"><display>第一句</display><tts lang="ja">一言目。</tts></beat>',
        '<beat speaker="kotone"></beat>',
        '<beat speaker="kotone" irodori-caption="優しく"><display>第三句</display><tts lang="ja">三言目。</tts></beat>',
    ].join('\n');
    const entries = editorPlaybackEntries(source);
    assert.deepEqual(entries.map(({ index, editorIndex }) => [index, editorIndex]), [[0, 0], [1, 2]]);
    assert.equal(entries[1].beat.irodoriCaption, '優しく');
});
