import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { buildChatPrompt, normalizeChatReply } from '../beat-chat.js';
import { parseBeatEditorSource, serializeBeatEditorScript, updateBeat } from '../beat-editor-model.js';
import { createIrodoriSpeech, IRODORI_CHARACTERS, readIrodoriVoices, saveIrodoriVoices } from '../irodori-tts.js';
import { buildWeirdContinuationPrompt, buildWeirdScriptPrompt } from '../sandbox/sandbox-weird-script.js';
import { createPlayerServer } from '../server.mjs';

test('Irodori voice settings match character IDs, names and aliases', async t => {
    const source = await readFile(new URL('../fish-tts.js', import.meta.url), 'utf8');
    const fish = vm.runInNewContext(`${source}\nHatsuFishTts;`, { URL });
    const saved = new Map();
    const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
    saveIrodoriVoices({ fktn: ' sample ', krnh: '   ', sson: 'none', producer: ' none ', narrator: 'unused' }, storage);
    const voices = readIrodoriVoices(storage);
    assert.deepEqual(voices, { fktn: 'sample', sson: 'none', producer: 'none' });
    assert.deepEqual(IRODORI_CHARACTERS.find(({ id }) => id === 'producer'), { id: 'producer', name: '制作人' });
    const irodori = createIrodoriSpeech(voices, fish);
    for (const speaker of ['kotone', 'fktn', '藤田琴音', '琴音']) assert.equal(irodori.voiceForSpeaker(speaker), 'sample');
    assert.equal(irodori.voiceForSpeaker('白草四音'), 'none');
    assert.equal(irodori.voiceForSpeaker('花海咲季'), '');
    for (const speaker of ['producer', '制作人', '製作人', 'プロデューサー', '{user}', 'user']) {
        assert.equal(irodori.voiceForSpeaker(speaker), 'none');
    }
    assert.equal(irodori.voiceForSpeaker('旁白'), '');
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return new Response('audio', { headers: { 'content-type': 'audio/wav' } });
    });
    const request = createIrodoriSpeech(voices, null).createRequest({ speaker: '制作人', text: 'おはよう。' });
    await request.synthesize();
    await irodori.createRequest({ speaker: 'producer', text: 'おはよう。', irodoriCaption: '明るい口調。' }).synthesize();
    assert.deepEqual(calls, [
        { url: '/api/irodori-tts', body: { input: 'おはよう。', voice: 'none', caption: '成人男性の声。' } },
        { url: '/api/irodori-tts', body: { input: 'おはよう。', voice: 'none', caption: '成人男性の声。明るい口調。' } },
    ]);
});

test('Fish Audio sends the producer’s Japanese line with the Satoru reference', async () => {
    const source = await readFile(new URL('../fish-tts.js', import.meta.url), 'utf8');
    const calls = [];
    const fish = vm.runInNewContext(`${source}\nHatsuFishTts;`, {
        URL, AbortController,
        fetch: async (_url, options) => {
            calls.push(JSON.parse(options.body));
            return new Response('audio', { headers: { 'content-type': 'audio/mpeg' } });
        },
    });
    fish.configure({ enabled: true, apiKey: 'test-key' });
    const referenceId = '297a6fd278df47c3b9da9bfdf55ac89a';
    for (const speaker of ['producer', '制作人', '製作人', 'プロデューサー', '{user}', 'user']) {
        assert.equal(fish.referenceIdForSpeaker(speaker), referenceId);
    }
    const result = normalizeChatReply('<beat speaker="制作人"><display lang="zh">早。</display><tts lang="ja">おはよう。</tts></beat>');
    assert.ok(result.ok);
    const [{ id, speaker, ttsText }] = result.beats;
    assert.ok(await fish.prepare({ id, speaker, text: ttsText }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].reference_id, referenceId);
    assert.equal(calls[0].text, 'おはよう。');
});

