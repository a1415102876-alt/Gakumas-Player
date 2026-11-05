// 1. 成套提示词：动作库里有配套 _b + _f，表情和动作一起播。
export const PAIRED_CUES = Object.freeze({
    待机: 'idle',
    待命: 'idle',
    生气: 'angry',
    怒: 'angry',
    愤怒: 'angry',
    发火: 'angry',
    恼火: 'angry',
    害羞: 'tereru',
    脸红: 'tereru',
    羞涩: 'tereru',
    羞恼: 'tereru',
    害羞生气: 'tereru',
    难过: 'sad',
    伤心: 'sad',
    悲伤: 'sad',
    吃惊: 'odoroku',
    吓一跳: 'odoroku',
    高兴: 'glad',
    欢喜: 'glad',
    雀跃: 'glad',
    安心: 'anshin',
    放心: 'anshin',
    不甘: 'kuyashigaru',
    不甘心: 'kuyashigaru',
    懊恼: 'kuyashigaru',
    得意: 'doya',
    炫耀: 'doya',
    干劲: 'yaruki',
    鼓劲: 'yaruki',
    哭泣: 'cry',
    哭: 'cry',
    无奈: 'akireru',
    无语: 'akireru',
    兴奋: 'koufun',
    激动: 'koufun',
    点头: 'yes',
    肯定: 'yes',
    同意: 'yes',
    摇头: 'no',
    否定: 'no',
    拒绝: 'no',
    思考: 'think',
    沉思: 'think',
    询问: 'ask',
    提问: 'ask',
    应答: 'henji',
    回应: 'henji',
    回答: 'henji',
    鞠躬: 'ojigi',
    行礼: 'ojigi',
    指向: 'yubisasi',
    指着: 'yubisasi',
    清嗓: 'kohon',
    咳嗽: 'kohon',
    讨好: 'kobiru',
    撒娇: 'kobiru',
    定格: 'kime',
    亮相: 'kime',
    定格亮相: 'kime',
    特殊演出: 'oneoff',
    phoneon: 'phoneon',
    phoneshow: 'phoneshow',
    phonetalk: 'phonetalk',
    phoneoff: 'phoneoff',
    接起电话: 'phoneon',
    展示手机: 'phoneshow',
    打电话: 'phonetalk',
    挂断电话: 'phoneoff',
    递交: 'watasu',
    递给: 'watasu',
    察觉: 'kiduku',
    注意到: 'kiduku',
    发现: 'kiduku',
    开关门: 'door',
    开门: 'door',
    关门: 'door',
    进场: 'enter',
    进来: 'enter',
    退场: 'exit',
    离开: 'exit',
    跑步: 'running',
    跑: 'running',
    坐下: 'sit',
    坐: 'sit',
    站起: 'standup',
    起立: 'standup',
    转身: 'turn',
    走路: 'walk',
    走: 'walk',
    背对: 'backidle',
    背对待机: 'backidle',
    课程开始: 'all-start',
    课程收尾: 'all-start-end',
    课程成功: 'all-result-success',
    舞蹈待机: 'da-idle',
    舞蹈提升: 'da-up-clear',
    舞蹈大提升: 'da-up-large',
    声乐待机: 'vo-idle',
    声乐提升: 'vo-up-clear',
    声乐大提升: 'vo-up-large',
    形象待机: 'vi-idle',
    形象提升: 'vi-up-clear',
    形象大提升: 'vi-up-large',
    表现待机: 'ex-idle',
    表现增益: 'ex-buff',
    表现减益: 'ex-debuff',
    表现提升: 'ex-up',
    表现大差: 'ex-up-large-bad',
    表现大好: 'ex-up-large-good',
    表现大普通: 'ex-up-large-normal',
    试镜开始: 'start',
    试镜成功: 'result-success',
    试镜失败: 'result-failed',
    试镜完美: 'result-perfect',
});

