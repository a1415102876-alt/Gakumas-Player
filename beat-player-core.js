import { BEAT_CUE_IDS, BEAT_EFFECT_IDS, BEAT_FACE_IDS, BEAT_OVERLAY_CUE_IDS } from './beat-cues.js?v=20261011-stage-cue-rules-v4';
import { BEAT_NPC_SPEAKER_NAMES } from './beat-npc-portraits.js?v=20261110-hkne-3d-v1';
import { sceneIdolId } from './scene-protocol.js?v=20261111-hkne-motions-v1';

export const BEAT_ACTOR_NAMES = Object.freeze({
    kotone: '藤田琴音',
    mao: '有村麻央',
    rinami: '姬崎莉波',
    hski: '花海咲季',
    hume: '花海佑芽',
    ssmk: '紫云清夏',
    kllj: '葛城莉莉娅',
    jsna: '十王星南',
    hmsz: '秦谷美铃',
    atbm: '雨夜燕',
    ttmr: '月村手毬',
    kcna: '仓本千奈',
    shro: '筱泽广',
    krnh: '贺阳燐羽',
    hkne: '冰渡香名江',
    氷渡香名江: '冰渡香名江',
    香名江: '冰渡香名江',
    燐羽: '贺阳燐羽',
    小燐: '贺阳燐羽',
    賀陽燐羽: '贺阳燐羽',
    amao: '有村麻央',
    fktn: '藤田琴音',
    hrnm: '姬崎莉波',
    nasr: '亚纱里老师',
    asari: '亚纱里老师',
});

// Non-idol speakers are rendered as dialogue labels only. They do not create
// a SceneDirector actor or consume a model slot.
export const BEAT_SPEAKER_NAMES = Object.freeze({
    ...BEAT_ACTOR_NAMES,
    ...BEAT_NPC_SPEAKER_NAMES,
    producer: '制作人',
    narrator: '旁白',
});

export function beatActorId(speaker) {
    const name = String(speaker || '').trim();
    return sceneIdolId(BEAT_ACTOR_NAMES[name] || name);
}

// Derive the camera from script order instead of playback history, so seeking
// to an offscreen speaker holds the same idol and framing as sequential play.
export function resolveBeatShot(beats, index) {
    const source = Array.isArray(beats) ? beats : [];
    if (!source.length) return { focus: '', shot: 'medium', inherited: false };
    const requested = Number(index);
    const currentIndex = Math.min(Math.max(Number.isFinite(requested) ? requested : 0, 0), source.length - 1);
    let focus = '';
    let focusIndex = -1;
    for (let i = currentIndex; i >= 0; i--) {
        const actor = beatActorId(source[i]?.speaker);
        if (!actor) continue;
        focus = actor;
        focusIndex = i;
        break;
    }
    // A producer or narrator line keeps the last idol in frame, but its own
    // shot still decides the framing. The parser has already copied an omitted
    // shot forward, so this reads the beat itself.
    const shot = source[currentIndex]?.shot || (focusIndex >= 0 ? source[focusIndex].shot : '') || 'medium';
    return { focus, shot, inherited: focusIndex >= 0 && focusIndex !== currentIndex };
}

export const BEAT_CUES = BEAT_CUE_IDS;
export const BEAT_FACES = BEAT_FACE_IDS;
export const BEAT_OVERLAYS = BEAT_OVERLAY_CUE_IDS;
export const BEAT_EFFECTS = BEAT_EFFECT_IDS;

export const BEAT_SHOTS = Object.freeze(['wide', 'medium', 'close', 'reaction', 'keep']);
// `camera` is the shared Beat framing override. It intentionally uses the
// same vocabulary as `shot` so the exact same value can be applied to both
// flat (2D) backgrounds and 3D scenes.
export const BEAT_CAMERA_PRESETS = BEAT_SHOTS;
// Kept as empty compatibility exports for older imports. Named camera motion
// fields were never part of the Beat protocol and must not drive playback.
export const BEAT_CAMERA_MOTIONS = Object.freeze([]);
export const BEAT_CAMERA_EASES = Object.freeze([]);
export const BEAT_POSITIONS = Object.freeze(['left', 'center', 'right']);

export function resolveBeatCameraPreset(value, shot = 'medium') {
    const key = String(value || '').trim().toLowerCase();
    if (BEAT_CAMERA_PRESETS.includes(key)) return key;
    const fallback = String(shot || '').trim().toLowerCase();
    return BEAT_CAMERA_PRESETS.includes(fallback) ? fallback : 'medium';
}

export function stagePositionOffset(position) {
    return ({ left: -100 / 3, center: 0, right: 100 / 3 })[String(position || '').trim().toLowerCase()] ?? 0;
}

export function backgroundPanPosition(position) {
    return ({ left: '0%', center: '50%', right: '100%' })[String(position || '').trim().toLowerCase()] ?? '50%';
}

export function backgroundPanAmount(position) {
    return ({ left: 0, center: 0.5, right: 1 })[String(position || '').trim().toLowerCase()] ?? 0.5;
}

