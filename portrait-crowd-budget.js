// Private portrait playback still has one full-screen WebGL canvas per actor.
// The shared stage uses the same budget helper for actor cadence, but keeps
// pixel ratio, post targets and shadow maps global so those costs do not scale
// with the number of visible actors.

export function portraitCrowdBudget({ count = 1, focused = true, devicePixelRatio = 1, shared = false } = {}) {
    const safeCount = Math.max(1, Math.round(Number(count) || 1));
    const isFocused = focused !== false || safeCount <= 1;
    const dpr = Math.max(1, Number(devicePixelRatio) || 1);
    // A shared stage has one drawing buffer, one post target pool and one
    // shadow map.  Per-actor crowd budgets would resize those shared objects
    // while actors are composed in sequence and could create multiple shadow
    // maps. Keep one stable global budget instead; updateStride remains a
    // per-actor concern and is handled by the stage loop.
    if (shared) {
        return {
            pixelRatio: Math.min(dpr, 1.75),
            shadowMap: 4096,
            taa: true,
            outline: true,
            drawStride: 1,
            // Keep the focused speaker fluid while allowing background actors
            // to advance on alternate frames. They still draw every frame so
            // their last pose remains present in the shared composition.
            updateStride: safeCount <= 1 || focused !== false ? 1 : 2,
        };
    }
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
