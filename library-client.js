import { MOTION_BUCKETS, indexMotionFiles, normalizeActionId } from './core.js?v=20260913-nested-motion';

export { indexMotionFiles };

export const LIBRARY_SOURCE_KEY = 'mmd-library-source';
export const LIBRARY_R2_KEY = 'mmd-library-r2-base';

export function joinLibraryUrl(base, ...parts) {
    const root = String(base || '').replace(/\/+$/, '');
    const tail = parts
        .flatMap(part => String(part || '').split('/'))
        .map(part => part.trim())
        .filter(part => part && part !== '.' && part !== '..')
        .map(part => encodeURIComponent(part))
        .join('/');
    if (!root) return `/${tail}`;
    return `${root}/${tail}`;
}

export function resolveLibrarySource(config, overrides = {}) {
    const stored = key => { try { return globalThis.localStorage?.getItem(key) || undefined; } catch { return undefined; } };
    const source = overrides.source || stored(LIBRARY_SOURCE_KEY) || config?.source || 'local';
    const r2Base = String(overrides.r2Base ?? stored(LIBRARY_R2_KEY) ?? config?.r2?.baseUrl ?? '').trim().replace(/\/+$/, '');
    const localBase = String(config?.localBase || 'library/file').replace(/\/+$/, '');
    const usingR2 = source === 'r2' && !!r2Base;
    return {
        source: usingR2 ? 'r2' : 'local',
        base: usingR2 ? r2Base : localBase,
        r2Base,
        localBase,
        usingR2,
    };
}

export function packPrefix(config, packId, usingR2) {
    const pack = config?.packs?.[packId];
    if (!pack) return packId;
    return usingR2 ? (pack.r2Prefix || packId) : packId;
}

export function libraryFileUrl(config, packId, filePath, overrides) {
    const resolved = resolveLibrarySource(config, overrides);
    return joinLibraryUrl(resolved.base, packPrefix(config, packId, resolved.usingR2), filePath);
}

export function selectIdolModel(idol, files = []) {
    const names = files.map(file => String(file || '').replaceAll('\\', '/'));
    const glbs = names.filter(name => name && !name.includes('/') && name.toLowerCase().endsWith('.glb'));
    const configured = String(idol?.model || '');
    if (!glbs.length) {
        return { name: configured, format: configured.toLowerCase().endsWith('.glb') ? 'glb' : 'pmx' };
    }
    const outfit = String(idol?.outfit || '').toLowerCase().replaceAll('_', '-');
    const id = String(idol?.id || '').toLowerCase();
    const ranked = [...glbs].sort((a, b) => rank(b) - rank(a) || a.length - b.length);
    return { name: ranked[0], format: 'glb' };

    function rank(name) {
        const stem = name.replace(/\.[^.]+$/, '').replace(/-glb-hair-layer$/i, '').toLowerCase();
        let score = 0;
        if (id && (stem === id || stem.startsWith(`${id}-`))) score += 2;
        if (outfit && stem.includes(outfit)) score += 4;
        return score;
    }
}

export function idolAssetUrls(idol, config, textureNames = [], overrides) {
    if (!idol) return null;
    const modelUrl = libraryFileUrl(config, idol.pack, idol.model, overrides);
    const textures = textureNames.map(name => ({
        name,
        url: libraryFileUrl(config, idol.pack, idol.textureDir ? `${idol.textureDir}/${name}` : name, overrides),
    }));
    return { modelUrl, textures };
}

export function lookupMotionFile(index, clipId) {
    if (!clipId || !index) return '';
    return index.get(clipId) || index.get(normalizeActionId(clipId)) || '';
}

export function guessMotionFileName(item, slot) {
    const clipId = item?.[slot];
    if (!clipId) return '';
    const suffix = slot === 'face' ? 'f' : 'b';
    const base = String(item.label || '').replace(/\.vmd$/i, '').replace(/[_-][bf]$/i, '');
    return `${base}_${suffix}.vmd`;
}

export function guessMotionPack(item, slot) {
    const clipId = String(item?.[slot] || item?.label || '');
    if (slot === 'face' || clipId.includes('facial-all') || clipId.includes('facial_all')) return 'motions/cmmn-face';
    if ((clipId.includes('chr-fktn') || clipId.includes('chr_fktn') || clipId.includes('live-chr-fktn')) && !/idle-001-in/.test(clipId)) {
        return 'motions/fktn-body';
    }
    return 'motions/cmmn-body';
}

export function motionAssetUrls(item, config, indexByPack, overrides) {
    const files = [];
    const packs = Object.keys(config?.packs || {}).filter(id => id.startsWith('motions/'));
    const find = (clipId, slot) => {
        if (!clipId) return null;
        for (const packId of packs) {
            const name = lookupMotionFile(indexByPack?.get(packId), clipId);
            if (name) return { packId, name, url: libraryFileUrl(config, packId, name, overrides), id: clipId };
        }
        const name = guessMotionFileName(item, slot);
        const packId = guessMotionPack(item, slot);
        if (!name || !config?.packs?.[packId]) return null;
        return { packId, name, url: libraryFileUrl(config, packId, name, overrides), id: clipId, guessed: true };
    };
    const body = find(item?.body, 'body');
    const face = find(item?.face, 'face');
    if (body) files.push({ ...body, kind: 'body', label: item.label });
    if (face) files.push({ ...face, kind: 'face', label: item.label });
    return files;
}

export function motionAvailability(item, indexByPack) {
    const packs = [...(indexByPack?.keys?.() || [])].filter(id => String(id).startsWith('motions/'));
    if (!packs.length) return { body: true, face: true, ready: true };
    const has = clipId => !!clipId && packs.some(packId => lookupMotionFile(indexByPack.get(packId), clipId));
    const needBody = !!item?.body;
    const needFace = !!item?.face;
    const body = !needBody || has(item.body);
    const face = !needFace || has(item.face);
    return { body, face, ready: body && face };
}

export function sourceLabel(source) {
    return source === 'r2' ? 'Cloudflare R2' : '本地资源';
}

export function bucketFilterOptions(usedIds) {
    const used = usedIds instanceof Set ? usedIds : new Set(usedIds || []);
    return Object.entries(MOTION_BUCKETS)
        .filter(([id]) => used.has(id))
        .map(([id, info]) => ({ id, label: info.label }));
}