// CSS `background-size: cover` window, in image UV. Y is top-down so it matches
// the stage plate behind the transparent canvas.
export function stagePlateCover(viewWidth, viewHeight, imageWidth, imageHeight, panX = 0.5, panY = 0.5) {
    const viewW = Math.max(1, Number(viewWidth) || 1);
    const viewH = Math.max(1, Number(viewHeight) || 1);
    const imageW = Math.max(1, Number(imageWidth) || 1);
    const imageH = Math.max(1, Number(imageHeight) || 1);
    const scale = Math.max(viewW / imageW, viewH / imageH);
    const displayedWidth = imageW * scale;
    const displayedHeight = imageH * scale;
    return {
        scaleX: viewW / displayedWidth,
        scaleY: viewH / displayedHeight,
        offsetX: ((displayedWidth - viewW) * panX) / displayedWidth,
        offsetY: ((displayedHeight - viewH) * panY) / displayedHeight,
    };
}

function clampUnit(value, fallback = 0.5) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(1, Math.max(0, number));
}

/** Shrink the cover window around a viewport point. Zoom 1 keeps the cover. */
export function zoomPlateCover(cover, zoom = 1, focusX = 0.5, focusY = 0.5) {
    const source = cover && typeof cover === 'object' ? cover : {};
    const z = Math.max(0.05, Number(zoom) || 1);
    const fx = clampUnit(focusX);
    const fy = clampUnit(focusY);
    const baseX = Number(source.scaleX) || 1;
    const baseY = Number(source.scaleY) || 1;
    const baseOffsetX = Number(source.offsetX) || 0;
    const baseOffsetY = Number(source.offsetY) || 0;
    let scaleX = baseX / z;
    let scaleY = baseY / z;
    const anchorX = baseOffsetX + baseX * fx;
    const anchorY = baseOffsetY + baseY * fy;
    let offsetX = anchorX - scaleX * fx;
    let offsetY = anchorY - scaleY * fy;
    if (scaleX > 1) {
        offsetX += (scaleX - 1) * fx;
        scaleX = 1;
    }
    if (scaleY > 1) {
        offsetY += (scaleY - 1) * fy;
        scaleY = 1;
    }
    offsetX = Math.min(Math.max(offsetX, 0), 1 - scaleX);
    offsetY = Math.min(Math.max(offsetY, 0), 1 - scaleY);
    return { scaleX, scaleY, offsetX, offsetY };
}

export function plateCoverToBackground(cover) {
    const scaleX = Number(cover?.scaleX) || 1;
    const scaleY = Number(cover?.scaleY) || 1;
    const align = (offset, scale) => (scale >= 0.999 ? 50 : (Number(offset) || 0) / (1 - scale) * 100);
    return {
        size: `${100 / scaleX}% ${100 / scaleY}%`,
        position: `${align(cover?.offsetX, scaleX)}% ${align(cover?.offsetY, scaleY)}%`,
    };
}

/** Close and bust shots soften a flat photo so the face stays in front of the room. */
export function backgroundDepthBlur(zoom) {
    const z = Number(zoom) || 1;
    if (z >= 2.2) return 8;
    if (z >= 1.35) return 3;
    return 0;
}

export function buildBackgroundPlan(beats) {
    return [...new Set((Array.isArray(beats) ? beats : [])
        .map(beat => String(beat?.background || '').trim())
        .filter(Boolean))];
}

export function preparedStageCovers(loaded = {}, next = {}) {
    if (!loaded.ready) return false;
    const cast = Array.isArray(loaded.cast) ? loaded.cast : [];
    const backgrounds = new Set(Array.isArray(loaded.backgrounds) ? loaded.backgrounds : []);
    const nextCast = Array.isArray(next.cast) ? next.cast : [];
    const nextBackgrounds = Array.isArray(next.backgrounds) ? next.backgrounds : [];
    if (!nextCast.length || !nextCast.every(id => cast.includes(id))) return false;
    return nextBackgrounds.every(name => backgrounds.has(name));
}

export function beatBackgroundChanged(previousBackground, nextBackground, nextBackgroundExplicit = true) {
    if (!nextBackgroundExplicit) return false;
    const previous = String(previousBackground || '').trim();
    const next = String(nextBackground || '').trim();
    return Boolean(previous && next && previous !== next);
}

export function estimateBeatHold(text) {
    const length = [...String(text || '')].length;
    if (length < 8) return 900;
    return Math.min(5200, Math.max(900, Math.round((900 + length * 70) / 100) * 100));
}

export function getShotPreset(shot, focus = '') {
    const key = String(shot || '').trim().toLowerCase();
    // Scales are relative to the Beat camera (head below the top, hips near the
    // dialogue box). Wide pulls back to a knee-length view, reaction is a bust,
    // and close fills the frame with the face. The actor stays centered.
    const framing = {
        wide: { scale: 0.67, originY: 0.58 },
        medium: { scale: 1, originY: 0.5 },
        close: { scale: 2.55, originY: 0.34 },
        reaction: { scale: 1.5, originY: 0.46 },
        keep: { scale: 1, originY: 0.5 },
    }[key];
    if (!framing) return { scale: 1, focus: '', backgroundDim: 0 };
    return { ...framing, focus: key === 'wide' ? '' : String(focus || ''), backgroundDim: 0 };
}
