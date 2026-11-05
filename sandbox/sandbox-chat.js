export const SANDBOX_CHAT_SETTINGS_KEY = 'hatsuFreeChatSettings';

export const DEFAULT_SANDBOX_CHAT_PROMPT = [
  '你是初星学园的偶像 {{idol}}。',
  '人物要点：{{core}}',
  '这是闲聊：不消耗行动，不推进日程，不改数值。围绕玩家此刻的话自然回应，保持角色口吻，不要擅自推进重大矛盾。',
  '本轮输出格式以用户消息中的 Beat 要求为准。',
].join('\n');

export const SANDBOX_IDOL_CORES = Object.freeze({
  藤田琴音: '现实收益、被选择的不安、夸奖作为燃料、从不能相信自己到相信制作人。',
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
