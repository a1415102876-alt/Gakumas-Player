import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as THREE from '../vendor/three/build/three.module.js';
import { MOTION_FADE, playlistClipIds, fadeDurationForClip, fadeDurationForTransition } from '../core.js';
import { parsePortraitCue, selectPortraitPerformance } from '../portrait-cues.js';
import { parseBeatScript, resolveBeatCue } from '../beat-protocol.js';
import { BEAT_SPEAKER_NAMES } from '../beat-player-core.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function methods(source, first, next) {
    const start = source.indexOf(`    ${first}(`);
    const end = source.indexOf(`\n    ${next}(`, start);
    assert.ok(start >= 0 && end > start, first);
    return source.slice(start, end);
}

const source = read('../live-portrait.js');
const Runtime = runInNewContext(`(class {
    ${methods(source, 'async playSpeakerCue', 'async preloadCues')}
    ${methods(source, 'playPlaylistIndex', 'ensureMixer')}
    ${methods(source, 'pause', 'setCrowdBudget')}
    ${methods(source, 'settleInactiveActions', 'async prewarm')}
})`, {
    THREE, MOTION_FADE, playlistClipIds, fadeDurationForClip, fadeDurationForTransition,
    parsePortraitCue, selectPortraitPerformance,
    portraitMotionLoops: runInNewContext(`(${source.slice(source.indexOf('function portraitMotionLoops('), source.indexOf('\nexport function createSceneDirector('))})`),
    motionAssetUrls: item => ['body', 'face'].filter(kind => item[kind]).map(kind => ({ id: item[kind], kind })),
});

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const model = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    const spine = new THREE.Bone();
    spine.name = 'Spine';
    const head = new THREE.Bone();
    head.name = 'Head';
    spine.add(head);
    model.add(spine);
    model.morphTargetInfluences = [0];
    model.morphTargetDictionary = { smile: 0 };
    const mixer = new THREE.AnimationMixer(model);
    const bodyClip = (name, duration = 1) => new THREE.AnimationClip(name, duration, [
        new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, duration], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    const faceClip = (name, duration, value) => new THREE.AnimationClip(name, duration, [
        new THREE.NumberKeyframeTrack('.morphTargetInfluences[0]', [0, duration], [0, value]),
    ]);
    const breath = new THREE.AnimationClip('breath', 2, [
        new THREE.VectorKeyframeTrack('Spine.position', [0, 1, 2], [0, 0, 0, 0, 0.1, 0, 0, 0, 0]),
    ]);
    const nod = new THREE.AnimationClip('nod', 0.5, [
        new THREE.QuaternionKeyframeTrack('Head.quaternion', [0, 0.5], [0, 0, 0, 1, 0.1, 0, 0, Math.sqrt(0.99)]),
    ]);
    let imports = 0;
    const runtime = Object.assign(new Runtime(), {
        model, modelFormat: 'glb', ensureMixer: () => mixer,
        ready: true, paused: false, autoIdleAdditiveOnHold: true, idolId: 'hkne',
        playlist: [], playlistIndex: -1, playGeneration: 0, performanceGeneration: 0,
        liveActions: [], fadingActions: [], basePerformanceFinished: false,
        actions: new Map([
            ['body', { clip: bodyClip('body'), kind: 'body' }],
            ['other-body', { clip: bodyClip('other-body', 0.2), kind: 'body' }],
            ['face', { clip: faceClip('face', 0.8, 0.25), kind: 'face' }],
            ['other-face', { clip: faceClip('other-face', 0.3, 0.75), kind: 'face' }],
            ['breath', { clip: breath, kind: 'body' }],
        ]),
        idleAdditiveItems: () => [{ body: 'breath', label: 'breath' }],
        importMotionEntries: async () => { imports++; },
        catalogItems: () => [], applyPropCue() {},
        cancelPerformance() { this.performanceGeneration++; },
        setTalkLevel() {}, stopLoop() {}, releasePresentationBuffers() {},
        clock: { getDelta() {} }, applyCrowdRendering() {}, startLoop() {}, resize() {},
        cameraFrameReady: true,
    });
    function play(body = 'body', face = 'face', options = {}) {
        runtime.performanceSelection = { body, face };
        return runtime.playPlaylistIndex(-1, { item: { body, face }, fade: 0, ...options });
    }
    async function advance(delta) {
        if (!runtime.paused) {
            mixer.update(delta);
            runtime.flushPendingAnimationFinishes();
        }
        await tick();
    }
    return { runtime, mixer, spine, nod, play, advance, get imports() { return imports; } };
}

