export const EXPRESSION_PRESETS = Object.freeze({
    neutral: { label: '自然', candidates: [], weight: 0 },
    happy: { label: '开心', candidates: ['笑い', 'にこり', '笑顔', 'smile', 'happy'], weight: 0.75 },
    shy: { label: '害羞', candidates: ['照れ', '赤面', '頬染め', 'blush', 'shy'], weight: 0.68 },
    surprised: { label: '惊讶', candidates: ['びっくり', '驚き', '驚', 'surprised', 'surprise'], weight: 0.82 },
    sad: { label: '难过', candidates: ['悲しい', '困る', '困り', '悲', 'sad'], weight: 0.72 },
    angry: { label: '生气', candidates: ['怒り', '怒', 'angry'], weight: 0.74 },
});

export function normalizeActionId(value) {
    return String(value || '')
        .trim()
        .replace(/\.vmd$/i, '')
        .replace(/[\s_]+/g, '-')
        .replace(/[^\p{L}\p{N}-]+/gu, '')
        .toLowerCase();
}

export function parsePerformanceCommand(input) {
    let value = input;
    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (!trimmed) throw new Error('请输入表演指令');
        try {
            value = JSON.parse(trimmed);
        } catch {
            throw new Error('指令不是有效的 JSON');
        }
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('指令必须是 JSON 对象');
    }

    const expression = typeof value.expression === 'string'
        ? value.expression.trim().toLowerCase()
        : '';
    const action = typeof value.action === 'string' ? normalizeActionId(value.action) : '';
    const intensityValue = Number(value.intensity ?? 1);
    const intensity = Number.isFinite(intensityValue)
        ? Math.min(1, Math.max(0, intensityValue))
        : 1;
    const morphs = {};

    if (value.morphs !== undefined) {
        if (!value.morphs || typeof value.morphs !== 'object' || Array.isArray(value.morphs)) {
            throw new Error('morphs 必须是名称到权重的对象');
        }
        Object.entries(value.morphs).forEach(([name, weight]) => {
            const numericWeight = Number(weight);
            if (!name.trim() || !Number.isFinite(numericWeight)) return;
            morphs[name.trim()] = Math.min(1, Math.max(0, numericWeight));
        });
    }

    return { expression, action, intensity, morphs };
}

// MMDLoader names bone tracks `.bones[<name>].<property>` and morph tracks
// `.morphTargetInfluences[<index>]`. GLB retargeting uses direct Bone node and
// face-mesh paths, so classify both forms before pairing body and face clips.
export function classifyClipTracks(trackNames) {
    const names = Array.isArray(trackNames) ? trackNames : [];
    const bones = names.filter(name => {
        const value = String(name);
        return value.startsWith('.bones[') || /\.(?:position|quaternion)$/.test(value) && !value.includes('morphTargetInfluences');
    }).length;
    const morphs = names.filter(name => /(?:^|\.)morphTargetInfluences\[/.test(String(name))).length;
    let kind = 'empty';
    if (bones && morphs) kind = 'mixed';
    else if (bones) kind = 'body';
    else if (morphs) kind = 'face';
    return { bones, morphs, kind };
}

// `mot_..._in_b` and `mot_..._in_f` normalize to ids ending in `-b` / `-f`.
// Only the trailing segment counts: `yes-b-002-in-b` pairs on `yes-b-002-in`.
export function motionPairKey(id) {
    const value = String(id || '');
    const match = /^(.*)-([bf])$/.exec(value);
    return match ? { key: match[1], suffix: match[2] } : { key: value, suffix: '' };
}

export function stripTrackSuffix(label) {
    return String(label || '').replace(/[-_][bf]$/i, '');
}

/**
 * Filename suffix wins over track classification. A facial VMD that failed to
 * bind any morph still has to pair with its _b sibling, and a body clip that
 * happens to carry a leftover morph track must not fall into the "other" bucket.
 */
export function playlistSlot(entry) {
    const { suffix } = motionPairKey(entry?.id);
    if (suffix === 'b') return 'body';
    if (suffix === 'f') return 'face';
    if (entry?.kind === 'body' || entry?.kind === 'face') return entry.kind;
    return '';
}

/**
 * Group loaded clips into playlist items, pairing each body motion with the
 * facial clip that shares its base name so both can play on one mixer.
 */
export function buildPlaylist(entries) {
    const items = [];
    const byKey = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || !entry.id) continue;
        const { key, suffix } = motionPairKey(entry.id);
        const slot = playlistSlot(entry);
        const pairable = (slot === 'body' && suffix === 'b') || (slot === 'face' && suffix === 'f');
        const existing = pairable ? byKey.get(key) : undefined;
        if (existing && !existing[slot]) {
            existing[slot] = entry.id;
            existing.label = stripTrackSuffix(existing.label);
            continue;
        }
        const item = {
            key: pairable ? key : entry.id,
            label: entry.label,
            body: slot === 'body' ? entry.id : '',
            face: slot === 'face' ? entry.id : '',
            other: slot ? '' : entry.id,
        };
        items.push(item);
        if (pairable && !byKey.has(key)) byKey.set(key, item);
    }
    return items.map(annotatePlaylistItem);
}

export function playlistClipIds(item) {
    return [item?.body, item?.face, item?.other].filter(Boolean);
}

