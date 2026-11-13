import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../vendor/three/build/three.module.js';
import { GakumasLookPass } from '../gakumas-look.js';

const lookSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gakumas-look.js'), 'utf8');

function makeRenderer() {
    const calls = [];
    return {
        calls,
        autoClear: true,
        domElement: { clientWidth: 1280, clientHeight: 720, width: 2560, height: 1440 },
        getPixelRatio: () => 2,
        getSize(target) { return target.set(1280, 720); },
        setRenderTarget(target) { calls.push(['target', target]); },
        setViewport(...values) { calls.push(['viewport', ...values]); },
        setScissor(...values) { calls.push(['scissor', ...values]); },
        setScissorTest(value) { calls.push(['scissorTest', value]); },
        render(scene) {
            const uniforms = scene.children[0].material.uniforms;
            calls.push(['render', {
                map: uniforms.gkLookMap.value,
                directPlate: uniforms.gkLookDirectPlate.value,
                hasPlate: uniforms.gkLookHasPlate.value,
                cover: uniforms.gkLookCover.value.toArray(),
            }]);
        },
    };
}

test('LookPass presents a 2D plate through the same grade with its cover transform', () => {
    const renderer = makeRenderer();
    const pass = new GakumasLookPass(renderer);
    const texture = new THREE.Texture({ width: 1920, height: 1080 });
    const cover = { scaleX: 1.25, scaleY: 1.25, offsetX: -0.125, offsetY: -0.125 };

    pass.presentPlate(texture, cover);

    const render = renderer.calls.find(([type]) => type === 'render');
    assert.deepEqual(render[1], {
        map: texture,
        directPlate: 1,
        hasPlate: 0,
        cover: [1.25, 1.25, -0.125, -0.125],
    });
    assert.deepEqual(renderer.calls.filter(([type]) => ['viewport', 'scissor', 'scissorTest'].includes(type)), [
        ['viewport', 0, 0, 1280, 720],
        ['scissor', 0, 0, 1280, 720],
        ['scissorTest', false],
    ]);
    assert.equal(pass.material.uniforms.gkLookMap.value, pass.target.texture);
    assert.equal(pass.material.uniforms.gkLookDirectPlate.value, 0);
    assert.deepEqual(pass.material.uniforms.gkLookCover.value.toArray(), [1, 1, 0, 0]);
    assert.deepEqual(pass.material.uniforms.gkLookTexel.value.toArray(), [1 / 2560, 1 / 1440]);

    texture.dispose();
    pass.dispose();
});

test('plate sharpening uses the ANGLE-safe straight sampler', () => {
    assert.match(lookSource, /vec3 gkSamplePlateStraight\(vec2 uv\)/);
    const sharpen = lookSource.match(/if \(gkLookHasPlate > 0\.5 && gkLookSharpen > 0\.5[\s\S]*?\n    \}/)?.[0] || '';
    assert.equal((sharpen.match(/gkSample\(/g) || []).length, 0);
    assert.equal((sharpen.match(/gkSamplePlateStraight\(/g) || []).length, 4);
});
