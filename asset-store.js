// Raw resources only. Save games, chat data and decoded Three.js objects never
// enter this cache. Failure to persist must not turn a usable download into an error.
export const RESOURCE_CACHE_NAME = 'mmd-dialogue-resources-v1';
const GiB = 1024 ** 3;
const abortError = () => new DOMException('资源加载已取消', 'AbortError');
const cacheKey = item => `https://mmd-resource-cache.invalid/${item.key.split('/').map(encodeURIComponent).join('/')}?v=${encodeURIComponent(item.hash)}`;

class Metadata {
    constructor() { this.ready = this.open(); }
    async open() {
        if (!globalThis.indexedDB) return null;
        return new Promise(resolve => {
            const req = indexedDB.open(RESOURCE_CACHE_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'url' });
            req.onsuccess = () => resolve(req.result);
            req.onerror = req.onblocked = () => resolve(null);
        });
    }
    async run(method, value) {
        const db = await this.ready;
        if (!db) return null;
        return new Promise(resolve => {
            try {
                const tx = db.transaction('files', method === 'getAll' ? 'readonly' : 'readwrite');
                const req = tx.objectStore('files')[method](...(value === undefined ? [] : [value]));
                let result;
                req.onsuccess = () => { result = req.result; };
                tx.oncomplete = () => resolve(result);
                tx.onerror = tx.onabort = () => resolve(null);
            } catch { resolve(null); }
        });
    }
}

