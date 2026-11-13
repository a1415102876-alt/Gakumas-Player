import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/build/three.module.js';
import { GakumasPostPass } from '../gakumas-post.js';
import { resolveVolumeStack, sceneGrade, scenePost } from '../gakumas-scene-core.js';
import { estimateRendererResources } from '../gpu-resource-estimator.js';

function renderer(hdr = true) {
    return {
        capabilities: { isWebGL2: hdr }, extensions: { has: () => hdr },
        autoClear: false, target: null, draws: [],
        getSize: vector => vector.set(1280, 720), getPixelRatio: () => 1,
        setRenderTarget(target) { this.target = target; },
        clear() {},
        render(scene) {
            const material = scene.children[0]?.material;
            const inputs = Object.fromEntries(Object.entries(material?.uniforms || {})
                .filter(([, uniform]) => uniform.value?.isTexture)
                .map(([name, uniform]) => [name, uniform.value]));
            assert.ok(!this.target || !Object.values(inputs).includes(this.target.texture), 'no texture feedback');
            this.draws.push({ material, target: this.target, inputs });
        },
    };
}

const settings = () => ({
    bloom: { enabled: true, intensity: 2.5, threshold: 0.95, diffusion: 6 },
    diffusion: { enabled: true, diffusion: 0.36, blend: 0.52 },
});

test('offscreen presentation still composites effects; only explicit raw extraction skips them', () => {
    const gpu = renderer(), post = new GakumasPostPass(gpu);
    post.enabled = true;
    post.apply(settings()); post.setModule('taa', false);
    let draws = 0;
    const result = post.render(() => { draws += 1; }, null, { present: false });
    assert.equal(draws, 1);
    assert.notEqual(result, post.color.texture);
    assert.ok(gpu.draws.some(draw => draw.material === post.extractMaterial));
    assert.equal(gpu.draws.at(-1).material, post.compositeMaterial);
    assert.equal(gpu.draws.at(-1).target.texture, result);
    assert.equal(gpu.target, null);
    assert.equal(gpu.autoClear, false);
    gpu.draws.length = 0;
    assert.equal(post.render(() => {}, null, { present: false, composite: false }), post.color.texture);
    assert.equal(gpu.draws.length, 0);
    post.dispose();
});

test('consecutive TAA frames keep the ungraded resolve as history when compositing offscreen', () => {
    const gpu = renderer(), post = new GakumasPostPass(gpu, { renderScale: 1 });
    post.enabled = true; post.apply(settings());
    const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 1000);
    let previousResolve;
    for (let frame = 0; frame < 4; frame += 1) {
        gpu.draws.length = 0;
        const result = post.render(() => {}, camera, { present: false });
        const resolve = gpu.draws.find(draw => draw.material === post.taaMaterial);
        const composite = gpu.draws.at(-1);
        assert.equal(composite.material, post.compositeMaterial);
        assert.equal(composite.inputs.gkSource, resolve.target.texture);
        assert.notEqual(result, resolve.target.texture);
        assert.equal(post.history[post.historyIndex], resolve.target);
        if (previousResolve) assert.equal(resolve.inputs.gkHistory, previousResolve);
        previousResolve = resolve.target.texture;
    }
    post.dispose();
});

test('bloom without diffusion still extracts a fresh source and all pyramid levels avoid feedback', () => {
    const gpu = renderer(), post = new GakumasPostPass(gpu);
    post.enabled = true; post.apply(settings()); post.setModule('taa', false); post.setModule('diffusion', false);
    for (const diffusion of [0, 2, 4, 6]) {
        post.apply({ bloom: { ...settings().bloom, diffusion } });
        gpu.draws.length = 0;
        post.render(() => {}, null, { present: false });
        const extracts = gpu.draws.filter(draw => draw.material === post.extractMaterial);
        assert.equal(extracts.length, 1);
        assert.equal(extracts[0].inputs.gkSource, post.color.texture);
        assert.equal(gpu.draws.at(-1).material, post.compositeMaterial);
    }
    post.dispose();
});

test('HDR grade is enabled only on supported targets and while the pass is enabled', () => {
    for (const hdr of [true, false]) {
        const post = new GakumasPostPass(renderer(hdr));
        post.enabled = true; post.apply(settings());
        post.settings.grading = {}; post.settings.sceneId = 'riverbed';
        assert.equal(post.usesSceneHDR, hdr);
        post.enabled = false;
        assert.equal(post.usesSceneHDR, false);
        assert.equal(post.color.texture.type, hdr ? THREE.HalfFloatType : THREE.UnsignedByteType);
        post.dispose();
    }
});

