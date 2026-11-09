// Pure helpers for scenes exported by tools/gakumas-scene-export. No Three.js
// import so the math can be tested in Node. Sidecar data is already in glTF
// space (Unity X negated), metres, with the camera/actor poses resolved.
import { calibratedSceneLayoutId } from './scene-placement-overrides.js?v=20261027-calibrated-beat-v1';

export const SCENE_FORMAT = 'gakumas-scene-export';

const ACESCC_MIDGRAY = 0.4135884;

export function validateSceneSidecar(sidecar) {
    const errors = [];
    if (!sidecar || sidecar.format !== SCENE_FORMAT) errors.push('不是学马仕场景导出文件');
    if (!sidecar?.glb) errors.push('缺少场景 GLB');
    if (!Array.isArray(sidecar?.lightmapSettings?.lightmaps)) errors.push('缺少光照贴图信息');
    if (!sidecar?.layouts || !Object.keys(sidecar.layouts).length) errors.push('缺少机位布局');
    return errors;
}

export function srgbToLinear(value) {
    const c = Number(value) || 0;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearColor(color = [1, 1, 1]) {
    return [srgbToLinear(color[0] ?? color.r), srgbToLinear(color[1] ?? color.g), srgbToLinear(color[2] ?? color.b)];
}

function rotateY(angle, [x, y, z]) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [x * c + z * s, y, -x * s + z * c];
}

// Root transform that puts a layout actor at the stage origin facing +Z,
// where the stage camera and character already live.
export function sceneRootTransform(actor, scale = 1) {
    const forward = actor?.forward || [0, 0, 1];
    const rotationY = -Math.atan2(forward[0], forward[2]);
    const rotated = rotateY(rotationY, actor?.position || [0, 0, 0]);
    return { rotationY, scale, position: rotated.map(value => -value * scale) };
}

export function applyRootTransform(root, point) {
    const rotated = rotateY(root.rotationY, point);
    return rotated.map((value, index) => value * root.scale + root.position[index]);
}

export function applyRootRotation(root, direction) {
    return rotateY(root.rotationY, direction);
}

export function pickLayoutActor(layout) {
    return layout?.actors?.[0] || null;
}

// The stage opens these scenes on their generic layout. Coarse activity boxes
// cover that station, and the dance room also replaced the generic camera.
export function beatUsesStageDefaultPlacement(sceneId) {
    const id = String(sceneId || '');
    return /^env_3d_adv_danceroom-00-00(?:-|$)/.test(id)
        || /^env_3d_adv_classroom-00-\d\d(?:-|$)/.test(id);
}

export function resolveBeatSceneCameraOptions(sceneId, shot, options = {}) {
    // Keep the user-calibrated actor/camera pair together, bypassing coarse
    // activity bounds and the previous extra one-metre camera retreat.
    const layout = calibratedSceneLayoutId(sceneId);
    if (!layout || options.layout) return options;
    return { ...options, layout, backoffMeters: 0 };
}

export function retreatCameraView(view, metres = 0, scale = 1) {
    const distance = Number(metres) * Number(scale);
    if (!view || !Number.isFinite(distance) || distance <= 0) return view;
    const direction = view.position.map((value, index) => value - view.target[index]);
    const length = Math.hypot(...direction);
    if (length < 1e-9) return view;
    return { ...view, position: view.position.map((value, index) => value + direction[index] / length * distance) };
}