export const MOTION_BUCKETS = Object.freeze({
    emotion: { id: 'emotion', label: '情绪反应', pairing: 'paired' },
    dialogue: { id: 'dialogue', label: '对话手势', pairing: 'paired' },
    staging: { id: 'staging', label: '场面调度', pairing: 'paired' },
    lesson: { id: 'lesson', label: '课程育成', pairing: 'paired' },
    audition: { id: 'audition', label: '试镜', pairing: 'paired' },
    home: { id: 'home', label: '自宅', pairing: 'paired' },
    produce: { id: 'produce', label: '制作', pairing: 'paired' },
    live: { id: 'live', label: '演出', pairing: 'paired' },
    bodyOnly: { id: 'bodyOnly', label: '仅动作（无配套表情）', pairing: 'bodyOnly' },
    faceOnly: { id: 'faceOnly', label: '仅表情（无配套动作）', pairing: 'faceOnly' },
    other: { id: 'other', label: '未分类', pairing: '' },
});

export const MOTION_BUCKET_ORDER = Object.freeze(Object.keys(MOTION_BUCKETS));

export const MOTION_FADE = Object.freeze({
    sameFamily: 0.3,
    standing: 0.6,
    face: 0.24,
    posture: 0,
});

const PERSIST_POSTURE_FAMILIES = new Set(['walk', 'running']);
const HOLD_AFTER_FAMILIES = new Set(['sit', 'walk', 'running', 'exit']);

function catalogOf(item) {
    return item?.catalog || {};
}

export function isIdleMotion(item) {
    const catalog = catalogOf(item);
    // Audition loops remain selectable in the library, but must not become
    // the fallback posture for ordinary dialogue or automatic idle playback.
    return (catalog.family || item?.family) === 'idle'
        && (catalog.scope || item?.scope) !== 'aud'
        && catalog.bucket !== 'audition';
}

export function isPersistedPosture(item) {
    const family = catalogOf(item).family;
    const phase = catalogOf(item).phase;
    return (family === 'sit' && phase === 'lp') || PERSIST_POSTURE_FAMILIES.has(family);
}

export function shouldLoopMotion(item, userLoop = false) {
    const family = catalogOf(item).family;
    const phase = catalogOf(item).phase;
    if (family === 'idle' || phase === 'lp') return true;
    return !!userLoop;
}

export function shouldReturnToIdle(item) {
    const family = catalogOf(item).family;
    const phase = catalogOf(item).phase;
    if (family === 'idle' || phase === 'lp') return false;
    if (HOLD_AFTER_FAMILIES.has(family)) return false;
    return phase === 'in' || phase === 'pose' || !phase;
}

export function canKeepBodyForFace(fromItem) {
    const family = catalogOf(fromItem).family;
    const phase = catalogOf(fromItem).phase;
    return !!fromItem?.body && (family === 'idle' || family === 'talk' || phase === 'lp');
}

export function fadeDurationForTransition(fromItem, toItem) {
    if (!toItem) return 0;
    if (!fromItem) return MOTION_FADE.standing;
    if (catalogOf(fromItem).family && catalogOf(fromItem).family === catalogOf(toItem).family) {
        return MOTION_FADE.sameFamily;
    }
    if (isPersistedPosture(fromItem) && catalogOf(fromItem).family !== catalogOf(toItem).family && catalogOf(toItem).family !== 'standup') {
        return MOTION_FADE.posture;
    }
    return MOTION_FADE.standing;
}

export function fadeDurationForClip(kind, bodyFade) {
    const duration = Number(bodyFade) || 0;
    if (duration <= 0) return 0;
    return kind === 'face' ? Math.min(duration, MOTION_FADE.face) : duration;
}

function followupScore(item, source) {
    const catalog = catalogOf(item);
    const wanted = catalogOf(source);
    let score = 0;
    if (catalog.character && catalog.character === wanted.character) score += 8;
    if (catalog.variant && catalog.variant === wanted.variant) score += 4;
    if (catalog.index && catalog.index === wanted.index) score += 2;
    if (catalog.extra === wanted.extra) score += 1;
    return score;
}

function clipPickKey(item) {
    return String(item?.stem || item?.key || item?.body || item?.face || '');
}

function pickRandomItem(list, random) {
    if (!list.length) return null;
    const roll = Number(typeof random === 'function' ? random() : Math.random());
    const index = Math.min(list.length - 1, Math.max(0, Math.floor((Number.isFinite(roll) ? roll : 0) * list.length)));
    return list[index];
}

function pickTopRanked(entries, getRank, options = {}) {
    if (!entries.length) return -1;
    let best = -Infinity;
    const top = [];
    for (const entry of entries) {
        const rank = getRank(entry);
        if (rank > best) {
            best = rank;
            top.length = 0;
            top.push(entry);
        } else if (rank === best) {
            top.push(entry);
        }
    }
    const avoidKey = String(options.avoidKey || '');
    const pool = avoidKey && top.length > 1
        ? top.filter(entry => clipPickKey(entry.item) !== avoidKey)
        : top;
    return pickRandomItem(pool.length ? pool : top, options.random)?.index ?? -1;
}

