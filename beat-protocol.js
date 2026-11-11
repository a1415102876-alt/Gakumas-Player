import { resolveNpcPortrait } from './beat-npc-portraits.js?v=20261110-hkne-3d-v1';
import { sceneIdolId, SCENE_IDOLS, STAR_EYE_IDOLS } from './scene-protocol.js?v=20261110-hkne-3d-v1';
import { BEAT_CUE_IDS, BEAT_BODY_CUE_SPECS, BEAT_EFFECT_ALIASES, BEAT_EFFECT_IDS, BEAT_FACE_ALIASES, BEAT_FACE_IDS, BEAT_OVERLAY_CUE_IDS, isBeatMotionFile, resolveBeatCueAlias } from './beat-cues.js?v=20261103-paired-face-v1';
import { normalizeFaceCue, normalizeGestureCue } from './dialogue-intent.js?v=20261026-cue-words-v1';
import { resolveBeatBackgroundAsset } from './beat-background-assets.js?v=20261029-bg-filename-v1';
import { resolveBeatCostume } from './beat-costumes.js?v=20261013-all-idol-solo1-v1';
import { BEAT_CAMERA_PRESETS, BEAT_SHOTS, beatActorId } from './beat-player-core.js?v=20261110-hkne-3d-v1';

const DEFAULT_CUES = BEAT_CUE_IDS;
const DEFAULT_SHOTS = BEAT_SHOTS;
const DEFAULT_CAMERA_PRESETS = BEAT_CAMERA_PRESETS;
const DEFAULT_WAITS = Object.freeze(['text', 'voice', 'none']);
const DEFAULT_POSITIONS = Object.freeze(['left', 'center', 'right']);
const DEFAULT_FACES = BEAT_FACE_IDS;
const DEFAULT_OVERLAYS = BEAT_OVERLAY_CUE_IDS;
const DEFAULT_EFFECTS = BEAT_EFFECT_IDS;
const BUILTIN_OTHER_SPEAKERS = new Set(['producer', '制作人', 'narrator', '旁白']);
const CUE_WORD_ALIASES = Object.freeze({
    疑问: 'ask',
    疑惑: 'ask',
    困扰: 'talk-concerned',
    为难: 'talk-concerned',
});
const FACE_WORD_ALIASES = Object.freeze({
    高兴: 'happy',
    开心: 'happy',
    得意: 'happy',
    惊讶: 'surprised',
    吃惊: 'surprised',
    害羞: 'shy',
    害臊: 'shy',
    困扰: 'sad',
    为难: 'sad',
    不安: 'sad',
    自然: 'neutral',
    平常: 'neutral',
    生气: 'angry',
    难过: 'sad',
    不开心: 'sad',
});
const SHOT_WORDS = Object.freeze({ 中景: 'medium', 近景: 'close', 特写: 'close', 反应: 'reaction', 全景: 'wide', 保持: 'keep' });
// `camera` is an optional framing override and deliberately shares the shot
// vocabulary. The same value is consumed by both 2D and 3D rendering.
const CAMERA_WORDS = SHOT_WORDS;
const BEAT_TRANSITIONS = Object.freeze({
    clock: 'clock',
    时钟: 'clock',
    时钟圆形: 'clock',
    圆形时钟: 'clock',
});

function canonToken(value, words) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return words[raw] || raw.toLowerCase();
}

function resolveCueWord(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return normalizeGestureCue(raw) || CUE_WORD_ALIASES[raw] || raw.toLowerCase();
}

function resolveFaceWord(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return FACE_WORD_ALIASES[raw] || normalizeFaceCue(raw) || raw.toLowerCase();
}
function asSet(values, fallback) {
    const source = Array.isArray(values) && values.length ? values : fallback;
    return new Set(source.map(value => String(value).trim()).filter(Boolean));
}