test('同一动作跨 Beat 或换成等效 cue 时保留呼吸相位', async () => {
    const f = fixture();
    f.play();
    await f.advance(1.1);
    await f.advance(0.4);
    const breath = f.runtime.additiveAction;
    assert.ok(breath);
    const time = breath.time;
    const generation = f.runtime.playGeneration;
    const cue = `冰渡香名江(${resolveBeatCue('greet')})`;
    f.runtime.plannedPerformances = new Map([[cue, { body: 'body', face: 'face' }]]);
    for (const oldKey of ['paired:greet:', 'file:same-body:']) {
        f.runtime.performanceKey = oldKey;
        await f.runtime.playSpeakerCue(cue);
        assert.equal(f.runtime.additiveAction, breath);
        assert.equal(breath.time, time);
        assert.equal(f.runtime.playGeneration, generation);
    }
    await f.advance(0.2);
    assert.ok(breath.time > time);
    assert.ok(f.spine.position.y > 0);
});

test('身体动作相同但切换表情时，呼吸不中断且表情能结束', async () => {
    const f = fixture();
    const cues = ['happy', 'sad'].map(face => `冰渡香名江(${resolveBeatCue('talk', face)})`);
    f.runtime.plannedPerformances = new Map([
        [cues[0], { body: 'body', face: 'face' }],
        [cues[1], { body: 'body', face: 'other-face' }],
    ]);
    await f.runtime.playSpeakerCue(cues[0]);
    await f.advance(1.1);
    await f.advance(0.4);
    const breath = f.runtime.additiveAction;
    await f.runtime.playSpeakerCue(cues[1]);
    assert.equal(f.runtime.additiveAction, breath);
    await f.advance(0.2);
    assert.equal(f.runtime.basePerformanceFinished, false);
    await f.advance(0.5);
    assert.equal(f.runtime.basePerformanceFinished, true);
    assert.equal(f.runtime.additiveAction, breath);
    assert.ok(Math.abs(f.runtime.model.morphTargetInfluences[0] - 0.75) < 1e-6,
        `Final face weight: ${f.runtime.model.morphTargetInfluences[0]}`);
});

test('暂停后重复动作并恢复时保留呼吸；短暂点头仍会清除', async () => {
    const f = fixture();
    f.play();
    await f.advance(1.1);
    await f.advance(0.4);
    const breath = f.runtime.additiveAction;
    const time = breath.time;
    f.runtime.pause();
    f.runtime.holdSamePerformance();
    await f.advance(1);
    assert.equal(f.runtime.additiveAction, breath);
    assert.equal(breath.time, time);
    f.runtime.resume();
    await f.advance(0.2);
    assert.ok(breath.time > time);
    f.runtime.playAdditiveClip(f.nod, 'nod');
    f.runtime.pause();
    assert.equal(f.runtime.additiveAction, null);
    f.runtime.resume();
    await tick();
    assert.ok(f.runtime.additiveAction);
    assert.equal(f.runtime.additiveClipId, 'breath');
});

test('恢复已定格姿势时补回呼吸，并合并重复的加载请求', async () => {
    const f = fixture();
    f.play();
    await f.advance(1.1);
    f.runtime.clearAdditiveClip();
    f.runtime.pause();
    f.runtime.holdSamePerformance();
    const imports = f.imports;
    f.runtime.resume();
    f.runtime.resume();
    f.runtime.holdSamePerformance();
    await tick();
    assert.equal(f.imports, imports + 1);
    assert.equal(f.runtime.additiveClipId, 'breath');
});

test('新身体动作结束后恢复呼吸，不会等待复用且已结束的长表情', async () => {
    const f = fixture();
    f.play();
    await f.advance(1.1);
    const breath = f.runtime.additiveAction;
    f.play('other-body');
    assert.equal(f.runtime.additiveAction, null);
    await f.advance(0.3);
    assert.equal(f.runtime.basePerformanceFinished, true);
    assert.ok(f.runtime.additiveAction);
    assert.equal(breath.time, 0);
});

