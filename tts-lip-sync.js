const TALK_VISUAL_MIN = 0.015;
const TALK_ENTER_POWER = 0.12;
const TALK_EXIT_POWER = 0.045;

export const TALK_MOUTH_PROFILES = Object.freeze([
    { id: 'smile-small', anchor: ['mouth_031'], driver: ['mouth_032'], hints: ['egao1', 'smile-small'] },
    { id: 'smile-large', anchor: ['mouth_002'], driver: ['mouth_003'], hints: ['egao2', 'smile-large'] },
    { id: 'anger-small', anchor: ['mouth_014'], driver: ['mouth_012'], hints: ['ikari1', 'anger-small'] },
    { id: 'anger-large', anchor: ['mouth_005'], driver: ['mouth_001'], hints: ['ikari2', 'anger-large'] },
    { id: 'weak-small', anchor: ['mouth_006'], driver: ['mouth_013'], hints: ['yowaki1', 'weak-small'] },
    { id: 'weak-large', anchor: ['mouth_011'], driver: ['mouth_033'], hints: ['yowaki2', 'weak-large'] },
    { id: 'round-small', anchor: ['mouth_014'], driver: ['mouth_007'], hints: ['maruguchi1', 'round-small'] },
    { id: 'round-mid', anchor: ['mouth_014'], driver: ['mouth_008'], hints: ['maruguchi2', 'round-mid'] },
    { id: 'round-large', anchor: ['mouth_005'], driver: ['mouth_009'], hints: ['maruguchi3', 'round-large'] },
    { id: 'cat', anchor: ['mouth_016'], driver: ['mouth_017'], hints: ['neko', 'cat'] },
    { id: 'nihera', anchor: ['mouth_002'], driver: ['mouth_004'], hints: ['nihera'] },
    { id: 'kyo', anchor: [], driver: ['mouth_010'], hints: ['kyoto', 'kyo'] },
    { id: 'chu', anchor: [], driver: ['mouth_018'], hints: ['chuu', 'chu', 'kiss'] },
    { id: 'smile-teeth', anchor: ['mouth_015'], driver: ['mouth_028'], hints: ['hamidashi', 'smile-teeth'] },
    { id: 'clench', anchor: ['mouth_028'], driver: ['mouth_029'], hints: ['kuishibari', 'clench'] },
]);

const PROFILE_BY_ID = new Map(TALK_MOUTH_PROFILES.map(profile => [profile.id, profile]));