export function findIdlePlaylistIndex(playlist, preferredCharacter = '') {
    const list = Array.isArray(playlist) ? playlist : [];
    const idles = list.map((item, index) => ({ item, index })).filter(({ item }) => isIdleMotion(item));
    if (!idles.length) return -1;
    const character = String(preferredCharacter || '');
    const rank = ({ item }) => {
        const catalog = catalogOf(item);
        return (character && catalog.character === character ? 8 : 0)
            + (catalog.phase === 'lp' ? 2 : 0)
            + (catalog.character === 'cmmn' ? 1 : 0);
    };
    return idles.sort((left, right) => rank(right) - rank(left))[0].index;
}

export const FACE_CLIP_PREFS = Object.freeze({
    happy: Object.freeze([
        { brow: 'normal1', mouth: 'egao1' },
        { brow: 'normal1', mouth: 'egao2' },
        { mouth: 'egao1' },
        { mouth: 'egao2' },
    ]),
    shy: Object.freeze([
        { brow: 'yowaki1', mouth: 'yowaki1' },
        { brow: 'yowaki2', mouth: 'yowaki1' },
        { brow: 'yowaki1' },
        { mouth: 'yowaki1' },
    ]),
    surprised: Object.freeze([
        { brow: 'odoroki1' },
        { brow: 'kyoto1' },
    ]),
    sad: Object.freeze([
        { brow: 'komari1' },
        { brow: 'yowaki1' },
        { brow: 'toji1' },
    ]),
    angry: Object.freeze([
        { brow: 'ikari1', mouth: 'ikari1' },
        { brow: 'ikari2', mouth: 'ikari1' },
        { brow: 'ikari1' },
        { mouth: 'ikari1' },
    ]),
    neutral: Object.freeze([
        { brow: 'normal1' },
    ]),
});

function isFacialCatalogItem(item) {
    const family = String(catalogOf(item).family || item.family || '');
    return family === 'facial' || family.startsWith('facial:') || family.startsWith('facial-');
}

export function findFacePlaylistIndex(playlist, faceId, options = {}) {
    faceId = String(faceId || '') === 'default' ? 'neutral' : String(faceId || '');
    if (faceId === 'joyful') faceId = 'very-happy';
    const prefs = FACE_CLIP_PREFS[faceId] || [];
    const list = Array.isArray(playlist) ? playlist : [];
    const facials = list.map((item, index) => ({ item, index })).filter(({ item }) => isFacialCatalogItem(item) && (item.face || catalogOf(item).mouth || item.mouth));
    if (!facials.length) return -1;
    const character = String(options.preferredCharacter || '');
    const unique = character ? facials.filter(({ item }) => (catalogOf(item).character || item.character) === character) : [];
    const selection = faceId === 'happy'
        ? facials.filter(({ item }) => {
            const catalog = catalogOf(item);
            const family = String(catalog.family || item.family || '');
            const stem = String(item.stem || item.key || '');
            return !family.startsWith('facial:unique-')
                && catalog.brow !== 'unique'
                && !/facial-all-unique-/i.test(stem);
        })
        : facials;
    const candidates = selection.length ? selection : facials;
    const faceName = item => String(item.stem || item.key || item.face || '').match(/facial-all-(.+?)-(?:in|pose|lp)(?:-f)?$/)?.[1]
        || [catalogOf(item).brow || item.brow, catalogOf(item).mouth || item.mouth].filter(Boolean).join('-');
    let names = [];
    if (faceId === 'neutral') names = ['default'];
    if (faceId === 'very-happy') names = character === 'hmsz' ? ['unique-egao2'] : character === 'ssmk' ? ['unique-egao1-start', 'unique-egao2-start'] : ['unique-egao1'];
    if (faceId === 'angry') names = ['unique-ikari1', 'unique-ikari2-start', 'unique-ikari3-start'];
    if (faceId === 'speechless') names = ['unique-hikitsuri1', 'unique-hikitsuri2', 'unique-hikitsuri3', 'unique-hikitsuri4'];
    if (['unequal-eyes', 'unique-futougou1'].includes(faceId)) names = ['unique-futougou1'];
    if (faceId === 'frown-smile' && character === 'amao') names = ['unique-egao2'];
    if (faceId === 'smile-open' && character === 'ssmk') names = ['unique-egao1-start'];
    if (faceId === 'smile-closed' && character === 'ssmk') names = ['unique-egao2-start'];
    if (faceId === 'unique-egao1') names = character === 'ssmk' ? ['unique-egao1-start'] : ['unique-egao1'];
    if (faceId === 'unique-egao2') names = character === 'ssmk' ? ['unique-egao2-start'] : ['unique-egao2'];
    if (faceId === 'unique-ikari1') names = ['unique-ikari1'];
    const semantic = unique.filter(({ item }) => names.includes(faceName(item)));
    if (semantic.length) return pickTopRanked(semantic, () => 1, options);
    // Unsupported dedicated expressions fall back to an appropriate general face.
    if (!prefs.length) return findFacePlaylistIndex(list, /smile|egao/.test(faceId) ? 'happy'
        : faceId === 'unique-ikari1' ? 'angry' : 'neutral', options);
    const scorePref = (item, pref) => {
        const catalog = catalogOf(item);
        const brow = catalog.brow || item.brow || '';
        const mouth = catalog.mouth || item.mouth || '';
        const phase = catalog.phase || item.phase || '';
        let score = 0;
        if (pref.brow && brow === pref.brow) score += 8;
        if (pref.mouth && mouth === pref.mouth) score += 8;
        if (pref.brow && brow && brow !== pref.brow) score -= 2;
        if (pref.mouth && mouth && mouth !== pref.mouth) score -= 2;
        if (phase === 'in') score += 1;
        return score;
    };
    for (const pref of prefs) {
        const index = pickTopRanked(candidates, ({ item }) => scorePref(item, pref), options);
        const winner = candidates.find(entry => entry.index === index);
        if (winner && scorePref(winner.item, pref) >= 8) return index;
    }
    const fallback = pickTopRanked(candidates, ({ item }) => Math.max(0, ...prefs.map(pref => scorePref(item, pref))), options);
    const fallbackItem = candidates.find(entry => entry.index === fallback);
    const fallbackScore = fallbackItem ? Math.max(0, ...prefs.map(pref => scorePref(fallbackItem.item, pref))) : 0;
    return fallbackScore > 0 ? fallback : -1;
}

