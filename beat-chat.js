import { parseBeatScript } from './beat-protocol.js?v=20261111-hkne-motions-v1';
import { activateTavernWorldbook, importTavernWorldbook } from './worldbook-scan.js';

const DEFAULT_BACKGROUND = '家·教室（午）';
const PLAYER_CHAT_NIGHT = '家·教室（夜）';

/** Player chat uses the noon classroom until 19:00, then the night variant through 04:59. */
export function playerChatScene(date = new Date()) {
    const hour = date.getHours();
    const night = hour >= 19 || hour < 5;
    const pad = value => String(value).padStart(2, '0');
    const clock = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(hour)}:${pad(date.getMinutes())}`;
    return {
        night,
        background: night ? PLAYER_CHAT_NIGHT : DEFAULT_BACKGROUND,
        context: `用户现在的本地时间是${clock}。${night ? '已经过了晚上7点，教室是夜晚。' : '现在还没到晚上7点，教室是白天。'}回复时要知道这个时间，可以自然提到此刻的光线和作息。不要因此改课程、训练或演出日程。`,
    };
}
const DEFAULT_TIMEOUT = 120000;
const BUILTIN_SPEAKERS = new Set(['producer', '制作人', 'narrator', '旁白']);

function escapeAttribute(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function removeAttribute(source, name) {
    const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'gi');
    return String(source || '').replace(pattern, '');
}

function setAttribute(source, name, value) {
    return `${String(source || '').trim()} ${name}="${escapeAttribute(value)}"`.trim();
}

function escapeText(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BEAT_JSON_FIELDS = ['speaker', 'cue', 'face', 'look', 'position', 'background', 'shot'];

/** Models sometimes emit the beat fields as a JSON array instead of <beat> tags. */
function jsonBeatsToScript(source) {
    const text = String(source || '');
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return '';
    let rows;
    try {
        rows = JSON.parse(text.slice(start, end + 1));
    } catch {
        return '';
    }
    if (!Array.isArray(rows) || !rows.length) return '';
    return rows.map((row) => {
        if (!row || typeof row !== 'object') return '';
        const rawBody = String(row.text || row.body || '').trim();
        const spoken = String(row.tts || row.ttsText || row.ja || '').trim();
        const body = spoken && !/<tts\b/i.test(rawBody)
            ? `${/<display\b/i.test(rawBody) ? rawBody : `<display lang="zh">${escapeText(rawBody)}</display>`}<tts lang="ja">${escapeText(spoken)}</tts>`
            : rawBody;
        if (!body) return '';
        const attrs = BEAT_JSON_FIELDS
            .filter((name) => row[name] != null && String(row[name]).trim())
            .map((name) => `${name}="${escapeAttribute(row[name])}"`)
            .join(' ');
        return `<beat ${attrs}>${body}</beat>`;
    }).filter(Boolean).join('\n');
}

export function beatStageHint() {
    return [
        '按 Beat 演出写在场的人、站位和镜头。',
        '偶像可以用：藤田琴音、有村麻央、姬崎莉波、花海咲季、花海佑芽、紫云清夏、葛城莉莉娅、十王星南、秦谷美铃、雨夜燕、月村手毬、仓本千奈、筱泽广、贺阳燐羽、冰渡香名江、亚纱里老师。只写这一场确实在场的人，不要把不在场的人拉进来。制作人用 producer，旁白用 narrator。',
        'position 用 left、center 或 right。look 用 camera，或看向在场的人。偶像对制作人说话或面向制作人交流时必须用 camera，禁止 look="producer"。',
        'shot 用 wide、medium、close、reaction 或 keep。wide 能同时看到左右站位的人。',
        '需要改变构图时写 camera="wide|medium|close|reaction|keep"；camera 与 shot 使用同一组景别，并同时作用于 2D 背景和 3D 场景。camera-motion、camera-ease、camera-duration 三个字段已停用。没有必要就省略 camera。',
    ].join('\n');
}

/**
 * Build the small, self-contained prompt used by the standalone chat panel.
 * It deliberately asks for Beat markup so the response can re-enter the
 * existing action, expression, lip-sync and TTS pipeline.
 */
export function suggestedActionPrompt() {
    return [
        '在全部 Beat 之后另起一行写一个 <choice>，里面正好 4 个 <option>。',
        '每个 option 是制作人的下一步行动，第一人称短句，彼此不同，不要写成偶像的台词。',
        '顺序是：保守地接住眼前的事、顺着刚才的话继续、主动提出一个做法、多走一步。',
        '不要把这些选项写进 Beat、display 或 tts。',
        '<choice><option>先听她说完。</option><option>顺着刚才的话问下去。</option><option>提出一个具体做法。</option><option>先放下这件事，看看旁边。</option></choice>',
    ].join('\n');
}

function finishChatPrompt(lines, suggestActions) {
    const body = lines.filter(Boolean);
    const extra = suggestActions ? suggestedActionPrompt() : '不要输出选项。';
    const last = body[body.length - 1] || '';
    if (/^玩家(?:说|的行动)：/.test(last)) body.splice(body.length - 1, 0, extra);
    else body.push(extra);
    return body.join('\n');
}

export function splitSuggestedActions(source) {
    const text = String(source || '');
    const match = text.match(/<choice\b[^>]*>([\s\S]*?)<\/choice>/i);
    if (!match) return { source: text, options: [] };
    const options = [...match[1].matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)]
        .map((item) => item[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80))
        .filter(Boolean);
    const without = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`;
    return { source: without, options: options.length >= 4 ? options.slice(0, 4) : [] };
}

