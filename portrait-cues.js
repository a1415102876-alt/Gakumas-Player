import { PAIRED_CUES, BODY_ONLY_CUES, FACE_ONLY_CUES } from './dialogue-intent.js?v=20261011-emotion-cue-labels-v2';
import { DEFAULT_MOTION_VARIANTS, findFacePlaylistIndex, findGesturePlaylistIndex, gesturePlaylistCandidateIndices } from './core.js?v=20261011-weighted-cues-v2';
import { isLivePortraitSpeaker } from './live-portrait-policy.js';
import { sceneIdolId, buildStageRules } from './scene-protocol.js';
import { beatMotionFileKey, isBeatMotionCandidate, isBeatMotionEligible, isBeatPairedCue, parseBeatCueToken } from './beat-cues.js?v=20261103-paired-face-v1';
export { sceneIdolId, buildStageRules, splitStageStory, parseStageTag, stageSnapshot, detectSceneCast } from './scene-protocol.js';

function canonicalWords(table) {
    const seen = new Set();
    return Object.freeze(Object.fromEntries(Object.entries(table).filter(([, id]) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    })));
}

export const PAIRED_WORDS = canonicalWords(PAIRED_CUES);
export const BODY_WORDS = canonicalWords(BODY_ONLY_CUES);
export const FACE_WORDS = canonicalWords(FACE_ONLY_CUES);

export { DEFAULT_MOTION_VARIANTS };