// 2. 仅表情：只播 facial-all，不改当前动作。
export const FACE_ONLY_CUES = Object.freeze({
    自然: 'neutral',
    无表情: 'neutral',
    平静: 'neutral',
    平常: 'neutral',
    开心: 'happy',
    笑: 'happy',
    微笑: 'happy',
    快乐: 'happy',
    愉快: 'happy',
    喜悦: 'happy',
    害臊: 'shy',
    不好意思: 'shy',
    惊讶: 'surprised',
    震惊: 'surprised',
    意外: 'surprised',
    不开心: 'sad',
    沮丧: 'sad',
});

// 3. 仅动作：动作库里没有配套表情，只播身体。
export const BODY_ONLY_CUES = Object.freeze({
    说话: 'talk',
    讲话: 'talk',
    开口: 'talk',
});

export const FACE_CUES = FACE_ONLY_CUES;
export const GESTURE_CUES = Object.freeze({ ...PAIRED_CUES, ...BODY_ONLY_CUES });

export const VISEME_IDS = Object.freeze(['rest', 'A', 'I', 'U', 'E', 'O', 'M']);

const VISEME_MORPH_CANDIDATES = Object.freeze({
    A: ['あ', 'あ２', 'あ2', 'a', 'A', 'mouth_a', 'moutha', '口あ', '口_あ'],
    I: ['い', 'い２', 'い2', 'i', 'I', 'mouth_i', 'mouthi', '口い', '口_い'],
    U: ['う', 'う２', 'う2', 'u', 'U', 'mouth_u', 'mouthu', '口う', '口_う'],
    E: ['え', 'え２', 'え2', 'e', 'E', 'mouth_e', 'mouthe', '口え', '口_え'],
    O: ['お', 'お２', 'お2', 'o', 'O', 'mouth_o', 'moutho', '口お', '口_お'],
    M: ['ん', 'm', 'M', 'mouth_m', '口閉じ', '閉口', 'むー', 'n'],
});

const DEFAULT_NUMBERED_VISEMES = Object.freeze({
    A: 'mouth_032',
    I: 'mouth_025+mouth_026',
    U: 'mouth_021',
    E: 'mouth_025',
    O: 'mouth_023',
    M: 'mouth_001',
});

// 中文韵母 → 日文あいうえお。汉字不会对到 Morph 名，只对到 viseme。
const CJK_VISEME_CHARS = Object.freeze({
    A: '啊阿哈呀哇那他她它大打哪拉沙妈马卡撒差查巴怕拿还来开爱太外在再才改海带看谈安南难反感完晚三山劝',
    I: '一你里是以己起气其几及西喜心因音今近信事意已题体齐奇机基希衣医米比地第提你里里其',
    U: '不无呜乎出知道书入如去住服副路组足祝术数复父普部',
    E: '的了也这着得呢诶给和特则责些设社者呢么呢',
    O: '哦喔我说可我多国过火或做作走后后头口手有诱友又都走够',
    M: '吗嘛嗯门们没',
});

const CHAR_VISEME = Object.freeze(Object.fromEntries(
    Object.entries(CJK_VISEME_CHARS).flatMap(([viseme, chars]) => [...chars].map(char => [char, viseme])),
));

const FACE_LABELS = new Map(Object.entries(FACE_ONLY_CUES));
const PAIRED_LABELS = new Map(Object.entries(PAIRED_CUES));
const BODY_LABELS = new Map(Object.entries(BODY_ONLY_CUES));
const GESTURE_LABELS = new Map(Object.entries(GESTURE_CUES));
const FACE_IDS = new Set(Object.values(FACE_ONLY_CUES));
const PAIRED_IDS = new Set(Object.values(PAIRED_CUES));
const BODY_IDS = new Set(Object.values(BODY_ONLY_CUES));
const GESTURE_IDS = new Set([...PAIRED_IDS, ...BODY_IDS]);

