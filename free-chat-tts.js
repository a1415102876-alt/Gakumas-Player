export const FISH_TTS_STORAGE_KEY = 'hatsuProduceTtsPreferences';
export const DEFAULT_FISH_TTS_PROXY = 'https://hatsuboshitest.a1415102876.workers.dev/api/fish-tts';
export const DEFAULT_FISH_TTS_MODEL = 's2.1-pro-free';

export function readFishTtsPreferences(storage = globalThis.localStorage) {
    try {
        const saved = JSON.parse(storage?.getItem(FISH_TTS_STORAGE_KEY) || 'null');
        return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch (error) {
        return {};
    }
}

export function resolveFishTtsSettings(input = {}, storage = globalThis.localStorage) {
    const saved = readFishTtsPreferences(storage);
    const proxyUrl = String(input.proxyUrl ?? saved.proxyUrl ?? DEFAULT_FISH_TTS_PROXY).trim() || DEFAULT_FISH_TTS_PROXY;
    const model = String(input.model ?? saved.model ?? DEFAULT_FISH_TTS_MODEL).trim() || DEFAULT_FISH_TTS_MODEL;
    const apiKey = String(input.apiKey ?? saved.apiKey ?? '').trim();
    const enabled = input.enabled == null ? Boolean(saved.enabled) : Boolean(input.enabled);
    return { enabled, proxyUrl, model, apiKey };
}

export function fishTtsStatus(config = {}) {
    if (!config.connected) return '语音组件未加载。';
    if (!config.enabled) return '角色语音已关闭。打开后会朗读回复里的日语台词。';
    if (!config.apiKey) return '已开启角色语音。填写 Fish API Key 后即可出声。';
    return '角色语音已接通。回复里的日语台词会在舞台上朗读。';
}

export function applyFishTtsSettings(input = {}, { storage = globalThis.localStorage, tts = globalThis.HatsuFishTts, onError, persist = false } = {}) {
    const config = resolveFishTtsSettings(input, storage);
    if (persist) storage?.setItem(FISH_TTS_STORAGE_KEY, JSON.stringify(config));
    const connected = typeof tts?.configure === 'function';
    if (connected) tts.configure({ ...config, onError });
    return { ...config, hasApiKey: Boolean(config.apiKey), connected };
}
