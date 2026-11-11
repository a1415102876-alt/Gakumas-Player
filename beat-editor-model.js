import { formatActorMove, formatActorPose, formatCameraMove, formatCameraPose, formatDepthOfField, formatFocalLength, parseActorMove, parseActorPose, parseBeatScript, parseCameraMove, parseCameraPose, parseCameraWalk, parseDepthOfField, parseFocalLength } from './beat-protocol.js?v=20261111-beat-breath-tts-v2';

const STANDARD_ATTRIBUTES = Object.freeze(new Set([
  'id', 'speaker', 'cue', 'face', 'overlay', 'effect', 'look', 'position',
  'background', 'shot', 'wait', 'transition', 'camera', 'focal', 'dof', 'camera-pose', 'camera-move', 'camera-walk', 'actor-pose', 'actor-move', 'camera-motion', 'camera-ease',
  'camera-duration', 'costume',
]));

const FIELD_TO_ATTRIBUTE = Object.freeze({
  id: 'id',
  speaker: 'speaker',
  cue: 'cue',
  face: 'face',
  overlay: 'overlay',
  effects: 'effect',
  look: 'look',
  position: 'position',
  background: 'background',
  shot: 'shot',
  wait: 'wait',
  transition: 'transition',
  camera: 'camera',
  focal: 'focal',
  dof: 'dof',
  cameraPose: 'camera-pose',
  cameraMove: 'camera-move',
  actorPose: 'actor-pose',
  actorMove: 'actor-move',
  cameraMotion: 'camera-motion',
  cameraEase: 'camera-ease',
  cameraDuration: 'camera-duration',
  costume: 'costume',
});
const LEGACY_CAMERA_ATTRIBUTES = new Set(['camera-motion', 'camera-ease', 'camera-duration']);

const ARRAY_FIELDS = new Set(['overlay', 'effects']);

function text(value) {
  return String(value ?? '');
}

function trimText(value) {
  return text(value).trim();
}

