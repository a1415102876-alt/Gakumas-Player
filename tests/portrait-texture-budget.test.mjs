import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSceneTextures, downscaleTextureSources } from '../portrait-texture-budget.js';

test('scene texture collection includes material maps and nested shader uniforms once', () => {
    const map = { isTexture: true };
    const uniformTexture = { isTexture: true };
    const material = {
        map,
        uniforms: { layers: { value: [uniformTexture, map] } },
        userData: { gakumasUniforms: { face: { value: uniformTexture } } },
    };
    const root = {
        traverse(callback) {
            callback({ material: [material] });
        },
    };

    assert.deepEqual([...collectSceneTextures(root)], [map, uniformTexture]);
});

test('large image sources are resized once and all sharing textures are marked for upload', async () => {
    const image = { width: 4096, height: 2048 };
    const source = { data: image };
    const textures = [0, 1].map(() => ({
        isTexture: true,
        source,
        version: 0,
        set needsUpdate(value) { if (value) this.version += 1; },
    }));
    const sizes = [];
    const budget = await downscaleTextureSources(textures, {
        maxDimension: 2048,
        createBitmap: async (original, options) => {
            sizes.push([original, options.resizeWidth, options.resizeHeight]);
            return { width: options.resizeWidth, height: options.resizeHeight };
        },
    });

    assert.equal(sizes.length, 1);
    assert.deepEqual(sizes[0].slice(1), [2048, 1024]);
    assert.equal(source.data.width, 2048);
    assert.equal(textures[0].version, 1);
    assert.equal(textures[1].version, 1);
    assert.equal(budget.resizedSources, 1);
    assert.ok(budget.estimatedBytesSaved > 0);
});

test('small, data, and compressed textures are left intact', async () => {
    const small = { isTexture: true, image: { width: 1024, height: 1024 } };
    const data = { isTexture: true, isDataTexture: true, image: { width: 4096, height: 4096, data: new Uint8Array(4) } };
    const compressed = { isTexture: true, isCompressedTexture: true, image: { width: 4096, height: 4096 } };
    const budget = await downscaleTextureSources([small, data, compressed], {
        createBitmap: async () => { throw new Error('should not resize'); },
    });

    assert.equal(budget.resizedSources, 0);
    assert.equal(small.image.width, 1024);
    assert.equal(data.image.width, 4096);
    assert.equal(compressed.image.width, 4096);
});
