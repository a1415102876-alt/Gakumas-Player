import { BEAT_SPEAKER_NAMES, beatActorId } from './beat-player-core.js?v=20261102-krnh-3d-v1';
import { BEAT_NPC_SPEAKER_NAMES, npcPortraitCharacter } from './beat-npc-portraits.js?v=20261102-krnh-3d-v1';
import { isProducerSpeaker } from './dialogue-reveal.js?v=producer-voice-v1';
import { SCENE_IDOLS } from './scene-protocol.js?v=20261102-krnh-3d-v1';

export const IRODORI_VOICES_KEY = 'hatsuIrodoriTtsVoices';
const CONNECTION_KEY = 'hatsuIrodoriTtsConnection';
export const IRODORI_CAPTION_LIMIT = 160;

export const IRODORI_CHARACTERS = Object.freeze([
    ...Object.entries(SCENE_IDOLS).map(([name, id]) => ({ id, name })),
    ...Object.entries(BEAT_NPC_SPEAKER_NAMES).map(([id, name]) => ({ id, name })),
    { id: 'producer', name: BEAT_SPEAKER_NAMES.producer },
]);

function normalizeVoices(voices) {
    return Object.fromEntries(IRODORI_CHARACTERS.flatMap(({ id }) => {
        const voice = voices?.[id];
        return typeof voice === 'string' && voice.trim() ? [[id, voice.trim()]] : [];
    }));
}

export function readIrodoriVoices(storage = globalThis.localStorage) {
    try {
        return normalizeVoices(JSON.parse(storage?.getItem(IRODORI_VOICES_KEY) || 'null'));
    } catch {
        return {};
    }
}

export function saveIrodoriVoices(voices, storage = globalThis.localStorage) {
    const normalized = normalizeVoices(voices);
    storage?.setItem(IRODORI_VOICES_KEY, JSON.stringify(normalized));
    return normalized;
}

export function readIrodoriConnection(storage = globalThis.localStorage) {
    try {
        return JSON.parse(storage?.getItem(CONNECTION_KEY) || 'null') || {};
    } catch {
        return {};
    }
}

export function saveIrodoriConnection({ port, protocol }, storage = globalThis.localStorage) {
    const connection = { ...(port ? { port: Number(port) } : {}), ...(protocol ? { protocol } : {}) };
    storage?.setItem(CONNECTION_KEY, JSON.stringify(connection));
    return connection;
}

export function irodoriCaptionPrompt(characters = []) {
    if (!characters.length) return '';
    const names = characters.map(({ name }) => name).join('、');
    return [
        `使用 Irodori 语音的角色：${names}。这些角色开口时，写对应的日语 <tts lang="ja">，包括只用头像的角色。`,
        '同一个 <beat> 的开头加上 irodori-caption="日语语气描述"，例如 irodori-caption="少し照れながら、優しく微笑むような声。"。用一句简短日语描述这句台词的情绪、强弱和说话方式，随上下文变化。描述里避免使用半角引号和尖括号。',
        '语气描述只放在 irodori-caption 属性里，不要写进 display 或 tts。其他角色及纯动作 Beat 省略该属性。',
    ].join('\n');
}

export function normalizeIrodoriCaption(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, IRODORI_CAPTION_LIMIT) : '';
}

export function createIrodoriSpeech(voices, fish = globalThis.HatsuFishTts, { port, protocol } = {}) {
    const characters = IRODORI_CHARACTERS.filter(({ id }) => Object.hasOwn(voices, id));
    const idByReference = new Map(characters.flatMap(({ id }) => {
        const reference = fish?.referenceIdForSpeaker?.(id);
        return reference ? [[reference, id]] : [];
    }));
    const voiceForSpeaker = speaker => {
        const id = isProducerSpeaker(speaker) ? 'producer' : (
            beatActorId(speaker) || npcPortraitCharacter(speaker)?.id
                || idByReference.get(fish?.referenceIdForSpeaker?.(speaker))
        );
        return id && Object.hasOwn(voices, id) ? voices[id] : '';
    };

    return {
        characters,
        voiceForSpeaker,
        createRequest({ speaker, text, irodoriCaption }) {
            const voice = voiceForSpeaker(speaker);
            if (!voice) return null;
            const input = text.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
            if (!input) return null;
            const style = normalizeIrodoriCaption(irodoriCaption);
            const caption = isProducerSpeaker(speaker) ? normalizeIrodoriCaption(`成人男性の声。${style}`) : style;
            const payload = { input, voice, ...(caption ? { caption } : {}), ...(port ? { port } : {}), ...(protocol ? { protocol } : {}) };
            return {
                key: JSON.stringify(payload),
                async synthesize(signal) {
                    const response = await fetch('/api/irodori-tts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
                        signal,
                        redirect: 'error',
                        body: JSON.stringify(payload),
                    });
                    if (!response.ok) {
                        const error = await response.json().catch(() => null);
                        const detail = error?.error?.message || error?.error || error?.detail;
                        throw new Error(`Irodori-TTS HTTP ${response.status}${typeof detail === 'string' ? ` · ${detail.slice(0, 180)}` : ''}`);
                    }
                    if (!response.headers.get('content-type')?.startsWith('audio/')) {
                        throw new Error('Irodori-TTS 未返回音频。');
                    }
                    return response.blob();
                },
            };
        },
    };
}