export class AssetStore {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || '';
        this.fetcher = options.fetcher || globalThis.fetch.bind(globalThis);
        this.storage = options.storage || globalThis.navigator?.storage;
        this.locks = options.locks || globalThis.navigator?.locks;
        this.budget = options.budget ?? (/Android|iPhone|iPad|Mobile/i.test(globalThis.navigator?.userAgent || '') ? GiB / 2 : GiB * 2);
        try { this.budget = Number(localStorage.getItem('mmd-resource-cache-budget')) || this.budget; } catch { /* unavailable */ }
        this.cachePromise = options.cache ? Promise.resolve(options.cache)
            : globalThis.caches?.open(RESOURCE_CACHE_NAME).catch(() => null) || Promise.resolve(null);
        this.metadata = new Metadata();
        this.rows = new Map();
        this.pending = new Map();
        this.pins = new Map();
        this.mutation = Promise.resolve();
        this.ready = this.restore();
    }
    async restore() {
        const cache = await this.cachePromise;
        if (!cache) return;
        try {
            const persisted = new Map((await this.metadata.run('getAll') || []).map(row => [row.url, row]));
            const previous = this.rows, refreshed = new Map();
            for (const request of await cache.keys()) {
                const url = request.url;
                const row = persisted.get(url) || previous.get(url);
                if (row) refreshed.set(url, row);
                else {
                    const response = await cache.match(url);
                    const size = Number(response?.headers.get('x-resource-size')) || (await response?.blob())?.size || 0;
                    refreshed.set(url, { url, size, used: Number(response?.headers.get('x-resource-used')) || 0 });
                }
            }
            this.rows = refreshed;
        } catch { /* private mode/cache unavailable: session downloads still work */ }
    }
    exclusive(task) {
        return this.locks?.request ? this.locks.request(RESOURCE_CACHE_NAME, task) : task();
    }
    url(item) {
        if (item.url) return item.url;
        return `${this.baseUrl.replace(/\/$/, '')}/${item.key.split('/').map(encodeURIComponent).join('/')}`;
    }
    pin(items) {
        const keys = [...new Set(items.map(cacheKey))];
        keys.forEach(key => this.pins.set(key, (this.pins.get(key) || 0) + 1));
        let released = false;
        return () => { if (released) return; released = true; keys.forEach(key => {
            const count = this.pins.get(key) - 1;
            if (count) this.pins.set(key, count); else this.pins.delete(key);
        }); };
    }
    async touch(url, size) {
        const row = { url, size, used: Date.now() };
        this.rows.set(url, row);
        await this.metadata.run('put', row);
    }
    async read(item) {
        await this.ready;
        const cache = await this.cachePromise, key = cacheKey(item);
        try {
            const response = await cache?.match(key);
            if (!response) return null;
            const blob = await response.blob();
            if (Number.isFinite(item.size) && blob.size !== item.size) {
                await cache.delete(key); this.rows.delete(key); await this.metadata.run('delete', key); return null;
            }
            await this.touch(key, blob.size);
            return { blob, cached: true, persisted: true };
        } catch { return null; }
    }
    get(item, { signal, onProgress } = {}) {
        if (signal?.aborted) return Promise.reject(abortError());
        const key = cacheKey(item);
        let job = this.pending.get(key);
        if (!job) {
            job = { controller: new AbortController(), consumers: new Set(), received: 0 };
            this.pending.set(key, job);
            job.promise = (async () => {
                const hit = await this.read(item);
                if (hit) return hit;
                return this.download(item, job);
            })().finally(() => { if (this.pending.get(key) === job) this.pending.delete(key); });
        }
        return new Promise((resolve, reject) => {
            const consumer = { progress: onProgress };
            job.consumers.add(consumer);
            if (job.received) onProgress?.(job.received);
            let settled = false;
            const cleanup = () => {
                signal?.removeEventListener('abort', cancel);
                job.consumers.delete(consumer);
            };
            const cancel = () => {
                if (settled) return; settled = true; cleanup();
                if (!job.consumers.size) { job.controller.abort(); if (this.pending.get(key) === job) this.pending.delete(key); }
                reject(abortError());
            };
            signal?.addEventListener('abort', cancel, { once: true });
            job.promise.then(result => { if (!settled) { settled = true; cleanup(); resolve(result); } }, error => {
                if (!settled) { settled = true; cleanup(); reject(error); }
            });
        });
    }
    async download(item, job) {
        const response = await this.fetcher(this.url(item), { signal: job.controller.signal, mode: 'cors', credentials: 'omit', cache: 'no-store' });
        if (!response.ok || response.type === 'opaque') throw new Error(`资源下载失败 HTTP ${response.status}：${item.key}`);
        const chunks = [];
        let bytes = 0;
        if (response.body?.getReader) {
            const reader = response.body.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (job.controller.signal.aborted) throw abortError();
                    chunks.push(value); bytes += value.byteLength; job.received = bytes;
                    job.consumers.forEach(consumer => consumer.progress?.(bytes));
                }
            } finally { reader.releaseLock(); }
        } else {
            const bytesArray = new Uint8Array(await response.arrayBuffer());
            chunks.push(bytesArray); bytes = bytesArray.byteLength; job.received = bytes;
            job.consumers.forEach(consumer => consumer.progress?.(bytes));
        }
        if (job.controller.signal.aborted) throw abortError();
        const blob = new Blob(chunks, { type: item.type || response.headers.get('content-type') || 'application/octet-stream' });
        if (Number.isFinite(item.size) && bytes !== item.size) throw new Error(`资源大小不符：${item.key}（${bytes}/${item.size}）`);
        // A strong hash is optional for imported manifests; generated manifests
        // always include SHA-256. Do not cache corrupted successful HTTP responses.
        if (/^[a-f0-9]{64}$/i.test(item.hash) && globalThis.crypto?.subtle) {
            const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
            const hash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
            if (hash !== item.hash) throw new Error(`资源校验失败：${item.key}`);
        }
        const persist = async () => {
            const cache = await this.cachePromise;
            // Other tabs and the audition iframe use the same origin cache.
            // Reconcile their writes while holding the origin-wide Web Lock.
            await this.restore();
            if (!cache || !await this.makeRoom(blob.size, cacheKey(item))) return false;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    await cache.put(cacheKey(item), new Response(blob, { headers: { 'content-type': blob.type, 'x-resource-size': String(blob.size), 'x-resource-used': String(Date.now()) } }));
                    await this.touch(cacheKey(item), blob.size);
                    return true;
                } catch (error) {
                    if (error?.name !== 'QuotaExceededError' || attempt) return false;
                    await this.evict(0, cacheKey(item));
                }
            }
            return false;
        };
        const saving = this.mutation.then(() => this.exclusive(persist), () => this.exclusive(persist));
        this.mutation = saving.catch(() => {});
        const persisted = await saving.catch(() => false);
        return { blob, cached: false, persisted };
    }
    async effectiveBudget() {
        try { const saved = Number(localStorage.getItem('mmd-resource-cache-budget')); if (saved > 0) this.budget = saved; } catch { /* unavailable */ }
        try {
            const { usage = 0, quota } = await this.storage?.estimate() || {};
            if (quota) {
                const own = [...this.rows.values()].reduce((sum, row) => sum + row.size, 0);
                return Math.max(0, Math.min(this.budget, quota - Math.max(0, usage - own) - Math.min(128 * 1024 ** 2, quota * .1)));
            }
        } catch { /* estimate is advisory */ }
        return this.budget;
    }
    async makeRoom(size, key) {
        const limit = await this.effectiveBudget();
        if (size > limit) return false;
        const current = [...this.rows.values()].reduce((sum, row) => sum + row.size, 0);
        if (current + size > limit) await this.evict(Math.max(size, limit * .8) - size, key);
        return [...this.rows.values()].reduce((sum, row) => sum + row.size, 0) + size <= limit;
    }
    async evict(target = 0, protectedKey = '') {
        await this.ready;
        const cache = await this.cachePromise;
        let total = [...this.rows.values()].reduce((sum, row) => sum + row.size, 0);
        for (const row of [...this.rows.values()].sort((a, b) => a.used - b.used)) {
            if (total <= target) break;
            if (this.pins.has(row.url) || row.url === protectedKey) continue;
            await cache?.delete(row.url); this.rows.delete(row.url); total -= row.size;
            await this.metadata.run('delete', row.url);
        }
    }
    async stats() {
        await this.ready;
        await this.restore();
        return { bytes: [...this.rows.values()].reduce((sum, row) => sum + row.size, 0), files: this.rows.size,
            budget: this.budget, effectiveBudget: await this.effectiveBudget(), persistent: Boolean(await this.cachePromise) };
    }
    async setBudget(bytes) {
        this.budget = Math.max(0, Number(bytes) || 0);
        try { localStorage.setItem('mmd-resource-cache-budget', String(this.budget)); } catch { /* unavailable */ }
        await this.mutation;
        await this.exclusive(async () => { await this.restore(); await this.evict(this.budget * .8); });
        return this.stats();
    }
    async clearUnused() { await this.mutation; await this.exclusive(async () => { await this.restore(); await this.evict(0); }); return this.stats(); }
    async requestPersistence() { return await this.storage?.persist?.() || false; }
    async prefetch(items, { signal, onProgress, concurrency = 4 } = {}) {
        const unique = [...new Map(items.map(item => [cacheKey(item), item])).values()];
        const state = { phase: 'checking', totalBytes: unique.reduce((n, item) => n + item.size, 0), downloadBytes: 0,
            receivedBytes: 0, cachedBytes: 0, completedFiles: 0, totalFiles: unique.length, volatileFiles: 0 };
        const results = new Map(), missing = [], amounts = new Map();
        const report = () => onProgress?.({ ...state });
        report();
        for (const item of unique) {
            if (signal?.aborted) throw abortError();
            const hit = await this.read(item);
            if (hit) { results.set(item.key, hit); state.cachedBytes += item.size; state.completedFiles++; }
            else { missing.push(item); state.downloadBytes += item.size; }
        }
        state.phase = 'downloading'; report();
        let cursor = 0;
        const group = new AbortController(), abort = () => group.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) group.abort();
        try {
            await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
                while (cursor < missing.length) {
                    const item = missing[cursor++];
                    const result = await this.get(item, { signal: group.signal, onProgress: bytes => {
                        state.receivedBytes += bytes - (amounts.get(item.key) || 0); amounts.set(item.key, bytes);
                        state.currentKey = item.key; report();
                    }});
                    results.set(item.key, result); state.completedFiles++;
                    if (result.cached) { state.cachedBytes += item.size; state.downloadBytes -= item.size; }
                    if (!result.persisted) state.volatileFiles++;
                    report();
                }
            }));
            return { results, progress: { ...state } };
        } catch (error) { group.abort(); throw error; }
        finally { signal?.removeEventListener('abort', abort); }
    }
}