function isKnownCueToken(text) {
    return FACE_LABELS.has(text) || PAIRED_LABELS.has(text) || BODY_LABELS.has(text);
}

// Single-letter viseme fallbacks like includes('i') match blink / pupil / eyebrow.
const FACIAL_NOISE_MORPH = /blink|wink|eyelid|eyebrow|\bbrow\b|b_brow|b_eye|b_iris|pupil|iris|highlight|まばたき|瞬き|ウィンク|ウインク|瞳孔|瞳大|瞳小|眉|涙|ハイライト|eyeclose|eye[_-]?close/i;
const MOUTH_MORPH = /^(?:[あいうえおん]$|[あいうえお][２2]$|[aiueomn]$|mouth|口|くち|lip|閉口|口閉じ|むー)|(?:mouth[_-]?[aiueomn]|口[_-]?[あいうえおん]|lips?[_-]?[aiueomn])/i;

export function isFacialNoiseMorph(name) {
    return FACIAL_NOISE_MORPH.test(String(name || ''));
}

export function isMouthVisemeMorph(name) {
    const text = String(name || '');
    if (!text || isFacialNoiseMorph(text)) return false;
    // Gakumas numbered mouths are expression slots, not あいうえお labels.
    if (/^(?:b_mouth\.)?mouth_\d+$/i.test(text)) return false;
    return MOUTH_MORPH.test(text);
}

export function normalizeVisemeAliases(value) {
    const aliases = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return aliases;
    for (const viseme of ['A', 'I', 'U', 'E', 'O', 'M']) {
        const targets = parseVisemeAliasList(value[viseme]);
        if (targets.length) aliases[viseme] = targets;
    }
    return aliases;
}

export function parseVisemeAliasList(value) {
    if (value == null || value === '') return [];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return parseVisemeAliasList(String(Math.trunc(value)));
    }
    if (Array.isArray(value)) return value.flatMap(item => parseVisemeAliasList(item));
    if (typeof value === 'object') {
        const name = String(value.name || value.morph || '').trim();
        if (!name) return [];
        const weight = Number(value.weight);
        return [{ name, weight: Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 1 }];
    }
    return String(value)
        .split(/[+,\s]+/)
        .map(name => name.trim())
        .filter(Boolean)
        .map(name => ({ name, weight: 1 }));
}

export function visemeBindingTargets(bound, viseme) {
    const value = bound?.[viseme];
    if (Array.isArray(value)) return value.filter(item => item?.name);
    if (typeof value === 'string' && value) return [{ name: value, weight: 1 }];
    return [];
}

export function allVisemeBindingTargets(bound) {
    return ['A', 'I', 'U', 'E', 'O', 'M'].flatMap(viseme => visemeBindingTargets(bound, viseme));
}

export function shouldClearFacialNoise(faceId) {
    return Boolean(faceId && faceId !== 'neutral');
}

export function snapshotVisemeInfluences(influences, dictionary, bound) {
    const saved = {};
    if (!influences || !dictionary) return saved;
    for (const target of allVisemeBindingTargets(bound)) {
        const index = dictionary[target.name];
        if (!Number.isInteger(index) || Object.prototype.hasOwnProperty.call(saved, target.name)) continue;
        saved[target.name] = influences[index] || 0;
    }
    return saved;
}

export function restoreVisemeInfluences(influences, dictionary, saved) {
    if (!saved || !influences || !dictionary) return;
    Object.entries(saved).forEach(([name, weight]) => {
        const index = dictionary[name];
        if (Number.isInteger(index)) influences[index] = weight;
    });
}

export function faceCueLabel(id) {
    const wanted = String(id || '');
    const hit = Object.entries(FACE_CUES).find(([, value]) => value === wanted);
    return hit?.[0] || wanted;
}

export function gestureCueLabel(id) {
    const wanted = String(id || '');
    const hit = Object.entries(GESTURE_CUES).find(([, value]) => value === wanted);
    return hit?.[0] || wanted;
}