function clamp(value, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function asText(value) {
    return String(value || '').trim().toLowerCase();
}

function candidateNames(name) {
    const wanted = String(name || '');
    if (!wanted) return [];
    return [wanted, `b_mouth.${wanted}`];
}

function findDictionaryName(dictionary, name) {
    const names = Object.keys(dictionary || {});
    const candidates = candidateNames(name).map(value => value.toLowerCase());
    return names.find(value => candidates.includes(value.toLowerCase())) || '';
}

function findDictionaryIndex(dictionary, name) {
    const actual = findDictionaryName(dictionary, name);
    const index = actual ? dictionary[actual] : -1;
    return Number.isInteger(index) ? index : -1;
}

function profileAvailable(profile, dictionary) {
    return [...profile.anchor, ...profile.driver].some(name => findDictionaryIndex(dictionary, name) >= 0);
}

function profileScore(profile, dictionary, influences) {
    return profile.anchor.reduce((score, name) => {
        const index = findDictionaryIndex(dictionary, name);
        return score + (index >= 0 ? Math.max(0, Number(influences?.[index]) || 0) : 0);
    }, 0);
}

function orientProfile(profile, dictionary, influences) {
    const anchorScore = profileScore({ ...profile, anchor: profile.anchor }, dictionary, influences);
    const driverScore = profileScore({ ...profile, anchor: profile.driver }, dictionary, influences);
    if (driverScore > Math.max(0.05, anchorScore)) {
        return { ...profile, anchor: profile.driver, driver: profile.anchor };
    }
    return profile;
}

export function talkProfileFromHint(hint) {
    const text = asText(hint);
    if (!text) return '';
    // The longer numbered/contextual tokens must be checked before generic
    // emotion words because `ikari2` is a different TalkData pair from
    // `ikari1`.
    for (const profile of TALK_MOUTH_PROFILES) {
        if (profile.hints.some(token => text.includes(token))) return profile.id;
    }
    return '';
}

export function selectTalkMouthProfile({ dictionary = {}, influences = [], hint = '' } = {}) {
    const hinted = PROFILE_BY_ID.get(talkProfileFromHint(hint));
    if (hinted && profileAvailable(hinted, dictionary)) return orientProfile(hinted, dictionary, influences);

    let best = null;
    let bestScore = 0.05;
    for (const profile of TALK_MOUTH_PROFILES) {
        if (!profileAvailable(profile, dictionary)) continue;
        const score = profileScore(profile, dictionary, influences);
        if (score > bestScore) {
            best = orientProfile(profile, dictionary, influences);
            bestScore = score;
        }
    }
    if (best) return best;
    const fallback = TALK_MOUTH_PROFILES.find(profile => profileAvailable(profile, dictionary));
    return fallback ? orientProfile(fallback, dictionary, influences) : null;
}

export function talkArticulationFromPhase(talkPower = 0, phase = 0, maxWeight = 0.92) {
    const power = clamp(talkPower);
    const cycle = 0.5 + 0.5 * Math.cos(Number(phase) || 0);
    const subCycle = 0.5 + 0.5 * Math.cos((Number(phase) || 0) * 2 + 0.7);
    const modulation = 0.62 + cycle * 0.3 + subCycle * 0.08;
    return power * clamp(maxWeight) * modulation;
}

export function applyTalkMouthProfile({
    influences,
    dictionary,
    profile,
    talkPower = 0,
    maxWeight = 0.92,
    phase = 0,
    replace = false,
} = {}) {
    if (!profile || !influences || !dictionary) return false;
    const opening = replace
        ? talkArticulationFromPhase(talkPower, phase, maxWeight)
        : clamp(talkPower) * clamp(maxWeight);
    const driverIndices = profile.driver
        .map(name => findDictionaryIndex(dictionary, name))
        .filter(index => index >= 0);
    if (!driverIndices.length) return false;

    if (replace) {
        // TalkCurve writes the selected talk pair as the final mouth layer.
        // Clear the fixed base slot instead of adding it to the audio driver.
        for (const name of profile.anchor) {
            const index = findDictionaryIndex(dictionary, name);
            if (index >= 0) influences[index] = 0;
        }
        for (const index of driverIndices) influences[index] = opening;
        return true;
    }

    // The fixed expression mouth and the talk driver are a mutually exclusive
    // pair. Keep their combined weight within one so a strong TTS frame cannot
    // overdrive the same mouth geometry twice.
    const anchorTotal = profile.anchor.reduce((total, name) => {
        const index = findDictionaryIndex(dictionary, name);
        return total + (index >= 0 ? Math.max(0, Number(influences[index]) || 0) : 0);
    }, 0);
    const currentDriverTotal = driverIndices.reduce((total, index) => total + Math.max(0, Number(influences[index]) || 0), 0);
    let remaining = Math.max(0, 1 - anchorTotal - currentDriverTotal);
    let applied = false;
    for (const index of driverIndices) {
        const current = Math.max(0, Number(influences[index]) || 0);
        const desiredIncrease = Math.max(0, opening - current);
        const increase = Math.min(desiredIncrease, remaining);
        influences[index] = current + increase;
        remaining -= increase;
        applied = true;
    }
    return applied;
}

export function createTalkState() {
    return {
        noiseFloor: 0.008,
        talkPower: 0,
        isTalk: false,
    };
}

function sampleTimeDomain(value, fromByteArray = false) {
    const numeric = Number(value) || 0;
    return Math.abs(fromByteArray ? (numeric - 128) / 128 : (numeric > 1 || numeric < -1 ? (numeric - 128) / 128 : numeric));
}

function sampleFrequency(value, fromByteArray = false) {
    const numeric = Number(value) || 0;
    return clamp(fromByteArray ? numeric / 255 : (numeric > 1 ? numeric / 255 : numeric));
}

function average(values, start = 0, end = values.length) {
    if (!values?.length || end <= start) return 0;
    let total = 0;
    for (let index = start; index < end; index += 1) total += values[index];
    return total / (end - start);
}

export function analyzeTalkFrame({ timeDomain, frequency, state = createTalkState(), options = {} } = {}) {
    const byteTimeDomain = ArrayBuffer.isView(timeDomain) && timeDomain.BYTES_PER_ELEMENT === 1;
    const byteFrequency = ArrayBuffer.isView(frequency) && frequency.BYTES_PER_ELEMENT === 1;
    const timeSamples = Array.from(timeDomain || [], value => sampleTimeDomain(value, byteTimeDomain));
    const frequencySamples = Array.from(frequency || [], value => sampleFrequency(value, byteFrequency));
    const rms = timeSamples.length
        ? Math.sqrt(timeSamples.reduce((sum, value) => sum + value * value, 0) / timeSamples.length)
        : 0;
    const voiceSpectrum = average(frequencySamples);
    const lowBand = average(frequencySamples, 0, Math.max(1, Math.floor(frequencySamples.length * 0.16)));
    const speechBand = average(frequencySamples, Math.floor(frequencySamples.length * 0.08), Math.max(1, Math.floor(frequencySamples.length * 0.62)));
    const highBand = average(frequencySamples, Math.floor(frequencySamples.length * 0.62), frequencySamples.length);
    const rawEnergy = clamp(Math.max(rms, voiceSpectrum * 0.82, speechBand * 0.94));

    const previous = { ...createTalkState(), ...(state || {}) };
    const floorRate = clamp(options.noiseFloorRate ?? 0.045, 0.001, 0.25);
    const floorTarget = Math.min(rawEnergy, previous.noiseFloor + 0.02);
    const noiseFloor = previous.isTalk
        ? previous.noiseFloor
        : previous.noiseFloor + (floorTarget - previous.noiseFloor) * floorRate;
    const signal = Math.max(0, rawEnergy - noiseFloor - TALK_VISUAL_MIN);
    const targetPower = clamp(signal / Math.max(0.08, Number(options.fullScale) || 0.22));
    const attack = clamp(options.attack ?? 0.62, 0.05, 1);
    const release = clamp(options.release ?? 0.22, 0.03, 1);
    const response = targetPower >= previous.talkPower ? attack : release;
    const talkPower = clamp(previous.talkPower + (targetPower - previous.talkPower) * response);
    const enterPower = Number(options.enterPower) > 0 ? Number(options.enterPower) : TALK_ENTER_POWER;
    const exitPower = Number(options.exitPower) > 0 ? Number(options.exitPower) : TALK_EXIT_POWER;
    const isTalk = previous.isTalk ? talkPower >= exitPower : talkPower >= enterPower;

    const nextState = {
        noiseFloor,
        talkPower,
        isTalk,
    };
    return {
        rms,
        voiceSpectrum,
        lowBand,
        speechBand,
        highBand,
        spectralCentroid: frequencySamples.length
            ? frequencySamples.reduce((sum, value, index) => sum + value * index, 0) / Math.max(1e-6, voiceSpectrum * frequencySamples.length)
            : 0,
        talkPower,
        isTalk,
        state: nextState,
    };
}

function defaultRequestFrame(callback) {
    if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback);
    return globalThis.setTimeout(() => callback(Date.now()), 16);
}