function parseAttributes(source) {
    const attributes = {};
    const pattern = /([A-Za-z][\w-]*)\s*=\s*(["'])(.*?)\2/g;
    let match;
    while ((match = pattern.exec(source))) attributes[match[1]] = match[3].trim();
    const costumeKeyword = source.match(/(?:^|\s)costume:([A-Za-z0-9_-]+)(?=\s|$)/i);
    if (!attributes.costume && costumeKeyword) attributes.costume = costumeKeyword[1];
    return attributes;
}

function normalizeText(text) {
    return String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/^[ \t]+|[ \t]+$/gm, '')
        .trim();
}

function stripLocalizedMarkup(value) {
    return String(value || '')
        .replace(/<tts\b[^>]*>[\s\S]*?<\/tts>/gi, '')
        .replace(/<tts\b[^>]*>[\s\S]*$/gi, '')
        .replace(/<display\b[^>]*>([\s\S]*?)<\/display>/gi, '$1')
        .replace(/<\/?display\b[^>]*>/gi, '')
        .replace(/<\/?tts\b[^>]*>/gi, '');
}

function parseLocalizedBeatText(rawText, speaker) {
    const source = String(rawText || '')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .trim();
    const displayMatch = source.match(/<display\b[^>]*\blang=["']zh["'][^>]*>([\s\S]*?)<\/display>/i)
        || source.match(/<display\b[^>]*>([\s\S]*?)<\/display>/i);
    const ttsMatch = source.match(/<tts\b[^>]*\blang=["']ja["'][^>]*>([\s\S]*?)<\/tts>/i)
        || source.match(/<tts\b[^>]*>([\s\S]*?)<\/tts>/i);
    const display = normalizeText(stripLocalizedMarkup(displayMatch ? displayMatch[1] : source));
    const voiced = isFishVoicedSpeaker(speaker);
    const ttsText = voiced && ttsMatch
        ? String(ttsMatch[1] || '')
            .replace(/<[^>]*>/g, '')
            .replace(/\[([^\]]*)\]/g, (match, value) => {
                const tag = String(value || '').trim().toLowerCase();
                return ['soft', 'pause', 'long pause', 'emphasis', 'excited', 'sighing'].includes(tag) ? `[${tag}]` : '';
            })
            .replace(/\s{2,}/g, ' ')
            .trim()
        : '';
    return { text: display, ttsText };
}

function isFishVoicedSpeaker(speaker) {
    return /(?:kotone|fktn|藤田琴音|琴音|hski|花海咲季|咲季|ttmr|月村手毬|手毬|shro|筱泽广|篠澤広|广|hmsz|秦谷美铃|美铃|kllj|葛城莉莉娅|莉莉娅|jsna|十王星南|星南|hume|花海佑芽|佑芽|hrnm|rinami|姬崎莉波|莉波|ssmk|sumika|shiun\s+sumika|紫云清夏|清夏|amao|mao|arimura\s+mao|有村麻央|麻央|atbm|tsubame|amaya\s+tsubame|雨夜燕|燕|kcna|仓本千奈|千奈|krnh|贺阳燐羽|賀陽燐羽|燐羽|nasr|asari|亚纱里|亜紗里)/i.test(String(speaker || ''));
}

function addError(errors, code, message, index, beat = null) {
    errors.push({ code, message, index, beat });
}

function parseChoiceEvent(input, errors) {
    const source = String(input || '');
    const openIndex = source.search(/<choice\b/i);
    if (openIndex < 0) return { storySource: source, choices: [] };
    const closeIndex = source.toLowerCase().indexOf('</choice>', openIndex);
    if (closeIndex < 0) {
        addError(errors, 'malformed-choice', '选项事件缺少结束标签，已忽略。', openIndex);
        return { storySource: source, choices: [] };
    }
    const blockEnd = closeIndex + '</choice>'.length;
    if (/<choice\b/i.test(source.slice(blockEnd))) {
        addError(errors, 'extra-choice', '一段演出只保留第一个选项事件。', source.slice(blockEnd).search(/<choice\b/i) + blockEnd);
    }
    if (/<beat\b/i.test(source.slice(blockEnd))) {
        addError(errors, 'choice-trailing', '选项之后的 Beat 不进入本段演出。', blockEnd);
    }
    const body = source.slice(source.indexOf('>', openIndex) + 1, closeIndex);
    const choices = [];
    const optionPattern = /<option\b[^>]*>([\s\S]*?)<\/option>/gi;
    let optionMatch;
    while ((optionMatch = optionPattern.exec(body))) {
        const text = normalizeText(stripLocalizedMarkup(optionMatch[1]));
        if (!text) {
            addError(errors, 'empty-option', '空选项已跳过。', openIndex + optionMatch.index);
            continue;
        }
        choices.push({ id: `c${String(choices.length + 1).padStart(2, '0')}`, text });
    }
    if (choices.length !== 4) {
        addError(errors, 'choice-count', `选项事件需要 4 个选项，当前是 ${choices.length} 个。`, openIndex);
        return { storySource: source.slice(0, openIndex), choices: [] };
    }
    return { storySource: source.slice(0, openIndex), choices: choices.slice(0, 4) };
}

/**
 * Parse the small, AI-facing Beat markup used by the prototype.
 * The parser intentionally returns usable beats together with diagnostics so a
 * single malformed or invented tag cannot stop the whole scene.
 */
export function parseBeatScript(source, options = {}) {
    const input = String(source ?? '');
    const actors = Array.isArray(options.actors) && options.actors.length
        ? asSet(options.actors, [])
        : null;
    const cues = asSet(options.cues, DEFAULT_CUES);
    const shots = asSet(options.shots, DEFAULT_SHOTS);
    const cameraPresets = asSet(options.cameraPresets, DEFAULT_CAMERA_PRESETS);
    const waits = asSet(options.waits, DEFAULT_WAITS);
    const positions = asSet(options.positions, DEFAULT_POSITIONS);
    const faces = asSet(options.faces, DEFAULT_FACES);
    const overlays = asSet(options.overlays, DEFAULT_OVERLAYS);
    const effects = asSet(options.effects, DEFAULT_EFFECTS);
    const backgrounds = asSet(options.backgrounds, []);
    const beats = [];
    const errors = [];
    const choiceEvent = parseChoiceEvent(input, errors);
    const storySource = choiceEvent.storySource;
    let searchIndex = 0;
    let previousLook = 'auto';
    let previousShot = 'keep';
    let previousBackground = '';
    let previousBackgroundAsset = null;
    const costumeByActor = new Map();
    for (const [actor, value] of Object.entries(options.defaultCostumes || {})) {
        const idolId = sceneIdolId(actor) || (actor === 'kotone' ? 'fktn' : actor);
        const costume = resolveBeatCostume(value, idolId);
        if (costume) costumeByActor.set(idolId, costume);
    }
    if (options.defaultBackground) {
        const initial = resolveBeatBackgroundAsset(options.defaultBackground, { backgrounds: [...backgrounds] });
        if (initial.matched) { previousBackground = initial.name; previousBackgroundAsset = initial; }
    }

    while (searchIndex < storySource.length) {
        const open = /<beat\b([^>]*)>/gi;
        open.lastIndex = searchIndex;
        const opening = open.exec(storySource);
        if (!opening) break;

        const openIndex = opening.index;
        const contentStart = open.lastIndex;
        const closeIndex = storySource.toLowerCase().indexOf('</beat>', contentStart);
        const nestedIndex = storySource.toLowerCase().indexOf('<beat', contentStart);
        if (closeIndex < 0 || (nestedIndex >= 0 && nestedIndex < closeIndex)) {
            addError(errors, 'malformed-beat', 'Beat 缺少结束标签，已跳过该段。', openIndex);
            searchIndex = nestedIndex >= 0 && nestedIndex < closeIndex ? nestedIndex : storySource.length;
            continue;
        }

        const attributes = parseAttributes(opening[1]);
        const rawText = storySource.slice(contentStart, closeIndex);
        const localized = parseLocalizedBeatText(rawText, attributes.speaker || 'narrator');
        const text = localized.text;
        const beatNumber = beats.length + 1;
        const beatId = attributes.id || `b${String(beatNumber).padStart(2, '0')}`;
        const speaker = attributes.speaker || 'narrator';
        const portrait = resolveNpcPortrait(speaker, attributes.face);

        if (!attributes.speaker) addError(errors, 'missing-speaker', 'Beat 缺少 speaker，按旁白处理。', openIndex, beatId);
        if (actors && !portrait && !BUILTIN_OTHER_SPEAKERS.has(speaker) && !actors.has(speaker) && options.allowOtherSpeakers !== true) {
            addError(errors, 'unknown-speaker', `未知角色：${speaker}。`, openIndex, beatId);
        }
        if (!text) {
            addError(errors, 'empty-text', 'Beat 没有台词文本，已跳过。', openIndex, beatId);
            searchIndex = closeIndex + '</beat>'.length;
            continue;
        }

        const requestedCue = String(attributes.cue || '').trim();
        const motionFile = isBeatMotionFile(requestedCue);
        let cue = motionFile ? requestedCue.replace(/\\/gu, '/').split('/').pop() : resolveCueWord(requestedCue || 'talk');
        if (!motionFile && !cues.has(cue)) {
            addError(errors, 'unknown-cue', `未知动作：${cue}，已回退到 talk。`, openIndex, beatId);
            cue = cues.has('talk') ? 'talk' : [...cues][0] || 'idle';
        }

        const rawFace = String(attributes.face || '').trim();
        const faceMotion = !portrait && isBeatMotionFile(rawFace);
        let face = portrait ? portrait.emotion : (faceMotion ? rawFace.replace(/\\/gu, '/').split('/').pop() : resolveFaceWord(rawFace));
        if (portrait) {
            if (!portrait.matchedFace) addError(errors, 'unknown-portrait-face', `当前角色没有立绘表情：${attributes.face}，已回退到默认立绘。`, openIndex, beatId);
        } else if (!faceMotion) {
            face = BEAT_FACE_ALIASES[face] || face;
            if (face && !faces.has(face)) {
                addError(errors, 'unknown-face', `未知独立表情：${face}，已回退到默认表情。`, openIndex, beatId);
                face = '';
            }
        }
        const overlay = [...new Set(String(attributes.overlay || '')
            .split(/[,，;；\s]+/u)
            .map(value => value.trim().toLowerCase())
            .filter(Boolean))];
        const invalidOverlays = overlay.filter(value => !overlays.has(value));
        if (invalidOverlays.length) {
            addError(errors, 'unknown-overlay', `未知叠加动作：${invalidOverlays.join('、')}，已忽略。`, openIndex, beatId);
        }
        let validOverlays = overlay.filter(value => overlays.has(value));
        const effect = [...new Set(String(attributes.effect || '')
            .split(/[,，;；\s]+/u)
            .map(value => BEAT_EFFECT_ALIASES[value.trim().toLowerCase()] || value.trim().toLowerCase())
            .filter(Boolean))];
        const invalidEffects = effect.filter(value => !effects.has(value));
        if (invalidEffects.length) {
            addError(errors, 'unknown-effect', `未知面部特殊效果：${invalidEffects.join('、')}，已忽略。`, openIndex, beatId);
        }
        let validEffects = effect.filter(value => effects.has(value));
        const normalizedSpeaker = String(speaker || '').trim().toLowerCase();
        const speakerId = sceneIdolId(speaker) || (normalizedSpeaker === 'kotone' ? 'fktn' : normalizedSpeaker);
        const actorId = beatActorId(speaker);
        if (attributes.costume) {
            const costume = actorId && resolveBeatCostume(attributes.costume, actorId);
            if (costume) costumeByActor.set(actorId, costume);
            else addError(errors, 'unknown-costume', `当前说话人不能使用服装 ${attributes.costume}，已沿用原服装。`, openIndex, beatId);
        }
        if (actorId && !costumeByActor.has(actorId)) costumeByActor.set(actorId, 'Default');
        if (validEffects.includes('star-eyes') && !STAR_EYE_IDOLS.includes(speakerId)) {
            addError(errors, 'effect-character', '当前角色没有星星眼材质，已忽略当前说话人的 star-eyes。', openIndex, beatId);
            validEffects = validEffects.filter(value => value !== 'star-eyes');
        }
        if (validEffects.length && ['producer', '制作人', 'narrator', '旁白'].includes(speaker)) {
            addError(errors, 'effect-speaker', '面部特殊效果只能用于偶像说话人，已忽略。', openIndex, beatId);
            validEffects = [];
        }
        const bodySpec = BEAT_BODY_CUE_SPECS[cue];
        if (portrait) {
            // A 2D NPC face must never change the last visible idol's morphs.
            validOverlays = [];
            validEffects = [];
        } else if (motionFile || faceMotion) {
            validOverlays = [];
        } else if (bodySpec) face ||= bodySpec.defaultFace;
        else {
            if (face) addError(errors, 'paired-face', '成套动作自带表情，已忽略独立 face。', openIndex, beatId);
            if (validOverlays.length) addError(errors, 'paired-overlay', '叠加动作需搭配独立身体动作，已忽略 overlay。', openIndex, beatId);
            face = '';
            validOverlays = [];
        }
        if (validOverlays.length > 1) {
            addError(errors, 'conflicting-overlays', '同一段只能选择点头或摇头的一种叠加，已保留第一项。', openIndex, beatId);
            validOverlays = validOverlays.slice(0, 1);
        }

        let shot = canonToken(attributes.shot, SHOT_WORDS) || previousShot;
        if (!shots.has(shot)) {
            addError(errors, 'unknown-shot', `未知镜头：${shot}，已回退到 keep。`, openIndex, beatId);
            shot = shots.has('keep') ? 'keep' : [...shots][0] || 'keep';
        }

        let camera = canonToken(attributes.camera, CAMERA_WORDS);
        if (camera && !cameraPresets.has(camera)) {
            addError(errors, 'unknown-camera', '未知 camera 景别：' + camera + '，已忽略。', openIndex, beatId);
            camera = '';
        }
        if (attributes['camera-motion'] || attributes['camera-ease'] || attributes['camera-duration']) {
            addError(errors, 'deprecated-camera-motion', 'camera-motion/camera-ease/camera-duration 已停用；camera 直接作用于 2D 和 3D 景别。', openIndex, beatId);
        }

        const look = attributes.look || previousLook;
        let position = String(attributes.position || '').trim().toLowerCase();
        if (position === 'middle') position = 'center';
        if (position && !positions.has(position)) {
            addError(errors, 'unknown-position', `未知站位：${position}，已交给播放器自动分配。`, openIndex, beatId);
            position = '';
        }
        if (attributes.background) {
            const requestedBackground = String(attributes.background).trim();
            const resolvedBackground = resolveBeatBackgroundAsset(requestedBackground, {
                backgrounds: [...backgrounds],
                category: options.backgroundCategory || '',
                context: options.backgroundContext || '',
            });
            if ((backgrounds.size || resolvedBackground.kind === '3d' || resolvedBackground.categoryMismatch) && !resolvedBackground.matched) {
                addError(errors, 'unknown-background', `未知背景：${requestedBackground}，已沿用上一背景。`, openIndex, beatId);
            } else {
                previousBackground = resolvedBackground.name || requestedBackground;
                previousBackgroundAsset = resolvedBackground.matched ? resolvedBackground : null;
            }
        }
        const background = previousBackground;
        let wait = attributes.wait || 'text';
        if (!waits.has(wait)) {
            addError(errors, 'unknown-wait', `未知等待方式：${wait}，已回退到 text。`, openIndex, beatId);
            wait = 'text';
        }
        const requestedTransition = String(attributes.transition || '').trim();
        const transition = BEAT_TRANSITIONS[requestedTransition] || BEAT_TRANSITIONS[requestedTransition.toLowerCase()] || '';
        if (requestedTransition && !transition) {
            addError(errors, 'unknown-transition', `未知转场：${requestedTransition}，已忽略。`, openIndex, beatId);
        }

        const beat = { id: beatId, speaker, cue, look, shot, text, wait };
        if (transition) beat.transition = transition;
        if (localized.ttsText && isFishVoicedSpeaker(speaker)) beat.ttsText = localized.ttsText;
        if (face) beat.face = face;
        if (portrait) beat.portrait = portrait;
        if (validOverlays.length) beat.overlay = validOverlays;
        if (validEffects.length) beat.effects = validEffects;
        if (background) beat.background = background;
        if (actorId) beat.costume = costumeByActor.get(actorId);
        beat.costumes = Object.fromEntries(costumeByActor);
        if (previousBackgroundAsset) beat.backgroundAsset = previousBackgroundAsset;
        if (position) beat.position = position;
        if (camera) beat.camera = camera;
        const cameraPose = parseCameraPose(attributes['camera-pose']);
        if (String(attributes['camera-pose'] || '').trim() && !cameraPose) {
            addError(errors, 'invalid-camera-pose', 'camera-pose 需要 x,y,z,水平角,俯仰角 五个数字，已忽略。', openIndex, beatId);
        }
        if (cameraPose) beat.cameraPose = cameraPose;
        const focal = parseFocalLength(attributes.focal);
        if (String(attributes.focal || '').trim() && !focal) {
            addError(errors, 'invalid-focal', 'focal 需要一个正数毫米焦距，已忽略。', openIndex, beatId);
        }
        if (focal) beat.focal = focal;
        const dof = parseDepthOfField(attributes.dof);
        if (String(attributes.dof || '').trim() && !dof) {
            addError(errors, 'invalid-dof', 'dof 需要光圈，或光圈,对焦距离，已忽略。', openIndex, beatId);
        }
        if (dof) beat.dof = dof;
        const actorPose = parseActorPose(attributes['actor-pose']);
        if (String(attributes['actor-pose'] || '').trim() && !actorPose) {
            addError(errors, 'invalid-actor-pose', 'actor-pose 需要 x,y,z,朝向 四个数字，已忽略。', openIndex, beatId);
        }
        if (actorPose) beat.actorPose = actorPose;
        const cameraMove = parseCameraMove(attributes['camera-move']);
        if (String(attributes['camera-move'] || '').trim() && !cameraMove) {
            addError(errors, 'invalid-camera-move', 'camera-move 需要起点 x,y,z,水平角,俯仰角，终点 x,y,z,水平角,俯仰角，以及秒数，已忽略。', openIndex, beatId);
        }
        if (cameraMove) beat.cameraMove = cameraMove;
        const cameraWalk = parseCameraWalk(attributes['camera-walk']);
        if (cameraWalk === true && cameraMove) beat.cameraMove.walk = true;
        else if (cameraWalk === true) addError(errors, 'invalid-camera-walk', 'camera-walk 需要同时写完整的 camera-move，已忽略。', openIndex, beatId);
        else if (cameraWalk == null) addError(errors, 'invalid-camera-walk', 'camera-walk 只能写 1，已忽略。', openIndex, beatId);
        const actorMove = parseActorMove(attributes['actor-move']);
        if (String(attributes['actor-move'] || '').trim() && !actorMove) {
            addError(errors, 'invalid-actor-move', 'actor-move 需要起点 x,y,z,朝向，终点 x,y,z,朝向，以及秒数，已忽略。', openIndex, beatId);
        }
        if (actorMove) beat.actorMove = actorMove;
        beats.push(beat);
        previousLook = look;
        previousShot = shot;
        searchIndex = closeIndex + '</beat>'.length;
    }

    if (!beats.length && storySource.trim()) {
        addError(errors, 'no-beats', '没有找到可播放的 beat。', 0);
    }

    return { beats, choices: choiceEvent.choices, errors };
}

export const BEAT_DEFAULTS = Object.freeze({
    cues: DEFAULT_CUES,
    shots: DEFAULT_SHOTS,
    waits: DEFAULT_WAITS,
    positions: DEFAULT_POSITIONS,
    faces: DEFAULT_FACES,
    overlays: DEFAULT_OVERLAYS,
    effects: DEFAULT_EFFECTS,
});

/** Resolve friendly aliases and paired family IDs for the Stage cue parser. */
export function parseCameraPose(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return parseCameraPose([value.x, value.y, value.z, value.yaw, value.pitch].join(','));
    }
    const parts = String(value || '').split(',').map(part => Number(String(part).trim()));
    if (parts.length !== 5 || parts.some(part => !Number.isFinite(part))) return null;
    const [x, y, z, yaw, pitch] = parts;
    return { x, y, z, yaw, pitch: Math.min(80, Math.max(-80, pitch)) };
}

export function parseFocalLength(value) {
    const focal = Number(String(value ?? '').trim());
    if (!Number.isFinite(focal) || focal <= 0) return null;
    return Math.min(200, Math.max(10, focal));
}

export function formatFocalLength(value) {
    const focal = parseFocalLength(value);
    return focal ? String(Math.round(focal * 10) / 10) : '';
}

export function parseDepthOfField(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const focus = value.focus == null || value.focus === '' ? '' : value.focus;
        return parseDepthOfField([value.aperture, focus].filter(part => part !== '').join(','));
    }
    const parts = String(value ?? '').split(',').map(part => part.trim()).filter(Boolean);
    if (!parts.length || parts.length > 2) return null;
    const aperture = Number(parts[0]);
    if (!Number.isFinite(aperture) || aperture <= 0) return null;
    const dof = { aperture: Math.min(22, Math.max(1.2, aperture)) };
    if (parts.length === 2) {
        const focus = Number(parts[1]);
        if (!Number.isFinite(focus) || focus <= 0) return null;
        dof.focus = focus;
    }
    return dof;
}

export function formatDepthOfField(value) {
    const dof = parseDepthOfField(value);
    if (!dof) return '';
    const aperture = String(Math.round(dof.aperture * 10) / 10);
    if (!Number.isFinite(dof.focus)) return aperture;
    return `${aperture},${String(Math.round(dof.focus * 1000) / 1000)}`;
}

export function formatCameraPose(pose) {
    const parsed = parseCameraPose(pose);
    if (!parsed) return '';
    return [parsed.x, parsed.y, parsed.z, parsed.yaw, parsed.pitch]
        .map(value => String(Math.round(value * 1000) / 1000))
        .join(',');
}

export function parseActorPose(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return parseActorPose([value.x, value.y, value.z, value.yaw].join(','));
    }
    const parts = String(value || '').split(',').map(part => Number(String(part).trim()));
    if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return null;
    const [x, y, z, yaw] = parts;
    return { x, y, z, yaw };
}

export function formatActorPose(pose) {
    const parsed = parseActorPose(pose);
    if (!parsed) return '';
    return [parsed.x, parsed.y, parsed.z, parsed.yaw]
        .map(value => String(Math.round(value * 1000) / 1000))
        .join(',');
}

function copyActorPose(pose) {
    const parsed = parseActorPose(pose);
    return parsed ? { ...parsed } : null;
}

// A free pose belongs to the actor, not the line. Later lines keep the last
// placement until that same actor writes a new one. A finished move leaves
// the actor at its destination.
export function resolveActorPoses(beats, index) {
    const poses = new Map();
    const list = Array.isArray(beats) ? beats : [];
    if (!list.length) return poses;
    const requested = Number(index);
    const last = Math.min(Math.max(Number.isFinite(requested) ? requested : 0, 0), list.length - 1);
    for (let i = 0; i <= last; i++) {
        const beat = list[i];
        const idolId = beatActorId(beat?.speaker);
        if (!idolId) continue;
        const pose = copyActorPose(beat?.actorPose);
        if (pose) poses.set(idolId, pose);
        if (i < last) {
            const arrived = copyActorPose(beat?.actorMove?.to);
            if (arrived) poses.set(idolId, arrived);
        }
    }
    return poses;
}

function roundMoveNumber(value) {
    return String(Math.round(value * 1000) / 1000);
}

function clampMovePitch(pitch) {
    return Math.min(80, Math.max(-80, pitch));
}

function cameraMovePose(parts) {
    const [x, y, z, yaw, pitch] = parts;
    return { x, y, z, yaw, pitch: clampMovePitch(pitch) };
}

export function parseCameraMove(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const from = value.from || {};
        const to = value.to || {};
        return parseCameraMove([from.x, from.y, from.z, from.yaw, from.pitch, to.x, to.y, to.z, to.yaw, to.pitch, value.duration].join(','));
    }
    const parts = String(value || '').split(',').map(part => Number(String(part).trim()));
    if (parts.length !== 11 || parts.some(part => !Number.isFinite(part)) || parts[10] <= 0) return null;
    return { from: cameraMovePose(parts.slice(0, 5)), to: cameraMovePose(parts.slice(5, 10)), duration: parts[10] };
}

