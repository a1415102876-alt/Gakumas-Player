export const BEAT_AUDIO_TYPES = Object.freeze({
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.wav': 'audio/wav',
});

export const BEAT_AUDIO_GROUPS = Object.freeze(['bgm', 'sfx']);
export const BEAT_AUDIO_CATALOG_PATH = 'api/beat-audio';
export const BEAT_AUDIO_FOLDER = 'audio';
export const BEAT_BGM_STOP = 'None';
export const BEAT_SFX_SEPARATOR = '|';
export const DEFAULT_BEAT_AUDIO_VOLUMES = Object.freeze({ bgm: 0.7, sfx: 1 });

const BEAT_AUDIO_VOLUMES_KEY = 'hatsuBeatAudioVolumes';

export function normalizeBeatAudioVolumes(volumes) {
    return Object.fromEntries(BEAT_AUDIO_GROUPS.map(kind => {
        const volume = volumes?.[kind];
        return [kind, Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : DEFAULT_BEAT_AUDIO_VOLUMES[kind]];
    }));
}

export function readBeatAudioVolumes(storage) {
    try {
        return normalizeBeatAudioVolumes(JSON.parse((storage ?? globalThis.localStorage)?.getItem(BEAT_AUDIO_VOLUMES_KEY) ?? 'null'));
    } catch {
        return { ...DEFAULT_BEAT_AUDIO_VOLUMES };
    }
}

export function writeBeatAudioVolumes(volumes, storage) {
    try {
        (storage ?? globalThis.localStorage)?.setItem(BEAT_AUDIO_VOLUMES_KEY, JSON.stringify(normalizeBeatAudioVolumes(volumes)));
    } catch { /* Audio remains adjustable when storage is unavailable. */ }
}

export function normalizeBeatAudioName(value) {
    if (typeof value !== 'string') return '';
    const name = value.trim();
    if (!name || name.startsWith('.') || /[<>:"/\\|?*\x00-\x1f\x7f]/u.test(name)) return '';
    const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
    return Object.hasOwn(BEAT_AUDIO_TYPES, extension) ? name : '';
}

export function normalizeBeatBgm(value, { explicit = false } = {}) {
    if (typeof value !== 'string') return '';
    const name = value.trim();
    if (name.toLowerCase() === 'none' || (!name && explicit)) return BEAT_BGM_STOP;
    return normalizeBeatAudioName(name);
}

export function normalizeBeatSoundEffects(value) {
    const names = Array.isArray(value) ? value : String(value ?? '').split(BEAT_SFX_SEPARATOR);
    return [...new Set(names.map(normalizeBeatAudioName).filter(Boolean))];
}

export function beatAudioAssetUrl(kind, filename) {
    const name = normalizeBeatAudioName(filename);
    if (!name || !BEAT_AUDIO_GROUPS.includes(kind)) return '';
    return new URL(`./assets/${BEAT_AUDIO_FOLDER}/${kind}/${encodeURIComponent(name)}`, import.meta.url).href;
}

export async function loadBeatAudioCatalog() {
    const response = await fetch(new URL(`./${BEAT_AUDIO_CATALOG_PATH}`, import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`音频资源列表加载失败（HTTP ${response.status}）。`);
    const catalog = await response.json();
    if (!BEAT_AUDIO_GROUPS.every(kind => Array.isArray(catalog?.[kind]))) {
        throw new Error('音频资源列表格式无效。');
    }
    return Object.fromEntries(BEAT_AUDIO_GROUPS.map(kind => [kind, normalizeBeatSoundEffects(catalog[kind])]));
}
