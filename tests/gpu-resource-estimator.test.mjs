import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateRendererResources } from '../gpu-resource-estimator.js';

const THREE = {
    RGBAFormat: 1,
    RGBFormat: 2,
    RGFormat: 3,
    RedFormat: 4,
    FloatType: 5,
    HalfFloatType: 6,
    UnsignedShortType: 7,
    ShortType: 8,
    UnsignedIntType: 9,
    IntType: 10,
    UnsignedInt248Type: 11,
};

function target(width, height, type = 0, extra = {}) {
    return {
        isWebGLRenderTarget: true,
        width,
        height,
        texture: { format: THREE.RGBAFormat, type },
        ...extra,
    };
}

test('estimator separates actor textures, scene plates, render targets, shadows, geometry and canvas', () => {
    const postTarget = target(100, 50, THREE.HalfFloatType, {
        depthTexture: { format: THREE.RedFormat, type: THREE.UnsignedInt248Type },
    });
    const lookTarget = target(25, 50, 0, { depthBuffer: true });
    const shadowMap = target(32, 16, 0, { depthBuffer: true });
    const arrays = [new Float32Array(9), new Uint16Array(3)];
    const scene = {
        traverse(callback) {
            callback({
                geometry: {
                    attributes: { position: { array: arrays[0] } },
                    index: { array: arrays[1] },
                },
                shadow: { map: shadowMap },
            });
        },
    };
    const memory = estimateRendererResources({
        renderer: {
            domElement: { width: 200, height: 100 },
            info: { memory: { textures: 7, geometries: 3 } },
        },
        roots: [scene],
        postPass: { color: postTarget, history: [] },
        lookPass: { target: lookTarget },
        modelTextureBytes: 1000,
        sceneTextureBytes: 2000,
        plateTextureBytes: 3000,
        three: THREE,
    });

    assert.equal(memory.modelTextureBytes, 1000);
    assert.equal(memory.sceneTextureBytes, 2000);
    assert.equal(memory.plateTextureBytes, 3000);
    assert.equal(memory.renderTargetBytes, 70000);
    assert.equal(memory.shadowMapBytes, 4096);
    assert.equal(memory.geometryBytes, 42);
    assert.equal(memory.canvasBytes, 80000);
    assert.equal(memory.estimatedBytes, 160138);
    assert.equal(memory.rendererTextureCount, 7);
    assert.equal(memory.rendererGeometryCount, 3);
});

test('render target collections and geometry attributes are deduplicated', () => {
    const shared = target(20, 10);
    const positions = new Float32Array(12);
    const root = {
        traverse(callback) {
            callback({ geometry: { attributes: { position: { array: positions } } } });
            callback({ geometry: { attributes: { position: { array: positions } } } });
        },
    };
    const memory = estimateRendererResources({
        renderer: {},
        roots: [root],
        postPass: { color: shared, history: [shared] },
        three: THREE,
    });

    assert.equal(memory.renderTargetBytes, 800);
    assert.equal(memory.geometryBytes, positions.byteLength);
});