export const DEFAULT_MOTION_VARIANTS = Object.freeze({
    fktn: 'b', hmsz: 'd', ttmr: 'c', jsna: 'c', atbm: 'c', amao: 'c',
    hski: 'a', hume: 'b', kcna: 'b', kllj: 'd', hrnm: 'd', ssmk: 'a', shro: 'd',
});

// A small number of characters use an additional untyped clip as a regular
// variation for one cue family. Keep this separate from DEFAULT_MOTION_VARIANTS
// so the normal a/b/c/d fallback order remains unchanged for every other cue.
export const MOTION_CUE_CANDIDATES = Object.freeze({
    hmsz: Object.freeze({
        angry: Object.freeze([
            Object.freeze({ character: 'cmmn', variant: 'd' }),
            Object.freeze({ character: 'cmmn', variant: '', index: '002' }),
        ]),
    }),
});

// These generic candidates are deliberately narrower than the full family.
// cry-003 is a recovery smile and cry-004 is an exaggerated crying loop, so
// neither should be selected by the ordinary cry cue.
export const MOTION_GENERIC_CUE_CANDIDATES = Object.freeze({
    cry: Object.freeze([
        Object.freeze({ character: 'cmmn', index: '001' }),
        Object.freeze({ character: 'cmmn', index: '002' }),
    ]),
});

function matchesMotionCandidate(item, candidate) {
    const catalog = catalogOf(item);
    const character = catalog.character || item.character || '';
    const variant = catalog.variant || item.variant || '';
    const index = catalog.index || item.index || '';
    return (candidate.character === undefined || character === candidate.character)
        && (candidate.variant === undefined || variant === candidate.variant)
        && (candidate.index === undefined || index === candidate.index);
}

export const DEDICATED_MOTION_PROBABILITY = 0.6;

function gestureCandidatePools(playlist, family, preferredCharacter = '', options = {}) {
    const wanted = String(family || '');
    if (!wanted) return { dedicated: [], generic: [] };
    const list = Array.isArray(playlist) ? playlist : [];
    const preferPairing = String(options.preferPairing || '');
    const matches = list.map((item, index) => ({ item, index }))
        .filter(({ item }) => {
            const familyId = String(catalogOf(item).family || item.family || '');
            if (wanted === 'idle' && !isIdleMotion(item)) return false;
            return familyId === wanted || familyId.startsWith(`${wanted}-`);
        });
    if (!matches.length) return { dedicated: [], generic: [] };
    const character = String(preferredCharacter || '');
    const preferredVariant = String(options.preferredVariant ?? DEFAULT_MOTION_VARIANTS[character] ?? '').toLowerCase();
    const dedicated = matches.filter(({ item }) => character
        && (catalogOf(item).character || item.character) === character
        && (catalogOf(item).family || item.family) === wanted);
    const generics = matches.filter(({ item }) => {
        const id = catalogOf(item).character || item.character || '';
        return !id || id === 'cmmn';
    });
    const variantMatches = preferredVariant
        ? generics.filter(({ item }) => String(catalogOf(item).variant || item.variant || '').toLowerCase() === preferredVariant)
        : [];
    const compatible = preferredVariant ? generics.filter(({ item }) => {
        const variant = String(catalogOf(item).variant || item.variant || '').toLowerCase();
        return ['ac', 'bd'].includes(variant) && variant.includes(preferredVariant);
    }) : [];
    const customCandidates = MOTION_CUE_CANDIDATES[character]?.[wanted] || [];
    const customMatches = customCandidates.length
        ? generics.filter(({ item }) => customCandidates.some(candidate => matchesMotionCandidate(item, candidate)))
        : [];
    const genericCandidates = MOTION_GENERIC_CUE_CANDIDATES[wanted];
    const hasGenericRule = Array.isArray(genericCandidates);
    const genericMatches = hasGenericRule
        ? generics.filter(({ item }) => genericCandidates.some(candidate => matchesMotionCandidate(item, candidate)))
        : [];
    const untyped = generics.filter(({ item }) => !(catalogOf(item).variant || item.variant));
    const generic = customMatches.length ? customMatches : hasGenericRule ? genericMatches : !preferredVariant ? generics
        : variantMatches.length ? variantMatches : compatible.length ? compatible : untyped.length ? untyped : generics;
    const rank = ({ item }, neutralizePhaseRank = false) => {
        const catalog = catalogOf(item);
        const familyId = String(catalog.family || item.family || '');
        const itemCharacter = catalog.character || item.character || '';
        const phase = catalog.phase || item.phase || '';
        const pairing = catalog.pairing || item.pairing || '';
        const additive = catalog.additive || item.additive;
        return (familyId === wanted ? 16 : 0)
            + (character && itemCharacter === character ? 8 : 0)
            + (preferPairing && pairing === preferPairing ? 4 : 0)
            + (neutralizePhaseRank ? 0 : phase === 'in' ? 3 : 0)
            + (neutralizePhaseRank ? 0 : phase === 'pose' ? 1 : 0)
            + (itemCharacter === 'cmmn' ? 1 : 0)
            + (additive ? 0 : 2);
    };
    const highest = (entries, neutralizePhaseRank = false) => {
        const best = Math.max(...entries.map(entry => rank(entry, neutralizePhaseRank)));
        return entries.filter(entry => rank(entry, neutralizePhaseRank) === best);
    };
    return { dedicated: highest(dedicated), generic: highest(generic, hasGenericRule && !customMatches.length) };
}