export function formatCameraMove(move) {
    const parsed = parseCameraMove(move);
    if (!parsed) return '';
    return [parsed.from.x, parsed.from.y, parsed.from.z, parsed.from.yaw, parsed.from.pitch, parsed.to.x, parsed.to.y, parsed.to.z, parsed.to.yaw, parsed.to.pitch, parsed.duration].map(roundMoveNumber).join(',');
}

const CAMERA_WALK_STEPS_PER_SECOND = 1.2;
const CAMERA_WALK_AMPLITUDE = 0.16;

export function parseCameraWalk(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text || text === '0' || text === 'false' || text === 'off') return false;
    if (text === '1' || text === 'true' || text === 'walk' || text === 'on') return true;
    return null;
}

// A walking operator bobs once per footstep. The offset is world-up, starts and
// ends at zero, and stays regular through the middle of the move.
export function cameraWalkOffset(elapsed, duration) {
    const time = Number(elapsed);
    const span = Number(duration);
    if (!Number.isFinite(time) || !Number.isFinite(span) || span <= 0 || time <= 0 || time >= span) return 0;
    const fade = Math.min(1, time / 0.18, (span - time) / 0.22);
    return Math.sin(time * Math.PI * 2 * CAMERA_WALK_STEPS_PER_SECOND) * CAMERA_WALK_AMPLITUDE * fade;
}

