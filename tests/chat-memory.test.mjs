import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatPrompt, createLocalChatBridge } from '../beat-chat.js';
import { readProducerProfile, writeProducerProfile, selectChatMemory } from '../sandbox/chat-memory.js';

const idol = '藤田琴音';
const reply = '<beat speaker="kotone" cue="talk" face="neutral">收到，制作人。</beat>';
const settings = { baseUrl: 'https://test.invalid/v1', model: 'test', producerProfile: '制作人档案测试字段', systemPrompt: '保持偶像口吻。' };
const response = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: reply } }] }) });
const prompt = (text, name = idol) => buildChatPrompt({ idolName: name, userText: text });

test('档案可以保存、读取及清空，存储失败会明确报错', () => {
    const values = new Map();
    const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
    writeProducerProfile('档案\n保留换行', storage);
    assert.equal(readProducerProfile(storage), '档案\n保留换行');
    writeProducerProfile('', storage);
    assert.equal(readProducerProfile(storage), '');
    assert.throws(() => writeProducerProfile('不能假装保存成功', { setItem() { throw new Error('QuotaExceeded'); } }));
});

test('刷新后的新聊天桥读取已保存对话，并将档案与当前消息一同发给 AI', async () => {
    const exchanges = new Map();
    const requests = [];
    const makeBridge = () => createLocalChatBridge({
        getSettings: () => settings,
        loadHistory: async name => ({ history: exchanges.get(name) || [] }),
        onExchange: async (name, exchange) => exchanges.set(name, [...(exchanges.get(name) || []), exchange.user, exchange.assistant]),
        fetchImpl: async (_, init) => { requests.push(JSON.parse(init.body)); return response(); },
    });
    await makeBridge().send(prompt('第一轮保存信息'));
    await makeBridge().send(prompt('接着刚才聊'));
    const messages = requests[1].messages;
    assert.match(messages[0].content, /【制作人档案】[\s\S]*制作人档案测试字段/);
    assert.equal(messages[1].role, 'user');
    assert.match(messages[1].content, /第一轮保存信息/);
    assert.equal(messages[2].role, 'assistant');
    assert.match(messages.at(-1).content, /接着刚才聊/);
    assert.equal(exchanges.get(idol).length, 4);
    await makeBridge().send(prompt('另一位偶像的第一轮', '花海咲季'));
    assert.equal(requests[2].messages.length, 2);
    assert.doesNotMatch(JSON.stringify(requests[2].messages), /第一轮保存信息/);
});

test('剧本生成 useHistory:false 不带入人设或闲聊，也不会写入历史', async () => {
    let body, loaded = false, saved = false;
    const bridge = createLocalChatBridge({
        getSettings: () => settings,
        loadHistory: async () => { loaded = true; return { history: [] }; },
        onExchange: async () => { saved = true; },
        fetchImpl: async (_, init) => { body = JSON.parse(init.body); return response(); },
    });
    await bridge.send(prompt('只生成剧本'), { useHistory: false });
    assert.equal(loaded, false);
    assert.equal(saved, false);
    assert.doesNotMatch(JSON.stringify(body.messages), /制作人档案测试字段/);
});

test('网络失败和格式无效的回复不写入聊天记忆', async () => {
    for (const fetchImpl of [
        async () => ({ ok: false, status: 503, text: async () => 'offline' }),
        async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) }),
    ]) {
        let saved = false;
        const bridge = createLocalChatBridge({ getSettings: () => settings, fetchImpl, onExchange: async () => { saved = true; } });
        await assert.rejects(bridge.send(prompt('失败消息')));
        assert.equal(saved, false);
        assert.equal(bridge.historyFor(idol).length, 0);
    }
});

test('存储读取或写入异常不会丢掉成功回复，并向界面报告错误', async () => {
    const errors = [];
    const bridge = createLocalChatBridge({
        getSettings: () => settings, fetchImpl: async () => response(),
        loadHistory: async () => { throw new Error('unavailable'); },
        onExchange: async () => { throw new Error('quota'); },
        onHistoryError: (_, action) => errors.push(action),
    });
    const result = await bridge.send(prompt('当前对话仍然可用'));
    assert.equal(result.isFinal, true);
    assert.deepEqual(errors, ['read', 'write']);
    assert.equal(bridge.historyFor(idol).length, 2);
});

test('旧话题可检索；近期消息保持成对、按时间排列；上下文有限而原记录完整', () => {
    const exchanges = Array.from({ length: 30 }, (_, index) => ({
        id: String(index).padStart(3, '0'), idolId: idol, createdAt: 1700000000000 + index,
        user: { role: 'user', content: index ? `最近消息 ${index}` : '我喜欢薄荷巧克力', text: index ? `最近消息 ${index}` : '我喜欢薄荷巧克力' },
        assistant: { role: 'assistant', content: '记住这轮对话。', text: '记住这轮对话。' },
    }));
    const memory = selectChatMemory(exchanges, '还记得薄荷巧克力吗？');
    assert.equal(memory.history.length, 24);
    assert.match(memory.history[0].content, /18/);
    assert.match(memory.memories, /薄荷巧克力/);
    assert.equal(exchanges.length, 30);
    const long = selectChatMemory([{ ...exchanges[0], user: { role: 'user', text: '', content: '字'.repeat(100000) } }], '', { maxChars: 200 });
    assert.ok(long.history.reduce((sum, turn) => sum + turn.content.length, 0) <= 200);
});

test('写入失败的本轮仍然留在页面上下文里，不会被旧档案覆盖', async () => {
    let archive = [], writes = 0, sent;
    const bridge = createLocalChatBridge({
        getSettings: () => settings,
        loadHistory: async () => ({ history: archive }),
        onExchange: async (_, { user, assistant }) => {
            if (++writes === 2) throw new Error('quota');
            archive = [...archive, user, assistant];
        },
        fetchImpl: async (_, init) => { sent = JSON.parse(init.body); return response(); },
    });
    await bridge.send(prompt('已经保存'), { requestId: 'first' });
    await bridge.send(prompt('暂时无法写入的新信息'), { requestId: 'second' });
    await bridge.send(prompt('继续'), { requestId: 'third' });
    assert.match(JSON.stringify(sent.messages), /暂时无法写入的新信息/);
});