function defaultCancelFrame(id) {
    if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(id);
    else globalThis.clearTimeout(id);
}

export class TtsLipSyncAnalyzer {
    constructor(options = {}) {
        this.AudioContext = options.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext || null;
        this.requestFrame = options.requestAnimationFrame || defaultRequestFrame;
        this.cancelFrame = options.cancelAnimationFrame || defaultCancelFrame;
        this.fftSize = Number(options.fftSize) || 512;
        this.context = null;
        this.source = null;
        this.analyser = null;
        this.audio = null;
        this.onFrame = null;
        this.frameId = 0;
        this.state = createTalkState();
        this.timeDomain = null;
        this.frequency = null;
        this.handleEnded = () => this.stop();
    }

    start(audio, onFrame) {
        this.stop();
        if (!audio || typeof this.AudioContext !== 'function') return false;
        try {
            this.context = new this.AudioContext();
            this.source = this.context.createMediaElementSource(audio);
            this.analyser = this.context.createAnalyser();
            this.analyser.fftSize = this.fftSize;
            this.analyser.smoothingTimeConstant = 0.72;
            this.source.connect(this.analyser);
            this.analyser.connect(this.context.destination);
            this.audio = audio;
            this.onFrame = typeof onFrame === 'function' ? onFrame : null;
            this.state = createTalkState();
            this.timeDomain = new Uint8Array(this.analyser.fftSize);
            this.frequency = new Uint8Array(this.analyser.frequencyBinCount);
            audio.addEventListener?.('ended', this.handleEnded);
            this.context.resume?.().catch?.(() => {});
            this.tick();
            return true;
        } catch (error) {
            this.stop();
            return false;
        }
    }

    tick() {
        if (!this.analyser || !this.audio) return;
        this.analyser.getByteTimeDomainData(this.timeDomain);
        this.analyser.getByteFrequencyData(this.frequency);
        const metrics = analyzeTalkFrame({
            timeDomain: this.timeDomain,
            frequency: this.frequency,
            state: this.state,
        });
        this.state = metrics.state;
        this.onFrame?.(metrics);
        this.frameId = this.requestFrame(() => this.tick());
    }

    stop() {
        if (this.frameId) this.cancelFrame(this.frameId);
        this.frameId = 0;
        this.audio?.removeEventListener?.('ended', this.handleEnded);
        try { this.source?.disconnect?.(); } catch { /* best effort */ }
        try { this.analyser?.disconnect?.(); } catch { /* best effort */ }
        try { this.context?.close?.(); } catch { /* best effort */ }
        this.audio = null;
        this.source = null;
        this.analyser = null;
        this.context = null;
        this.onFrame = null;
        this.state = createTalkState();
    }
}