// The game camera keeps its exact direction; the orbit target is the point on
// its view ray closest to the actor so OrbitControls does not re-aim it.
export function layoutCameraView(layout, root, minDistance = 1, modelFrame = null) {
    const camera = layout?.camera;
    if (!camera) return null;
    if (layout.genericShot) {
        const rule = layout.genericShot;
        const height = Number(modelFrame?.height) > 0 ? Number(modelFrame.height) : Number(rule.referenceHeight) || 1.6;
        const footY = Number(modelFrame?.footY) || 0;
        const top = height * rule.topRatio;
        const bottom = height * rule.bottomRatio;
        const fov = Number(camera.fov);
        const distance = (top - bottom) / (2 * Math.tan(fov * Math.PI / 360));
        const focus = applyRootTransform(root, pickLayoutActor(layout)?.position || [0, 0, 0]);
        const target = [focus[0], focus[1] + (footY + (top + bottom) / 2) * root.scale, focus[2]];
        return {
            position: [target[0], target[1], target[2] + distance * root.scale],
            target,
            up: [0, 1, 0],
            fov,
            near: Number(camera.near) * root.scale || null,
            far: Number(camera.far) * root.scale || null,
        };
    }
    const position = applyRootTransform(root, camera.position);
    const forward = applyRootRotation(root, camera.forward);
    const actor = pickLayoutActor(layout);
    const focus = actor ? applyRootTransform(root, actor.position) : [0, 0, 0];
    const along = (focus[0] - position[0]) * forward[0] + (focus[1] - position[1]) * forward[1] + (focus[2] - position[2]) * forward[2];
    const distance = Math.max(along, minDistance);
    return {
        position,
        target: camera.target ? applyRootTransform(root, camera.target) : position.map((value, index) => value + forward[index] * distance),
        up: applyRootRotation(root, camera.up || [0, 1, 0]),
        fov: Number(camera.fov) || null,
        near: Number(camera.near) * root.scale || null,
        far: Number(camera.far) * root.scale || null,
    };
}

