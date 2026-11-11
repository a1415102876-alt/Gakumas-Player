import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as THREE from '../vendor/three/build/three.module.js';
import { parseBeatScript, buildStageSlides, resolveBeatCue } from '../beat-protocol.js';
import { BEAT_SPEAKER_NAMES, beatActorId } from '../beat-player-core.js';
import { parseBeatEditorSource, serializeBeatEditorScript } from '../beat-editor-model.js';
import { buildDialogueAssetPlan } from '../dialogue-asset-plan.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const motionFile = 'mot_all_chr_hkne_teapot-001_pose_b.vmd';
const faceFile = 'mot_all_chr_hkne_teapot-001_pose_f.vmd';
const script = (cue, overlay, extra = '') => `<beat speaker="hkne" cue="${cue}" overlay="${overlay}" ${extra}>我明白了。</beat>`;

// Exercise the production methods with the real mixer without constructing a
// browser renderer or loading the runtime's browser-only dependencies.
function method(source, name, nextName) {
    const start = source.indexOf(`    ${name}(`);
    const end = source.indexOf(`\n    ${nextName}(`, start);
    assert.ok(start >= 0 && end > start, `Missing method: ${name}`);
    return source.slice(start, end);
}

const runtimeSource = read('../live-portrait.js');
const OverlayRuntime = runInNewContext(`(class {
    ${method(runtimeSource, 'playAdditiveClip', 'playIdleAdditiveClip')}
    ${method(runtimeSource, 'clearAdditiveClip', 'async preloadCues')}
    ${method(runtimeSource, 'flushPendingAnimationFinishes', 'ensureMixer')}
    ${method(runtimeSource, 'ensureIdleAdditiveOnHold', 'async playRandomIdleAdditiveOnHold')}
})`, { THREE });
const PreloadPlanner = runInNewContext(`(class {
    ${method(read('../beat-player.js'), 'buildPreloadPlan', 'async prepareResources')}
})`, { NAME_MAP: BEAT_SPEAKER_NAMES, beatActorId, resolveBeatCue });

test('成套、独立和指定 VMD 动作均保留头部叠加', () => {
    for (const cue of ['greet', 'think', 'idle', 'talk', motionFile]) {
        for (const overlay of ['yes-additive', 'no-additive']) {
            const parsed = parseBeatScript(script(cue, overlay));
            assert.deepEqual(parsed.errors, [], cue);
            assert.deepEqual(parsed.beats[0].overlay, [overlay], cue);
            assert.equal(parsed.beats[0].cue, cue);
        }
    }
    const customFace = parseBeatScript(script('greet', 'yes-additive', `face="${faceFile}"`));
    assert.deepEqual(customFace.errors, []);
    assert.equal(customFace.beats[0].face, faceFile);
    assert.deepEqual(customFace.beats[0].overlay, ['yes-additive']);

    const pairedFace = parseBeatScript(script('greet', 'yes-additive', 'face="happy"'));
    assert.deepEqual(pairedFace.errors.map(error => error.code), ['paired-face']);
    assert.equal(pairedFace.beats[0].face, undefined);
    assert.deepEqual(pairedFace.beats[0].overlay, ['yes-additive']);
});

test('叠加仍去重、诊断未知项，并只允许一种头部手势', () => {
    const parsed = parseBeatScript(script('greet', 'YES-ADDITIVE,yes-additive；no-additive unknown'));
    assert.deepEqual(parsed.beats[0].overlay, ['yes-additive']);
    assert.deepEqual(parsed.errors.map(error => error.code), ['unknown-overlay', 'conflicting-overlays']);
    const npc = parseBeatScript('<beat speaker="andk" overlay="yes-additive">你好。</beat>');
    assert.ok(npc.beats[0].portrait);
    assert.equal(npc.beats[0].overlay, undefined);
});

test('编辑器导入和导出成套或文件动作时保留叠加', () => {
    for (const cue of ['greet', motionFile]) {
        const document = parseBeatEditorSource(script(cue, 'no-additive'));
        assert.deepEqual(document.beats[0].overlay, ['no-additive']);
        const parsed = parseBeatScript(serializeBeatEditorScript(document));
        assert.deepEqual(parsed.errors, []);
        assert.equal(parsed.beats[0].cue, cue);
        assert.deepEqual(parsed.beats[0].overlay, ['no-additive']);
    }
});

test('预加载计划同时选择底层动作及真实的点头或摇头资源', () => {
    const library = {
        config: JSON.parse(read('../library.json')),
        manifest: JSON.parse(read('../resource-manifest.json')),
        map: JSON.parse(read('../gakumas-motion-map.json')),
    };
    for (const [cue, overlay, suffix] of [
        ['greet', 'yes-additive', 'yes-002-add_in_b.vmd'],
        [motionFile, 'no-additive', 'no-001-add_in_b.vmd'],
    ]) {
        const { beats, errors } = parseBeatScript(script(cue, overlay));
        assert.deepEqual(errors, []);
        const preload = new PreloadPlanner().buildPreloadPlan(beats);
        const { slides } = buildStageSlides(beats, BEAT_SPEAKER_NAMES);
        const plan = buildDialogueAssetPlan({ beats, slides }, preload, library);
        const performances = plan.performances.get('hkne');
        const name = BEAT_SPEAKER_NAMES.hkne;
        assert.ok(performances.get(`${name}(${resolveBeatCue(cue)})`).body);
        assert.equal(performances.get(`${name}(${resolveBeatCue(overlay)})`).additive, true);
        assert.ok(plan.keys.some(key => key.endsWith(suffix)));
        if (cue === motionFile) assert.ok(plan.keys.some(key => key.endsWith(motionFile)));
    }
});