// Preloading uses the same pools as playback, without consuming random rolls.
export function gesturePlaylistCandidateIndices(playlist, family, preferredCharacter = '', options = {}) {
    const pools = gestureCandidatePools(playlist, family, preferredCharacter, options);
    return [...pools.dedicated, ...pools.generic].map(entry => entry.index);
}

export function findGesturePlaylistIndex(playlist, family, preferredCharacter = '', options = {}) {
    const pools = gestureCandidatePools(playlist, family, preferredCharacter, options);
    let selected = pools.dedicated.length ? pools.dedicated : pools.generic;
    if (pools.dedicated.length && pools.generic.length) {
        const probability = Number.isFinite(options.dedicatedProbability)
            ? Math.max(0, Math.min(1, options.dedicatedProbability)) : DEDICATED_MOTION_PROBABILITY;
        const roll = Number(typeof options.random === 'function' ? options.random() : Math.random());
        selected = roll < probability ? pools.dedicated : pools.generic;
    }
    return pickTopRanked(selected, () => 1, options);
}

export function findPhaseFollowupIndex(playlist, item, phase, currentIndex = -1) {
    if (!item || !phase) return -1;
    const family = catalogOf(item).family;
    if (!family) return -1;
    const matches = (Array.isArray(playlist) ? playlist : [])
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry, index }) => index !== currentIndex
            && catalogOf(entry).family === family
            && catalogOf(entry).phase === phase
            && entry.key !== item.key);
    if (!matches.length) return -1;
    return matches.sort((left, right) => followupScore(right.entry, item) - followupScore(left.entry, item))[0].index;
}

const SCOPE_LABELS = Object.freeze({
    all: '',
    aud: '试镜',
    home: '自宅',
    lesson: '课程',
    prod: '制作',
    live: '演出',
});

const CHARACTER_LABELS = Object.freeze({
    cmmn: '通用',
    fktn: '琴音',
    amao: '麻央',
    atbm: '千奈',
    hmsz: '美玲',
    hrnm: '莉波',
    hski: '咲季',
    hume: '佑芽',
    jsna: '星南',
    kcna: '千奈',
    kllj: '莉莉娅',
    nasr: '亚纱里',
    shro: '广',
    ssmk: '紫云清夏',
    ttmr: '手毬',
});

const PHASE_LABELS = Object.freeze({
    in: '进入',
    pose: '定格',
    lp: '循环',
});

const VARIANT_LABELS = Object.freeze({
    a: '型A',
    b: '型B',
    c: '型C',
    d: '型D',
    ac: 'AC',
    bd: 'BD',
});

