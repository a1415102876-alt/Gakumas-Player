// A user-supplied background image that replaces every scene the script asks
// for (2D plates and 3D scenes alike). The image and its on/off switch live in
// this browser's IndexedDB; nothing is uploaded anywhere.

const DB_NAME = 'gakumas-custom-background';
const STORE = 'background';
const RECORD_KEY = 'current';
const CUSTOM_SEQUENCE_KEY = '__custom-sequence';
const CUSTOM_BACKGROUND_KEY = /^custom([1-9]\d*)$/iu;

export const CUSTOM_BACKGROUND_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
export const CUSTOM_BACKGROUND_MAX_BYTES = 30 * 1024 * 1024;
// The plate becomes a WebGL texture. 4096 fits every desktop GPU and keeps the
// upload around 64 MB of VRAM at most.
export const CUSTOM_BACKGROUND_MAX_SIDE = 4096;

function openDb(indexedDBImpl = globalThis.indexedDB) {
    return new Promise((resolve, reject) => {
        if (!indexedDBImpl) { reject(new Error('当前浏览器不支持本地图片存储。')); return; }
        const request = indexedDBImpl.open(DB_NAME, 2);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('无法打开本地图片存储。'));
    });
}

async function withStore(mode, action) {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const store = tx.objectStore(STORE);
            let result;
            const request = action(store);
            if (request) request.onsuccess = () => { result = request.result; };
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error || new Error('本地图片存储失败。'));
            tx.onabort = () => reject(tx.error || new Error('本地图片存储被中断，可能是空间不足。'));
        });
    } finally {
        db.close();
    }
}

export function validateCustomBackgroundFile(file) {
    if (!file || typeof file.size !== 'number') return '没有选择图片。';
    const type = String(file.type || '').toLowerCase();
    if (!CUSTOM_BACKGROUND_TYPES.includes(type)) return '只支持 PNG、JPG、WebP、GIF、AVIF 或 BMP 图片。';
    if (file.size <= 0) return '图片文件是空的。';
    if (file.size > CUSTOM_BACKGROUND_MAX_BYTES) return `图片超过 ${Math.round(CUSTOM_BACKGROUND_MAX_BYTES / 1024 / 1024)} MB，请换一张小一些的图片。`;
    return '';
}

export function fitWithin(width, height, maxSide = CUSTOM_BACKGROUND_MAX_SIDE) {
    const w = Math.max(1, Math.round(Number(width) || 1));
    const h = Math.max(1, Math.round(Number(height) || 1));
    const scale = Math.min(1, maxSide / Math.max(w, h));
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scaled: scale < 1 };
}

function decodeImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => (image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('图片尺寸无效。')));
        image.onerror = () => reject(new Error('图片无法解码，文件可能已损坏。'));
        image.src = url;
    });
}

// Decode the file once to prove it is an image, and shrink it when the longest
// side exceeds the texture budget. Returns the blob that should be stored.
export async function prepareCustomBackgroundFile(file) {
    const problem = validateCustomBackgroundFile(file);
    if (problem) throw new Error(problem);
    const url = URL.createObjectURL(file);
    try {
        const image = await decodeImage(url);
        const size = fitWithin(image.naturalWidth, image.naturalHeight);
        if (!size.scaled) return { blob: file, width: image.naturalWidth, height: image.naturalHeight, scaled: false };
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, size.width, size.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.92));
        if (!blob) throw new Error('图片缩小失败。');
        return { blob, width: size.width, height: size.height, scaled: true };
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function readCustomBackground() {
    const record = await withStore('readonly', store => store.get(RECORD_KEY));
    if (!record || !(record.blob instanceof Blob)) return null;
    return {
        blob: record.blob,
        name: String(record.name || ''),
        width: Number(record.width) || 0,
        height: Number(record.height) || 0,
        enabled: record.enabled !== false,
        updatedAt: Number(record.updatedAt) || 0,
    };
}

export function normalizeCustomBackgroundId(value) {
    const id = String(value || '').trim().toLowerCase();
    return CUSTOM_BACKGROUND_KEY.test(id) ? id : '';
}

