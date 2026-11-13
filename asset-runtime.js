import { AssetStore } from './asset-store.js';
import { resolveLibrarySource } from './library-client.js';

const ROOT = new URL('./', import.meta.url);
let libraryPromise, sharedStore;
async function json(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`资源索引读取失败（${response.status}）：${url}`);
    return response.json();
}
export function loadResourceLibrary() {
    libraryPromise ||= Promise.all(['library.json?v=20261113-hkne-onsen-v1', 'gakumas-motion-map.json?v=20261111-hkne-motions-v1', 'resource-manifest.json?v=20261113-hkne-onsen-v1']
        .map(name => json(new URL(name, ROOT)))).then(([config, map, manifest]) => ({ config, map, manifest, status: manifest.status }))
        .catch(error => { libraryPromise = null; throw error; });
    return libraryPromise;
}
export function resourceStore() { return sharedStore ||= new AssetStore(); }

export function canonicalResourceKey(input, config, base = ROOT.href) {
    let url;
    try { url = new URL(input, base); } catch { return ''; }
    if (!/^https?:$/.test(url.protocol)) return '';
    const pathname = decodeURIComponent(url.pathname);
    const remote = resolveLibrarySource(config);
    if (remote.r2Base) {
        const root = new URL(remote.r2Base + '/');
        if (url.origin === root.origin && pathname.startsWith(root.pathname)) return pathname.slice(root.pathname.length);
    }
    const local = new URL(remote.localBase + '/', url.origin);
    if (url.origin === new URL(base).origin && pathname.startsWith(local.pathname)) return pathname.slice(local.pathname.length).replace(/^scenes\/gakumas\//, 'scenes/');
    const stage = new URL(base);
    if (url.origin === stage.origin && pathname.startsWith(stage.pathname)) return pathname.slice(stage.pathname.length);
    return '';
}

export class ResourceSession {
    constructor(library, options = {}) {
        Object.assign(this, library);
        this.store = options.store || resourceStore();
        this.controller = new AbortController();
        this.urls = new Map(); this.blobs = new Map(); this.disposed = false;
        this.onProgress = options.onProgress || (() => {});
        this.base = options.base || ROOT.href;
    }
    key(url) { return canonicalResourceKey(url, this.config, this.base); }
    urlFor(item) {
        // Small versioned fixes can ship with the frontend while large assets
        // remain on R2. The content hash also invalidates the browser HTTP cache.
        if (item.delivery === 'frontend') {
            const url = new URL(item.local, this.base);
            url.searchParams.set('v', item.hash);
            return url.href;
        }
        const source = resolveLibrarySource(this.config, { source: this.config.source, r2Base: this.config.r2?.baseUrl });
        return source.usingR2 ? `${source.base}/${item.key.split('/').map(encodeURIComponent).join('/')}` : new URL(item.local, this.base).href;
    }
    async prepare(keys, { extend = false } = {}) {
        const selected = new Set();
        const add = key => {
            if (selected.has(key)) return;
            const row = this.manifest.assets[key];
            if (!row) throw new Error(`资源清单缺少：${key}`);
            selected.add(key); (row.deps || []).forEach(add);
        };
        keys.forEach(add);
        const items = [...selected].map(key => ({ key, ...this.manifest.assets[key] }));
        const concurrency = /Android|iPhone|iPad|Mobile/i.test(globalThis.navigator?.userAgent || '') ? 2 : 4;
        if (extend && !this.disposed && this.urls?.size) {
            const union = [...new Map([...(this.items || []), ...items].map(item => [item.key, item])).values()];
            const nextUnpin = this.store.pin(union);
            this.unpin?.();
            this.unpin = nextUnpin;
            this.items = union;
            const missing = items.filter(item => !this.urls.has(item.key));
            if (!missing.length) return this;
            const { results, progress } = await this.store.prefetch(missing.map(item => ({ ...item, url: this.urlFor(item) })), {
                signal: this.controller.signal,
                onProgress: progress => {
                    if (progress.phase === 'downloading' && progress.downloadBytes > 0) this.onProgress(progress);
                },
                concurrency,
            });
            if (this.disposed) throw new DOMException('资源加载已取消', 'AbortError');
            for (const [key, { blob }] of results) {
                if (this.urls.has(key)) continue;
                this.blobs.set(key, blob);
                this.urls.set(key, URL.createObjectURL(blob));
            }
            this.progress = progress;
            return this;
        }
        this.items = items;
        this.unpin?.(); this.unpin = this.store.pin(this.items);
        const { results, progress } = await this.store.prefetch(this.items.map(item => ({ ...item, url: this.urlFor(item) })), {
            signal: this.controller.signal, onProgress: this.onProgress,
            concurrency,
        });
        if (this.disposed) throw new DOMException('资源加载已取消', 'AbortError');
        for (const [key, { blob }] of results) {
            this.blobs.set(key, blob); this.urls.set(key, URL.createObjectURL(blob));
        }
        this.progress = progress;
        this.onProgress({ ...progress, phase: 'preparing', preparedTasks: 0 });
        return this;
    }
    resolve(input) {
        if (/^(?:blob:|data:)/.test(String(input))) return input;
        const key = this.key(input);
        if (!key || !this.manifest.assets[key]) return input;
        if (this.disposed) throw new DOMException('资源加载已取消', 'AbortError');
        if (!this.urls.has(key)) throw new Error(`本段未准备该资源：${key}`);
        return this.urls.get(key);
    }
    async fetch(input) {
        const key = this.key(input);
        if (key && this.manifest.assets[key]) {
            this.resolve(input);
            return new Response(this.blobs.get(key), { headers: { 'content-type': this.blobs.get(key).type } });
        }
        return fetch(input, { signal: this.controller.signal });
    }
    manager(THREE, rewrite = value => value) {
        return new THREE.LoadingManager().setURLModifier(value => this.resolve(rewrite(value)));
    }
    report(phase, detail = {}) { if (!this.disposed) this.onProgress({ ...this.progress, phase, ...detail }); }
    dispose() {
        if (this.disposed) return;
        this.disposed = true; this.controller.abort(); this.unpin?.();
        this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls.clear(); this.blobs.clear();
    }
}