test('indoor, sunset and night scene switches replace the entire volume grade and effect state', () => {
    const post = new GakumasPostPass(renderer());
    post.enabled = true;
    const profiles = [
        { id: 'classroom-noon', exposure: -0.075, contrast: 6, saturation: 8.5, bloom: 2, filter: { r: 1, g: 1, b: 1 } },
        { id: 'courtyard-evening', exposure: -0.2, contrast: 8, saturation: 8, bloom: 2, filter: { r: 1, g: 0.8, b: 0.6 } },
        { id: 'classroom-night', exposure: -0.1, contrast: 5.5, saturation: 7.5, bloom: 1.25, filter: { r: 0.6, g: 0.8, b: 1 } },
        { id: 'ungraded-scene', exposure: 0, contrast: 0, saturation: 0, bloom: 0, filter: { r: 1, g: 1, b: 1 } },
    ];
    for (const profile of profiles) {
        const stack = {
            ColorAdjustments: { postExposure: profile.exposure, contrast: profile.contrast, saturation: profile.saturation, colorFilter: profile.filter },
            VLBloom: { intensity: profile.bloom, threshold: 0.95, diffusion: 6 },
            VLTonemapping: { mode: profile.bloom ? 5 : 0 },
        };
        const active = { VLBloom: profile.bloom > 0, ColorAdjustments: true, VLTonemapping: true };
        const settings = scenePost(stack, active, profile.id);
        assert.equal(settings.sceneId, profile.id);
        assert.deepEqual(settings.grading, sceneGrade(stack, active));
        post.apply(settings);
        const uniforms = post.compositeMaterial.uniforms;
        assert.equal(post.usesSceneHDR, true);
        assert.equal(uniforms.gkExposure.value, 2 ** profile.exposure);
        assert.equal(uniforms.gkContrast.value, 1 + profile.contrast / 100);
        assert.equal(uniforms.gkSaturation.value, 1 + profile.saturation / 100);
        assert.deepEqual(uniforms.gkColorFilter.value.toArray(), settings.grading.colorFilter);
        assert.equal(uniforms.gkToneEnabled.value, profile.bloom ? 1 : 0);
        assert.equal(uniforms.gkBloomIntensity.value, profile.bloom * 0.35);
        assert.equal(uniforms.gkStarWeight.value, 0);
        assert.equal(post.resetHistory, true);
    }
    post.apply(null);
    assert.equal(post.usesSceneHDR, false);
    assert.equal(post.compositeMaterial.uniforms.gkApplyGrade.value, 0);
    post.dispose();
});

test('local camera volumes drive post grading and LDR keeps grade in scene materials', () => {
    const value = value => ({ override: true, value });
    const volumes = [
        { path: 'global', global: true, priority: 0, profile: { components: {
            ColorAdjustments: { postExposure: value(0), saturation: value(5) },
        } } },
        { path: 'local', global: false, priority: 1, weight: 0.5,
            matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            colliders: [{ center: [0, 0, 0], size: [2, 2, 2] }],
            profile: { components: { ColorAdjustments: { postExposure: value(-1) } } } },
    ];
    const inside = resolveVolumeStack(volumes, [0, 0, 0]);
    const outside = resolveVolumeStack(volumes, [20, 0, 0]);
    const local = scenePost(inside.stack, inside.activeComponents, 'room');
    const global = scenePost(outside.stack, outside.activeComponents, 'room');
    assert.notEqual(local.grading.exposure, global.grading.exposure);
    assert.equal(local.grading.saturation, global.grading.saturation);
    const post = new GakumasPostPass(renderer(false));
    post.enabled = true; post.apply(local);
    assert.equal(post.usesSceneHDR, false);
    assert.equal(post.compositeMaterial.uniforms.gkApplyGrade.value, 0);
    post.dispose();
});

test('inactive serialized grading components do not tint or tonemap other scenes', () => {
    const inactiveStack = {
        ColorAdjustments: { postExposure: -2, saturation: 40, colorFilter: { r: 1, g: 0, b: 0 } },
        VLTonemapping: { mode: 5 },
        ShadowsMidtonesHighlights: { shadows: { x: 0.1, y: 0.2, z: 0.9, w: -1 } },
        VLLightmapVolume: { intensity: 4 },
    };
    const post = scenePost(inactiveStack, {}, 'no-volume');
    assert.deepEqual(post.grading, sceneGrade({}));
    const active = scenePost(inactiveStack, { ColorAdjustments: true }, 'filtered');
    assert.equal(active.grading.exposure, 0.25);
    assert.equal(active.grading.tone.enabled, false);
    assert.deepEqual(active.grading.shadows, [1, 1, 1]);
});

test('inactive star streak stays off even when bloom is enabled', () => {
    const resolved = scenePost({ VLBloom: { intensity: 2.5 } }, { VLBloom: true, VLStarStreak: false });
    const post = new GakumasPostPass(renderer());
    post.enabled = true; post.apply(resolved);
    assert.equal(post.compositeMaterial.uniforms.gkStarWeight.value, 0);
    post.apply({ ...resolved, starStreak: { enabled: true } });
    assert.ok(post.compositeMaterial.uniforms.gkStarWeight.value > 0);
    post.dispose();
});

test('small bloom buffers are estimated and disposed, including after a resize', () => {
    const post = new GakumasPostPass(renderer(), { renderScale: 1 });
    post.setSize(1280, 720); post.setSize(640, 360);
    const memory = estimateRendererResources({ renderer: {}, postPass: { bloomPyramid: post.bloomPyramid }, three: THREE });
    const expected = post.bloomPyramid.reduce((bytes, target) => bytes + target.width * target.height * 8, 0);
    assert.equal(memory.renderTargetBytes, expected);
    let disposed = 0;
    for (const target of post.bloomPyramid) target.addEventListener('dispose', () => { disposed += 1; });
    post.dispose();
    assert.equal(disposed, post.bloomPyramid.length);
});
