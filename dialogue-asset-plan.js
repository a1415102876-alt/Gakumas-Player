import { findIdlePlaylistIndex, indexMotionFiles, isIdleMotion } from './core.js';
import { motionAssetUrls, motionAvailability } from './library-client.js';
import { idolCostumeVariant } from './beat-costumes.js';
import { parsePortraitCue, selectPortraitPerformance } from './portrait-cues.js?v=20261103-paired-face-v1';
import { SCENE_IDOLS } from './scene-protocol.js';
import { textureDescriptor, GAKUMAS_ACTIVE_TEXTURE_KINDS } from './gakumas-materials.js';
import { isBeatScene, resolveBeatBackgroundAsset } from './beat-background-assets.js';
import { STAR_EYE_RESOURCES } from './star-eye-resources.js';
import { propAssetKeysForIdol } from './stage-props.js';
import { normalizeCustomBackgroundId } from './custom-background.js';

export function resourceCatalog(map) {
    return (map?.buckets || []).flatMap(bucket => (bucket.families || []).flatMap(family => (family.items || []).map(item => ({
        ...item, key: item.stem, catalog: { bucket: bucket.id, family: family.id, pairing: item.pairing,
            character: item.character, phase: item.phase, additive: item.additive },
    }))));
}

export function buildAuditionAssetPlan(command, library) {
    const plan = buildDialogueAssetPlan({ beats: [], slides: [] }, { cast: [command.actorId], cuesById: {}, costumesById: {} }, library);
    const { config, map, manifest } = library;
    const index = new Map(Object.entries(manifest.status.packs).map(([id, pack]) => [id, indexMotionFiles(pack.files)]));
    const catalog = resourceCatalog(map);
    const success = catalog.find(item => item.stem === `mot-aud-chr-cmmn-cmmn-result-success-${command.variant}-001-in`);
    if (!success) throw new Error('试镜成功动作未配置');
    // Stage uses its catalogIdleItem preference before the success pair.
    const idles = catalog.filter(isIdleMotion);
    const stageIdle = idles.find(item => item.character === command.actorId) || idles.find(item => item.phase === 'lp') || idles[0];
    for (const item of [success, stageIdle].filter(Boolean)) for (const file of motionAssetUrls(item, config, index)) {
        if (file.guessed) throw new Error('试镜动作文件缺失');
        plan.keys.push(`${config.packs[file.packId].r2Prefix || file.packId}/${file.name}`);
    }
    const scene = config.scenes.find(row => row.id === command.sceneId);
    if (!scene) throw new Error('试镜场景未配置');
    plan.keys.push(`${config.packs[scene.pack].r2Prefix}/${scene.path}`, `camera-tracks/audition-success-${command.variant}.json`);
    return plan;
}