export function looksLikeMotionFile(value) {
    const text = String(value || '').trim();
    return /\.vmd$/i.test(text) || /^(?:mot[-_])/i.test(text);
}

export function classifyCueToken(value, field = '') {
    const text = String(value || '').trim();
    if (!text || looksLikeMotionFile(text)) return { kind: '', id: '' };
    if (FACE_LABELS.has(text)) return { kind: 'faceOnly', id: FACE_LABELS.get(text) };
    if (PAIRED_LABELS.has(text)) return { kind: 'paired', id: PAIRED_LABELS.get(text) };
    if (BODY_LABELS.has(text)) return { kind: 'bodyOnly', id: BODY_LABELS.get(text) };
    const lower = text.toLowerCase();
    const inFace = FACE_IDS.has(lower);
    const inPaired = PAIRED_IDS.has(lower);
    const inBody = BODY_IDS.has(lower);
    if (field === 'face') {
        if (inFace) return { kind: 'faceOnly', id: lower };
        if (inPaired) return { kind: 'paired', id: lower };
        if (inBody) return { kind: 'bodyOnly', id: lower };
        return { kind: '', id: '' };
    }
    if (field === 'gesture') {
        if (inBody) return { kind: 'bodyOnly', id: lower };
        if (inPaired) return { kind: 'paired', id: lower };
        if (inFace) return { kind: 'faceOnly', id: lower };
        return { kind: '', id: '' };
    }
    if (inFace && !inPaired) return { kind: 'faceOnly', id: lower };
    if (inPaired && !inFace) return { kind: 'paired', id: lower };
    if (inBody) return { kind: 'bodyOnly', id: lower };
    if (inFace && inPaired) return { kind: 'paired', id: lower };
    return { kind: '', id: '' };
}

export function normalizeFaceCue(value) {
    const token = classifyCueToken(value, 'face');
    return token.kind === 'faceOnly' ? token.id : '';
}

export function normalizeGestureCue(value) {
    const token = classifyCueToken(value, 'gesture');
    return token.kind === 'paired' || token.kind === 'bodyOnly' ? token.id : '';
}

function findNamedMorph(names, candidate) {
    const wanted = String(candidate || '');
    if (!wanted) return '';
    const exact = names.find(name => name === wanted || name.toLowerCase() === wanted.toLowerCase());
    if (exact) return exact;
    if (/^\d{1,3}$/.test(wanted)) {
        const padded = `mouth_${wanted.padStart(3, '0')}`;
        return names.find(name => name === padded || name === `b_mouth.${padded}`) || '';
    }
    if (/^mouth_\d+$/i.test(wanted)) {
        return names.find(name => name.toLowerCase() === `b_mouth.${wanted.toLowerCase()}`) || '';
    }
    return '';
}

function resolveAliasTargets(names, targets) {
    return (Array.isArray(targets) ? targets : [])
        .map(target => {
            const name = findNamedMorph(names, target.name);
            return name ? { name, weight: target.weight } : null;
        })
        .filter(Boolean);
}

export function bindVisemeMorphs(morphNames, aliases = {}) {
    const names = Array.isArray(morphNames) ? morphNames : [];
    const bound = {};
    const explicit = normalizeVisemeAliases(aliases);
    const hasNumberedMouths = names.some(name => /^(?:b_mouth\.)?mouth_\d+$/i.test(name));
    const effectiveAliases = Object.keys(explicit).length || !hasNumberedMouths
        ? explicit
        : normalizeVisemeAliases(DEFAULT_NUMBERED_VISEMES);
    for (const viseme of ['A', 'I', 'U', 'E', 'O', 'M']) {
        if (effectiveAliases[viseme]) {
            bound[viseme] = resolveAliasTargets(names, effectiveAliases[viseme]);
            continue;
        }
        const candidates = VISEME_MORPH_CANDIDATES[viseme];
        const exact = candidates
            .map(candidate => findNamedMorph(names, candidate))
            .find(name => isMouthVisemeMorph(name));
        if (exact) {
            bound[viseme] = [{ name: exact, weight: 1 }];
            continue;
        }
        // Only longer labels such as mouth_a / 口_あ may substring-match.
        const loose = candidates
            .filter(candidate => candidate.length > 2)
            .map(candidate => names.find(name => (
                isMouthVisemeMorph(name)
                && name.toLowerCase().includes(candidate.toLowerCase())
            )))
            .find(Boolean) || '';
        bound[viseme] = loose ? [{ name: loose, weight: 1 }] : [];
    }
    return bound;
}