const FAMILY_INTENTS = Object.freeze({
    akireru: { bucket: 'emotion', label: '无奈' },
    angry: { bucket: 'emotion', label: '生气' },
    anshin: { bucket: 'emotion', label: '安心' },
    cry: { bucket: 'emotion', label: '哭泣' },
    doya: { bucket: 'emotion', label: '得意' },
    glad: { bucket: 'emotion', label: '高兴' },
    idle: { bucket: 'emotion', label: '待机' },
    kime: { bucket: 'staging', label: '定格亮相' },
    kobiru: { bucket: 'emotion', label: '讨好' },
    koufun: { bucket: 'emotion', label: '兴奋' },
    kuyashigaru: { bucket: 'emotion', label: '不甘' },
    odoroku: { bucket: 'emotion', label: '吃惊' },
    oneoff: { bucket: 'live', label: '特殊演出' },
    sad: { bucket: 'emotion', label: '难过' },
    tereru: { bucket: 'emotion', label: '害羞' },
    yaruki: { bucket: 'emotion', label: '干劲' },
    ask: { bucket: 'dialogue', label: '询问' },
    henji: { bucket: 'dialogue', label: '应答' },
    kiduku: { bucket: 'dialogue', label: '察觉' },
    kohon: { bucket: 'dialogue', label: '清嗓' },
    no: { bucket: 'dialogue', label: '否定' },
    ojigi: { bucket: 'dialogue', label: '鞠躬' },
    talk: { bucket: 'dialogue', label: '说话' },
    think: { bucket: 'dialogue', label: '思考' },
    watasu: { bucket: 'dialogue', label: '递交' },
    yes: { bucket: 'dialogue', label: '肯定' },
    yubisasi: { bucket: 'dialogue', label: '指向' },
    door: { bucket: 'staging', label: '开关门' },
    enter: { bucket: 'staging', label: '进场' },
    exit: { bucket: 'staging', label: '退场' },
    running: { bucket: 'staging', label: '跑步' },
    sit: { bucket: 'staging', label: '坐下' },
    standup: { bucket: 'staging', label: '站起' },
    turn: { bucket: 'staging', label: '转身' },
    walk: { bucket: 'staging', label: '走路' },
    backidle: { bucket: 'produce', label: '背对待机' },
    facial: { bucket: 'faceOnly', label: '独立表情' },
    akubi: { bucket: 'emotion', label: '打哈欠' },
    bye: { bucket: 'dialogue', label: '告别' },
    clap: { bucket: 'emotion', label: '鼓掌' },
    dance: { bucket: 'live', label: '舞蹈' },
    eat: { bucket: 'dialogue', label: '吃东西' },
    fansa: { bucket: 'live', label: '应援' },
    fuman: { bucket: 'emotion', label: '不满' },
    futon: { bucket: 'staging', label: '铺被/被褥' },
    hand: { bucket: 'dialogue', label: '伸手' },
    hisohiso: { bucket: 'dialogue', label: '小声交流' },
    hug: { bucket: 'emotion', label: '拥抱' },
    inoru: { bucket: 'dialogue', label: '祈祷' },
    janken: { bucket: 'dialogue', label: '猜拳' },
    ketsui: { bucket: 'dialogue', label: '下定决心' },
    kiss: { bucket: 'dialogue', label: '飞吻' },
    karakau: { bucket: 'emotion', label: '调侃' },
    komaru: { bucket: 'emotion', label: '困扰' },
    kowagaru: { bucket: 'emotion', label: '害怕' },
    kushami: { bucket: 'emotion', label: '打喷嚏' },
    letter: { bucket: 'dialogue', label: '书信' },
    lunchbag: { bucket: 'dialogue', label: '便当' },
    massage: { bucket: 'dialogue', label: '按摩' },
    microphone: { bucket: 'live', label: '麦克风' },
    mojimoji: { bucket: 'emotion', label: '扭捏' },
    naderu: { bucket: 'dialogue', label: '摸头' },
    niramu: { bucket: 'emotion', label: '瞪视' },
    nomu: { bucket: 'dialogue', label: '喝东西' },
    phoneoff: { bucket: 'dialogue', label: '挂断电话' },
    phoneon: { bucket: 'dialogue', label: '接起电话' },
    phoneshow: { bucket: 'dialogue', label: '展示手机' },
    phonetalk: { bucket: 'dialogue', label: '打电话' },
    photograph: { bucket: 'dialogue', label: '拍照' },
    piece: { bucket: 'dialogue', label: '比耶' },
    read: { bucket: 'dialogue', label: '阅读' },
    rollover: { bucket: 'staging', label: '翻滚' },
    sakebu: { bucket: 'emotion', label: '喊叫' },
    search: { bucket: 'dialogue', label: '寻找' },
    seiza: { bucket: 'staging', label: '正坐' },
    sing: { bucket: 'live', label: '歌唱' },
    sleep: { bucket: 'emotion', label: '睡眠' },
    sleepin: { bucket: 'emotion', label: '睡着' },
    sleepup: { bucket: 'emotion', label: '醒来' },
    stand: { bucket: 'staging', label: '站立' },
    stretch: { bucket: 'staging', label: '伸展' },
    taoreru: { bucket: 'emotion', label: '累到跌倒' },
    tameiki: { bucket: 'emotion', label: '叹气' },
    tanoshimu: { bucket: 'emotion', label: '享受' },
    'test-turn-r': { bucket: 'staging', label: '测试转身' },
    tired: { bucket: 'emotion', label: '疲惫' },
    trophy: { bucket: 'emotion', label: '奖杯' },
    tsuneru: { bucket: 'dialogue', label: '捏脸' },
    uzukumaru: { bucket: 'staging', label: '蜷缩' },
    yodare: { bucket: 'emotion', label: '流口水' },
    yurasu: { bucket: 'emotion', label: '摇晃' },
    yutanpo: { bucket: 'dialogue', label: '暖水袋' },
});

const LESSON_FAMILY_LABELS = Object.freeze({
    'all-start': '开始',
    'all-start-end': '收尾',
    'all-result-success': '成功',
    'da-idle': '舞蹈待机',
    'da-up-clear': '舞蹈提升',
    'da-up-large': '舞蹈大提升',
    'ex-idle': '表现待机',
    'ex-buff': '表现增益',
    'ex-debuff': '表现减益',
    'ex-up': '表现提升',
    'ex-up-large-bad': '表现大提升（差）',
    'ex-up-large-good': '表现大提升（好）',
    'ex-up-large-normal': '表现大提升（普通）',
    'vi-idle': '形象待机',
    'vi-up-clear': '形象提升',
    'vi-up-large': '形象大提升',
    'vo-idle': '声乐待机',
    'vo-up-clear': '声乐提升',
    'vo-up-large': '声乐大提升',
});

const AUDITION_FAMILY_LABELS = Object.freeze({
    idle: '待机',
    'selection01-result-win': '选拔胜利',
    'result-failed': '失败',
    'result-perfect': '完美',
    'result-success': '成功',
    start: '开始',
});

