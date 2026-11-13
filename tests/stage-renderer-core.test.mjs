import test from 'node:test';
import assert from 'node:assert/strict';
import { resetRendererCanvasViewport, shouldAccumulateStageLayers } from '../stage-renderer-core.js';

function makeRenderer(pixelRatio = 1) {
    const calls = [];
    return {
        calls,
        getPixelRatio: () => pixelRatio,
        setViewport: (...args) => calls.push(['viewport', ...args]),
        setScissor: (...args) => calls.push(['scissor', ...args]),
        setScissorTest: value => calls.push(['scissorTest', value]),
    };
}

test('renderer viewport reset restores the whole logical canvas and disables stale scissor', () => {
    const renderer = makeRenderer(2);
    const canvas = { clientWidth: 1280, clientHeight: 720, width: 2560, height: 1440 };

    resetRendererCanvasViewport(renderer, canvas);

    assert.deepEqual(renderer.calls, [
        ['viewport', 0, 0, 1280, 720],
        ['scissor', 0, 0, 1280, 720],
        ['scissorTest', false],
    ]);
});

test('renderer viewport reset derives logical dimensions from the drawing buffer when CSS size is unavailable', () => {
    const renderer = makeRenderer(2);
    const canvas = { clientWidth: 0, clientHeight: 0, width: 1920, height: 1080 };

    resetRendererCanvasViewport(renderer, canvas);

    assert.deepEqual(renderer.calls, [
        ['viewport', 0, 0, 960, 540],
        ['scissor', 0, 0, 960, 540],
        ['scissorTest', false],
    ]);
});

test('2D plate composition stays on the same direct path with or without actors', () => {
    assert.equal(shouldAccumulateStageLayers({ hasFlatPlate: true, compatible: true }), false);
    assert.equal(shouldAccumulateStageLayers({ hasFlatPlate: true, compatible: false }), false);
});

test('3D/background accumulation remains available when no 2D plate is present', () => {
    assert.equal(shouldAccumulateStageLayers({ hasFlatPlate: false, compatible: true }), true);
    assert.equal(shouldAccumulateStageLayers({ hasFlatPlate: false, compatible: false }), false);
});