test('AI prompt and normalized Beat preserve captions across chat, scripts and editing', () => {
    const irodoriCharacters = createIrodoriSpeech({ fktn: 'sample' }).characters;
    const chat = { idolName: '藤田琴音', userText: '早上好' };
    assert.match(buildChatPrompt({ ...chat, irodoriCharacters }), /irodori-caption/);
    assert.doesNotMatch(buildChatPrompt({ ...chat, irodoriCharacters, present: false }), /irodori-caption/);
    assert.doesNotMatch(buildChatPrompt({ ...chat, irodoriCharacters, idolName: '花海咲季' }), /irodori-caption/);
    assert.match(buildWeirdScriptPrompt({ irodoriCharacters }), /irodori-caption/);
    assert.match(buildWeirdContinuationPrompt({ irodoriCharacters }), /irodori-caption/);
    const producerVoices = createIrodoriSpeech({ producer: 'none' }).characters;
    for (const options of [{}, { present: false }, { present: false, company: true }, { staging: true }]) {
        const prompt = buildChatPrompt({ ...chat, ...options, irodoriCharacters: producerVoices });
        assert.match(prompt, /制作人开口时也写对应的日语 <tts lang="ja">/);
        assert.match(prompt, /使用 Irodori 语音的角色：制作人/);
    }
    for (const buildPrompt of [buildWeirdScriptPrompt, buildWeirdContinuationPrompt]) {
        assert.match(buildPrompt(), /偶像或制作人开口的 Beat 必须同时写两段/);
    }
    const caption = '小声で「おはよう」と、"優しく"話す & 笑顔。';
    const response = normalizeChatReply(JSON.stringify([
        { speaker: 'kotone', text: '早上好。', tts: 'おはよう。', irodoriCaption: caption },
        { speaker: 'sson', text: '嗯。', tts: 'うん。' },
        { speaker: 'producer', text: '早。', tts: 'おはよう。', irodoriCaption: caption },
        { speaker: 'narrator', text: '早晨。', tts: '朝。' },
    ]));
    assert.ok(response.ok);
    assert.equal(response.beats[0].irodoriCaption, caption);
    assert.equal(response.beats[0].text, '早上好。');
    assert.equal(response.beats[1].ttsText, 'うん。');
    assert.equal(response.beats[2].ttsText, 'おはよう。');
    assert.equal(response.beats[2].irodoriCaption, caption);
    assert.equal(response.beats[3].ttsText, undefined);
    const editor = parseBeatEditorSource(response.script);
    assert.equal(editor.beats[0].irodoriCaption, caption);
    assert.equal(normalizeChatReply(serializeBeatEditorScript(editor)).beats[0].irodoriCaption, caption);
    assert.doesNotMatch(serializeBeatEditorScript(updateBeat(editor, 0, { irodoriCaption: '' })).split('\n')[0], /irodori-caption/);
});

test('Irodori proxy sends the caption and voice to the configured loopback port', async t => {
    const calls = [];
    const audio = Uint8Array.of(82, 73, 70, 70);
    const server = createPlayerServer({
        irodori: { port: 8091, model: 'test-model', apiKey: 'test-key' },
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return new Response(audio, { headers: { 'content-type': 'audio/wav' } });
        },
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = (body, requestOrigin = origin) => fetch(`${origin}/api/irodori-tts`, {
        method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const payload = { input: 'おはよう。', voice: 'sample', caption: '元気な声。' };
    assert.equal((await request(payload, 'https://example.test')).status, 403);
    assert.equal((await request({ ...payload, caption: [] })).status, 400);
    assert.equal(calls.length, 0);
    const response = await request({ ...payload, irodori: { ref_wav: 'ignored.wav' } });
    assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), audio);
    assert.equal(calls[0].url, 'http://127.0.0.1:8091/v1/audio/speech');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        model: 'test-model', input: payload.input, voice: payload.voice, response_format: 'wav', irodori: { caption: payload.caption },
    });
    await request({ input: payload.input, voice: 'none' });
    assert.equal(JSON.parse(calls[1].options.body).irodori, undefined);
});