function actorMovePose(parts) {
    const [x, y, z, yaw] = parts;
    return { x, y, z, yaw };
}

export function parseActorMove(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const from = value.from || {};
        const to = value.to || {};
        return parseActorMove([from.x, from.y, from.z, from.yaw, to.x, to.y, to.z, to.yaw, value.duration].join(','));
    }
    const parts = String(value || '').split(',').map(part => Number(String(part).trim()));
    if (parts.length !== 9 || parts.some(part => !Number.isFinite(part)) || parts[8] <= 0) return null;
    return { from: actorMovePose(parts.slice(0, 4)), to: actorMovePose(parts.slice(4, 8)), duration: parts[8] };
}

export function formatActorMove(move) {
    const parsed = parseActorMove(move);
    if (!parsed) return '';
    return [parsed.from.x, parsed.from.y, parsed.from.z, parsed.from.yaw, parsed.to.x, parsed.to.y, parsed.to.z, parsed.to.yaw, parsed.duration].map(roundMoveNumber).join(',');
}

export function resolveBeatCue(cue, face = '') {
    return resolveBeatCueAlias(cue, face);
}

function resolveActorId(value, nameMap) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (Object.hasOwn(nameMap, raw)) return sceneIdolId(nameMap[raw]) || raw;
    const entry = Object.entries(nameMap).find(([, name]) => name === raw);
    return sceneIdolId(raw) || (entry ? sceneIdolId(entry[1]) || entry[0] : raw);
}