function recordFromStored(key, record) {
    if (!record || !(record.blob instanceof Blob)) return null;
    const id = normalizeCustomBackgroundId(key || record.id);
    return {
        id,
        blob: record.blob,
        name: String(record.name || ''),
        width: Number(record.width) || 0,
        height: Number(record.height) || 0,
        updatedAt: Number(record.updatedAt) || 0,
    };
}

/** List the browser-local numbered Custom image repository. */
export async function listCustomBackgrounds() {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            const keysRequest = store.getAllKeys();
            const valuesRequest = store.getAll();
            let keys = [];
            let values = [];
            keysRequest.onsuccess = () => { keys = keysRequest.result || []; };
            valuesRequest.onsuccess = () => { values = valuesRequest.result || []; };
            tx.oncomplete = () => resolve(keys
                .map((key, index) => recordFromStored(key, values[index]))
                .filter(record => record?.id)
                .sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6))));
            tx.onerror = () => reject(tx.error || new Error('读取本地图片仓库失败。'));
            tx.onabort = () => reject(tx.error || new Error('读取本地图片仓库被中断。'));
        });
    } finally {
        db.close();
    }
}

export function nextCustomBackgroundId(records, highWaterMark = 0) {
    // Keep IDs stable after deletion. Reusing a hole would silently make an
    // existing Beat point at a different image after the next upload.
    const used = (records || [])
        .map(record => Number(String(record?.id || '').slice(6)))
        .filter(number => Number.isSafeInteger(number) && number > 0);
    const lastAssigned = Math.max(Number.isSafeInteger(Number(highWaterMark)) ? Number(highWaterMark) : 0, ...used, 0);
    return `custom${lastAssigned + 1}`;
}

/** Save an image under the next stable customN ID. */
export async function saveCustomBackgroundItem({ blob, name = '', width = 0, height = 0 } = {}) {
    if (!(blob instanceof Blob)) throw new Error('没有可保存的图片。');
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const keysRequest = store.getAllKeys();
            const sequenceRequest = store.get(CUSTOM_SEQUENCE_KEY);
            let record = null;
            let keys;
            let sequence;
            let saved = false;
            const maybeSave = () => {
                if (saved || !keys || sequence === undefined) return;
                saved = true;
                const id = nextCustomBackgroundId((keys || []).map(key => ({ id: key })), sequence);
                const number = Number(id.slice(6));
                record = { id, blob, name: String(name || ''), width, height, updatedAt: Date.now() };
                store.put(number, CUSTOM_SEQUENCE_KEY);
                store.put(record, id);
            };
            keysRequest.onsuccess = () => { keys = keysRequest.result || []; maybeSave(); };
            sequenceRequest.onsuccess = () => { sequence = sequenceRequest.result || 0; maybeSave(); };
            tx.oncomplete = () => resolve(recordFromStored(record?.id, record));
            tx.onerror = () => reject(tx.error || new Error('本地图片存储失败。'));
            tx.onabort = () => reject(tx.error || new Error('本地图片存储被中断，可能是空间不足。'));
        });
    } finally {
        db.close();
    }
}

export async function deleteCustomBackgroundItem(id) {
    const key = normalizeCustomBackgroundId(id);
    if (!key) return false;
    await withStore('readwrite', store => store.delete(key));
    return true;
}

export async function saveCustomBackground({ blob, name = '', width = 0, height = 0, enabled = true }) {
    if (!(blob instanceof Blob)) throw new Error('没有可保存的图片。');
    const record = { blob, name: String(name || ''), width, height, enabled: Boolean(enabled), updatedAt: Date.now() };
    await withStore('readwrite', store => store.put(record, RECORD_KEY));
    return readCustomBackground();
}

export async function setCustomBackgroundEnabled(enabled) {
    const current = await readCustomBackground();
    if (!current) return null;
    return saveCustomBackground({ ...current, enabled });
}

export async function clearCustomBackground() {
    await withStore('readwrite', store => store.delete(RECORD_KEY));
}

// Decode a stored record into what the player needs: an <img> for the WebGL
// plate and an object URL for the CSS layer. Call release() when replaced.
export async function loadCustomBackgroundImage(record) {
    if (!record?.blob) return null;
    const url = URL.createObjectURL(record.blob);
    try {
        const image = await decodeImage(url);
        return { image, url, name: record.name, release: () => URL.revokeObjectURL(url) };
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
}
