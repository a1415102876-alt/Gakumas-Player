import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/build/three.module.js';
import { FacialEffectsStage, noHighlightEyeResource } from '../facial-effects-stage.js';

test('无高光主体眼贴图只对香名江启用，并且关闭后恢复基础贴图和 shader 参数', async () => {
    assert.ok(noHighlightEyeResource('hkne'));
    assert.equal(noHighlightEyeResource('fktn'), null);

    const baseMap = new THREE.Texture();
    const replacementMap = new THREE.Texture();
    const baseShade = new THREE.Texture();
    const baseDef = new THREE.Texture();
    const replacementShade = new THREE.Texture();
    const replacementDef = new THREE.Texture();
    const material = {
        map: baseMap,
        userData: {
            facialBaseMap: baseMap,
            facialBaseRepeat: new THREE.Vector2(1, 1),
            facialBaseOffset: new THREE.Vector2(0, 0),
            gakumasUniforms: {
                gkShadeMap: { value: baseShade },
                gkDefMap: { value: baseDef },
                gkHasShade: { value: 0 },
                gkHasDef: { value: 0 },
            },
        },
    };
    const stage = Object.assign(Object.create(FacialEffectsStage.prototype), {
        idolId: 'hkne',
        loading: new Map(),
        state: { noHighlight: true },
        model: {},
        materialEntries: [{ material }],
        texture: async () => replacementMap,
        dataTexture: async path => path.includes('_sdw') ? replacementShade : replacementDef,
        report() {},
    });

    stage.ensureKanaeNoHighlight(material);
    await stage.loading.get('no-highlight:hkne');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(material.map, replacementMap);
    assert.equal(material.userData.gakumasUniforms.gkShadeMap.value, replacementShade);
    assert.equal(material.userData.gakumasUniforms.gkDefMap.value, replacementDef);
    assert.equal(material.userData.gakumasUniforms.gkHasShade.value, 1);
    assert.equal(material.userData.gakumasUniforms.gkHasDef.value, 1);

    stage.restoreKanaeNoHighlight(material);
    assert.equal(material.map, baseMap);
    assert.equal(material.userData.gakumasUniforms.gkShadeMap.value, baseShade);
    assert.equal(material.userData.gakumasUniforms.gkDefMap.value, baseDef);
    assert.equal(material.userData.gakumasUniforms.gkHasShade.value, 0);
    assert.equal(material.userData.gakumasUniforms.gkHasDef.value, 0);
});