// Plan against the final compiled slides, including business-specific stage
// entries. Choices are pinned here and reused by playback instead of re-rolling.
export function buildDialogueAssetPlan(compiled, preload, library, { random, preloadFamiliesById = {} } = {}) {
    // Reopening the same generated segment reuses the same selection. Different
    // dialogue text still samples the existing weighted animation rules.
    let seed = 2166136261;
    for (const char of JSON.stringify(compiled.beats || [])) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
    random ||= () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const { config, manifest, map } = library, keys = new Set(), performances = new Map(), fallbacks = [];
    const index = new Map(Object.entries(manifest.status.packs).map(([id, pack]) => [id, indexMotionFiles(pack.files)]));
    const cast = new Set(preload.cast), cuesById = structuredClone(preload.cuesById || {}), costumesById = structuredClone(preload.costumesById || {});
    const names = Object.fromEntries(Object.entries(SCENE_IDOLS).map(([name, id]) => [id, name]));
    const add = key => { if (!manifest.assets[key]) throw new Error(`本段资源不在清单中：${key}`); keys.add(key); };
    for (const slide of compiled.slides || []) {
        const id = slide.idolId;
        if (!id) continue;
        cast.add(id);
        if (slide.action && !['enter', 'exit'].includes(slide.action)) {
            (cuesById[id] ||= []).push(`${names[id]}(${slide.action})`);
        }
    }
    const catalog = resourceCatalog(map);
    const motions = item => {
        const files = motionAssetUrls(item, config, index);
        if (!files.length || files.some(file => file.guessed)) throw new Error(`动作文件缺失：${item?.label || item?.stem}`);
        files.forEach(file => add(`${config.packs[file.packId].r2Prefix || file.packId}/${file.name}`));
    };
    for (const id of cast) {
        costumesById[id] ||= ['Default'];
        for (const costume of costumesById[id]) {
            const idol = idolCostumeVariant(config.idols.find(row => row.id === id), costume);
            if (!idol) throw new Error(`角色服装未配置：${id}/${costume}`);
            const prefix = config.packs[idol.pack].r2Prefix || idol.pack;
            add(`${prefix}/${idol.model}`);
            propAssetKeysForIdol(id).forEach(add);
            for (const file of manifest.status.packs[idol.pack].files) {
                if (/\.(png|jpe?g|webp)$/i.test(file) && GAKUMAS_ACTIVE_TEXTURE_KINDS.includes(textureDescriptor(file).kind)) add(`${prefix}/${file}`);
            }
            const profileKey = idol.secondaryMotionProfile || idol.model.replace(/\.glb$/i, '').replace(/-glb-hair-layer$/i, '');
            const profile = manifest.profiles.find(row => row.modelKey === profileKey || row.aliases?.includes(profileKey));
            add(profile?.profile || `secondary-motion-profiles/${id}.json`);
        }
        add('secondary-motion-manifest.json');
        const ready = catalog.filter(item => motionAvailability(item, index).ready);
        const eligible = ready.filter(item => ['cmmn', id].includes(item.character));
        const idleIndex = findIdlePlaylistIndex(eligible, id);
        let idle = idleIndex >= 0 ? eligible[idleIndex] : null;
        // Idols without a standing idle, such as krnh, keep the dialogue pose
        // instead of failing preparation or dropping into the bind pose.
        const idleUsesDialogue = !idle;
        if (!idle) idle = selectPortraitPerformance({ mode: 'mixed', gesture: 'talk', face: 'neutral', bodySelector: 'neutral' }, eligible, id, { random });
        if (!idle) throw new Error(`缺少角色待机动作：${id}`);
        motions(idle);
        for (const family of (preloadFamiliesById?.[id] || [])) {
            const familyId = String(family || '').trim();
            if (!familyId) continue;
            const familyItems = eligible.filter(item => String(item.catalog?.family || item.family || '') === familyId);
            if (!familyItems.length) throw new Error(`缺少角色预加载动作族：${id}/${familyId}`);
            familyItems.forEach(motions);
        }
        eligible.filter(item => (item.additive || item.catalog?.additive) && item.catalog?.family === 'idle-preview' && /idle-\d+-add-lp/i.test(item.stem || '') && item.body).forEach(motions);
        const selected = new Map(); performances.set(id, selected);
        for (const speaker of [...new Set([...(cuesById[id] || []), `${names[id]}(待机)`])]) {
            let cue = parsePortraitCue(speaker, 'dialogue', id);
            if (!cue || cue.mode === 'keep') cue = parsePortraitCue(`${names[id]}(待机)`, 'dialogue', id);
            // An explicit filename may belong to another idol. Named cues stay on this idol plus shared motions.
            const pool = cue?.mode === 'file' || cue?.faceFile ? ready : eligible;
            let item = selectPortraitPerformance(cue, pool, id, { random }) || (id === 'nasr' ? idle : null);
            // The global cue vocabulary includes character-exclusive actions.
            // Pin a real idle for an unavailable cue, so preparation and playback
            // agree instead of retrying the same impossible selection forever.
            if (!item && cue.mode !== 'additive') {
                item = selectPortraitPerformance(parsePortraitCue(`${names[id]}(待机)`, 'dialogue', id), eligible, id, { random });
                if (item) fallbacks.push({ idolId: id, speaker, requested: cue.gesture, used: 'idle' });
            }
            if (!item && idleUsesDialogue && cue.mode !== 'additive') {
                item = idle;
                fallbacks.push({ idolId: id, speaker, requested: cue.gesture, used: 'talk' });
            }
            if (!item) throw new Error(`无法为角色选择动作：${speaker}`);
            selected.set(speaker, item); motions(item);
        }
    }
    for (const beat of compiled.beats || []) {
        if (beat.portrait?.src) {
            const path = decodeURIComponent(new URL(beat.portrait.src).pathname);
            add(path.slice(path.indexOf('npc-portraits/')));
        }
        if (beat.background) {
            // Custom backgrounds live in the browser-local IndexedDB
            // repository. They must never be turned into a manifest key such
            // as `backgrounds_2d/custom1`; the player resolves them from its
            // local image map after the normal resource plan is prepared.
            if (!normalizeCustomBackgroundId(beat.background)) {
                if (isBeatScene(beat.background)) {
                    const scene = resolveBeatBackgroundAsset(beat.background);
                    if (!scene.matched) throw new Error(`场景未配置：${beat.background}`);
                    add(scene.path.replace(/^\.\//, ''));
                } else {
                    const background = resolveBeatBackgroundAsset(beat.background);
                    add(`backgrounds_2d/${background.matched ? background.name : beat.background}`);
                }
            }
        }
        const effects = new Set(beat.effects || []);
        if (effects.size) for (const id of cast) {
            if (effects.has('star-eyes')) {
                const stars = STAR_EYE_RESOURCES[id];
                if (stars) ['col', 'shade', 'def'].forEach(kind => add('assets/facial-effects/' + stars[kind]));
            }
            const effectPrefixes = [];
            if (effects.has('black-lines')) effectPrefixes.push('jsna-head-gaan/');
            if (effects.has('futougou') || effects.has('unequal-eyes')) effectPrefixes.push('kcna-eye-futougou-');
            if (effects.has('tears')) effectPrefixes.push('fktn-eye-tear', 'kcna-eye-tear');
            for (const key of Object.keys(manifest.assets)) if (/\.(obj|png)$/i.test(key)
                && effectPrefixes.some(prefix => key.startsWith('assets/facial-effects/' + prefix))) add(key);
        }
    }
    return { keys: [...keys], cast: [...cast], cuesById, costumesById, performances, fallbacks };
}
