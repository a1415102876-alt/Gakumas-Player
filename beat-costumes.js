// Outfit keywords are separate from motion cues. Each idol's actual assets
// remain in library.json; teachers and unknown actors have no Solo1 variant.
export const BEAT_COSTUME_IDS = Object.freeze(['Default', 'Solo1', 'Onsen']);
const SOLO1_IDOLS = new Set(['fktn', 'hski', 'ttmr', 'amao', 'hrnm', 'shro', 'kllj', 'kcna', 'ssmk', 'hume', 'hmsz', 'jsna', 'atbm']);
// Hot-spring outfit: hkne's head on the hume-othr-0000 body.
const ONSEN_IDOLS = new Set(['hkne']);
const ONSEN_WORDS = ['onsen', '温泉', '温泉服'];

export function resolveBeatCostume(value = 'Default', idolId = 'fktn') {
    const token = String(value || 'Default').trim().replace(/^costume\s*:\s*/i, '').toLowerCase();
    if (['default', 'casl', 'casual', '便服', '默认'].includes(token)) return 'Default';
    if (token === 'solo1' && SOLO1_IDOLS.has(idolId)) return 'Solo1';
    if (ONSEN_WORDS.includes(token) && ONSEN_IDOLS.has(idolId)) return 'Onsen';
    return '';
}

export function idolCostumeVariant(idol, value = 'Default') {
    if (!idol) return null;
    const costume = resolveBeatCostume(value, idol.id);
    if (!costume) return null;
    if (costume === 'Default') return idol;
    const variant = idol.costumes?.[costume];
    return variant ? { ...idol, ...variant, id: idol.id } : null;
}

export function costumeEntryKey(idolId, costume = 'Default') {
    return `${idolId}:${resolveBeatCostume(costume, idolId) || 'Default'}`;
}
