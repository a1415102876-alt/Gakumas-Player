import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/build/three.module.js';
import { linearColor, resolveVolumeStack, sceneActorLight } from '../gakumas-scene-core.js';
import { GAKUMAS_LOOK, applyGakumasLookUniforms, applySceneActorUniforms, createGakumasLookUniformValues, matcapKeyDirection } from '../gakumas-look.js';

test('resolved character volume supplies main light, shade and rim parameters', () => {
    const component = {
        active: 1,
        mainLightAngle: { override: true, value: { x: 35, y: 15 } },
        matCapOffset: { override: true, value: 0 },
        shadeColorMultiply: { override: true, value: { r: 0.57, g: 0.46, b: 0.70 } },
        rimAngle: { override: true, value: { x: -20, y: 20 } },
        rimColor: { override: true, value: { r: 1.24, g: 0.67, b: 0.29 } },
        rimPower: { override: true, value: 32 },
        rimBaseColorRatio: { override: true, value: 0 },
        additiveLightScale: { override: true, value: 0 },
    };
    const { stack } = resolveVolumeStack([{ enabled: true, priority: 0, isGlobal: true, profile: { components: { VLActorParameter: component } } }]);
    const actor = sceneActorLight(stack);
    assert.equal(actor.matCapOffset, 0);
    assert.equal(actor.rimBaseColorRatio, 0);
    assert.deepEqual(actor.shadeMultiply, linearColor([0.57, 0.46, 0.70]));
    assert.deepEqual(actor.rimColor, linearColor([1.24, 0.67, 0.29]));
    assert.deepEqual(actor.rimAngle, [-20, 20]);

    const uniforms = {
        ...createGakumasLookUniformValues(),
        gkMatCapOffset: { value: 0.3 },
        gkAddLightScale: { value: 1 },
        gkRimDirection: { value: new THREE.Vector3() },
        gkRimColor: { value: new THREE.Color() },
        gkRimPower: { value: 0 },
        gkRimAlbedo: { value: 1 },
    };
    applySceneActorUniforms(uniforms, { actorLight: actor });
    assert.equal(uniforms.gkLightTermOffset.value, 0);
    assert.equal(uniforms.gkMatCapOffset.value, 0);
    assert.equal(uniforms.gkAddLightScale.value, 0);
    assert.deepEqual(uniforms.gkShadeMultiply.value.toArray(), actor.shadeMultiply.map(value => 1 - GAKUMAS_LOOK.sceneShadeTint + GAKUMAS_LOOK.sceneShadeTint * value));
    assert.deepEqual(uniforms.gkRimColor.value.toArray(), actor.rimColor);
    assert.ok(uniforms.gkRimDirection.value.distanceTo(matcapKeyDirection(-20, 20)) < 1e-12);
    assert.equal(uniforms.gkRimPower.value, 32);
    assert.equal(uniforms.gkRimAlbedo.value, 0);

    // The render loop reapplies the base look and light before each scene.
    applyGakumasLookUniforms(uniforms);
    uniforms.gkRimColor.value.setRGB(1, 1, 1);
    applySceneActorUniforms(uniforms, { actorLight: sceneActorLight({}) });
    assert.equal(uniforms.gkLightTermOffset.value, GAKUMAS_LOOK.lightTermOffset);
    assert.deepEqual(uniforms.gkShadeMultiply.value.toArray(), GAKUMAS_LOOK.shadeMultiply);
    assert.deepEqual(uniforms.gkRimColor.value.toArray(), [1, 1, 1]);
    assert.equal(uniforms.gkRimPower.value, GAKUMAS_LOOK.rimPower);
});

test('scene tint preserves the selected key color and can be adjusted independently', () => {
    const uniforms = { gkLightDirection: { value: new THREE.Vector3() }, gkLightColor: { value: new THREE.Color() } };
    const actor = { hasMainLight: true, azimuth: 0, elevation: 0, color: [1, 0.5, 0.25] };
    const base = [0.8, 0.6, 0.4];
    for (const tint of [0, 0.3, 1]) {
        uniforms.gkLightColor.value.setRGB(...base);
        applySceneActorUniforms(uniforms, { actorLight: actor }, null, tint);
        uniforms.gkLightColor.value.toArray().forEach((value, index) => {
            assert.ok(Math.abs(value - base[index] * (1 - tint + tint * actor.color[index])) < 1e-12);
        });
    }
});
