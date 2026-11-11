import { BEAT_BACKGROUND_NAMES } from '../beat-backgrounds.js';
import '../beat-background-routing.js';
import { GAKUMAS_EXPAND_STYLE } from './gakumas-expand-style.js';

export const WEIRD_SCRIPT_MODE = Object.freeze({ FULL: 'full', EXPAND: 'expand', DIRECT: 'direct' });

const DEFAULT_MAX_LOCATION_CHARS = 12000;
const DEFAULT_BEAT_TARGET = 100;

function safeText(value) {
  return String(value || '').trim();
}

function uniqueSafeLocations(names) {
  const source = Array.isArray(names) && names.length ? names : BEAT_BACKGROUND_NAMES;
  return [...new Set(source.map(safeText).filter(name => /^[^./\\][^/\\]*\.png$/iu.test(name)))];
}

export function formatWeirdLocationList(names = BEAT_BACKGROUND_NAMES, { maxChars = DEFAULT_MAX_LOCATION_CHARS } = {}) {
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Math.floor(Number(maxChars)) : DEFAULT_MAX_LOCATION_CHARS;
  const lines = [];
  let used = 0;
  for (const name of uniqueSafeLocations(names)) {
    const line = `- ${name}`;
    const next = used ? `${line}\n` : line;
    if (used + next.length > limit) break;
    lines.push(line);
    used += next.length;
  }
  return lines.join('\n');
}

function beatOutputRules() {
  return [
    'cue 只能写这些中文情绪或动作词，不要写 talk、happy 这类英文 id，也不要自造近义词：说话、待机、生气、害羞、难过、吃惊、高兴、安心、不甘、得意、干劲、哭泣、无奈、兴奋、点头、摇头、思考、询问、应答、鞠躬、指向、讨好、定格、察觉。',
    '除 cue="说话" 以外，这些词自带表情，不要再写 face。face 只在 cue="说话" 时写，只能是：高兴、惊讶、害羞、困扰、自然、难过、生气。',
    '每个有台词的偶像 Beat 必须同时写两段，顺序固定，不能只写其中一段：<display lang="zh">玩家看到的中文</display><tts lang="ja">给语音朗读的日语</tts>。',
    'display 的 lang 必须是 zh，内容是中文；tts 的 lang 必须是 ja，内容是和这句中文意思对应的日语。不要把中文写进 tts，不要把日语写进 display，不要省略 lang，不要写成 <tts>日语</tts>。',
    '制作人和旁白只写 <display lang="zh">，不要写 tts。没有台词的纯动作 Beat 也只写一句短 display，不要写空的 tts。',
    'speaker 和 look 只能使用这些登记 id，不要用罗马音，也不要自造英文名。',
    'kotone=藤田琴音；mao=有村麻央；rinami=姬崎莉波；hski=花海咲季；hume=花海佑芽；ssmk=紫云清夏；kllj=葛城莉莉娅；jsna=十王星南；hmsz=秦谷美铃；atbm=雨夜燕；ttmr=月村手毬；kcna=仓本千奈；shro=筱泽广；krnh=贺阳燐羽；nasr=亚纱里老师；hkne=冰渡香名江。',
    '制作人用 producer，旁白用 narrator。美铃必须写 hmsz，不要写 misuzu。燐羽必须写 krnh，不要写 rinpa 或 rinha。手毬必须写 ttmr，不要写 temari。',
    '偶像对制作人说话或面向制作人交流时必须写 look="camera"，不要把 producer 或 制作人 写进 look；如果看到旧脚本中的 look="producer" 或 look="制作人"，改为 camera。其他情况 look 写 camera 或在场角色的登记 id，不要把 left、right 写进 look。',
    '没有 3D 模型、只用头像的角色：andk=蓝井抚子；fobr=胧；mska=村雨愁佳；msrn=芹菜；myu0=真城优；sgka=白草月花；sson=白草四音。',
    '样例只说明标签格式。speaker="角色"是占位，必须换成上面的登记 id，不要原样输出，也不要写成“担当偶像”：<beat id="b001" speaker="角色" cue="说话" face="高兴" look="camera" position="center" background="宿舍走廊-午" shot="medium" wait="text"><display lang="zh">今天从这里开始。</display><tts lang="ja">今日はここから始めよう。</tts></beat>',
  ].join('\n');
}

function beatContract() {
  return [
    '你是 Beat 剧情编排器。只输出可直接交给 BeatPlayerApp 的完整 <beat>...</beat> 标签，不要输出解释、Markdown 围栏、JSON、旧 VN/NIA 标签或其他外壳。',
    '本次没有当前担当，也没有默认担当偶像。不要根据沙盒存档、编年史或常驻设定补一位担当。谁出场、和制作人是什么关系，只按用户文案；文案没有写担当关系时，不要安排担当，也不要补一位偶像来当担当。',
    '每个 Beat 都要有 id、speaker、cue、look、position、background、shot、wait。cue="说话" 时再加 face。',
    beatOutputRules(),
    'speaker 使用文案里实际说话的人，并且必须换成上表里的登记 id。不要创造新的角色 ID。',
    'position 只能是 left、center、right；shot 使用 wide、medium、close、reaction、keep。情绪或动作发生明显转换时拆到下一个 Beat。',
    'wait 有台词时用 text；这句要等语音念完再进下一句时用 voice。',
    'background 写成「地点-时段」，时段只用晨、午、夕、夜，例如宿舍走廊-午、学生会室-夕。不要写 .png 文件名。地点只能从下面的名单里选；文案没有地点时按语境补一个名单里的地点。同一段场景不要来回换地点。',
    `尽量完整写完用户文案；自然延伸时允许超过 ${DEFAULT_BEAT_TARGET} 个 Beat，但不要为了凑数重复句子。`,
  ].join('\n');
}

