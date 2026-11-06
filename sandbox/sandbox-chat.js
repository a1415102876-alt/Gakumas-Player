export const SANDBOX_CHAT_SETTINGS_KEY = 'hatsuFreeChatSettings';

export const DEFAULT_SANDBOX_CHAT_PROMPT = [
  '你是初星学园的偶像 {{idol}}。',
  '人物要点：{{core}}',
  '这是闲聊：不消耗行动，不推进日程，不改数值。围绕玩家此刻的话自然回应，保持角色口吻，不要擅自推进重大矛盾。',
  '本轮输出格式以用户消息中的 Beat 要求为准。',
].join('\n');

export const SANDBOX_IDOL_CORES = Object.freeze({
  藤田琴音: '现实收益、被选择的不安、夸奖作为燃料、从不能相信自己到相信制作人。',
  月村手毬: '冷淡外壳、脆弱内心、讨厌旧日的自己、需要精确而严格的支持。',
  花海咲季: '骄傲、好胜、害怕输给重要对手，但会把恐惧转回胜利计划。',
  花海佑芽: '直觉型行动力、对姐姐咲季的憧憬与胜负心、压倒性成长欲、把失败立刻转成下一次挑战。',
  筱泽广: '理论极强、身体极弱、喜欢为了成功而陷入困难的过程。',
  十王星南: '学园顶点、被完美形象困住、重新学习数值以外的偶像魅力。',
  秦谷美铃: '慵懒、照顾欲、温柔独占欲、安静自负、按自己的步调走向顶点。',
  仓本千奈: '能力不足与优渥出身带来的羞耻、总想放弃却会回来完成下一步、把他人的支持变成真心回礼。',
  葛城莉莉娅: '从零开始的异国少女、自我否定与害羞、即使害怕也会行动的坚韧、把得到的支持认真还给观众。',
  紫云清夏: '开朗轻佻的保护色、芭蕾伤痛留下的恐惧、害怕认真后再次失去、以渐进训练重新选择舞台。',
  有村麻央: '永远屈居星南之下的执念，既渴望超越又藏着惜与依赖；用好强遮住怕再输。宿舍长的可靠外壳下，也有想为自己而赢的心情。',
  姬崎莉波: '温柔成熟的姐姐气质、过去扮演妹妹偶像的失败、从刻意营销到自然照顾、也承认自己想被保护与喜欢竞争。',
  雨夜燕: '学生会副会长，实力与傲气都摆在面上。视星南为对手，严格，也会照顾人，嘴上不承认自己想被陪。',
});

export function readStoredFreeChatSettings(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SANDBOX_CHAT_SETTINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function mergeStoredChatSettings(stored = {}, fields = {}, { allowEmpty = false } = {}) {
  const next = stored && typeof stored === 'object' ? { ...stored } : {};
  for (const key of ['baseUrl', 'model', 'apiKey']) {
    const value = String(fields[key] ?? '').trim();
    if (allowEmpty || value || !String(next[key] || '').trim()) next[key] = value;
  }
  return next;
}

export function buildSandboxChatSettings(stored = {}, { idolName = '藤田琴音', worldbookEntries = [] } = {}) {
  const idol = String(idolName || '藤田琴音');
  return {
    baseUrl: stored.baseUrl || '',
    apiKey: stored.apiKey || '',
    model: stored.model || '',
    temperature: stored.temperature ?? 0.8,
    maxTokens: stored.maxTokens ?? 800,
    systemPrompt: stored.systemPrompt || DEFAULT_SANDBOX_CHAT_PROMPT,
    worldbook: stored.worldbook ?? '',
    worldbookEntries: Array.isArray(worldbookEntries) ? worldbookEntries : [],
    idolName: idol,
    idolCore: SANDBOX_IDOL_CORES[idol] || '',
    userName: stored.userName || '制作人',
  };
}

export function sandboxChatAvailability(settings = {}) {
  if (!String(settings.baseUrl || '').trim() || !String(settings.model || '').trim()) {
    return '还没有闲聊 API。请先在闲聊页填写地址和模型。';
  }
  const count = Array.isArray(settings.worldbookEntries) ? settings.worldbookEntries.length : 0;
  return count
    ? `已接通闲聊 API，世界书「初星学园」共 ${count} 条。`
    : '已接通闲聊 API。世界书未载入时，仍会使用闲聊页里的补充设定。';
}
