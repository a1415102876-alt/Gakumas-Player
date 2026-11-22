import { normalizeBeatJobName } from './beat-job-name.js';

import { BEAT_SPEAKER_NAMES } from './beat-player-core.js?v=20261102-krnh-3d-v1';
import { resolveFishTtsSettings } from './free-chat-tts.js?v=irodori-tts-v1';
import { createIrodoriSpeech, readIrodoriConnection, readIrodoriVoices } from './irodori-tts.js?v=irodori-connection-v1';

export { normalizeBeatJobName };

const JOBS_ROUTE = '/api/beat-jobs';
const VOICE_ROUTE = '/api/beat-tts';

function namedRoute(route, name, fields) {
    const query = new URLSearchParams({ name: normalizeBeatJobName(name), ...fields });
    return `${route}?${query}`;
}

async function checkedFetch(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' ? body.error : `本地文件请求失败（HTTP ${response.status}）。`);
    }
    return response;
}

export async function listBeatJobs({ signal } = {}) {
    const response = await checkedFetch(JOBS_ROUTE, { cache: 'no-store', signal });
    return (await response.json()).jobs;
}

export async function loadBeatJob(name, { signal } = {}) {
    const job = await checkedFetch(namedRoute(JOBS_ROUTE, name), { cache: 'no-store', signal });
    const { url } = await job.json();
    return (await checkedFetch(url, { cache: 'no-store', signal })).text();
}

export async function saveBeatJob(name, source) {
    const response = await checkedFetch(namedRoute(JOBS_ROUTE, name), {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: source,
    });
    return response.json();
}

export function canExportBeatVoice(beat) {
    return Boolean(beat?.ttsText?.trim());
}

function irodoriConnection() {
    const saved = readIrodoriConnection();
    if (saved.port) return saved;
    const page = new URL(location.href);
    const launcher = new URL(sessionStorage.getItem('hatsuBeatEditorReturn') || page, page);
    const port = Number(page.searchParams.get('irodoriPort') || launcher.searchParams.get('irodoriPort'));
    return Number.isInteger(port) && port >= 1 && port <= 65535
        ? { port, protocol: 'openai', ...saved }
        : saved;
}

export function synthesizeBeatVoice(beat, { signal } = {}) {
    const tts = globalThis.HatsuFishTts;
    if (!tts?.synthesize) throw new Error('语音组件未加载。');
    if (!canExportBeatVoice(beat)) throw new Error('这句没有可导出的日文 TTS 台词。');
    const irodori = createIrodoriSpeech(readIrodoriVoices(), tts, irodoriConnection());
    return tts.synthesize({
        speaker: BEAT_SPEAKER_NAMES[beat.speaker] || beat.speaker,
        text: beat.ttsText,
        irodoriCaption: beat.irodoriCaption,
    }, { signal, settings: { ...resolveFishTtsSettings(), irodori } });
}

export async function beatVoiceFingerprint(beat) {
    const input = JSON.stringify([beat.speaker, beat.ttsText, beat.irodoriCaption || '']);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function listExportedBeatVoices(name, { signal } = {}) {
    const response = await checkedFetch(namedRoute(VOICE_ROUTE, name), { cache: 'no-store', signal });
    return (await response.json()).clips;
}

async function readClip(clip, signal) {
    const response = await checkedFetch(clip.url, { signal });
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('导出的文件没有可播放的音频。');
    return blob;
}

export async function getExportedBeatVoice(name, index, { signal } = {}) {
    const clip = (await listExportedBeatVoices(name, { signal })).find(entry => entry.index === index);
    return clip ? { ...clip, blob: await readClip(clip, signal) } : null;
}

export async function writeExportedBeatVoice(name, beat, index, blob, { expectedRevision, signal } = {}) {
    const fields = { index, fingerprint: await beatVoiceFingerprint(beat) };
    if (expectedRevision !== undefined) fields.expectedRevision = expectedRevision;
    const response = await checkedFetch(namedRoute(VOICE_ROUTE, name, fields), {
        method: 'PUT',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
        signal,
    });
    return response.json();
}

export function createExportedBeatVoiceCache(name, beats, { signal } = {}) {
    const catalog = listExportedBeatVoices(name, { signal }).then(clips => new Map(clips
        .filter(clip => canExportBeatVoice(beats[clip.index]))
        .sort((left, right) => left.index - right.index)
        .map(clip => [clip.index, clip]))
    ).catch(() => new Map());
    const requests = new Map();
    async function read(index) {
        const clip = (await catalog).get(index);
        if (!clip || signal?.aborted) return null;
        if (!requests.has(index)) {
            const request = beatVoiceFingerprint(beats[index])
                .then(fingerprint => clip.fingerprint === fingerprint ? readClip(clip, signal) : null)
                .catch(() => null);
            requests.set(index, request);
        }
        return requests.get(index);
    }
    const preload = catalog.then(async clips => {
        const voices = new Map();
        const pending = clips.keys();
        async function cacheClips() {
            for (const index of pending) {
                if (signal?.aborted) return;
                const blob = await read(index);
                if (blob) voices.set(index, blob);
            }
        }
        await Promise.all(Array.from({ length: Math.min(4, clips.size) }, cacheClips));
        return voices;
    });
    return { preload, read };
}
