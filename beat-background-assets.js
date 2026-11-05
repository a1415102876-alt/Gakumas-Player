import './beat-background-routing.js?v=20261014-idol-bond-v1';
import { resolveBeatBackground, BEAT_3D_SCENE_RULES } from './beat-background-catalog.js?v=20261029-bg-filename-v1';
import { BEAT_SCENE_ASSETS } from './beat-scene-assets.js?v=20261007-beat-scenes-v1';

const TIMES = ['morning', 'noon', 'evening', 'night'];
const TIME = /-(morning|noon|evening|night|other)$/u;
const clean = value => String(value || '').trim().replace(/\.png$/iu, '');
const expand = value => globalThis.HatsuBeatBackgroundRouting.expandBackground(value);
const shortScene = value => value.replace(/^env_3d_(adv|lesson)_/u, '3d-$1-');

export function isBeatScene(value) {
    return /^(?:env_3d_|3d-)/u.test(clean(expand(value)));
}

function permitted(family, category, context) {
    const rules = globalThis.HatsuBeatBackgroundRouting.contexts[context];
    if (context && !rules) return false;
    if (rules && rules.category !== 'bond') return rules.locations.some(row => row.family === family);
    if (!context && category && category !== 'bond' && family.startsWith('env_3d_')) {
        return BEAT_3D_SCENE_RULES.some(row => row.family === family && row.eventCategory === category);
    }
    return true;
}

export function resolveBeatBackgroundAsset(value, options = {}) {
    const input = clean(expand(value));
    const category = options.category || '';
    const context = options.context || '';
    if (!isBeatScene(input)) {
        const result = resolveBeatBackground(input, {
            backgrounds: options.backgrounds,
            category: context ? '' : category,
        });
        if (result.matched && !permitted(result.family, category, context)) {
            return { ...result, name: '', matched: false, categoryMismatch: true };
        }
        return { ...result, kind: '2d' };
    }
    const time = input.match(TIME)?.[1] || 'noon';
    const familyToken = input.replace(TIME, '');
    const candidates = BEAT_SCENE_ASSETS.filter(asset => [asset.family, shortScene(asset.family)].includes(familyToken));
    if (!candidates.length) return { name: '', family: familyToken, kind: '3d', matched: false };
    if (!permitted(candidates[0].family, category, context)) {
        return { name: '', family: candidates[0].family, kind: '3d', matched: false, categoryMismatch: true };
    }
    const exact = candidates.find(asset => [asset.name, shortScene(asset.name)].includes(input));
    const ranked = candidates.filter(asset => TIMES.includes(asset.time)).sort((a, b) => TIMES.indexOf(a.time) - TIMES.indexOf(b.time));
    const earlier = ranked.filter(asset => TIMES.indexOf(asset.time) <= TIMES.indexOf(time));
    const asset = exact || (time === 'other' ? candidates.find(asset => asset.time === 'other')
        : candidates.find(asset => !asset.time) || earlier.at(-1) || ranked[0]);
    if (!asset) return { name: '', family: candidates[0].family, kind: '3d', matched: false };
    return { ...asset, kind: '3d', matched: true, exact: Boolean(exact) };
}

export function sceneAssetUrl(asset) {
    const registered = BEAT_SCENE_ASSETS.find(row => row.name === (typeof asset === 'string' ? asset : asset?.name));
    return registered ? new URL(registered.path, import.meta.url).href : '';
}