const BROW_LABELS = Object.freeze({
    ikari1: '怒眉1',
    ikari2: '怒眉2',
    jiai1: '慈爱眉',
    jito1: '眯眼1',
    jito2: '眯眼2',
    jito3: '眯眼3',
    komari1: '困扰眉',
    kyoto1: '茫然眉',
    normal1: '平常眉',
    odoroki1: '吃惊眉',
    toji1: '闭眼1',
    toji2: '闭眼2',
    yowaki1: '弱气眉1',
    yowaki2: '弱气眉2',
});

const MOUTH_LABELS = Object.freeze({
    egao1: '笑嘴1',
    egao2: '笑嘴2',
    ikari1: '怒嘴1',
    ikari2: '怒嘴2',
    neko: '猫嘴',
    nihera: '奸笑',
    yowaki1: '弱气嘴',
});

function compactTitle(parts) {
    return parts.filter(Boolean).join(' ');
}

function parseClipTokens(name) {
    const raw = String(name || '').replace(/\.vmd$/i, '').trim();
    const id = normalizeActionId(raw);
    const { key, suffix } = motionPairKey(id);
    const match = /^(?:mot-)?(all|aud|home|lesson|prod|live)-chr-([^-]+)-(.+)$/.exec(key);
    let scope = '';
    let character = '';
    let rest = key;
    let phase = '';
    if (match) {
        scope = match[1];
        character = match[2];
        rest = match[3];
    }
    const phaseMatch = /^(.*)-(in|pose|lp)$/.exec(rest);
    if (phaseMatch) {
        rest = phaseMatch[1];
        phase = phaseMatch[2];
    }
    if ((scope === 'lesson' || scope === 'aud') && rest.startsWith('cmmn-')) {
        rest = rest.slice(5);
    }
    return {
        raw,
        id,
        key,
        suffix,
        scope,
        character,
        rest,
        phase,
    };
}

function parseFamilyRest(rest) {
    const facial = /^facial-all-(.+)$/.exec(rest);
    if (facial) {
        const combo = facial[1];
        const split = combo.match(/^([a-z]+[0-9]*)-([a-z]+[0-9]*)$/);
        return {
            family: 'facial',
            variant: '',
            index: '',
            extra: '',
            additive: false,
            brow: split?.[1] || '',
            mouth: split?.[2] || combo,
        };
    }

    const additive = /(?:^|-)add(?:-|$)/.test(rest);
    const cleaned = rest.replace(/-add(?=-|$)/g, '').replace(/^-|-$/g, '');
    const withVariant = /^(.+)-(ac|bd|[a-d])-(\d+)(?:-(\d+))?$/.exec(cleaned);
    if (withVariant) {
        return {
            family: withVariant[1],
            variant: withVariant[2],
            index: withVariant[3] || '',
            extra: withVariant[4] || '',
            additive,
            brow: '',
            mouth: '',
        };
    }
    const numbered = /^(.+)-(\d+)(?:-(\d+))?$/.exec(cleaned);
    if (!numbered) {
        return { family: cleaned, variant: '', index: '', extra: '', additive, brow: '', mouth: '' };
    }
    return {
        family: numbered[1],
        variant: '',
        index: numbered[2] || '',
        extra: numbered[3] || '',
        additive,
        brow: '',
        mouth: '',
    };
}

function familyMeta(scope, family) {
    if (scope === 'lesson') {
        return { bucket: 'lesson', label: LESSON_FAMILY_LABELS[family] || family };
    }
    if (scope === 'aud') {
        return { bucket: 'audition', label: AUDITION_FAMILY_LABELS[family] || family };
    }
    if (scope === 'home') {
        return { bucket: 'home', label: FAMILY_INTENTS[family]?.label || family };
    }
    if (scope === 'prod') {
        return { bucket: 'produce', label: FAMILY_INTENTS[family]?.label || family };
    }
    if (scope === 'live') {
        return { bucket: 'live', label: '演出' };
    }
    return FAMILY_INTENTS[family] || { bucket: 'other', label: family || '未识别' };
}

export function classifyMotionName(name) {
    const tokens = parseClipTokens(name);
    const parts = parseFamilyRest(tokens.rest || '');
    const intent = familyMeta(tokens.scope, parts.family);
    const variantLabel = VARIANT_LABELS[parts.variant] || parts.variant;
    const phaseLabel = PHASE_LABELS[tokens.phase] || '';
    const scopeLabel = SCOPE_LABELS[tokens.scope] || '';
    const characterLabel = tokens.character && tokens.character !== 'cmmn'
        ? CHARACTER_LABELS[tokens.character] || tokens.character
        : '';
    const browLabel = BROW_LABELS[parts.brow] || parts.brow;
    const mouthLabel = MOUTH_LABELS[parts.mouth] || parts.mouth;
    const indexLabel = [variantLabel, parts.index, parts.extra].filter(Boolean).join('-');
    const familyLabel = parts.family === 'facial' && (browLabel || mouthLabel)
        ? compactTitle([browLabel, mouthLabel && `+ ${mouthLabel}`])
        : intent.label;
    const title = compactTitle([
        characterLabel,
        scopeLabel,
        familyLabel,
        indexLabel,
        phaseLabel,
        parts.additive ? '叠加' : '',
    ]);
    return {
        key: tokens.key,
        suffix: tokens.suffix,
        scope: tokens.scope,
        character: tokens.character,
        family: parts.family,
        familyLabel,
        variant: parts.variant,
        variantLabel,
        index: parts.index,
        extra: parts.extra,
        phase: tokens.phase,
        phaseLabel,
        additive: parts.additive,
        brow: parts.brow,
        mouth: parts.mouth,
        browLabel,
        mouthLabel,
        intentBucket: intent.bucket,
        title: title || tokens.key,
    };
}