test('Irodori defaults to the caption server on 7862 and supports the Gradio override', async t => {
    const calls = [];
    const origin = 'http://127.0.0.1:7860';
    const endpoint = `${origin}/gradio_api/call/_run_generation`;
    const audio = Uint8Array.of(82, 73, 70, 70);
    const server = createPlayerServer({ fetchImpl: async (url, options) => {
        calls.push(url);
        if (url === 'http://127.0.0.1:7862/v1/audio/speech') {
            assert.deepEqual(JSON.parse(options.body).irodori, { caption: '元気な声。' });
            return new Response(audio, { headers: { 'content-type': 'audio/wav' } });
        }
        if (url.endsWith('/info')) return Response.json({ named_endpoints: { '/_run_generation': { parameters: [
            { parameter_name: 'text' },
            { parameter_name: 'caption' },
            { parameter_name: 'speaker_embedding_path_raw', parameter_has_default: true, parameter_default: 'preset.speaker.safetensors' },
        ] } } });
        if (url === endpoint) {
            assert.deepEqual(JSON.parse(options.body), { data: ['おはよう。', '元気な声。', 'preset.speaker.safetensors'] });
            return Response.json({ event_id: 'job-1' });
        }
        if (url === `${endpoint}/job-1`) return new Response('event: heartbeat\ndata: null\n\nevent: complete\ndata: [{"value":{"url":"http://localhost:7860/gradio_api/file=voice.wav"},"__type__":"update"}]\n\n');
        assert.equal(url, `${origin}/gradio_api/file=voice.wav`);
        return new Response(audio, { headers: { 'content-type': 'audio/wav' } });
    } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const player = `http://127.0.0.1:${server.address().port}`;
    const post = body => fetch(`${player}/api/irodori-tts`, {
        method: 'POST', headers: { Origin: player, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const payload = { input: 'おはよう。', voice: 'default', caption: '元気な声。' };
    assert.deepEqual(await fetch(`${player}/api/irodori-tts`).then(response => response.json()), { port: 7862 });
    assert.equal((await post({ ...payload, port: server.address().port })).status, 400);
    assert.equal((await post({ ...payload, port: 'external' })).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await post(payload)).status, 200);
    assert.equal(calls.shift(), 'http://127.0.0.1:7862/v1/audio/speech');
    const response = await post({ ...payload, port: 7860 });
    assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), audio);
    assert.deepEqual(calls, [`${origin}/gradio_api/info`, endpoint, `${endpoint}/job-1`, `${origin}/gradio_api/file=voice.wav`]);
});

test('Irodori connection check verifies the selected API without synthesizing speech', async t => {
    const calls = [];
    const server = createPlayerServer({
        irodori: { port: 8091, model: 'test-model', apiKey: 'test-key' },
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            if (url === 'http://127.0.0.1:8091/v1/models') {
                return Response.json({ data: [{ id: 'test-model' }] });
            }
            if (url === 'http://127.0.0.1:7860/gradio_api/info') {
                return Response.json({ named_endpoints: { '/_run_generation': { parameters: [{ parameter_name: 'text' }] } } });
            }
            if (url === 'http://127.0.0.1:8092/v1/models') {
                return Response.json({ data: [{ id: 'another-model' }] });
            }
            if (url === 'http://127.0.0.1:8093/gradio_api/info') {
                return Response.json({ named_endpoints: {} });
            }
            throw new TypeError('fetch failed');
        },
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = `${origin}/api/irodori-tts/check`;
    const check = (body, requestOrigin = origin) => fetch(url, {
        method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

    assert.equal((await fetch(url)).status, 405);
    assert.equal((await check({}, 'https://example.test')).status, 403);
    assert.equal((await check({ port: server.address().port })).status, 400);
    assert.equal((await check({ protocol: 'invalid' })).status, 400);
    assert.equal(calls.length, 0);

    const openai = await check({});
    assert.equal(openai.status, 200);
    assert.deepEqual(await openai.json(), { port: 8091, protocol: 'openai' });
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
    assert.equal(calls[0].options.redirect, 'error');
    const gradio = await check({ port: 7860 });
    assert.equal(gradio.status, 200);
    assert.deepEqual(await gradio.json(), { port: 7860, protocol: 'gradio' });

    const missingModel = await check({ port: 8092, protocol: 'openai' });
    assert.equal(missingModel.status, 502);
    assert.match((await missingModel.json()).error, /未报告模型/);
    assert.equal(calls[2].options.headers.Authorization, undefined);
    const wrongGradio = await check({ port: 8093, protocol: 'gradio' });
    assert.equal(wrongGradio.status, 502);
    assert.match((await wrongGradio.json()).error, /未暴露 Irodori/);
    const offline = await check({ port: 8094 });
    assert.equal(offline.status, 502);
    assert.match((await offline.json()).error, /8094/);
    assert.deepEqual(calls.map(({ url }) => url), [
        'http://127.0.0.1:8091/v1/models',
        'http://127.0.0.1:7860/gradio_api/info',
        'http://127.0.0.1:8092/v1/models',
        'http://127.0.0.1:8093/gradio_api/info',
        'http://127.0.0.1:8094/v1/models',
    ]);
    assert.ok(calls.every(({ options }) => (options.method ?? 'GET') === 'GET'));
});

test('speech prefers Irodori and uses Fish only after a local synthesis failure', async () => {
    const source = await readFile(new URL('../fish-tts.js', import.meta.url), 'utf8');
    const calls = [];
    const audio = new Blob(['audio']);
    const fish = vm.runInNewContext(`${source}\nHatsuFishTts;`, { URL, AbortController, fetch: async () => {
        calls.push('fish');
        return new Response(audio, { headers: { 'content-type': 'audio/mpeg' } });
    } });
    let fail = false;
    fish.configure({ enabled: true, apiKey: 'test-key', irodori: {
        voiceForSpeaker: () => 'default',
        createRequest: () => ({ key: 'local', synthesize: async () => {
            calls.push('irodori');
            if (fail) throw new Error('offline');
            return audio;
        } }),
    } });
    const session = fish.beginSession('test');
    const line = { speaker: 'kotone', text: 'おはよう。', session };
    assert.ok(await fish.prepare({ ...line, id: 'success' }));
    assert.deepEqual(calls, ['irodori']);
    fail = true;
    assert.ok(await fish.prepare({ ...line, id: 'fallback' }));
    assert.deepEqual(calls, ['irodori', 'irodori', 'fish']);
    fish.configure({ apiKey: '' });
    assert.equal(await fish.prepare({ ...line, id: 'local-only' }), null);
    assert.deepEqual(calls, ['irodori', 'irodori', 'fish', 'irodori']);
});
