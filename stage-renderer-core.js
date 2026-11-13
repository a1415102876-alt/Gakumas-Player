// Restore the default framebuffer's full CSS-pixel viewport after a renderer
// pass has used a smaller intermediate target or scissor rectangle.
export function resetRendererCanvasViewport(renderer, canvas) {
    if (!renderer || !canvas) return;
    const pixelRatio = renderer.getPixelRatio?.() || 1;
    const width = canvas.clientWidth || (canvas.width || 1) / pixelRatio;
    const height = canvas.clientHeight || (canvas.height || 1) / pixelRatio;
    renderer.setViewport(0, 0, width, height);
    renderer.setScissor(0, 0, width, height);
    renderer.setScissorTest(false);
}

// Flat 2D plates are color graded when presented by LookPass. Sending them
// through the stage accumulation/post pass as well makes their appearance
// depend on whether any actors happen to be visible in the frame.
export function shouldAccumulateStageLayers({ hasFlatPlate = false, compatible = false } = {}) {
    return Boolean(compatible) && !hasFlatPlate;
}