/**
 * Convert parsed beats into the slide shape consumed by SceneDirector. The
 * player keeps dialogue and presentation intent separate: action cues are
 * played when the current beat is spoken, while these slides establish cast,
 * placement, and attention targets.
 */
export function buildStageSlides(beats, nameMap = {}) {
    const slides = [];
    const beatIndexes = [];
    const entered = new Set();
    const positions = ['center', 'right', 'left'];
    const positionByActor = new Map();
    const targetId = value => {
        const raw = String(value || '').trim().toLowerCase();
        if (['camera', 'none', 'auto'].includes(raw)) return raw;
        return resolveActorId(value, nameMap);
    };
    const ensureActor = (idolId, position) => {
        if (!idolId) return;
        const nextPosition = position || positionByActor.get(idolId) || positions[positionByActor.size] || 'right';
        if (!positionByActor.has(idolId)) positionByActor.set(idolId, nextPosition);
        else if (position && positionByActor.get(idolId) !== position) {
            positionByActor.set(idolId, position);
            slides.push({ type: 'stage', action: 'position', idolId, position, speaker: '', text: '' });
        }
        if (!entered.has(idolId)) {
            entered.add(idolId);
            slides.push({ type: 'stage', action: 'enter', idolId, position: positionByActor.get(idolId), speaker: '', text: '' });
        }
    };

    for (const beat of Array.isArray(beats) ? beats : []) {
        const speakerName = nameMap[beat.speaker] || beat.speaker || '';
        // A Beat may be spoken by a non-idol (for example producer). Keep the
        // dialogue slide and label, but only idols create stage actors.
        const idolId = sceneIdolId(speakerName);
        if (idolId) {
            const interactionTarget = ['pinch', 'pinch-receive', 'shake', 'shake-receive'].includes(String(beat.cue || '').toLowerCase())
                ? targetId(beat.look)
                : '';
            if (interactionTarget && interactionTarget !== idolId && Object.values(SCENE_IDOLS).includes(interactionTarget)) {
                ensureActor(interactionTarget, beat.position || positionByActor.get(idolId) || 'center');
                ensureActor(idolId, beat.position || positionByActor.get(interactionTarget) || 'center');
            } else ensureActor(idolId, beat.position);
            if (beat.look && beat.look !== 'auto') {
                slides.push({ type: 'stage', action: 'look', idolId, target: targetId(beat.look) || 'camera', duration: 0, speaker: '', text: '' });
            }
        }
        beatIndexes.push(slides.length);
        const dialogueSlide = { type: 'dialogue', speaker: speakerName, text: beat.text || '' };
        if (beat.ttsText) dialogueSlide.ttsText = beat.ttsText;
        slides.push(dialogueSlide);
    }
    return { slides, beatIndexes };
}
