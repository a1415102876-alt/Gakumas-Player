export const PRODUCER_PROFILE_KEY = 'hatsuProducerProfileV1';
export const CHAT_MEMORY_DB = 'hatsuChatMemoryV1';
export const PROFILE_MAX_LENGTH = 20000;

export function readProducerProfile(storage = globalThis.localStorage) {
    try { return String(storage?.getItem(PRODUCER_PROFILE_KEY) || '').slice(0, PROFILE_MAX_LENGTH); }
    catch { return ''; }
}

export function writeProducerProfile(text, storage = globalThis.localStorage) {
    if (!storage) throw new Error('浏览器未开放本地存储，制作人档案未保存。');
    const profile = String(text || '').slice(0, PROFILE_MAX_LENGTH);
    storage.setItem(PRODUCER_PROFILE_KEY, profile);
    return profile;
}

function recallTerms(query) {
    const terms = new Set(String(query || '').toLowerCase().match(/[a-z0-9_-]{3,}/g) || []);
    const stop = new Set(['我们', '你们', '这个', '那个', '什么', '怎么', '可以', '一下', '今天', '现在', '记得', '之前', '时候', '是不是', '有没有']);
    for (const part of String(query || '').match(/[\p{Script=Han}]{2,}/gu) || []) {
        for (let size = 2; size <= 4; size++) {
            for (let start = 0; start + size <= part.length; start++) {
                const term = part.slice(start, start + size);
                if (!stop.has(term)) terms.add(term);
            }
        }
    }
    return [...terms].slice(0, 500);
}

/** Archive every exchange; bound only the context sent to the model. */
export function selectChatMemory(exchanges, query, { recentLimit = 12, recallLimit = 6, maxChars = 24000 } = {}) {
    const sorted = [...exchanges].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const recent = [];
    let used = 0;
    for (const exchange of sorted.slice(-recentLimit).reverse()) {
        const size = exchange.user.content.length + exchange.assistant.content.length;
        if (used + size > maxChars && recent.length) break;
        recent.unshift(exchange);
        used += size;
    }
    // A single very long reply must not consume an unbounded context.
    const history = recent.flatMap(exchange => [exchange.user, exchange.assistant].map(turn => ({
        id: `${exchange.id}-${turn.role}`,
        role: turn.role,
        content: turn.content.slice(0, used > maxChars ? Math.floor(maxChars / 2) : maxChars),
    })));
    const selected = new Set(recent.map(exchange => exchange.id));
    const terms = recallTerms(query);
    const older = sorted.filter(exchange => !selected.has(exchange.id));
    const ranked = older.map(exchange => {
        const text = `${exchange.user.text}\n${exchange.assistant.text}`.toLowerCase();
        return { exchange, score: terms.reduce((score, term) => score + (text.includes(term) ? term.length : 0), 0) };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.exchange.createdAt - a.exchange.createdAt);
    let recallChars = 0;
    const memories = [];
    for (const { exchange } of ranked.slice(0, recallLimit)) {
        const text = `${new Date(exchange.createdAt).toLocaleDateString('zh-CN')}\n制作人：${exchange.user.text}\n${exchange.idolId}：${exchange.assistant.text}`;
        const excerpt = text.slice(0, Math.min(1600, 8000 - recallChars));
        if (!excerpt) break;
        memories.push(excerpt);
        recallChars += excerpt.length;
    }
    return { history, memories: memories.join('\n\n') };
}

export function createChatMemoryStore({ indexedDB = globalThis.indexedDB, keyRange = globalThis.IDBKeyRange, dbName = CHAT_MEMORY_DB } = {}) {
    let opening;
    async function database() {
        if (!indexedDB || !keyRange) throw new Error('浏览器未开放聊天记忆存储；请使用普通浏览窗口。');
        if (!opening) opening = new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);
            request.onupgradeneeded = () => {
                const store = request.result.createObjectStore('exchanges', { keyPath: 'id' });
                store.createIndex('idolCreatedAt', ['idolId', 'createdAt']);
            };
            request.onerror = () => reject(request.error || new Error('聊天记忆读取失败。'));
            request.onblocked = () => reject(new Error('聊天记忆被其他页面占用，请关闭旧页面后重试。'));
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => { db.close(); opening = null; };
                resolve(db);
            };
        }).catch(error => { opening = null; throw error; });
        return opening;
    }
    async function transaction(mode, operation) {
        const db = await database();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('exchanges', mode);
            let result;
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(tx.error || new Error('聊天记忆保存失败，请检查浏览器存储空间。'));
            tx.onerror = () => {}; // onabort reports the final transaction error.
            try { operation(tx.objectStore('exchanges'), value => { result = value; }); }
            catch (error) { tx.abort(); reject(error); }
        });
    }
    const range = idol => keyRange.bound([String(idol), 0], [String(idol), Number.MAX_SAFE_INTEGER]);
    return {
        async remember(idolId, { user, assistant, requestId } = {}) {
            if (!idolId || !user?.content || !assistant?.content) throw new Error('聊天记录不完整，未写入记忆。');
            const createdAt = Date.now();
            const id = String(requestId || `${createdAt}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`);
            const exchange = {
                id, idolId: String(idolId), createdAt,
                user: { role: 'user', content: String(user.content), text: String(user.text || user.content), label: '你' },
                assistant: { role: 'assistant', content: String(assistant.content), text: String(assistant.text || assistant.content), label: String(idolId) },
            };
            // One transaction keeps the producer line and the answer together.
            await transaction('readwrite', (store, done) => { store.put(exchange); done(exchange); });
            return exchange;
        },
        async list(idolId, { offset = 0, limit = 30 } = {}) {
            return transaction('readonly', (store, done) => {
                const index = store.index('idolCreatedAt');
                const rows = [];
                let total = 0, skipped = false;
                const count = index.count(range(idolId));
                count.onsuccess = () => { total = count.result; done({ rows, total }); };
                const cursor = index.openCursor(range(idolId), 'prev');
                cursor.onsuccess = () => {
                    const item = cursor.result;
                    if (!item || rows.length >= limit) { done({ rows, total }); return; }
                    if (offset > 0 && !skipped) { skipped = true; item.advance(offset); return; }
                    rows.push(item.value);
                    item.continue();
                };
            });
        },
        async all(idolId) {
            return transaction('readonly', (store, done) => {
                const request = store.index('idolCreatedAt').getAll(range(idolId));
                request.onsuccess = () => done(request.result);
            });
        },
        async context(idolId, query) { return selectChatMemory(await this.all(idolId), query); },
        async clear(idolId) {
            return transaction('readwrite', (store, done) => {
                const request = store.index('idolCreatedAt').openCursor(range(idolId));
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) { done(true); return; }
                    cursor.delete();
                    cursor.continue();
                };
            });
        },
    };
}