export function parsePortraitCue(speaker, slideType = '', idolId = 'fktn') {
    if (slideType === 'narration' || sceneIdolId(speaker) !== idolId) return null;
    const raw = String(speaker || '').trim();
    const fallback = { mode: 'paired', gesture: 'idle', face: '', invalid: true };
    if (!/[（(]/u.test(raw)) return { mode: 'keep' };
    const match = raw.match(/^[^（(]+\s*(?:\(([^()]*)\)|（([^（）]*)）)$/u);
    if (!match) return fallback;
    const token = (match[1] ?? match[2]).trim();
    const encodedBeatCue = parseBeatCueToken(token);
    if (encodedBeatCue) return encodedBeatCue;
    if (Object.hasOwn(PAIRED_WORDS, token)) return { mode: 'paired', gesture: PAIRED_WORDS[token], face: '' };
    if (isBeatPairedCue(token)) return parseBeatCueToken(`__beat-paired__${token}`);
    if (Object.hasOwn(BODY_WORDS, token)) return { mode: 'mixed', gesture: BODY_WORDS[token], face: 'neutral' };
    const parts = token.split(/[;；]/u).map(part => part.trim());
    const fields = parts.map(part => part.match(/^(动作|表情)\s*=\s*([^=]+)$/u));
    if (fields.length !== 2 || fields.some(field => !field) || fields[0][1] === fields[1][1]) return fallback;
    const values = Object.fromEntries(fields.map(field => [field[1], field[2].trim()]));
    if (!Object.hasOwn(BODY_WORDS, values.动作) || !Object.hasOwn(FACE_WORDS, values.表情)) return fallback;
    return { mode: 'mixed', gesture: BODY_WORDS[values.动作], face: FACE_WORDS[values.表情] };
}

function performanceCatalog(cue, catalog, idolId) {
    const eligible = catalog.filter(item => ['cmmn', idolId].includes(item.character || item.catalog?.character)
        && (!cue.beat || (isBeatMotionEligible(item) && isBeatMotionCandidate(item, cue.gesture))));
    const pairing = ['mixed', 'additive'].includes(cue.mode) ? 'bodyOnly' : 'paired';
    const candidates = eligible.filter(item => (item.pairing || item.catalog?.pairing) === pairing && item.body);
    const selector = String(cue.bodySelector || (cue.gesture === 'tereru' ? 'tereru-default' : ''));
    const selectedCandidates = selector ? candidates.filter(item => matchesBodySelector(item, selector)) : candidates;
    return { eligible, bodies: selectedCandidates, pairing };
}

function selectMotionFile(cue, catalog) {
    const key = beatMotionFileKey(cue?.file);
    if (!key) return null;
    const item = catalog.find(entry => [entry.label, entry.stem, entry.body, entry.face, entry.key]
        .some(name => beatMotionFileKey(name) === key));
    if (!item) return null;
    if (item.body && item.face) return { ...item, key: `${item.body}|${item.face}`, face: item.face, pairing: item.pairing || 'paired' };
    if (item.body) return { ...item, key: item.body, face: '', pairing: 'bodyOnly' };
    if (item.face) return { ...item, key: item.face, body: '', face: item.face, pairing: 'faceOnly' };
    return null;
}

function faceFileClip(cue, catalog) {
    return selectMotionFile({ file: cue?.faceFile }, catalog)?.face || '';
}

function semanticFaceClip(faceId, catalog, idolId) {
    const faces = catalog.filter(item => (item.pairing || item.catalog?.pairing) === 'faceOnly' && item.face
        && ['cmmn', idolId].includes(item.character || item.catalog?.character || ''));
    const index = findFacePlaylistIndex(faces, faceId, { preferredCharacter: idolId, random: () => 0 });
    return index >= 0 ? (faces[index]?.face || '') : '';
}

function withRequestedFace(item, cue, catalog, idolId) {
    if (!item?.body || (!cue?.face && !cue?.faceFile)) return item;
    const face = cue.faceFile ? faceFileClip(cue, catalog) : semanticFaceClip(cue.face, catalog, idolId);
    if (!face) return item;
    return { ...item, face, key: `${item.body}|${face}`, pairing: 'mixed' };
}

export function selectPortraitPerformance(cue, catalog, idolId = 'fktn', options = {}) {
    if (!cue || cue.mode === 'keep') return null;
    if (cue.mode === 'file') return withRequestedFace(selectMotionFile(cue, catalog), cue, catalog, idolId);
    const { eligible, bodies, pairing } = performanceCatalog(cue, catalog, idolId);
    const avoidBody = String(options.avoidBody || '');
    const avoidBodyKey = bodies.find(item => String(item.body || '') === avoidBody)?.stem
        || bodies.find(item => String(item.body || '') === avoidBody)?.key
        || avoidBody;
    const bodyIndex = findGesturePlaylistIndex(bodies, cue.gesture, idolId, {
        preferPairing: pairing,
        preferredVariant: DEFAULT_MOTION_VARIANTS[idolId] || '',
        avoidKey: avoidBodyKey,
        random: options.random,
        dedicatedProbability: options.dedicatedProbability,
    });
    const body = bodies[bodyIndex];
    if (!body) return null;
    if (cue.faceFile) {
        const face = faceFileClip(cue, catalog);
        if (face) return { ...body, key: `${body.body}|${face}`, face, pairing: 'mixed' };
    }
    let face = body.face;
    if (cue.mode === 'mixed' && cue.faceFile) {
        face = faceFileClip(cue, catalog);
        if (!face) return null;
        return { ...body, key: `${body.body}|${face}`, face, pairing: 'mixed' };
    }
    if (cue.mode === 'mixed') {
        const faces = eligible.filter(item => (item.pairing || item.catalog?.pairing) === 'faceOnly' && item.face);
        const avoidFace = String(options.avoidFace || '');
        const avoidFaceKey = faces.find(item => String(item.face || '') === avoidFace)?.stem
            || faces.find(item => String(item.face || '') === avoidFace)?.key
            || avoidFace;
        const exactFaces = faces.filter(item => (item.family || item.catalog?.family) === `facial:${cue.face}`);
        const semanticFaceIds = new Set(['neutral', 'happy', 'angry', 'speechless', 'unequal-eyes', 'joyful', 'very-happy', 'frown-smile', 'smile-open', 'smile-closed', 'unique-egao1', 'unique-egao2', 'unique-ikari1']);
        const exactFace = semanticFaceIds.has(cue.face) ? null : (exactFaces.find(item => String(item.face || '') !== avoidFace) || exactFaces[0]);
        face = exactFace?.face || faces[findFacePlaylistIndex(faces, cue.face, {
            preferredCharacter: idolId,
            avoidKey: avoidFaceKey,
            random: () => 0,
        })]?.face;
    }
    if (cue.mode === 'additive') return { ...body, key: body.body, face: '', pairing: 'bodyOnly', additive: true };
    if (!face) return null;
    return { ...body, key: `${body.body}|${face}`, face, pairing: cue.mode === 'mixed' ? 'mixed' : 'paired' };
}

// Enumerate both weighted pools before playback so a random variant never
// causes an on-demand VMD fetch when a Beat is already on screen.
export function portraitPerformanceCandidates(cue, catalog, idolId = 'fktn') {
    if (!cue || cue.mode === 'keep') return [];
    if (cue.mode === 'file') {
        const item = selectPortraitPerformance(cue, catalog, idolId);
        return item ? [item] : [];
    }
    const { eligible, bodies, pairing } = performanceCatalog(cue, catalog, idolId);
    const indices = gesturePlaylistCandidateIndices(bodies, cue.gesture, idolId, {
        preferPairing: pairing, preferredVariant: DEFAULT_MOTION_VARIANTS[idolId] || '',
    });
    const faces = eligible.filter(item => (item.pairing || item.catalog?.pairing) === 'faceOnly' && item.face);
    const requestedFace = cue.faceFile ? selectMotionFile({ file: cue.faceFile }, catalog) : null;
    const choices = new Map();
    for (const index of indices) {
        const subset = [bodies[index], ...faces, ...(requestedFace ? [requestedFace] : [])];
        const first = selectPortraitPerformance(cue, subset, idolId, { random: () => 0 });
        if (!first) continue;
        choices.set(first.key, first);
        if (cue.mode === 'mixed') {
            const second = selectPortraitPerformance(cue, subset, idolId, { random: () => 0, avoidFace: first.face });
            if (second) choices.set(second.key, second);
        }
    }
    return [...choices.values()];
}

function bodyIndex(item) {
    const value = Number(item?.index || item?.catalog?.index || '');
    return Number.isInteger(value) ? value : 0;
}

function bodyPhase(item) {
    return String(item?.phase || item?.catalog?.phase || '').toLowerCase();
}

function matchesBodySelector(item, selector) {
    const family = item.family || item.catalog?.family || '';
    const character = item.character || item.catalog?.character || '';
    const index = bodyIndex(item);
    const phase = bodyPhase(item);
    const additive = Boolean(item.additive || item.catalog?.additive);
    const variant = String(item.variant || item.catalog?.variant || '').toLowerCase();
    if (selector === 'fly-kiss') return family === 'kiss';
    if (selector === 'head-pat') return family === 'naderu';
    if (selector === 'v-sign') return family === 'piece';
    if (selector === 'drink-standing') return family === 'nomu' && [1, 2, 3].includes(index) && phase === 'in';
    if (selector === 'drink-seated') return family === 'nomu' && index === 4 && phase === 'in';
    if (selector === 'pinch-actor') return family === 'tsuneru'
        && ((character === 'cmmn' && index === 1) || (character === 'fktn' && index === 2));
    if (selector === 'pinch-receiver') return family === 'tsuneru'
        && ((character === 'cmmn' && index === 2) || (character === 'hski' && index === 1));
    if (selector === 'pinch-self') return family === 'tsuneru' && character === 'fktn' && index === 1;
    if (selector === 'shake-actor') return family === 'yurasu' && character === 'cmmn' && index === 1;
    if (selector === 'shake-receiver') return family === 'yurasu' && character === 'cmmn' && index === 2;
    if (selector === 'enter-direct') return family === 'enter' && !variant && [1, 3, 5].includes(index) && phase === 'in' && !additive;
    if (selector === 'enter-bow') return family === 'enter' && phase === 'in' && !additive
        && ((variant === 'a' && [1, 2].includes(index)) || (variant === 'c' && index === 2));
    if (selector === 'enter-run') return family === 'enter' && character === 'cmmn' && !variant && [2, 4, 6, 7, 8, 9].includes(index) && phase === 'in' && !additive;
    if (selector === 'ojigi-formal') return family === 'ojigi' && character === 'cmmn' && !variant && index === 1 && phase === 'in' && !additive;
    if (selector === 'ojigi-relaxed') return family === 'ojigi' && phase === 'in' && !additive
        && !(character === 'cmmn' && !variant && index === 1);
    if (selector === 'hisohiso-happy') return family === 'hisohiso' && [1, 3].includes(index) && phase === 'in' && !additive;
    if (selector === 'hisohiso-sad') return family === 'hisohiso' && [2, 4].includes(index) && phase === 'in' && !additive;
    if (selector === 'tereru-fktn-happy') return family === 'tereru' && phase === 'in' && !additive
        && ((character === 'fktn' && index === 1) || (character === 'cmmn' && variant === 'b' && [1, 2].includes(index)));
    if (selector === 'tereru-fktn-unhappy') return family === 'tereru' && character === 'fktn' && index === 2 && phase === 'in' && !additive;
    if (selector === 'tereru-default') return family === 'tereru' && !(character === 'fktn' && index === 2);
    if (selector === 'exit-run') return family === 'exit' && character === 'cmmn' && !variant && [2, 4, 6, 8, 10, 11, 12, 13].includes(index) && phase === 'in' && !additive;
    if (selector === 'exit-walk') return family === 'exit' && phase === 'in' && !additive
        && !(character === 'cmmn' && !variant && [2, 4, 6, 8, 10, 11, 12, 13].includes(index));
    if (selector === 'turn-rear-camera') return family === 'turn' && phase === 'in' && !additive
        && !(character === 'cmmn' && !variant && [1, 3, 4, 6, 7].includes(index));
    if (selector === 'turn-right') return family === 'turn' && character === 'cmmn' && !variant && index === 1 && phase === 'in' && !additive;
    if (selector === 'turn-left') return family === 'turn' && character === 'cmmn' && !variant && index === 3 && phase === 'in' && !additive;
    if (selector === 'turn-back') return family === 'turn' && character === 'cmmn' && !variant && index === 4 && phase === 'in' && !additive;
    if (selector === 'turn-front-left') return family === 'turn' && character === 'cmmn' && !variant && index === 6 && phase === 'in' && !additive;
    if (selector === 'no-additive') return family === 'no' && additive && index === 1;
    if (selector === 'yes-additive') return family === 'yes' && additive && index === 2;
    if (family !== 'talk' || additive) return false;
    if (selector === 'neutral') return (index >= 1 && index <= 15 || index === 20 || index === 21) && phase === 'in';
    if (selector === 'inspecting') return index >= 16 && index <= 19 && phase === 'in';
    if (selector === 'excited') return (index === 24 || index === 25) && phase === 'in';
    if (selector === 'concerned') return index >= 28 && index <= 31 && phase === 'in';
    if (selector === 'proud') return index === 32 && phase === 'in';
    return true;
}

export function buildIdol3dRules(idolName = '偶像', availableTags = []) {
    const tags = availableTags.length ? availableTags.join('、') : [...new Set([...Object.keys(PAIRED_WORDS), ...Object.keys(BODY_WORDS), ...Object.keys(FACE_WORDS)])].join('、');
    return [
        '<idol_3d_performance_rules>',
        `适用角色：${idolName}。本规则控制3D身体动作、表情、口型和舞台注意方向。`,
        `VN台词使用 <dialogue char="${idolName}(功能词)">台词</dialogue>；NIA台词 speaker 使用相同格式，旁白不填角色名。`,
        `功能词只允许使用实际动作库白名单：${tags}。同语义的本角色专属组与通用组均可用时，前端按60%/40%选组，再在组内选择候选；有配套身体与表情时使用成套动作，否则才组合独立动作和表情。不得输出文件名、内部ID或不存在的动作。`,
        '情绪区分：琴音的害羞或tereru-happy在高兴害羞专属001（60%）与通用B-001/B-002（合计40%）之间选择；tereru-unhappy只调用不高兴害羞专属002，不混入高兴害羞。普通 happy 使用一般笑脸，very-happy 才调用角色 unique-egao。普通哭泣的通用组仅包含cry-001/cry-002，不包含哭后笑容或手舞足蹈式大哭。通用无类型yaruki-001/002暂不作为候选，A/B/C/D通用干劲和角色专属干劲仍可用。',
        '动作应服务于剧情：普通说话保持说话，倾听使用待机或应答，明确点头、摇头、递交、鞠躬、坐下、起身或转身时才调用对应动作。相邻两段如果能自然表达出不同动作或表情，尽量避免同一说话人的动作与表情组合完全重复；必须保持同一语义时沿用当前功能词，播放器会在同一功能词存在多个候选资源时避开上一候选。',
        '多人对话时，当前说话者看向实际听话者；听话者看向说话者并用待机、应答、点头或情绪动作做轻微回应。向制作人、观众、舞台或直播镜头表达时才看向camera。',
        '注意方向变化使用独立舞台标签 <stage-look idol="偶像全名" target="偶像全名|camera|none"/>；在场但未发言者的明确反应使用 <stage-action idol="偶像全名" cue="功能词"/>。标签只在目标或动作变化时输出，不要每句重复。',
        '模型由前端扫描回复中的偶像姓名并预加载；不要输出stage-preload。角色只有真实出现时才stage-enter，真实离开时才stage-exit；被提及、回忆、电话或画外音不进场。',
        buildStageRules(),
        '</idol_3d_performance_rules>',
    ].join('\n');
}

export function buildPortraitRules() {
    return [
        '<fujita_kotone_portrait_rules>',
        '适用角色：藤田琴音。括号只控制3D表现，不属于姓名或台词；名字框只显示藤田琴音。',
        buildIdol3dRules('藤田琴音', [...Object.keys(PAIRED_WORDS), ...Object.keys(BODY_WORDS)]),
        'VN：<dialogue char="藤田琴音(功能词)">台词</dialogue>。NIA网络直播：beats[].speaker 使用同样的姓名格式；电视营业的 lines[].speaker 也相同。旁白不填姓名；本规则不得用于其他角色。',
        '同一功能词的琴音专属组与对应通用组同时可用时，前端按60%/40%选组；一组不可用时使用另一组。害羞的高兴与不高兴版本分开选择，不得拿其他偶像的专属动作代替。',
        '每次只输出一个准确功能词，不输出文件名、多个标签或动作=...;表情=...组合语法。',
        '根据语境优先选择合适的成套功能词，同时播放对应身体动作与配套表情；普通交谈没有突出情绪时用说话，倾听、等待或无法判断时用待机。不要为了成套动作虚构行为。',
        '成套词：' + Object.keys(PAIRED_WORDS).join('、') + '。',
        '纯动作词：' + Object.keys(BODY_WORDS).join('、') + '。',
        '讨好、定格已经补齐专属表情，属于成套功能词，不再作为纯动作。',
        '示例：藤田琴音(害羞)；藤田琴音(讨好)；藤田琴音(说话)。',
        '仅使用白名单准确写法，不输出文件名、旧立绘词或自造词。无变化沿用标签；无法判断使用待机。只有剧情确实发生时才选择移动、递交、课程等动作，不为动作虚构道具和事件。',
        '</fujita_kotone_portrait_rules>',
        buildStageRules(),
    ].join('\n');
}