export function estimateVisemeTrack(text, options = {}) {
    const source = String(text || '');
    const charDuration = Number(options.charDuration) > 0 ? Number(options.charDuration) : 0.12;
    const pauseDuration = Number(options.pauseDuration) > 0 ? Number(options.pauseDuration) : 0.18;
    const track = [];
    let time = 0;
    for (const char of source) {
        if (/\s/.test(char)) continue;
        if (/[、，。！？,.!?;；：:]/.test(char)) {
            track.push({ t: time, viseme: 'rest', duration: pauseDuration });
            time += pauseDuration;
            continue;
        }
        const viseme = visemeFromChar(char);
        const duration = /[a-z]/i.test(char) ? charDuration * 0.75 : charDuration;
        track.push({ t: time, viseme, duration });
        time += duration;
    }
    if (track.length) track.push({ t: time, viseme: 'rest', duration: 0.16 });
    return track;
}

export function visemeWeightAt(track, time) {
    const list = Array.isArray(track) ? track : [];
    const weights = { A: 0, I: 0, U: 0, E: 0, O: 0, M: 0 };
    if (!list.length || time < 0) return weights;
    const current = list.find((cue, index) => {
        const next = list[index + 1];
        return time >= cue.t && (!next || time < next.t);
    }) || list[list.length - 1];
    if (!current || current.viseme === 'rest') return weights;
    const local = time - current.t;
    const span = Math.max(current.duration || 0.12, 0.04);
    const attack = Math.min(0.04, span * 0.35);
    const release = Math.min(0.05, span * 0.35);
    let weight = 0.85;
    if (local < attack) weight *= local / attack;
    else if (local > span - release) weight *= Math.max(0, (span - local) / release);
    if (weights[current.viseme] !== undefined) weights[current.viseme] = Math.min(1, weight);
    return weights;
}

export function parseAiCue(input) {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        return finalizeCue(input);
    }
    const raw = String(input || '').trim();
    if (!raw) return emptyCue('请输入台词或关键词');

    if (raw.startsWith('{')) {
        try {
            return finalizeCue(JSON.parse(raw));
        } catch {
            return emptyCue('JSON 无法解析');
        }
    }

    const tags = [];
    let text = raw.replace(/【([^】]+)】/g, (_, tag) => {
        tags.push(tag.trim());
        return ' ';
    }).trim();

    const leading = [];
    const leadingCue = /^(?:[\s。．.、,，]*)([\u4e00-\u9fff]{1,6})(?=[。．.、,，\s]|$)/;
    for (let i = 0; i < 6; i += 1) {
        const match = leadingCue.exec(text);
        if (!match || !isKnownCueToken(match[1])) break;
        leading.push(match[1]);
        text = text.slice(match[0].length).replace(/^[\s。．.、,，]+/, '');
    }

    const tokens = [...tags, ...leading];
    const kinds = pickCueKinds(tokens);
    return finalizeCue({
        face: kinds.face,
        gesture: kinds.gesture,
        pairing: kinds.pairing,
        text: text.replace(/\s+/g, ' ').trim(),
    });
}