function promptLocationName(name) {
  const formatted = globalThis.HatsuBeatBackgroundRouting?.formatBackground?.(name) || safeText(name).replace(/\.png$/iu, '');
  return formatted.replace(/-(?:晨|午|夕|夜|morning|noon|evening|night|other)$/u, '');
}

export function formatWeirdPromptLocations(names = BEAT_BACKGROUND_NAMES, { maxChars = DEFAULT_MAX_LOCATION_CHARS } = {}) {
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Math.floor(Number(maxChars)) : DEFAULT_MAX_LOCATION_CHARS;
  const lines = [];
  const seen = new Set();
  let used = 0;
  for (const name of (Array.isArray(names) && names.length ? names : BEAT_BACKGROUND_NAMES)) {
    const label = promptLocationName(name);
    if (!label || seen.has(label) || /[\\/]/.test(label)) continue;
    seen.add(label);
    const line = `- ${label}`;
    const next = used ? `${line}\n` : line;
    if (used + next.length > limit) break;
    lines.push(line);
    used += next.length;
  }
  return lines.join('\n');
}

export function buildWeirdScriptPrompt({ mode = WEIRD_SCRIPT_MODE.FULL, text = '', locations = BEAT_BACKGROUND_NAMES, beatTarget = DEFAULT_BEAT_TARGET } = {}) {
  const source = safeText(text);
  const locationList = formatWeirdPromptLocations(locations);
  const target = Number.isFinite(Number(beatTarget)) ? Math.max(1, Math.floor(Number(beatTarget))) : DEFAULT_BEAT_TARGET;
  const contract = beatContract();
  const modeInstruction = mode === WEIRD_SCRIPT_MODE.EXPAND
    ? [
      '这是 AI 扩写模式。按用户点子里写到的人物和关系扩写成完整长篇。世界书只用来核对已经出场的人的性格，不要用它补一位默认担当，也不要泄露世界书原文。',
      `用户点子：\n${source}`,
    ]
    : [
      '这是全文案转 Beat 模式。用户提供的是要演出的文案；只把它组织成 Beat，不额外添加角色资料或历史对话。',
      `用户全文案：\n${source}`,
    ];
  return [
    '[HATSU_WEIRD_SCRIPT]',
    contract,
    `本次目标长度：至少围绕 ${target} 个 Beat 组织内容；若用户文案较短，以自然完整为先。`,
    ...modeInstruction,
    '允许使用的地点清单：',
    locationList,
    mode === WEIRD_SCRIPT_MODE.EXPAND ? '扩写时只参考文案里已经出现的角色设定。世界书核对性格，下面的文风参考只约束口气。' : '全文案模式不读取角色资料、历史、世界书或文风参考，只依据本提示和用户文案。',
    mode === WEIRD_SCRIPT_MODE.EXPAND ? GAKUMAS_EXPAND_STYLE : '',
  ].filter(Boolean).join('\n\n');
}

export function prepareDirectBeatScript(source) {
  const closed = extractClosedBeatScript(source);
  if (!closed.count) {
    return { ok: false, error: '没有找到完整的 Beat。每个 beat 都要闭合，并带有 display。' };
  }
  if (closed.hasOpenBeat) {
    return { ok: false, error: '末尾还有未闭合的 Beat，补全后再演出。' };
  }
  return { ok: true, script: closed.script, count: closed.count };
}

export function extractClosedBeatScript(source) {
  const raw = safeText(source);
  const matches = raw.match(/<beat\b[^>]*>[\s\S]*?<\/beat>/gi) || [];
  const valid = matches.filter(match => /<display\b[^>]*>[\s\S]*?<\/display>/i.test(match) && /<display\b[^>]*>\s*[^<\s][\s\S]*?<\/display>/i.test(match));
  const opened = (raw.match(/<beat\b/gi) || []).length;
  const hasOpenBeat = opened > matches.length || /<beat\b[^>]*>[\s\S]*$/i.test(raw.slice(raw.lastIndexOf('</beat>') + 7));
  const last = valid.at(-1) || '';
  const background = last.match(/\bbackground=["']([^"']+)["']/i)?.[1] || '';
  return {
    script: valid.join('\n'),
    count: valid.length,
    hasOpenBeat,
    tail: raw.slice(Math.max(0, raw.lastIndexOf('</beat>') + 7)).trim(),
    lastBackground: background,
  };
}

export function buildWeirdContinuationPrompt({ completedScript = '', completedCount = 0, lastBackground = '', style = false } = {}) {
  const closed = safeText(completedScript);
  const count = Number.isFinite(Number(completedCount)) ? Math.max(0, Math.floor(Number(completedCount))) : 0;
  const background = safeText(lastBackground) || '沿用上一个完整 Beat 的 background';
  return [
    '[HATSU_WEIRD_SCRIPT_CONTINUE]',
    '本次没有当前担当，也没有默认担当偶像。续写时不要把任何未在已完成 Beat 里担任担当的人补成担当。',
    `前面已经保留 ${count} 个完整 Beat，最后地点为：${background}。`,
    '只输出后续新的、完整闭合的 <beat>...</beat>；不要重复已完成内容，不要输出解释或 Markdown。',
    beatOutputRules(),
    '保持前文人物关系、情绪和地点连续；如果故事已经自然结束，就输出剩余收束 Beat，不要硬凑长度。',
    style ? GAKUMAS_EXPAND_STYLE : '',
    '已完成内容的末尾仅用于承接：',
    closed.slice(-5000),
  ].filter(Boolean).join('\n\n');
}
