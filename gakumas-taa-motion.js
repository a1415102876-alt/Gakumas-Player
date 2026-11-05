const TAA_MOTION_MIN = 0;
const TAA_MOTION_MAX = 1;

export function clampTaaMotion(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return TAA_MOTION_MIN;
    return Math.min(TAA_MOTION_MAX, Math.max(TAA_MOTION_MIN, numeric));
}

export function mergeTaaMotion(cameraMotion = 0, objectMotion = 0) {
    return Math.max(clampTaaMotion(cameraMotion), clampTaaMotion(objectMotion));
}

export function decayTaaMotion(value = 0, factor = 0.72) {
    return clampTaaMotion(value) * clampTaaMotion(factor);
}

export function motionFromPositions(current = [], previous = [], scale = 1) {
    if (!Array.isArray(current) || !Array.isArray(previous) || current.length === 0 || current.length !== previous.length) return 0;
    const multiplier = Number(scale);
    if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
    let distance = 0;
    for (let index = 0; index < current.length; index += 1) {
        const a = current[index];
        const b = previous[index];
        if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return 0;
        const values = [a[0], a[1], a[2], b[0], b[1], b[2]].map(Number);
        if (values.some(value => !Number.isFinite(value))) return 0;
        distance += Math.hypot(values[0] - values[3], values[1] - values[4], values[2] - values[5]);
    }
    return clampTaaMotion((distance / current.length) * multiplier);
}

export const TAA_COLOR_SAMPLES = 4;

// High-contrast outline pixels used to discard the whole history sample.
// With a velocity buffer the clip only has to soften those edges.
export const TAA_CLIP = {
    portrait: [0.02, 0.10],
    scene: [0.04, 0.18],
    velocityPortrait: [0.04, 0.22],
    velocityScene: [0.08, 0.40],
    cap: 0.55,
};

function smoothstep(edge0, edge1, value) {
    const span = edge1 - edge0;
    if (!Number.isFinite(span) || span === 0) return value >= edge1 ? 1 : 0;
    const t = Math.min(1, Math.max(0, (value - edge0) / span));
    return t * t * (3 - 2 * t);
}

export function catmullRomWeight(distance) {
    const ax = Math.abs(Number(distance));
    if (!Number.isFinite(ax) || ax > 2) return 0;
    if (ax > 1) return ((-0.5 * ax + 2.5) * ax - 4) * ax + 2;
    return (1.5 * ax - 2.5) * ax * ax + 1;
}

export function historyClipReject(clipDistance, { velocity = false, portrait = false } = {}) {
    const distance = Number(clipDistance);
    if (!Number.isFinite(distance)) return 0;
    const edges = portrait
        ? (velocity ? TAA_CLIP.velocityPortrait : TAA_CLIP.portrait)
        : (velocity ? TAA_CLIP.velocityScene : TAA_CLIP.scene);
    const span = smoothstep(edges[0], edges[1], distance);
    return velocity ? Math.min(span, TAA_CLIP.cap) : span;
}