export function buildChatPrompt({ idolName, userText, background = DEFAULT_BACKGROUND, context = '', present = true, company = false, staging = false, suggestActions = false } = {}) {
    const idol = String(idolName || '').trim();
    const text = String(userText || '').trim();
    const status = String(context || '').trim();
    const scene = String(background || DEFAULT_BACKGROUND).trim() || DEFAULT_BACKGROUND;
    if (!text) throw new Error('消息不能为空');
    if (present === false && !company) {
        return finishChatPrompt([
            '[HATSU_OUTPUT_MODE:BEAT_CHAT]',
            '你正在写制作人独自行动的一段短演出。这个地点现在没有偶像，不要让她出场、说话，也不要写成她在旁边。',
            `当前场景：${scene}。background 固定为这个场景。`,
            '只输出 2 到 4 个 <beat>...</beat>，不要输出解释、Markdown 代码围栏或 NIA 结构。',
            'speaker 只能是「制作人」或「旁白」。制作人写他正在做的事和一句短话，旁白写环境和结果。',
            staging ? '可以写 position、shot、camera，用来表现这次行动；camera 与 shot 使用同一组景别。' : 'position 用 center，shot 用 medium。',
            '制作人和旁白不要写 tts。不要写夸奖标记。没有与偶像的互动，relationship_update 写 0。',
            `样例：<beat speaker="制作人" cue="idle" face="neutral" look="camera" position="center" background="${scene}" shot="medium"><display lang="zh">我先把这里收拾一下。</display></beat>`,
            `<beat speaker="旁白" cue="idle" face="neutral" look="camera" position="center" background="${scene}" shot="medium"><display lang="zh">屋里安静下来。</display></beat>`,
            status,
            `玩家的行动：${text}`,
        ], suggestActions);
    }
    if (company) {
        return finishChatPrompt([
            '[HATSU_OUTPUT_MODE:BEAT_CHAT]',
            '你正在写制作人在这个地点遇到其他偶像的一段相处。担当不在这里，不要让担当出场或说话。',
            `当前场景：${scene}。background 固定为这个场景。`,
            staging
                ? '输出 8 到 12 个 <beat>...</beat>，大约 10 个。顺着玩家的话往下聊，可以有来回，不要两三句就结束。不要输出解释、Markdown 代码围栏、VN 的 <dialogue>、旧格式标签或 NIA 结构。'
                : '只输出 2 到 4 个 <beat>...</beat>，不要输出解释、Markdown 代码围栏或 NIA 结构。',
            '名单里的偶像用她自己的名字做 speaker，写出她本人的台词。制作人用 producer，旁白用 narrator。不要用旁白转述偶像说的话。偶像对制作人说话或面向制作人交流时必须写 look="camera"，不要写 look="producer"。',
            staging ? beatStageHint() : 'position 用 left、center 或 right。shot 用 medium。',
            '每个偶像的 Beat 都要同时写中文和日语：<display lang="zh">玩家看到的中文</display><tts lang="ja">给 Fish 朗读的日语</tts>。制作人和旁白不要写 tts。没有与担当的互动，relationship_update 写 0。不要写夸奖标记。',
            status,
            `玩家说：${text}`,
        ], suggestActions);
    }
    if (!idol) throw new Error('未选择偶像');
    return finishChatPrompt([
        '[HATSU_OUTPUT_MODE:BEAT_CHAT]',
        staging
            ? '你正在为初星学园 3D 闲聊写一段大约 10 个 Beat 的相处。'
            : '你正在为初星学园 3D 闲聊模式生成一轮简短回复。',
        `当前偶像：${idol}`,
        staging
            ? `当前场景：${background}。background 固定为这个场景。`
            : `当前场景：${background}。镜头固定为 medium，不要输出 camera、camera-motion、camera-duration、camera-ease 或运镜描述。`,
        staging
            ? '输出 8 到 12 个 <beat>...</beat>，大约 10 个。顺着玩家的话往下聊，可以有来回，不要两三句就结束。不要输出解释、Markdown 代码围栏、VN 的 <dialogue>、旧格式标签或 NIA 结构。'
            : '只输出一个或多个 <beat>...</beat>，不要输出解释、Markdown 代码围栏、VN 的 <dialogue>、旧格式标签或 NIA 结构。',
        staging
            ? `${idol}在场时由她主要回应。名单里的其他偶像如果开口，speaker 用她自己的名字，不要改成旁白或 narrator。\n${beatStageHint()}`
            : `每个情绪或动作变化拆成独立 Beat；speaker 使用 ${idol}，只有确实需要制作人回应时才使用 producer。`,
        staging
            ? '每个偶像的 Beat 都写 cue、face、look、position。background 保持当前场景。'
            : '每个 Beat 都使用 cue、face、look、position、background 和 shot 等现有字段；background 固定为当前场景，shot 固定为 medium，position 固定为 center。偶像对制作人说话或面向制作人交流时必须写 look="camera"，不要写 look="producer"。',
        '回复应自然承接玩家的话，保持角色口吻。',
        staging
            ? '每个偶像的 Beat 都要同时写中文和日语：<display lang="zh">玩家看到的中文</display><tts lang="ja">给 Fish 朗读的日语</tts>。两句意思对应。制作人、旁白和没有模型台词的人不要写 tts。'
            : `每个 ${idol} 的 Beat 都要同时写中文和日语：<display lang="zh">玩家看到的中文</display><tts lang="ja">给 Fish 朗读的日语</tts>。两句意思对应。制作人和旁白不要写 tts。`,
        staging
            ? `样例：<beat speaker="${idol}" cue="说话" face="高兴" look="camera" position="center" background="${background}" shot="medium" camera="close"><display lang="zh">还好呀。</display><tts lang="ja">大丈夫だよ。</tts></beat>\n<beat speaker="有村麻央" cue="说话" face="高兴" look="${idol}" position="left" background="${background}" shot="wide" camera="wide"><display lang="zh">我也在。</display><tts lang="ja">私もいるよ。</tts></beat>`
            : `样例：<beat speaker="${idol}" cue="说话" face="高兴" look="camera" position="center" background="${background}" shot="medium"><display lang="zh">还好呀。</display><tts lang="ja">大丈夫だよ。</tts></beat>`,
        status,
        `玩家说：${text}`,
    ], suggestActions);
}

