export const FISH_TTS_STORAGE_KEY = 'hatsuProduceTtsPreferences';
export const DEFAULT_FISH_TTS_PROXY = (() => {
    const location = globalThis.location;
    return location?.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname)
        ? new URL('/api/fish-tts', location.origin).href
        : 'https://tts.sawadaz.xyz/api/fish-tts';
})();
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
    const configuredProxy = String(input.proxyUrl ?? saved.proxyUrl ?? DEFAULT_FISH_TTS_PROXY).replace(/\s+/g, "") || DEFAULT_FISH_TTS_PROXY;
    const proxyUrl = /^\/api\/fish-tts\/?$/i.test(configuredProxy) ? DEFAULT_FISH_TTS_PROXY : configuredProxy;
    const model = String(input.model ?? saved.model ?? DEFAULT_FISH_TTS_MODEL).trim() || DEFAULT_FISH_TTS_MODEL;
    const apiKey = String(input.apiKey ?? saved.apiKey ?? '').trim();
    const enabled = input.enabled == null ? Boolean(saved.enabled) : Boolean(input.enabled);
    return { enabled, proxyUrl, model, apiKey };
}

export function fishTtsStatus(config = {}) {
    if (!config.connected) return '语音组件未加载。';
    if (!config.enabled) return '角色语音已关闭。打开后会朗读回复里的日语台词。';
    const local = config.irodoriCount ? `已为 ${config.irodoriCount} 个角色配置本地 Irodori-TTS。` : '';
    const fish = config.apiKey ? 'Fish Audio 已配置。' : '使用 Fish Audio 的角色需要填写 Fish API Key。';
    return `${local}${fish}`;
}

export function applyFishTtsSettings(input = {}, { storage = globalThis.localStorage, tts = globalThis.HatsuFishTts, irodori, onError, persist = false } = {}) {
    const config = resolveFishTtsSettings(input, storage);
    if (persist) storage?.setItem(FISH_TTS_STORAGE_KEY, JSON.stringify(config));
    const connected = typeof tts?.configure === 'function';
    if (connected) tts.configure({ ...config, ...(irodori === undefined ? {} : { irodori }), onError });
    return { ...config, hasApiKey: Boolean(config.apiKey), connected, irodoriCount: tts?.getIrodoriCharacters?.().length || 0 };
}