function quaternion(axis, angle) {
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), angle);
}

function rotationTrack(name, start, end = start) {
    return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [...start, ...end]);
}

test('成套及文件动作实际叠加头颈旋转，身体、位置和表情继续播放', () => {
    for (const mode of ['mixed', 'paired', 'file']) {
        for (const mmd of [false, true]) {
            const model = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
            const [spine, neck, head] = ['Spine', mmd ? '首' : 'Neck', mmd ? '頭' : 'Head'].map(name => {
                const bone = new THREE.Bone();
                bone.name = name;
                return bone;
            });
            model.add(spine);
            spine.add(neck);
            neck.add(head);
            model.bind(new THREE.Skeleton([spine, neck, head]));
            model.morphTargetInfluences = [0];
            model.morphTargetDictionary = { smile: 0 };
            const trackName = bone => mmd ? `.bones[${bone.name}]` : bone.name;
            const baseHead = quaternion([0, 1, 0], 0.35);
            const baseNeck = quaternion([1, 0, 0], -0.1);
            const baseSpine = quaternion([0, 0, 1], 0.15);
            const baseClip = new THREE.AnimationClip('body-and-face', 2, [
                rotationTrack(trackName(head), baseHead),
                rotationTrack(trackName(neck), baseNeck),
                rotationTrack(trackName(spine), baseSpine),
                new THREE.VectorKeyframeTrack('.position', [0, 2], [1, 2, 3, 1, 2, 3]),
                new THREE.NumberKeyframeTrack('.morphTargetInfluences[0]', [0, 2], [0.3, 0.3]),
            ]);
            const source = new THREE.AnimationClip('head-gesture', 1, [
                rotationTrack(trackName(head), quaternion([1, 0, 0], 0.25), quaternion([1, 0, 0], 0.7)),
                rotationTrack(trackName(neck), quaternion([0, 0, 1], -0.1), quaternion([0, 0, 1], 0.2)),
                rotationTrack(trackName(spine), quaternion([0, 1, 0], 2)),
                new THREE.VectorKeyframeTrack('.position', [0, 1], [100, 100, 100, 200, 200, 200]),
                new THREE.NumberKeyframeTrack('.morphTargetInfluences[0]', [0, 1], [1, 1]),
            ]);
            const originalValues = source.tracks.map(track => [...track.values]);
            const mixer = new THREE.AnimationMixer(model);
            const baseAction = mixer.clipAction(baseClip).play();
            const runtime = Object.assign(new OverlayRuntime(), {
                model, ensureMixer: () => mixer, performanceKey: `${mode}:base`,
                performanceSelection: { body: 'base-body', face: 'base-face' },
                playGeneration: 1, liveActions: [baseAction], basePerformanceFinished: false,
            });
            const selection = runtime.performanceSelection;
            assert.equal(runtime.playAdditiveClip(source, 'gesture'), true, `${mode}/${mmd}`);
            mixer.update(0.5);
            assert.ok(head.quaternion.clone().normalize().angleTo(baseHead.clone().multiply(quaternion([1, 0, 0], 0.225))) < 1e-6);
            assert.ok(neck.quaternion.clone().normalize().angleTo(baseNeck.clone().multiply(quaternion([0, 0, 1], 0.15))) < 1e-6);
            assert.ok(spine.quaternion.clone().normalize().angleTo(baseSpine) < 1e-6);
            assert.deepEqual(model.position.toArray(), [1, 2, 3]);
            assert.ok(Math.abs(model.morphTargetInfluences[0] - 0.3) < 1e-6);
            assert.deepEqual(source.tracks.map(track => [...track.values]), originalValues);
            assert.equal(runtime.performanceSelection, selection);
            assert.equal(runtime.performanceKey, `${mode}:base`);
            mixer.update(0.6);
            assert.equal(runtime.pendingAdditiveFinish, runtime.additiveAction);
            runtime.flushPendingAnimationFinishes();
            assert.equal(runtime.additiveAction, null);
            assert.equal(baseAction.isRunning(), true);
            assert.ok(head.quaternion.clone().normalize().angleTo(baseHead) < 1e-6);
            model.geometry.dispose();
            model.material.dispose();
            model.skeleton.dispose();
        }
    }
});

test('没有底层身体的纯表情文件不启动头部叠加', () => {
    const mixer = new THREE.AnimationMixer(new THREE.Object3D());
    const runtime = Object.assign(new OverlayRuntime(), {
        ensureMixer: () => mixer, performanceKey: 'file:face',
        performanceSelection: { body: '', face: 'face' },
    });
    const source = new THREE.AnimationClip('nod', 1, [rotationTrack('Head', new THREE.Quaternion())]);
    assert.equal(runtime.playAdditiveClip(source, 'nod'), false);
    assert.equal(runtime.additiveAction, undefined);
});