function escapeAttribute(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeBody(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseRawAttributes(source) {
  const attributes = {};
  const pattern = /([A-Za-z][\w-]*)\s*=\s*(["'])(.*?)\2/g;
  let match;
  while ((match = pattern.exec(text(source)))) attributes[match[1]] = match[3];
  return attributes;
}

function splitArray(value) {
  return [...new Set(text(value).split(/[,，;；\s]+/u).map(item => item.trim()).filter(Boolean))];
}

function decodeMarkup(value) {
  return text(value)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"');
}

function removeLocalizedBlocks(body) {
  return text(body)
    .replace(/<display\b[^>]*>[\s\S]*?<\/display>/giu, '')
    .replace(/<tts\b[^>]*>[\s\S]*?<\/tts>/giu, '')
    .trim();
}

function readLocalizedBody(body) {
  const raw = text(body);
  const display = raw.match(/<display\b[^>]*>([\s\S]*?)<\/display>/iu)?.[1];
  const tts = raw.match(/<tts\b[^>]*>([\s\S]*?)<\/tts>/iu)?.[1];
  const legacy = display == null && tts == null ? raw : '';
  return {
    text: decodeMarkup(display == null ? legacy : display).trim(),
    ttsText: decodeMarkup(tts || '').trim(),
    rawBodyExtras: display == null && tts == null ? '' : removeLocalizedBlocks(raw),
  };
}

function makeId(index = 0) {
  return `b${String(Math.max(1, Number(index) + 1)).padStart(2, '0')}`;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return [...new Set(value.map(item => trimText(item)).filter(Boolean))];
  return splitArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  return value;
}

function readCameraMove(source) {
  const hasObject = Object.hasOwn(source, 'cameraMove');
  const move = hasObject
    ? parseCameraMove(source.cameraMove)
    : parseCameraMove(source.rawAttributes?.['camera-move']);
  if (!move) return null;
  const walk = hasObject
    ? source.cameraMove?.walk === true
    : parseCameraWalk(source.rawAttributes?.['camera-walk']) === true;
  if (walk) move.walk = true;
  return move;
}

function sanitizeBeat(beat, index = 0) {
  const source = beat && typeof beat === 'object' ? beat : {};
  const result = {
    id: trimText(source.id) || makeId(index),
    speaker: trimText(source.speaker),
    cue: trimText(source.cue) || 'talk',
    face: trimText(source.face),
    overlay: normalizeArray(source.overlay),
    effects: normalizeArray(source.effects),
    look: trimText(source.look) || 'auto',
    position: trimText(source.position),
    background: trimText(source.background),
    shot: trimText(source.shot) || 'medium',
    wait: trimText(source.wait) || 'text',
    transition: trimText(source.transition) === 'clock' ? 'clock' : '',
    camera: trimText(source.camera),
    focal: Object.hasOwn(source, 'focal') ? parseFocalLength(source.focal) : parseFocalLength(source.rawAttributes?.focal),
    dof: Object.hasOwn(source, 'dof') ? parseDepthOfField(source.dof) : parseDepthOfField(source.rawAttributes?.dof),
    cameraPose: Object.hasOwn(source, 'cameraPose')
      ? parseCameraPose(source.cameraPose)
      : parseCameraPose(source.rawAttributes?.['camera-pose']),
    cameraMove: readCameraMove(source),
    actorPose: Object.hasOwn(source, 'actorPose')
      ? parseActorPose(source.actorPose)
      : parseActorPose(source.rawAttributes?.['actor-pose']),
    actorMove: Object.hasOwn(source, 'actorMove')
      ? parseActorMove(source.actorMove)
      : parseActorMove(source.rawAttributes?.['actor-move']),
    cameraMotion: trimText(source.cameraMotion),
    cameraEase: trimText(source.cameraEase),
    cameraDuration: Number.isFinite(Number(source.cameraDuration)) && Number(source.cameraDuration) > 0 ? Number(source.cameraDuration) : 0,
    costume: trimText(source.costume),
    text: trimText(source.text),
    ttsText: trimText(source.ttsText),
    costumes: cloneValue(source.costumes || {}),
    rawAttributes: { ...(source.rawAttributes || {}) },
    rawBodyExtras: text(source.rawBodyExtras || '').trim(),
    rawLead: text(source.rawLead || ''),
  };
  if (source.portrait) result.portrait = cloneValue(source.portrait);
  if (source.backgroundAsset) result.backgroundAsset = cloneValue(source.backgroundAsset);
  return result;
}

function sourceBeatMatches(source) {
  const matches = [];
  const pattern = /<beat\b([^>]*)>[\s\S]*?<\/beat>/giu;
  let match;
  while ((match = pattern.exec(text(source)))) {
    const full = match[0];
    const openEnd = full.indexOf('>');
    const bodyStart = openEnd + 1;
    const bodyEnd = full.toLowerCase().lastIndexOf('</beat>');
    matches.push({
      full,
      index: match.index,
      end: pattern.lastIndex,
      attributesSource: match[1] || '',
      body: bodyEnd >= bodyStart ? full.slice(bodyStart, bodyEnd) : '',
    });
  }
  return matches;
}

function rawAttributePatch(normalized, rawAttributes) {
  const result = { ...(rawAttributes || {}) };
  for (const [field, attribute] of Object.entries(FIELD_TO_ATTRIBUTE)) {
    if (!Object.hasOwn(normalized, field)) continue;
    if (ARRAY_FIELDS.has(field)) {
      const values = normalizeArray(normalized[field]);
      if (values.length) result[attribute] = values.join(',');
      else delete result[attribute];
    } else if (field === 'cameraDuration') {
      if (Number(normalized[field]) > 0) result[attribute] = String(normalized[field]);
      else delete result[attribute];
    } else if (field === 'focal') {
      const formatted = formatFocalLength(normalized.focal);
      if (formatted) result[attribute] = formatted;
      else delete result[attribute];
    } else if (field === 'dof') {
      const formatted = formatDepthOfField(normalized.dof);
      if (formatted) result[attribute] = formatted;
      else delete result[attribute];
    } else if (field === 'cameraPose') {
      const formatted = formatCameraPose(normalized.cameraPose);
      if (formatted) result[attribute] = formatted;
      else delete result[attribute];
    } else if (field === 'actorPose') {
      const formatted = formatActorPose(normalized.actorPose);
      if (formatted) result[attribute] = formatted;
      else delete result[attribute];
    } else if (field === 'cameraMove') {
      const formatted = formatCameraMove(normalized.cameraMove);
      if (formatted) result[attribute] = formatted;
      else delete result[attribute];
      if (formatted && normalized.cameraMove?.walk) result['camera-walk'] = '1';
      else delete result['camera-walk'];
    } else if (field === 'actorMove') {
      const formatted = formatActorMove(normalized.actorMove);
      if (formatted) result[attribute] = formatted;
      else delete result[attribute];
    } else {
      const value = trimText(normalized[field]);
      if (value) result[attribute] = value;
      else if (LEGACY_CAMERA_ATTRIBUTES.has(attribute)) continue;
      else if (STANDARD_ATTRIBUTES.has(attribute)) delete result[attribute];
    }
  }
  return result;
}

function attributesText(beat, index) {
  const values = rawAttributePatch(beat, beat.rawAttributes);
  values.id = trimText(beat.id) || makeId(index);
  values.speaker = trimText(beat.speaker);
  values.cue = trimText(beat.cue) || 'talk';
  const preferredOrder = ['id', 'speaker', 'cue', 'face', 'overlay', 'effect', 'look', 'position', 'actor-pose', 'actor-move', 'background', 'shot', 'wait', 'transition', 'camera', 'focal', 'dof', 'camera-pose', 'camera-move', 'camera-walk', 'camera-motion', 'camera-ease', 'camera-duration', 'costume'];
  const keys = [...new Set([...preferredOrder, ...Object.keys(values)])].filter(key => values[key] != null && values[key] !== '');
  return keys.map(key => `${key}="${escapeAttribute(values[key])}"`).join(' ');
}

function bodyText(beat) {
  const parts = [`<display lang="zh">${escapeBody(beat.text)}</display>`];
  if (trimText(beat.ttsText)) parts.push(`<tts lang="ja">${escapeBody(beat.ttsText)}</tts>`);
  if (trimText(beat.rawBodyExtras)) parts.push(beat.rawBodyExtras);
  return parts.join('');
}

export function createEditorBeat(overrides = {}) {
  return sanitizeBeat({
    id: makeId(0),
    speaker: 'producer',
    cue: 'talk',
    look: 'camera',
    shot: 'medium',
    wait: 'text',
    text: '新的一段台词。',
    ...cloneValue(overrides),
  }, 0);
}

export function cloneEditorBeat(beat, index = 0) {
  const copy = sanitizeBeat(cloneValue(beat), index);
  copy.id = makeId(index);
  copy.rawLead = '\n';
  return copy;
}

export function parseBeatEditorSource(source, options = {}) {
  const raw = text(source);
  const matches = sourceBeatMatches(raw);
  const parsed = parseBeatScript(raw, options);
  const beats = matches.map((match, index) => {
    const normalized = parsed.beats[index] || {};
    const localized = readLocalizedBody(match.body);
    const beat = sanitizeBeat({
      ...normalized,
      ...localized,
      rawAttributes: parseRawAttributes(match.attributesSource),
      rawBodyExtras: localized.rawBodyExtras,
      rawLead: index === 0 ? '' : '',
    }, index);
    return beat;
  });
  const prefix = matches.length ? raw.slice(0, matches[0].index) : raw;
  const suffix = matches.length ? raw.slice(matches.at(-1).end) : '';
  if (matches.length > 1) {
    for (let index = 1; index < matches.length; index += 1) {
      beats[index].rawLead = raw.slice(matches[index - 1].end, matches[index].index);
    }
  }
  return {
    prefix,
    suffix,
    beats,
    choices: cloneValue(parsed.choices || []),
    dirty: false,
    source: raw,
  };
}

export function serializeBeatEditorScript(document) {
  const source = document && typeof document === 'object' ? document : {};
  const beats = Array.isArray(source.beats) ? source.beats : [];
  const lead = text(source.prefix || '');
  const body = beats.map((rawBeat, index) => {
    const beat = sanitizeBeat(rawBeat, index);
    const rawLead = index === 0 ? '' : text(beat.rawLead || '\n');
    return `${rawLead}<beat ${attributesText(beat, index)}>${bodyText(beat)}</beat>`;
  }).join('');
  return `${lead}${body}${text(source.suffix || '')}`.trim();
}

export function updateBeat(document, index, patch = {}) {
  const source = document && typeof document === 'object' ? document : { beats: [] };
  const beats = Array.isArray(source.beats) ? source.beats.map(cloneValue) : [];
  if (index < 0 || index >= beats.length) return { ...source, beats, dirty: true };
  beats[index] = sanitizeBeat({ ...beats[index], ...cloneValue(patch) }, index);
  return { ...source, beats, dirty: true };
}

export function moveBeat(document, fromIndex, toIndex) {
  const source = document && typeof document === 'object' ? document : { beats: [] };
  const beats = Array.isArray(source.beats) ? source.beats.map(cloneValue) : [];
  if (fromIndex < 0 || fromIndex >= beats.length || toIndex < 0 || toIndex >= beats.length || fromIndex === toIndex) return { ...source, beats, dirty: Boolean(source.dirty) };
  const [item] = beats.splice(fromIndex, 1);
  beats.splice(toIndex, 0, item);
  return { ...source, beats, dirty: true };
}

export function validateEditorDocument(document) {
  const source = document && typeof document === 'object' ? document : {};
  const beats = Array.isArray(source.beats) ? source.beats : [];
  const errors = [];
  if (!beats.length) errors.push('至少需要一个 Beat。');
  beats.forEach((rawBeat, index) => {
    const beat = sanitizeBeat(rawBeat, index);
    if (!beat.speaker) errors.push(`第 ${index + 1} 段缺少说话人。`);
    if (!beat.text) errors.push(`第 ${index + 1} 段缺少中文台词。`);
    if (!beat.cue) errors.push(`第 ${index + 1} 段缺少动作。`);
    if (!beat.shot) errors.push(`第 ${index + 1} 段缺少镜头景别。`);
  });
  return { ok: errors.length === 0, errors };
}

export { escapeAttribute, escapeBody, parseRawAttributes, sanitizeBeat };
