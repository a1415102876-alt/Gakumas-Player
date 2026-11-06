export const GP_MODE = Object.freeze({ FULL: 'full', EXPAND: 'expand', EDITOR: 'editor', CHAT: 'chat' });
export const GP_DRAFT_KEY = 'hatsuGakumasPlayerDraftV1';
export const GP_MAX_INPUT = 200000;

const MODE_COPY = Object.freeze({
  [GP_MODE.FULL]: Object.freeze({
    title: '全文案',
    english: 'FULL TEXT',
    summary: '贴入写好的完整文案，AI 只负责整理成 Beat 格式。',
    placeholder: '把完整文案贴在这里。台词、旁白、地点都会按原文整理成 Beat。',
    action: '整理成 Beat 脚本',
    busy: '正在把全文整理成 Beat……',
  }),
  [GP_MODE.EXPAND]: Object.freeze({
    title: 'AI 扩写',
    english: 'AI EXPAND',
    summary: '写下大纲或点子，AI 补全剧情、台词和 Beat 格式。',
    placeholder: '写下故事大纲：谁出场、在哪里、发生了什么、想要怎样的结尾。',
    action: '扩写成 Beat 脚本',
    busy: '正在按大纲扩写长篇 Beat……',
  }),
  [GP_MODE.EDITOR]: Object.freeze({
    title: '编辑器',
    english: 'EDITOR',
    summary: '在可视化编辑器里逐条制作 Beat，返回后直接播放。',
    placeholder: '',
    action: '打开可视化编辑器',
    busy: '',
  }),
  [GP_MODE.CHAT]: Object.freeze({
    title: '闲聊',
    english: 'CHAT',
    summary: '在家·教室（午）的主页机位和她说话。世界书只核对这位偶像，回答直接在教室里演出。',
    placeholder: '',
    action: '进入教室',
    busy: '正在读取世界书……',
  }),
});

export function normalizeGpMode(value) {
  return Object.values(GP_MODE).includes(value) ? value : GP_MODE.FULL;
}

export function gpModeCopy(mode) {
  return MODE_COPY[normalizeGpMode(mode)];
}

export function gpModeUsesAi(mode) {
  const normalized = normalizeGpMode(mode);
  return normalized !== GP_MODE.EDITOR && normalized !== GP_MODE.CHAT;
}

export function normalizeGpDraft(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    mode: normalizeGpMode(source.mode),
    input: String(source.input || '').slice(0, GP_MAX_INPUT),
    script: String(source.script || '').slice(0, GP_MAX_INPUT * 2),
  };
}

export function readGpDraft(storage = globalThis.localStorage) {
  try {
    return normalizeGpDraft(JSON.parse(storage?.getItem(GP_DRAFT_KEY) || '{}'));
  } catch {
    return normalizeGpDraft(null);
  }
}

export function writeGpDraft(draft, storage = globalThis.localStorage) {
  const next = normalizeGpDraft(draft);
  try { storage?.setItem(GP_DRAFT_KEY, JSON.stringify(next)); } catch { /* storage full or disabled */ }
  return next;
}

export function summarizeBeatScript(source) {
  const raw = String(source || '');
  const closed = raw.match(/<beat\b[^>]*>[\s\S]*?<\/beat>/gi) || [];
  const opened = (raw.match(/<beat\b/gi) || []).length;
  const speakers = new Set();
  for (const beat of closed) {
    const speaker = beat.match(/\bspeaker=["']([^"']+)["']/i)?.[1];
    if (speaker) speakers.add(speaker);
  }
  const count = closed.length;
  const hasOpenBeat = opened > count;
  let message = '';
  if (!raw.trim()) message = '还没有 Beat 脚本。';
  else if (!count) message = '没有找到闭合的 <beat>…</beat>。';
  else if (hasOpenBeat) message = `共 ${count} 个完整 Beat，末尾还有未闭合的 Beat。`;
  else message = `共 ${count} 个 Beat，${speakers.size} 位说话人。`;
  return { count, hasOpenBeat, speakers: [...speakers], ready: count > 0 && !hasOpenBeat, message };
}

export function appendBeatScript(existing, addition) {
  const head = String(existing || '').trim();
  const tail = String(addition || '').trim();
  if (!head) return tail;
  if (!tail) return head;
  return `${head}\n${tail}`;
}