/** Force chat responses into the single fixed scene and medium shot. */
export function forceMediumBeatScript(source, { background = DEFAULT_BACKGROUND, preserveBackground = false, preserveStaging = false } = {}) {
    const input = String(source || '').trim();
    if (!input) return '';
    const scene = String(background || DEFAULT_BACKGROUND).trim() || DEFAULT_BACKGROUND;
    return input.replace(/<beat\b([^>]*)>([\s\S]*?)<\/beat>/gi, (_match, rawAttrs, body) => {
        let attrs = String(rawAttrs || '');
        const locked = [];
        if (!preserveStaging) locked.push('position', 'look');
        if (!preserveBackground && !preserveStaging) locked.push('shot', 'camera', 'camera-motion', 'camera-duration', 'camera-ease');
        if (!preserveBackground) locked.push('background');
        for (const name of locked) attrs = removeAttribute(attrs, name);
        if (!preserveBackground) attrs = setAttribute(attrs, 'background', scene);
        if (!preserveBackground && !preserveStaging) attrs = setAttribute(attrs, 'shot', 'medium');
        if (!preserveStaging) {
            attrs = setAttribute(attrs, 'position', 'center');
            attrs = setAttribute(attrs, 'look', 'camera');
        }
        return `<beat ${attrs}>${body}</beat>`;
    });
}

/**
 * Normalize and validate one model reply before handing it to BeatPlayerApp.
 * A response containing no complete Beat is never allowed to become dialogue.
 */