function pickCueKinds(tokens) {
    let face = '';
    let gesture = '';
    let pairing = '';
    for (const raw of Array.isArray(tokens) ? tokens : []) {
        const token = classifyCueToken(raw);
        if (token.kind === 'faceOnly' && !face) {
            face = token.id;
        } else if ((token.kind === 'paired' || token.kind === 'bodyOnly') && !gesture) {
            gesture = token.id;
            pairing = token.kind;
        }
    }
    return { face, gesture, pairing };
}

function finalizeCue(value) {
    const warnings = [];
    const faceSource = value.face ?? value.expression ?? '';
    const gestureSource = value.gesture ?? value.action ?? '';
    if (looksLikeMotionFile(faceSource) || looksLikeMotionFile(gestureSource)) {
        warnings.push('忽略动作文件名，请改用中文关键词');
    }
    const faceToken = classifyCueToken(faceSource, 'face');
    const gestureToken = classifyCueToken(gestureSource, 'gesture');
    let face = faceToken.kind === 'faceOnly' ? faceToken.id : '';
    let gesture = '';
    if (faceToken.kind === 'paired' || faceToken.kind === 'bodyOnly') gesture = faceToken.id;
    if (gestureToken.kind === 'paired' || gestureToken.kind === 'bodyOnly') gesture = gestureToken.id;
    else if (gestureToken.kind === 'faceOnly' && !face) face = gestureToken.id;
    const text = String(value.text ?? value.speech ?? '').trim();
    if (!gesture && text) gesture = 'talk';
    const gestureKind = BODY_IDS.has(gesture) ? 'bodyOnly' : gesture ? 'paired' : '';
    const pairing = face && gesture ? 'mixed' : face ? 'faceOnly' : gestureKind;
    const visemes = Array.isArray(value.visemes)
        ? value.visemes.filter(item => item && VISEME_IDS.includes(item.viseme)).map(item => ({
            t: Math.max(0, Number(item.t) || 0),
            viseme: item.viseme,
            duration: Math.max(0.04, Number(item.duration) || 0.12),
        }))
        : [];
    const error = value.error || '';
    return {
        face,
        gesture,
        pairing,
        skipFace: Boolean(face) || pairing === 'bodyOnly',
        text,
        visemes,
        warnings,
        error,
    };
}

function emptyCue(error) {
    return { face: '', gesture: '', pairing: '', skipFace: false, text: '', visemes: [], warnings: [], error };
}

export function visemeFromChar(char) {
    const text = String(char || '');
    if (!text) return 'A';
    if (CHAR_VISEME[text]) return CHAR_VISEME[text];
    if (/[\u3040-\u30ff]/.test(text)) return kanaViseme(text);
    const latin = latinViseme(text);
    if (latin) return latin;
    return 'A';
}

function kanaViseme(char) {
    if (/[あかがさざただなはばぱまやらわアカガサザタダナハバパマヤラワ]/.test(char)) return 'A';
    if (/[いきぎしじちぢにひびぴみりイキギシジチヂニヒビピミリ]/.test(char)) return 'I';
    if (/[うくぐすずつづぬふぶぷむゆるウクグスズツヅヌフブプムユル]/.test(char)) return 'U';
    if (/[えけげせぜてでねへべぺめれエケゲセゼテデネヘベペメレ]/.test(char)) return 'E';
    if (/[おこごそぞとどのほぼぽもよろをオコゴソゾトドノホボポモヨロヲ]/.test(char)) return 'O';
    if (/[んン]/.test(char)) return 'M';
    return 'A';
}

function latinViseme(char) {
    const text = String(char || '').toLowerCase();
    if ('aáàâä'.includes(text)) return 'A';
    if ('iíìîïy'.includes(text)) return 'I';
    if ('uúùûüw'.includes(text)) return 'U';
    if ('eéèêë'.includes(text)) return 'E';
    if ('oóòôö'.includes(text)) return 'O';
    if ('mnbp'.includes(text)) return 'M';
    return '';
}
