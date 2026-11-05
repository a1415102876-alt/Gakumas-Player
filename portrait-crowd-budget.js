// Each visible idol owns a full-screen WebGL canvas. One portrait can afford
// the solo shadow map and pixel ratio; a group cannot, because those costs
// multiply by the number of canvases. Solo playback stays on the original budget.

export function portraitCrowdBudget({ count = 1, focused = true, devicePixelRatio = 1 } = {}) {
    const safeCount = Math.max(1, Math.round(Number(count) || 1));
    const isFocused = focused !== false || safeCount <= 1;
    const dpr = Math.max(1, Number(devicePixelRatio) || 1);
    if (safeCount <= 1) {
        return { pixelRatio: Math.min(dpr, 1.75), shadowMap: 4096, taa: true, outline: true, drawStride: 1, updateStride: 1 };
    }
    if (safeCount === 2) {
        return {
            pixelRatio: Math.min(dpr, isFocused ? 1.35 : 1.15),
            shadowMap: isFocused ? 2048 : 1024,
            taa: true,
            outline: true,
            drawStride: 1,
            updateStride: 1,
        };
    }
    const updateStride = isFocused ? 1 : (safeCount >= 4 ? 3 : 2);
    return {
        pixelRatio: Math.min(dpr, isFocused ? 1.25 : 1),
        shadowMap: isFocused ? 2048 : (safeCount >= 5 ? 512 : 1024),
        taa: isFocused,
        outline: isFocused || safeCount < 4,
        drawStride: isFocused ? 1 : 2,
        updateStride,
    };
}