test('点头自然结束后恢复呼吸，显式重播身体动作则重新等待完成', async () => {
    const f = fixture();
    f.play();
    await f.advance(1.1);
    f.runtime.playAdditiveClip(f.nod, 'nod');
    await f.advance(0.6);
    assert.equal(f.runtime.additiveClipId, 'breath');
    assert.equal(f.runtime.additiveFinishedHandler, null);
    f.play('body', 'face', { restart: true });
    assert.equal(f.runtime.additiveAction, null);
    assert.equal(f.runtime.basePerformanceFinished, false);
    await f.advance(1.1);
    assert.equal(f.runtime.additiveClipId, 'breath');
});

test('异步呼吸加载不会覆盖新点头、暂停后的请求或新动作', async () => {
    for (const change of ['nod', 'pause', 'body']) {
        const f = fixture();
        f.play();
        await f.advance(1.1);
        f.runtime.clearAdditiveClip();
        const loads = [];
        f.runtime.importMotionEntries = () => new Promise(resolve => { loads.push(resolve); });
        const pending = f.runtime.playRandomIdleAdditiveOnHold();
        if (change === 'nod') f.runtime.playAdditiveClip(f.nod, 'nod');
        if (change === 'pause') { f.runtime.pause(); f.runtime.resume(); }
        if (change === 'body') f.play('other-body');
        loads[0]();
        await pending;
        assert.equal(f.runtime.additiveClipId, '');
        if (change === 'nod') assert.ok(f.runtime.additiveFinishedHandler);
        else assert.equal(f.runtime.additiveAction, null);
        if (change === 'pause') {
            assert.equal(loads.length, 2);
            loads[1]();
            await tick();
            assert.equal(f.runtime.additiveClipId, 'breath');
        }
    }
});

test('香名江日语台词通过解析、预加载和播放链，使用指定音色', async () => {
    const requests = [];
    const scope = {
        URL, AbortController, Blob,
        fetch: async (url, options) => {
            requests.push({ url, ...options, body: JSON.parse(options.body) });
            return new Response(new Uint8Array([73, 68, 51]), { headers: { 'content-type': 'audio/mpeg' } });
        },
        Audio: class {
            play() { queueMicrotask(() => this.onended?.()); return Promise.resolve(); }
            pause() {}
        },
    };
    runInNewContext(read('../fish-tts.js'), scope);
    const tts = scope.HatsuFishTts;
    tts.configure({ enabled: true, apiKey: 'mock-key', proxyUrl: 'https://tts.example.test/api/fish-tts' });
    const session = tts.beginSession('hkne-regression');
    const VoicePlayer = runInNewContext(`(class {
        ${methods(read('../beat-player.js'), 'prepareBeatVoices', 'isTtsLipSyncEnabled')}
        ${methods(read('../beat-player.js'), 'playBeatVoice', 'scheduleNext')}
    })`, { NAME_MAP: BEAT_SPEAKER_NAMES });
    const player = Object.assign(new VoicePlayer(), {
        tts, ttsSession: session, state: { current: 0, generation: 1 },
        stopTtsLipSync() {}, startTtsLipSync() {},
    });
    const aliases = ['hkne', '冰渡香名江', '氷渡香名江', '香名江', 'kanae', 'hido kanae', 'hido-kanae'];
    for (const [index, speaker] of aliases.entries()) {
        const { beats, errors } = parseBeatScript(`<beat id="voice-${index}" speaker="${speaker}"><display lang="zh">请多指教。</display><tts lang="ja">[soft]よろしくお願いします。</tts></beat>`);
        assert.deepEqual(errors, []);
        assert.equal(beats[0].text, '请多指教。');
        assert.equal(beats[0].ttsText, '[soft]よろしくお願いします。', speaker);
        assert.equal(tts.referenceIdForSpeaker(speaker), 'df77ae3e7b3b45798c0641f6a2fe928f');
        player.compiled = { beats };
        player.prepareBeatVoices();
        assert.equal(await player.playBeatVoice(beats[0], 1), true);
    }
    assert.equal(requests.length, aliases.length);
    for (const request of requests) {
        assert.equal(request.url, 'https://tts.example.test/api/fish-tts');
        assert.equal(request.body.reference_id, 'df77ae3e7b3b45798c0641f6a2fe928f');
        assert.equal(request.body.text, '[soft]よろしくお願いします。');
    }
    const other = parseBeatScript('<beat speaker="producer"><display>明白。</display><tts lang="ja">はい。</tts></beat>');
    assert.equal(other.beats[0].ttsText, undefined);
    tts.cancel();
});