export function normalizeChatReply(source, options = {}) {
    const split = splitSuggestedActions(source);
    let raw = String(split.source || '')
        .replace(/<relationship_update>[\s\S]*?<\/relationship_update>/gi, '')
        .replace(/【初星任务标记】\s*praise_kotone/gi, '')
        .replace(/<quest_flag\s+id=["']praise_kotone["']\s*\/?>/gi, '')
        .replace(/【初星时间标记】\s*\d{1,4}/gi, '')
        .replace(/<time_mark\s+minutes=["']\d{1,4}["']\s*\/?>/gi, '')
        .replace(/^```(?:xml|html|json|text)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    if (!/<beat\b/i.test(raw)) raw = jsonBeatsToScript(raw) || raw;
    if (!raw || /<\/?(?:dialogue|vn|nia_[a-z_]+)\b/i.test(raw)) {
        return { ok: false, error: '闲聊回复不是 Beat 格式。', options: [] };
    }
    const matches = raw.match(/<beat\b[^>]*>[\s\S]*?<\/beat>/gi) || [];
    if (!matches.length || matches.length !== (raw.match(/<beat\b/gi) || []).length) {
        return { ok: false, error: '闲聊回复缺少完整的 Beat 结束标签。', options: [] };
    }
    const script = forceMediumBeatScript(matches.join('\n'), options);
    const preserveBackground = Boolean(options.preserveBackground);
    const parsed = parseBeatScript(script, {
        allowOtherSpeakers: true,
        ...(preserveBackground ? {} : {
            backgrounds: [options.background || DEFAULT_BACKGROUND],
            defaultBackground: options.background || DEFAULT_BACKGROUND,
        }),
    });
    if (!parsed.beats.length || parsed.errors.some(error => ['malformed-beat', 'empty-text'].includes(error.code))) {
        return { ok: false, error: '闲聊回复中没有可播放的完整 Beat。', errors: parsed.errors, options: [] };
    }
    return { ok: true, script, beats: parsed.beats, errors: parsed.errors, options: split.options };
}

function makeRequestId(prefix = 'beat-chat') {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function getParentWindow(windowRef) {
    try {
        return windowRef?.parent && windowRef.parent !== windowRef ? windowRef.parent : null;
    } catch (error) {
        return null;
    }
}

/**
 * Small postMessage adapter for the existing st.html transactional bridge.
 * It does not mutate the host chat itself; the host owns that transaction.
 */
export function createChatBridge({ windowRef = globalThis.window, timeoutMs = DEFAULT_TIMEOUT } = {}) {
    const listeners = new Map();
    const contextWaiters = new Set();
    const host = getParentWindow(windowRef);
    let disposed = false;
    let context = null;

    const removeListener = (eventName, handler) => {
        try { windowRef?.removeEventListener?.(eventName, handler); } catch (error) {}
    };
    const onMessage = event => {
        const data = event?.data || {};
        if (data.source !== 'hatsuboshi-produce-host') return;
        if (data.type === 'character') {
            context = { character: data.character || null, saveScope: String(data.saveScope || '') };
            for (const resolve of contextWaiters) resolve(context);
            contextWaiters.clear();
            if (!listeners.size) removeListener('message', onMessage);
            return;
        }
        if (!['aiReplyCommitted', 'primaryAiError'].includes(data.type)) return;
        const requestId = String(data.requestId || '');
        const pending = listeners.get(requestId);
        if (!pending || String(data.channelLeaseId || '') !== pending.channelLeaseId) return;
        listeners.delete(requestId);
        clearTimeout(pending.timer);
        removeListener('message', onMessage);
        if (data.type === 'primaryAiError') {
            pending.reject(new Error(String(data.error || '闲聊生成失败')));
        } else {
            pending.resolve({
                requestId,
                channelLeaseId: pending.channelLeaseId,
                text: String(data.text || data.rawText || ''),
                rawText: String(data.rawText || data.text || ''),
                isFinal: data.isFinal !== false,
            });
        }
    };

    const post = payload => {
        if (disposed) throw new Error('闲聊桥已关闭');
        if (!host?.postMessage) throw new Error('当前页面没有连接到 SillyTavern');
        host.postMessage(payload, '*');
    };

    const requestContext = () => {
        if (context) return Promise.resolve(context);
        if (!host?.postMessage) return Promise.reject(new Error('当前页面没有连接到 SillyTavern'));
        return new Promise((resolve, reject) => {
            let waiter;
            const timer = setTimeout(() => {
                contextWaiters.delete(waiter);
                reject(new Error('未能读取当前酒馆角色档案'));
            }, Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT, 10000));
            waiter = value => {
                clearTimeout(timer);
                resolve(value);
            };
            contextWaiters.add(waiter);
            windowRef?.addEventListener?.('message', onMessage);
            try { post({ source: 'hatsuboshi-produce', type: 'getCharacter' }); }
            catch (error) { clearTimeout(timer); contextWaiters.delete(waiter); reject(error); }
        });
    };

    const send = (prompt, {
        saveScope = context?.saveScope || `beat-chat-${Date.now()}`,
        requestId = makeRequestId(),
        ownerKind = 'beat_chat',
        generationMode = 'shujuku_same_layer',
    } = {}) => {
        const text = String(prompt || '').trim();
        if (!text) return Promise.reject(new Error('闲聊提示词为空'));
        if (!host?.postMessage) return Promise.reject(new Error('当前页面没有连接到 SillyTavern'));
        const channelLeaseId = makeRequestId('beat-chat-lease');
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                listeners.delete(requestId);
                removeListener('message', onMessage);
                reject(new Error('闲聊生成超时，请重试'));
            }, Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT);
            listeners.set(requestId, { resolve, reject, timer, channelLeaseId });
            windowRef?.addEventListener?.('message', onMessage);
            try {
                post({
                    source: 'hatsuboshi-produce',
                    type: 'sendPrompt',
                    requestId,
                    channelLeaseId,
                    saveScope: String(saveScope || `beat-chat-${Date.now()}`),
                    ownerKind,
                    generationMode,
                    prompt: text,
                });
            } catch (error) {
                clearTimeout(timer);
                listeners.delete(requestId);
                removeListener('message', onMessage);
                reject(error);
            }
        });
    };

    return {
        requestContext,
        send,
        get context() { return context; },
        dispose() {
            disposed = true;
            for (const pending of listeners.values()) {
                clearTimeout(pending.timer);
                pending.reject(new Error('闲聊桥已关闭'));
            }
            listeners.clear();
            contextWaiters.clear();
            removeListener('message', onMessage);
        },
    };
}

export function chatCompletionsUrl(baseUrl) {
    const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

export function applyChatPreset(template, { idol = '', core = '' } = {}) {
    return String(template || '')
        .replace(/\{\{\s*idol\s*\}\}/g, idol)
        .replace(/\{\{\s*char\s*\}\}/g, idol)
        .replace(/\{\{\s*core\s*\}\}/g, core);
}

function worldbookKeys(entry) {
    const source = Array.isArray(entry?.keys) ? entry.keys : Array.isArray(entry?.key) ? entry.key : entry?.key;
    const list = Array.isArray(source) ? source : String(source || '').split(/[、,，]/);
    return list.map(key => String(key || '').trim()).filter(Boolean);
}

function normalizeWorldbookEntry(entry) {
    if (!entry || entry.disable || entry.enabled === false) return null;
    const content = String(entry.content || '').trim().slice(0, 2000);
    if (!content) return null;
    return {
        keys: worldbookKeys(entry),
        content,
        constant: Boolean(entry.constant),
        comment: String(entry.comment || '').trim(),
    };
}

function normalizeWorldbookData(data) {
    const rawEntries = Array.isArray(data)
        ? data
        : Array.isArray(data?.entries)
            ? data.entries
            : data?.entries && typeof data.entries === 'object'
                ? Object.values(data.entries)
                : [];
    return rawEntries.map(normalizeWorldbookEntry).filter(Boolean).slice(0, 40);
}

function parsePlainWorldbook(text) {
    return String(text || '').split(/\n---\n/).map(block => {
        const lines = block.trim().split('\n').map(line => line.trim()).filter(Boolean);
        if (!lines.length) return null;
        const head = lines[0];
        if (/^常驻(?:[:：]|$)/.test(head)) {
            const inline = head.replace(/^常驻[:：]?/, '').trim();
            const content = [inline, ...lines.slice(1)].filter(Boolean).join('\n').trim();
            return content ? { keys: [], content, constant: true } : null;
        }
        const keyMatch = head.match(/^关键词[:：]\s*(.*)$/);
        if (!keyMatch) return null;
        const keys = keyMatch[1].split(/[、,，]/).map(key => key.trim()).filter(Boolean);
        const content = lines.slice(1).join('\n').trim();
        return keys.length && content ? { keys, content, constant: false } : null;
    }).filter(Boolean).slice(0, 40);
}

/** Accept a SillyTavern worldbook JSON export or the small plain-text format. */
export function parseWorldbook(source) {
    const text = String(source || '').trim();
    if (!text) return [];
    if (text.startsWith('{') || text.startsWith('[')) {
        try {
            return normalizeWorldbookData(JSON.parse(text));
        } catch (error) {
            // A JSON-looking draft can still be edited as plain text.
        }
    }
    return parsePlainWorldbook(text);
}

/**
 * Constant entries always qualify. Keyword entries qualify when any primary
 * key occurs in the scan text. The result is inserted once, in this order.
 */
export function matchWorldbookEntries(entries, text, { maxChars = 2400 } = {}) {
    const haystack = String(text || '').toLowerCase();
    const selected = [];
    let used = 0;
    const add = entry => {
        if (!entry || used >= maxChars) return;
        const content = String(entry.content || '').trim().slice(0, maxChars - used);
        if (!content) return;
        selected.push({ ...entry, content });
        used += content.length;
    };
    for (const entry of entries || []) if (entry.constant) add(entry);
    for (const entry of entries || []) {
        if (entry.constant || !entry.keys?.length) continue;
        const hit = entry.keys.some(key => key && haystack.includes(String(key).toLowerCase()));
        if (hit) add(entry);
    }
    return selected;
}

export function extractChatIdolName(prompt) {
    return (String(prompt || '').match(/当前偶像：(.+)/) || [])[1]?.trim() || '';
}

export function extractChatPlayerLine(prompt) {
    return (String(prompt || '').match(/玩家说：([\s\S]*)$/) || [])[1]?.trim() || '';
}

export function assembleLocalChatMessages({ systemPrompt = '', worldEntries = [], history = [], userPrompt = '', producerProfile = '', memories = '' } = {}) {
    const lore = worldEntries.map(entry => entry.content.trim()).filter(Boolean).join('\n\n');
    const system = [
        String(systemPrompt || '').trim(),
        lore ? `【世界书】\n${lore}` : '',
        String(producerProfile || '').trim() ? `【制作人档案】\n以下是与你交谈的制作人的自我设定。请据此理解对方的身份、称呼和背景，不要把制作人的资料当作偶像的设定，也不要代替制作人说话。\n${String(producerProfile).trim()}` : '',
        String(memories || '').trim() ? `【与当前偶像的历史聊天记忆】\n以下是较早的对话摘录，仅用于回忆已经聊过的事情；与近期对话冲突时以近期对话为准。\n${String(memories).trim()}` : '',
    ].filter(Boolean).join('\n\n');
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    for (const item of history) {
        if (!item || (item.role !== 'user' && item.role !== 'assistant')) continue;
        const content = String(item.content || '').trim();
        if (!content) continue;
        messages.push({ role: item.role, content });
    }
    messages.push({ role: 'user', content: String(userPrompt || '') });
    return messages;
}

function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function isTransientFetchError(error) {
    const message = String(error?.message || error || '');
    return error?.name === 'TypeError' && /failed to fetch|fetch failed|networkerror|load failed/i.test(message);
}

function networkFetchDiagnostic(error) {
    const detail = String(error?.message || error || '浏览器未收到 API 响应').trim();
    return new Error(`闲聊网络请求失败：${detail}。浏览器未收到 API 响应，请检查 API 网关、代理连接或 CORS 设置。`);
}

function chatDisplayText(beats) {
    return (beats || []).map(beat => `${beat.speaker}：${beat.text}`).join('\n');
}

function chatWorldbookEntries(settings, scanMessages, idol) {
    const text = String(settings.worldbook || '').trim();
    let pasted = [];
    if (text.startsWith('{') || text.startsWith('[')) {
        try {
            pasted = importTavernWorldbook(JSON.parse(text));
        } catch {
            pasted = [];
        }
    }
    if (!pasted.length) pasted = importTavernWorldbook(parseWorldbook(text));
    const loaded = Array.isArray(settings.worldbookEntries) ? settings.worldbookEntries : [];
    return activateTavernWorldbook([...loaded, ...pasted], scanMessages, {
        characterName: idol,
        userName: settings.userName || '制作人',
    });
}

/**
 * Browser chat-completion bridge. It keeps the Beat player's send/requestContext
 * shape, and supplies the worldbook plus recent turns that SillyTavern used to inject.
 */
export function createLocalChatBridge({ fetchImpl = globalThis.fetch, getSettings, timeoutMs = DEFAULT_TIMEOUT, historyLimit = 8, currentDay, onRemember, loadHistory, onExchange, onHistoryError } = {}) {
    const histories = new Map();
    let disposed = false;

    const readSettings = () => {
        const settings = typeof getSettings === 'function' ? getSettings() : {};
        return settings && typeof settings === 'object' ? settings : {};
    };
    const dayOf = () => {
        const value = typeof currentDay === 'function' ? Number(currentDay()) : NaN;
        return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    };
    const turnsFor = idol => histories.get(String(idol || '')) || [];
    const remember = (idol, turn, { notify = true } = {}) => {
        const key = String(idol || '');
        const active = dayOf();
        const stored = { ...turn };
        if (active && !stored.day) stored.day = active;
        let next = [...turnsFor(key), stored];
        if (active) next = next.filter(item => Number(item.day) === active);
        else if (Number.isFinite(historyLimit) && historyLimit > 0) next = next.slice(-historyLimit);
        histories.set(key, next);
        if (notify) onRemember?.(key, stored);
    };

    return {
        requestContext() {
            if (disposed) return Promise.reject(new Error('闲聊桥已关闭'));
            return Promise.resolve({ character: { name: '初星学园' }, saveScope: 'local-free-chat' });
        },
        historyFor(idolName) {
            return turnsFor(idolName).map(turn => ({ ...turn }));
        },
        clear(idolName) {
            histories.delete(String(idolName || ''));
        },
        restore(turns = []) {
            histories.clear();
            for (const turn of Array.isArray(turns) ? turns : []) {
                const idol = String(turn?.idolId || '');
                if (!idol) continue;
                remember(idol, {
                    role: turn.role,
                    content: turn.content,
                    text: turn.text,
                    label: turn.label,
                    day: turn.day,
                }, { notify: false });
            }
        },
        async send(prompt, {
            requestId = makeRequestId(),
            saveScope = 'local-free-chat',
            maxTokens,
            maxTokensLimit,
            timeoutMs: requestTimeoutMs,
            normalizeOptions = {},
            useWorldbook = true,
            useHistory = true,
            systemPrompt: systemPromptOverride,
            characterName,
            worldbookEntries: worldbookOverride,
            signal: externalSignal,
        } = {}) {
            if (disposed) throw new Error('闲聊桥已关闭');
            const text = String(prompt || '').trim();
            if (!text) throw new Error('闲聊提示词为空');
            const settings = readSettings();
            const url = chatCompletionsUrl(settings.baseUrl);
            const model = String(settings.model || '').trim();
            if (!url || !model) throw new Error('请先填写 API 地址和模型');
            const idol = characterName == null
                ? (extractChatIdolName(text) || String(settings.idolName || '').trim())
                : String(characterName).trim();
            const bookSettings = worldbookOverride == null ? settings : { ...settings, worldbookEntries: worldbookOverride };
            const playerLine = extractChatPlayerLine(text);
            const active = dayOf();
            let history = useHistory ? turnsFor(idol).filter(turn => !active || Number(turn.day) === active) : [];
            let memories = '';
            if (useHistory && typeof loadHistory === 'function') {
                try {
                    const saved = await loadHistory(idol, playerLine || text);
                    if (Array.isArray(saved?.history) && saved.history.length) {
                        // A failed archive write must not hide this page's newer turns.
                        const lastSaved = saved.history.at(-1);
                        const overlap = lastSaved?.id ? history.findLastIndex(turn => turn.id === lastSaved.id) : -1;
                        history = [...saved.history, ...(overlap >= 0 ? history.slice(overlap + 1) : [])];
                    }
                    memories = String(saved?.memories || '');
                } catch (error) { onHistoryError?.(error, 'read'); }
            }
            const scanMessages = [text, ...[...history].reverse().map(turn => turn.content)];
            const messages = assembleLocalChatMessages({
                systemPrompt: applyChatPreset(
                    Object.prototype.hasOwnProperty.call(arguments[1] || {}, 'systemPrompt') ? systemPromptOverride : settings.systemPrompt,
                    { idol, core: settings.idolCore },
                ),
                worldEntries: useWorldbook ? chatWorldbookEntries(bookSettings, scanMessages, idol) : [],
                history: history.map(turn => ({ role: turn.role, content: turn.content })),
                userPrompt: text,
                producerProfile: useHistory ? settings.producerProfile : '',
                memories,
            });
            const controller = new AbortController();
            const onExternalAbort = () => controller.abort();
            if (externalSignal) {
                if (externalSignal.aborted) controller.abort();
                else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
            }
            const requestTimeout = Number(requestTimeoutMs) > 0 ? Number(requestTimeoutMs) : (Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT);
            const timer = setTimeout(() => controller.abort(), requestTimeout);
            try {
                const longOutputLimit = maxTokensLimit != null;
                const allowedMaxTokens = longOutputLimit ? clampNumber(maxTokensLimit, 12000, 800, 48000) : 4000;
                const requestedMaxTokens = clampNumber(
                    maxTokens ?? (maxTokensLimit ?? settings.maxTokens),
                    800,
                    64,
                    allowedMaxTokens,
                );
                const tokenCandidates = [requestedMaxTokens];
                if (longOutputLimit) {
                    for (const fallback of [32000, 16000]) {
                        const candidate = Math.min(fallback, requestedMaxTokens);
                        if (!tokenCandidates.includes(candidate)) tokenCandidates.push(candidate);
                    }
                }
                let response;
                let responseText = '';
                for (let index = 0; index < tokenCandidates.length; index += 1) {
                    const body = {
                        model,
                        messages,
                        temperature: clampNumber(settings.temperature, 0.8, 0, 2),
                        max_tokens: tokenCandidates[index],
                    };
                    const networkAttempts = longOutputLimit ? 2 : 1;
                    for (let networkAttempt = 0; networkAttempt < networkAttempts; networkAttempt += 1) {
                        try {
                            response = await fetchImpl(url, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    Authorization: `Bearer ${String(settings.apiKey || '').trim()}`,
                                },
                                body: JSON.stringify(body),
                                signal: controller.signal,
                            });
                            break;
                        } catch (error) {
                            if (error?.name === 'AbortError') throw error;
                            if (!isTransientFetchError(error) || networkAttempt === networkAttempts - 1) {
                                throw networkFetchDiagnostic(error);
                            }
                            await new Promise(resolve => setTimeout(resolve, 600));
                            if (controller.signal.aborted) {
                                const aborted = new Error('请求已取消');
                                aborted.name = 'AbortError';
                                throw aborted;
                            }
                        }
                    }
                    if (response.ok) break;
                    responseText = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
                    const invalidArgument = Number(response.status) === 400
                        && /invalid[_ -]?argument|max[_ -]?tokens|output tokens|token limit/i.test(responseText);
                    if (!invalidArgument || index === tokenCandidates.length - 1) {
                        const detail = responseText.trim().replace(/\s+/g, ' ').slice(0, 300);
                        throw new Error(`闲聊生成失败：HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
                    }
                }
                const json = await response.json();
                const reply = String(json?.choices?.[0]?.message?.content || '').trim();
                const finishReason = String(json?.choices?.[0]?.finish_reason || '');
                const normalized = normalizeChatReply(reply, normalizeOptions);
                if (finishReason === 'length' || !normalized.ok) {
                    const error = new Error(normalized.error || '闲聊回复不是 Beat 格式。');
                    error.rawText = reply;
                    error.finishReason = finishReason;
                    error.closedBeatCount = (reply.match(/<beat\b[^>]*>[\s\S]*?<\/beat>/gi) || []).length;
                    throw error;
                }
                if (controller.signal.aborted) {
                    const aborted = new Error('请求已取消');
                    aborted.name = 'AbortError';
                    throw aborted;
                }
                const user = playerLine ? { id: `${requestId}-user`, role: 'user', content: `玩家说：${playerLine}`, text: playerLine, label: '你' } : null;
                const assistant = { id: `${requestId}-assistant`, role: 'assistant', content: normalized.script, text: chatDisplayText(normalized.beats), label: idol || '偶像' };
                if (useHistory && user) remember(idol, user);
                if (useHistory) remember(idol, assistant);
                if (useHistory && user && typeof onExchange === 'function') {
                    try { await onExchange(idol, { user, assistant, requestId }); }
                    catch (error) { onHistoryError?.(error, 'write'); }
                }
                return {
                    requestId,
                    channelLeaseId: 'local',
                    saveScope,
                    text: reply,
                    rawText: reply,
                    isFinal: true,
                };
            } catch (error) {
                if (error?.name === 'AbortError') {
                    if (externalSignal?.aborted) throw new Error('已取消闲聊生成');
                    throw new Error('闲聊生成超时，请重试');
                }
                throw error;
            } finally {
                clearTimeout(timer);
                externalSignal?.removeEventListener?.('abort', onExternalAbort);
            }
        },
        dispose() {
            disposed = true;
        },
    };
}

export { BUILTIN_SPEAKERS };