function invertAffine(m) {
    // Column-major 4x4 with no projection row.
    const a = m[0], b = m[4], c = m[8];
    const d = m[1], e = m[5], f = m[9];
    const g = m[2], h = m[6], i = m[10];
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) return null;
    const inv = [
        (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
        (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
        (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
    ];
    const t = [m[12], m[13], m[14]];
    return point => {
        const p = [point[0] - t[0], point[1] - t[1], point[2] - t[2]];
        return [
            inv[0] * p[0] + inv[1] * p[1] + inv[2] * p[2],
            inv[3] * p[0] + inv[4] * p[1] + inv[5] * p[2],
            inv[6] * p[0] + inv[7] * p[1] + inv[8] * p[2],
        ];
    };
}

export function volumeContains(volume, point) {
    if (volume.global) return true;
    const toLocal = volume.matrix ? invertAffine(volume.matrix) : null;
    if (!toLocal || !volume.colliders?.length) return false;
    const local = toLocal(point);
    return volume.colliders.some(({ center, size }) => [0, 1, 2].every(axis => Math.abs(local[axis] - center[axis]) <= Math.abs(size[axis]) / 2 + 1e-6));
}

function lerpValue(from, to, t) {
    if (typeof to === 'number' && typeof from === 'number') return from + (to - from) * t;
    if (to && typeof to === 'object' && !Array.isArray(to) && from && typeof from === 'object') {
        const result = { ...to };
        for (const key of Object.keys(to)) {
            if (typeof to[key] === 'number' && typeof from[key] === 'number') result[key] = from[key] + (to[key] - from[key]) * t;
        }
        return result;
    }
    return t >= 1 ? to : from;
}

// URP-style volume stack at a scene-space point: defaults, then every enabled
// volume containing the point in ascending priority, lerped by weight.
// Radical inverse used by URP TemporalAA. Index 0 is skipped by the caller.
export function haltonSequence(index, base) {
    let result = 0;
    let fraction = 1 / base;
    let current = index;
    while (current > 0) {
        result += (current % base) * fraction;
        current = Math.floor(current / base);
        fraction /= base;
    }
    return result;
}

export function resolveVolumeStack(volumes = [], point = [0, 0, 0]) {
    const stack = {};
    for (const volume of volumes) {
        for (const [name, fields] of Object.entries(volume.profile?.components || {})) {
            stack[name] ||= {};
            for (const [field, entry] of Object.entries(fields)) {
                if (entry && typeof entry === 'object' && 'override' in entry && !(field in stack[name])) stack[name][field] = entry.value;
            }
        }
    }
    const active = volumes
        .map((volume, index) => ({ volume, index }))
        .filter(({ volume }) => volume.enabled !== false && (volume.weight ?? 1) > 0 && volumeContains(volume, point))
        .sort((a, b) => (a.volume.priority - b.volume.priority) || (a.index - b.index));
    const activeComponents = {};
    for (const { volume } of active) {
        const weight = Math.max(0, Math.min(1, volume.weight ?? 1));
        for (const [name, fields] of Object.entries(volume.profile?.components || {})) {
            if (fields.active === 0 || fields.active === false) continue;
            activeComponents[name] = true;
            for (const [field, entry] of Object.entries(fields)) {
                if (!entry || typeof entry !== 'object' || !entry.override) continue;
                stack[name][field] = lerpValue(stack[name][field], entry.value, weight);
            }
        }
    }
    return { stack, volumes: active.map(({ volume }) => volume.path), activeComponents };
}

function flare(entry = {}) {
    const center = entry.center || {};
    const size = entry.size || {};
    return {
        center: [Number(center.x) || 0, Number(center.y) || 0],
        size: [Math.abs(Number(size.x) || 0), Math.abs(Number(size.y) || 0)],
        color0: linearColor(colorArray(entry.color0, [0, 0, 0])),
        color1: linearColor(colorArray(entry.color1, [0, 0, 0])),
    };
}

// Screen-space post modules taken from the volume stack. Grading and fog stay
// in the scene shader; this is only what a fullscreen pass can add.
export function scenePost(stack = {}, active = {}) {
    const on = name => !!active[name];
    const bloom = stack.VLBloom || {};
    const diffusion = stack.VLDiffusion || {};
    const paraffin = stack.VLParaffin || {};
    const chroma = stack.ChromaticAberration || {};
    const vignette = stack.Vignette || {};
    const center = vignette.center || {};
    return {
        bloom: {
            enabled: on('VLBloom'),
            intensity: Number(bloom.intensity) || 0,
            threshold: Number.isFinite(bloom.threshold) ? bloom.threshold : 1,
            diffusion: Number(bloom.diffusion) || 0,
            color: linearColor(colorArray(bloom.color)),
        },
        diffusion: {
            enabled: on('VLDiffusion'),
            diffusion: Number(diffusion.diffusion) || 0,
            contrastThreshold: Number.isFinite(diffusion.contrastThreshold) ? diffusion.contrastThreshold : 0.5,
            contrastPower: Number.isFinite(diffusion.contrastPower) ? diffusion.contrastPower : 1,
            blend: Number(diffusion.blend) || 0,
        },
        paraffin: {
            enabled: on('VLParaffin'),
            flares: [flare(paraffin.flare0), flare(paraffin.flare1)],
        },
        chromatic: {
            enabled: on('ChromaticAberration'),
            intensity: Number(chroma.intensity) || 0,
        },
        vignette: {
            enabled: on('Vignette'),
            color: linearColor(colorArray(vignette.color, [0, 0, 0])),
            center: [Number.isFinite(center.x) ? center.x : 0.5, Number.isFinite(center.y) ? center.y : 0.5],
            intensity: Number(vignette.intensity) || 0,
            smoothness: Number.isFinite(vignette.smoothness) ? vignette.smoothness : 0.2,
        },
    };
}

function colorArray(value, fallback = [1, 1, 1]) {
    if (!value) return fallback;
    return [value.r ?? value[0] ?? fallback[0], value.g ?? value[1] ?? fallback[1], value.b ?? value[2] ?? fallback[2]];
}

// Scene-only grading taken from the resolved volume stack. Actors keep the
// stage look; the scene shader applies this so lightmap HDR does not clip.
export function sceneGrade(stack = {}) {
    const adjust = stack.ColorAdjustments || {};
    const tone = stack.VLTonemapping || {};
    const lightmap = stack.VLLightmapVolume || {};
    const lightmapColor = linearColor(colorArray(lightmap.color));
    const lightmapIntensity = Number.isFinite(lightmap.intensity) ? lightmap.intensity : 1;
    const smh = stack.ShadowsMidtonesHighlights || {};
    return {
        shadows: smhTint(smh.shadows),
        midtones: smhTint(smh.midtones),
        highlights: smhTint(smh.highlights),
        smhLimits: [smh.shadowsStart ?? 0, smh.shadowsEnd ?? 0.3, smh.highlightsStart ?? 0.55, smh.highlightsEnd ?? 1],
        exposure: 2 ** (Number(adjust.postExposure) || 0),
        contrast: 1 + (Number(adjust.contrast) || 0) / 100,
        saturation: 1 + (Number(adjust.saturation) || 0) / 100,
        colorFilter: linearColor(colorArray(adjust.colorFilter)),
        tone: {
            enabled: Number(tone.mode) === 5,
            linearStart: Number.isFinite(tone.gtLinearSectionStart) ? tone.gtLinearSectionStart : 0.22,
            linearLength: Number.isFinite(tone.gtLinearSelectionLength) ? tone.gtLinearSelectionLength : 0.4,
            contrast: Number.isFinite(tone.gtContrast) ? tone.gtContrast : 1,
            black: Number.isFinite(tone.gtBlackBrightness) ? tone.gtBlackBrightness : 1.33,
        },
        lightmapTint: lightmapColor.map(value => value * lightmapIntensity),
    };
}

// Character lighting written by the scene volume, not by the stage sliders.
// VLActorParameter is the runtime block: mainLightSpace 0 keeps the key in
// MatCap space, and its xy angles are azimuth then elevation. Additional
// lights use the same realtime scene lights as the background, scaled by
// additiveLightScale. Eye highlight and eye reflection are separate tints.
export function sceneActorLight(stack = {}) {
    const actor = stack.VLActorParameter || {};
    const campus = stack.CampusLitActor || {};
    const angle = actor.mainLightAngle || campus.mainLightAngle || null;
    const colorSource = actor.lightColor || campus.lightColor || null;
    const shadeApply = actor.shadeApplyRatio ?? campus.shadeApplyRatio;
    const rimAngle = actor.rimAngle ?? campus.rimAngle;
    const rimColor = actor.rimColor ?? campus.rimColor;
    const shadeMultiply = actor.shadeColorMultiply ?? campus.shadeColorMultiply;
    const optionalNumber = value => value != null && Number.isFinite(Number(value)) ? Number(value) : null;
    return {
        hasMainLight: Boolean(angle || colorSource),
        mainLightSpace: Number(actor.mainLightSpace ?? campus.mainLightSpace) || 0,
        azimuth: Number(angle?.x) || 0,
        elevation: Number(angle?.y) || 0,
        color: linearColor(colorArray(colorSource)),
        additiveScale: Number(actor.additiveLightScale) || 0,
        additiveSpecularScale: Number.isFinite(Number(actor.additiveLightSpecularScale)) ? Number(actor.additiveLightSpecularScale) : 1,
        shadeApply: Number.isFinite(Number(shadeApply)) ? Number(shadeApply) : 1,
        matCapOffset: optionalNumber(actor.matCapOffset ?? campus.matCapOffset),
        shadeMultiply: shadeMultiply ? linearColor(colorArray(shadeMultiply)) : null,
        rimAngle: rimAngle ? [Number(rimAngle.x ?? rimAngle[0]) || 0, Number(rimAngle.y ?? rimAngle[1]) || 0] : null,
        rimColor: rimColor ? linearColor(colorArray(rimColor)) : null,
        rimPower: optionalNumber(actor.rimPower ?? campus.rimPower),
        rimBaseColorRatio: optionalNumber(actor.rimBaseColorRatio ?? campus.rimBaseColorRatio),
        eyeHighlightColor: linearColor(colorArray(actor.eyeHighlightColor)),
        eyeReflectionColor: linearColor(colorArray(actor.eyeReflectionColor)),
        giScale: Number(actor.giScale ?? campus.giScale) || 0,
    };
}

// VL SphereFog from the volume stack. Volume parameters are raw Unity values,
// so the centre still needs the X flip into glTF space.
export function sceneSphereFog(stack = {}) {
    const fog = stack.SphereFog || {};
    const density = Number(fog.density) || 0;
    const radius = Number(fog.radius) || 0;
    const position = fog.position || {};
    return {
        enabled: density > 0 && radius > 0,
        center: [-(Number(position.x) || 0), Number(position.y) || 0, Number(position.z) || 0],
        radius,
        density,
        maxAmount: Number.isFinite(fog.maxAmount) ? fog.maxAmount : 1,
        color: linearColor(colorArray(fog.color)),
    };
}

const HOT_SPRING_SCENE_ID = 'env_3d_adv_hotspring-00-00-noon';
const HOT_SPRING_DEFAULT_EFFECTS = Object.freeze({
    kind: 'hot-spring',
    water: {
        center: [-2.8, -0.08, -2.4],
        size: [7.2, 5.4],
        y: 0,
        color: [0.12, 0.68, 0.72],
        opacity: 0.56,
        wave: { amplitude: 0.018, speed: 0.08, scale: 0.72 },
    },
    steam: [],
    fogOverride: { density: 0.18, maxAmount: 0.12 },
});

function finiteNonNegative(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function vector(value, fallback, length) {
    if (!Array.isArray(value) || value.length < length) return [...fallback];
    return fallback.map((fallbackValue, index) => {
        const number = Number(value[index]);
        return Number.isFinite(number) ? number : fallbackValue;
    });
}

// Scene-local effects are opt-in through both the known scene id and the
// sidecar kind. This prevents a malformed or copied effects block from
// changing unrelated scene renders.
export function sceneEffectProfile(sceneId, sidecarEffects = {}) {
    if (sceneId !== HOT_SPRING_SCENE_ID) return null;
    if (sidecarEffects?.kind && sidecarEffects.kind !== HOT_SPRING_DEFAULT_EFFECTS.kind) return null;
    const source = sidecarEffects?.kind === HOT_SPRING_DEFAULT_EFFECTS.kind ? sidecarEffects : {};
    const defaults = HOT_SPRING_DEFAULT_EFFECTS;
    const waterSource = source.water || {};
    const waveSource = waterSource.wave || {};
    const water = {
        ...defaults.water,
        ...waterSource,
        center: vector(waterSource.center, defaults.water.center, 3),
        size: vector(waterSource.size, defaults.water.size, 2),
        y: Number.isFinite(Number(waterSource.y)) ? Number(waterSource.y) : defaults.water.y,
        color: vector(waterSource.color, defaults.water.color, 3),
        opacity: Math.min(0.9, finiteNonNegative(waterSource.opacity, defaults.water.opacity)),
        wave: {
            ...defaults.water.wave,
            ...waveSource,
            amplitude: finiteNonNegative(waveSource.amplitude, defaults.water.wave.amplitude),
            speed: finiteNonNegative(waveSource.speed, defaults.water.wave.speed),
            scale: Math.max(0.05, finiteNonNegative(waveSource.scale, defaults.water.wave.scale)),
        },
    };
    const steam = (Array.isArray(source.steam) ? source.steam : defaults.steam).slice(0, 3).map(patch => ({
        position: vector(patch?.position, [0, water.y + 0.15, 0], 3),
        size: vector(patch?.size, [1.6, 1.1], 2),
        opacity: Math.min(0.35, finiteNonNegative(patch?.opacity, 0.1)),
        drift: vector(patch?.drift, [0.03, 0.02], 2),
    }));
    const fogSource = source.fogOverride || {};
    return {
        kind: defaults.kind,
        water,
        steam,
        fogOverride: {
            density: finiteNonNegative(fogSource.density, defaults.fogOverride.density),
            maxAmount: Math.min(1, finiteNonNegative(fogSource.maxAmount, defaults.fogOverride.maxAmount)),
        },
    };
}

export function sceneFogWithOverride(fog, override = null) {
    if (!fog || !override) return fog;
    const density = finiteNonNegative(override.density, fog.density);
    const maxAmount = Math.min(1, finiteNonNegative(override.maxAmount, fog.maxAmount));
    return { ...fog, density, maxAmount };
}

// ColorUtils.PrepareShadowsMidtonesHighlights: gamma colour to linear plus the
// w offset (x4 when positive).
export function smhTint(value) {
    const v = value || { x: 1, y: 1, z: 1, w: 0 };
    const w = Number(v.w) || 0;
    const weight = w * (w < 0 ? 1 : 4);
    return [v.x, v.y, v.z].map(channel => Math.max(srgbToLinear(channel ?? 1) + weight, 0));
}

// Uchimura "GT" curve, mirrored by the GLSL in gakumas-scene.js.
export function gtTonemap(x, { linearStart: m = 0.22, linearLength: l = 0.4, contrast: a = 1, black: c = 1.33, pedestal: b = 0, max: P = 1 } = {}) {
    const l0 = ((P - m) * l) / a;
    const S0 = m + l0;
    const S1 = m + a * l0;
    const C2 = (a * P) / (P - S1);
    const CP = -C2 / P;
    const t = Math.max(0, Math.min(1, x / m));
    const w0 = 1 - t * t * (3 - 2 * t);
    const w2 = x >= S0 ? 1 : 0;
    const w1 = 1 - w0 - w2;
    const T = m * (Math.max(x, 0) / m) ** c + b;
    const S = P - (P - S1) * Math.exp(CP * (x - S0));
    const L = m + a * (x - m);
    return T * w0 + L * w1 + S * w2;
}

// Unity SphericalHarmonicsL2 (channel-major) into nine RGB coefficients.
export function shCoefficients(sh27) {
    const values = Array.from(sh27 || [], Number);
    if (values.length !== 27) return null;
    return Array.from({ length: 9 }, (_, i) => [values[i], values[9 + i], values[18 + i]]);
}

// Unity ShadeSH9 with the coefficients Unity stores for probes (already
// convolved and normalised): SHA, SHB, SHC built the way Unity uploads them.
export function shadeSH9(sh27, normal) {
    const c = shCoefficients(sh27);
    if (!c) return [0, 0, 0];
    const [x, y, z] = normal;
    return [0, 1, 2].map(ch => Math.max(0,
        c[0][ch] - c[6][ch]
        + c[3][ch] * x + c[1][ch] * y + c[2][ch] * z
        + c[4][ch] * x * y + c[5][ch] * y * z + c[6][ch] * 3 * z * z + c[7][ch] * z * x
        + c[8][ch] * (x * x - y * y)));
}

export function rgbmDecode([r, g, b, a], range) {
    return [r * a * range, g * a * range, b * a * range];
}

// URP decal UVs for a unit quad vertex (glTF-local x, y in -0.5..0.5). The
// mirrored local X is flipped back to Unity, and V is flipped for top-down images.
export function decalUv(x, y, uvScale = [1, 1], uvBias = [0, 0]) {
    const u = (-x + 0.5) * uvScale[0] + uvBias[0];
    const v = (y + 0.5) * uvScale[1] + uvBias[1];
    return [u, 1 - v];
}

// Panoramic sky lookup for a glTF-space direction (top-down equirect image).
export function panoramaUv(direction, rotationDegrees = 0) {
    const length = Math.hypot(...direction) || 1;
    const [ux, uy, uz] = [-direction[0] / length, direction[1] / length, direction[2] / length];
    const angle = (rotationDegrees * Math.PI) / 180;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rx = c * ux + s * uz;
    const rz = -s * ux + c * uz;
    return [0.5 - Math.atan2(rz, rx) / (2 * Math.PI), Math.acos(Math.max(-1, Math.min(1, uy))) / Math.PI];
}

export const SCENE_LIGHT_TYPES = { directional: 0, point: 1, spot: 2 };

// URP light constants: distance attenuation uses 1/range^2, the spot cone is
// saturate(dot * a + b)^2 with a/b from the inner and outer cosines.
// The window below replaces that photometric curve. Inverse-square on these
// intensities (about 20–50 at one metre) falls off inside the first metre,
// even when the exported range is 2.7–4 m. Hold the light until 35% of the
// range, then smooth it to zero at the range.
export function punctualWindow(distance, range) {
    const radius = Number(range);
    if (!(radius > 0)) return 0;
    const t = Math.min(1, Math.max(0, Number(distance) / radius));
    const x = Math.min(1, Math.max(0, (t - 0.35) / 0.65));
    const smooth = x * x * (3 - 2 * x);
    return 1 - smooth;
}
export function spotAttenuation(spotAngle, innerSpotAngle) {
    const cosOuter = Math.cos((spotAngle * Math.PI) / 360);
    const cosInner = Math.max(Math.cos(((innerSpotAngle || 0) * Math.PI) / 360), cosOuter + 1e-4);
    const scale = 1 / Math.max(cosInner - cosOuter, 1e-4);
    return [scale, -cosOuter * scale];
}

// Realtime contribution of the scene lights. Fully baked lights already live
// in the lightmap; mixed lights in shadowmask mode add direct light gated by
// their shadowmask channel.
export function sceneLightData(lights = [], maxLights = 12) {
    const entries = lights
        .filter(light => light.enabled && light.bakeType !== 'baked' && light.type in SCENE_LIGHT_TYPES && light.intensity > 0)
        .slice(0, maxLights)
        .map(light => {
            const color = light.colorLinear || linearColor(light.color);
            const [spotScale, spotOffset] = light.type === 'spot' ? spotAttenuation(light.spotAngle, light.innerSpotAngle) : [0, 1];
            const range = Math.max(light.range || 10, 1e-3);
            const shadowed = light.bakeType === 'mixed' && light.mixedLightingMode !== 'indirectOnly';
            return {
                path: light.path,
                position: [...light.position, SCENE_LIGHT_TYPES[light.type]],
                direction: light.forward || [0, -1, 0],
                specular: Number.isFinite(light.specularStrength) ? light.specularStrength : 1,
                color: color.slice(0, 3).map(value => value * light.intensity),
                params: [1 / (range * range), spotScale, spotOffset, shadowed ? light.shadowMaskChannel ?? -1 : -1],
            };
        });
    return { count: entries.length, entries };
}

function boxOf(probe) {
    const center = probe.position.map((value, index) => value + (probe.boxOffset?.[index] || 0));
    const half = probe.boxSize.map(value => Math.abs(value) / 2);
    return { min: center.map((value, index) => value - half[index]), max: center.map((value, index) => value + half[index]) };
}

export function reflectionProbeBox(probe) {
    return boxOf(probe);
}

// Dynamic actors have no lightmap UVs. Unity shades them from the light-probe
// grid: inverse-distance blend of the nearest probes supplies SH and the
// shadowmask occlusion that static meshes read from the mask texture.
export function sampleLightField(field, point = [0, 0, 0], nearest = 4) {
    const positions = field?.positions;
    if (!Array.isArray(positions) || !positions.length || !Array.isArray(point)) return null;
    const ranked = [];
    for (let index = 0; index < positions.length; index += 1) {
        const probe = positions[index];
        if (!Array.isArray(probe) || probe.length < 3) continue;
        const dx = probe[0] - point[0];
        const dy = probe[1] - point[1];
        const dz = probe[2] - point[2];
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (ranked.length < nearest) {
            ranked.push({ index, distanceSquared });
            if (ranked.length === nearest) ranked.sort((a, b) => a.distanceSquared - b.distanceSquared);
        } else if (distanceSquared < ranked[nearest - 1].distanceSquared) {
            ranked[nearest - 1] = { index, distanceSquared };
            ranked.sort((a, b) => a.distanceSquared - b.distanceSquared);
        }
    }
    if (!ranked.length) return null;
    if (ranked.length < nearest) ranked.sort((a, b) => a.distanceSquared - b.distanceSquared);
    if (ranked[0].distanceSquared < 1e-8) return lightProbeAt(field, ranked[0].index);
    let weightSum = 0;
    const weights = ranked.map(item => {
        const weight = 1 / (item.distanceSquared + 1e-4);
        weightSum += weight;
        return weight;
    });
    const sh = Array.from({ length: 9 }, () => [0, 0, 0]);
    const occlusion = [0, 0, 0, 0];
    let shWeight = 0;
    ranked.forEach((item, rank) => {
        const weight = weights[rank] / weightSum;
        const coefficients = shCoefficients(field.coefficients?.[item.index]);
        if (coefficients) {
            shWeight += weight;
            coefficients.forEach((rgb, band) => {
                rgb.forEach((value, channel) => {
                    sh[band][channel] += value * weight;
                });
            });
        }
        const sample = probeOcclusion(field.occlusion?.[item.index]);
        sample.forEach((value, channel) => {
            occlusion[channel] += value * weight;
        });
    });
    if (shWeight > 0 && shWeight < 0.999) {
        const scale = 1 / shWeight;
        sh.forEach(rgb => {
            rgb[0] *= scale;
            rgb[1] *= scale;
            rgb[2] *= scale;
        });
    }
    return { sh: shWeight > 0 ? sh : null, occlusion };
}

function probeOcclusion(value) {
    return [0, 1, 2, 3].map(channel => {
        const sample = Array.isArray(value) ? Number(value[channel]) : 1;
        return Number.isFinite(sample) ? sample : 1;
    });
}

function lightProbeAt(field, index) {
    return { sh: shCoefficients(field.coefficients?.[index]), occlusion: probeOcclusion(field.occlusion?.[index]) };
}

// The toon key follows the mixed directional's shadowmask channel. Spot
// channels stay on their own additional lights so a local lamp does not
// darken the whole character.
export function actorShadowChannel(entries = []) {
    const directional = entries.find(entry => entry.position?.[3] === 0 && Number(entry.params?.[3]) >= 0);
    return directional ? Number(directional.params[3]) : -1;
}

export function actorEnvironmentSample(stage, point) {
    if (!stage?.sidecar || !Array.isArray(point)) return null;
    const field = sampleLightField(stage.sidecar.lightProbes, point);
    const sh = field?.sh || shCoefficients(stage.sidecar.environment?.ambientProbe);
    return {
        sh: sh || null,
        occlusion: field?.occlusion || [1, 1, 1, 1],
        shadowChannel: actorShadowChannel(stage.sceneLightEntries),
        probeIndex: selectReflectionProbe(stage.sidecar.reflectionProbes || [], point),
        giScale: Number(stage.actorLight?.giScale) || 0,
        tint: stage.grade?.lightmapTint || [1, 1, 1],
    };
}

// Unity picks probes per renderer from its bounds; one probe per mesh is
// enough here: the highest-importance, smallest box containing the centre,
// else the box nearest to it.
export function selectReflectionProbe(probes = [], point = [0, 0, 0]) {
    let best = -1;
    let bestKey = null;
    probes.forEach((probe, index) => {
        if (!probe.atlas) return;
        const { min, max } = boxOf(probe);
        const outside = Math.hypot(...point.map((value, axis) => Math.max(min[axis] - value, 0, value - max[axis])));
        const volume = probe.boxSize.reduce((product, value) => product * Math.abs(value), 1);
        const key = [outside, -(probe.importance ?? 1), volume];
        if (!bestKey || compareKeys(key, bestKey) < 0) {
            best = index;
            bestKey = key;
        }
    });
    return best;
}

function compareKeys(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

// Unity specular cube mips: mip = perceptualRoughness * (1.7 - 0.7 * pr) * 6.
export function reflectionMip(perceptualRoughness) {
    const r = Math.max(0, Math.min(1, perceptualRoughness));
    return r * (1.7 - 0.7 * r) * 6;
}

// Equirect lookup used by the Unity atlas dump (u from +X towards +Z, v = 0 up),
// for a glTF-space direction.
export function probeAtlasUv(direction) {
    const length = Math.hypot(...direction) || 1;
    const [x, y, z] = [-direction[0] / length, direction[1] / length, direction[2] / length];
    let u = Math.atan2(z, x) / (2 * Math.PI);
    if (u < 0) u += 1;
    return [u, Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI];
}

export function sceneLayoutOptions(sidecar) {
    const labels = { overview: '预览总览', 'home-commu': '交流', 'home-home': '主页', 'home-idol': '偶像', 'home-contest': '竞赛', loginbonus: '登录奖励' };
    return Object.entries(sidecar?.layouts || {}).map(([id, layout]) => ({
        id,
        label: layout.label ? `${layout.label}（${id}）` : labels[id] ? `${labels[id]}（${id}）` : id,
    }));
}