export function pairingOf(item) {
    if (item?.body && item?.face) return 'paired';
    if (item?.face && !item?.body) return 'faceOnly';
    if (item?.body && !item?.face) return 'bodyOnly';
    return 'other';
}

export function annotatePlaylistItem(item) {
    const source = item?.label || item?.body || item?.face || item?.other || item?.key || '';
    const parsed = classifyMotionName(source);
    const pairing = pairingOf(item);
    const bucket = pairing === 'paired' ? parsed.intentBucket : pairing;
    const bucketInfo = MOTION_BUCKETS[bucket] || MOTION_BUCKETS.other;
    return {
        ...item,
        catalog: {
            ...parsed,
            pairing,
            pairingLabel: pairing === 'paired' ? '动作+表情' : bucketInfo.label,
            bucket: bucketInfo.id,
            bucketLabel: bucketInfo.label,
        },
    };
}

export function sortPlaylistByCatalog(items) {
    const list = Array.isArray(items) ? [...items] : [];
    return list.sort((left, right) => {
        const a = left.catalog || annotatePlaylistItem(left).catalog;
        const b = right.catalog || annotatePlaylistItem(right).catalog;
        const bucket = MOTION_BUCKET_ORDER.indexOf(a.bucket) - MOTION_BUCKET_ORDER.indexOf(b.bucket);
        if (bucket) return bucket;
        const family = String(a.familyLabel || '').localeCompare(String(b.familyLabel || ''), 'zh');
        if (family) return family;
        const variant = String(a.variant || '').localeCompare(String(b.variant || ''));
        if (variant) return variant;
        const index = String(a.index || '').localeCompare(String(b.index || ''), undefined, { numeric: true });
        if (index) return index;
        const extra = String(a.extra || '').localeCompare(String(b.extra || ''), undefined, { numeric: true });
        if (extra) return extra;
        const phase = String(a.phase || '').localeCompare(String(b.phase || ''));
        if (phase) return phase;
        return String(left.label || '').localeCompare(String(right.label || ''));
    });
}

export function groupPlaylistByCatalog(items) {
    const groups = [];
    const byId = new Map();
    for (const item of sortPlaylistByCatalog(items)) {
        const catalog = item.catalog || annotatePlaylistItem(item).catalog;
        let group = byId.get(catalog.bucket);
        if (!group) {
            group = {
                id: catalog.bucket,
                label: catalog.bucketLabel,
                items: [],
            };
            byId.set(catalog.bucket, group);
            groups.push(group);
        }
        group.items.push(item);
    }
    return groups;
}

export function buildMotionCatalogTable(entries) {
    const playlist = sortPlaylistByCatalog(buildPlaylist(entries));
    return {
        version: 1,
        generatedFrom: 'clip names and _b/_f pairing',
        counts: {
            total: playlist.length,
            paired: playlist.filter(item => item.catalog.pairing === 'paired').length,
            bodyOnly: playlist.filter(item => item.catalog.pairing === 'bodyOnly').length,
            faceOnly: playlist.filter(item => item.catalog.pairing === 'faceOnly').length,
        },
        buckets: groupPlaylistByCatalog(playlist).map(group => ({
            id: group.id,
            label: group.label,
            count: group.items.length,
            families: [...group.items.reduce((map, item) => {
                const key = item.catalog.family === 'facial'
                    ? `facial:${item.catalog.brow}-${item.catalog.mouth}`
                    : item.catalog.family || 'other';
                if (!map.has(key)) {
                    map.set(key, {
                        id: key,
                        label: item.catalog.familyLabel,
                        items: [],
                    });
                }
                map.get(key).items.push({
                    stem: item.key,
                    title: item.catalog.title,
                    label: item.label,
                    body: item.body || '',
                    face: item.face || '',
                    other: item.other || '',
                    pairing: item.catalog.pairing,
                    scope: item.catalog.scope,
                    character: item.catalog.character,
                    variant: item.catalog.variant,
                    index: item.catalog.index,
                    extra: item.catalog.extra,
                    phase: item.catalog.phase,
                    additive: item.catalog.additive,
                    brow: item.catalog.brow,
                    mouth: item.catalog.mouth,
                });
                return map;
            }, new Map()).values()],
        })),
    };
}

export function indexMotionFiles(names) {
    const map = new Map();
    for (const name of Array.isArray(names) ? names : []) {
        const normalized = String(name || '').replaceAll('\\', '/');
        const id = normalizeActionId(normalized);
        const baseName = normalized.split('/').pop() || normalized;
        const baseId = normalizeActionId(baseName);
        if (id) map.set(id, name);
        if (baseId) map.set(baseId, name);
    }
    return map;
}

export function findPresetMorph(morphNames, preset) {
    const names = Array.isArray(morphNames) ? morphNames : [];
    const candidates = Array.isArray(preset?.candidates) ? preset.candidates : [];
    const exact = candidates
        .map(candidate => names.find(name => name.toLowerCase() === candidate.toLowerCase()))
        .find(Boolean);
    if (exact) return exact;

    return candidates
        .map(candidate => names.find(name => name.toLowerCase().includes(candidate.toLowerCase())))
        .find(Boolean) || '';
}
