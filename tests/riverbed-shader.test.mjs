import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { linearColor, resolveVolumeStack, sceneDepthFog, sceneCloudLayers } from '../gakumas-scene-core.js';

test('inactive volume defaults do not enable riverbed fog or clouds', () => {
    const { stack, activeComponents } = resolveVolumeStack([{
        enabled: false, isGlobal: true,
        profile: { components: {
            DepthFog: { density: { override: true, value: 0.3 } },
            VLCloud: { multiplySpeed: { override: true, value: 0.3 } },
        } },
    }]);
    assert.equal(sceneDepthFog(stack, activeComponents).enabled, false);
    assert.equal(sceneCloudLayers(stack, activeComponents).enabled, false);
});

test('depth fog preserves colour and cap while applying the explicit scene density scale', () => {
    const stack = { DepthFog: { density: 0.3, maxAmount: 0.3, color: { r: 0.5, g: 0.6, b: 0.7 }, applySkybox: false } };
    const fog = sceneDepthFog(stack, { DepthFog: true }, { densityScale: 0.01 });
    assert.equal(fog.enabled, true);
    assert.equal(fog.density, 0.003);
    assert.equal(fog.maxAmount, 0.3);
    assert.deepEqual(fog.color, linearColor([0.5, 0.6, 0.7]));
    assert.equal(fog.applySkybox, false);
    assert.equal(sceneDepthFog(stack, { DepthFog: true }, { densityScale: 0 }).enabled, false);
    assert.equal(sceneDepthFog({ DepthFog: { density: -1 } }, { DepthFog: true }).enabled, false);
    assert.equal(sceneDepthFog({ DepthFog: { density: 1, maxAmount: 2 } }, { DepthFog: true }).maxAmount, 1);
    assert.equal(sceneDepthFog({ DepthFog: { density: 1, maxAmount: -2 } }, { DepthFog: true }).maxAmount, 0);
});

test('cloud volume keeps zero speed and offset and converts emission colour once', () => {
    const cloud = sceneCloudLayers({ VLCloud: { multiplySpeed: 0, cloudOffsetY: -10, cloudEmissionColor: [0.5, 0.6, 0.7] } }, { VLCloud: true });
    assert.equal(cloud.enabled, true);
    assert.equal(cloud.speed, 0);
    assert.equal(cloud.offsetY, -10);
    assert.deepEqual(cloud.color, [...linearColor([0.5, 0.6, 0.7]), 1]);
    assert.equal(sceneCloudLayers().speed, 1);
});

test('riverbed manifest dependency closure includes all shader inputs with matching bytes', async () => {
    const root = new URL('../', import.meta.url);
    const { assets } = JSON.parse(await readFile(new URL('resource-manifest.json', root), 'utf8'));
    const sceneKey = 'scenes/env_3d_adv_riverbed-00-00-noon/scene.json';
    const dataKey = 'scene-shader-data/riverbed-noon/shader-data.json';
    const data = JSON.parse(await readFile(new URL(dataKey, root), 'utf8'));
    assert.ok(assets[sceneKey].deps.includes(dataKey));
    const inputs = [data.clouds.file, ...Object.values(data.water.textures).map(entry => entry.file)]
        .map(file => `scene-shader-data/riverbed-noon/${file}`);
    assert.deepEqual(new Set(assets[dataKey].deps), new Set(inputs));
    for (const key of [dataKey, ...inputs]) {
        const entry = assets[key];
        assert.equal(entry.delivery, 'frontend', key);
        const bytes = await readFile(new URL(entry.local, root));
        assert.equal(bytes.length, entry.size, key);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.hash, key);
    }
    assert.equal(data.clouds.layers.length, 5);
});
