const PUNCTUATION = /[，。！？、；：,.!?;:]/u;

export const TYPEWRITER_DEFAULTS = Object.freeze({
    baseDelayMs: 34,
    punctuationMultiplier: 2.1,
    whitespaceMultiplier: 0.35,
    audioPlaybackRate: 1.8, // 改成 2 即为两倍音效速度
});

export function isProducerSpeaker(speaker) {
    const token = String(speaker || '').trim().toLowerCase();
    return ['producer', '制作人', '{user}', 'user'].includes(token);
}

export function typewriterDelayMs(character, options = {}) {
    const base = Math.max(12, Number(options.baseDelayMs) || TYPEWRITER_DEFAULTS.baseDelayMs);
    const punctuationMultiplier = Math.max(1, Number(options.punctuationMultiplier) || TYPEWRITER_DEFAULTS.punctuationMultiplier);
    const whitespaceMultiplier = Math.max(0.1, Number(options.whitespaceMultiplier) || TYPEWRITER_DEFAULTS.whitespaceMultiplier);
    const value = String(character || '');
    if (!value.trim()) return Math.max(8, Math.round(base * whitespaceMultiplier));
    if (PUNCTUATION.test(value)) return Math.round(base * punctuationMultiplier);
    return Math.round(base);
}

export function estimateTypewriterDuration(text, options = {}) {
    return Array.from(String(text || '')).reduce(
        (total, character) => total + typewriterDelayMs(character, options),
        0,
    );
}
