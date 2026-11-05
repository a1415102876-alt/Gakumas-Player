export const LIVE_PORTRAIT_IDOL_ID = 'fktn';
export const LIVE_PORTRAIT_SPEAKERS = Object.freeze([
    '藤田琴音', '花海咲季', '花海佑芽', '姬崎莉波', '紫云清夏', '葛城莉莉娅',
    '十王星南', '秦谷美铃', '雨夜燕', '有村麻央', '月村手毬', '仓本千奈', '筱泽广', '亚纱里老师',
]);
export const LIVE_PORTRAIT_PACK = 'idols/fktn';

const LIVE_PORTRAIT_PACKS = Object.freeze({
    藤田琴音: 'idols/fktn', 花海咲季: 'idols/hski', 花海佑芽: 'idols/hume', 姬崎莉波: 'idols/hrnm',
    紫云清夏: 'idols/ssmk', 葛城莉莉娅: 'idols/kllj', 十王星南: 'idols/jsna', 秦谷美铃: 'idols/hmsz',
    雨夜燕: 'idols/atbm', 有村麻央: 'idols/amao', 月村手毬: 'idols/ttmr', 仓本千奈: 'idols/kcna', 筱泽广: 'idols/shro',
    亚纱里老师: 'idols/nasr',
});

export function normalizeLivePortraitSpeaker(speaker) {
    return String(speaker || '').replace(/\s*[（(].*$/u, '').trim();
}

export function livePortraitCue(speaker) {
    const raw = String(speaker || '');
    const match = raw.match(/[（(]([^）)]+)[）)]/u);
    return match ? match[1].trim() : '';
}

export function isLivePortraitSpeaker(speaker) {
    return LIVE_PORTRAIT_SPEAKERS.includes(normalizeLivePortraitSpeaker(speaker));
}

export function canUseLivePortrait(speaker, status) {
    const pack = LIVE_PORTRAIT_PACKS[normalizeLivePortraitSpeaker(speaker)];
    return Boolean(pack && (!status?.packs || status.packs[pack]?.available));
}

export function shouldPlayLivePortraitTalk(speaker, slideType = '') {
    return isLivePortraitSpeaker(speaker) && slideType !== 'narration';
}

export function shouldShowLivePortrait(input = {}) {
    if (input.nsfw || input.hcg) return false;
    if (input.available === false) return false;
    return isLivePortraitSpeaker(input.idol || input.speaker);
}
