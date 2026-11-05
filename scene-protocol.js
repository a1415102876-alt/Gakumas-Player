import { STAR_EYE_IDOLS } from './star-eye-resources.js?v=20261006-star-eyes-v1';

export const SCENE_IDOLS = Object.freeze({
    藤田琴音: 'fktn', 花海咲季: 'hski', 花海佑芽: 'hume', 姬崎莉波: 'hrnm',
    紫云清夏: 'ssmk', 葛城莉莉娅: 'kllj', 十王星南: 'jsna', 秦谷美铃: 'hmsz',
    雨夜燕: 'atbm', 有村麻央: 'amao', 月村手毬: 'ttmr', 仓本千奈: 'kcna', 筱泽广: 'shro',
    贺阳燐羽: 'krnh', 亚纱里老师: 'nasr',
});

// Re-export the generated resource list so Beat and scene consumers share the
// same current cache-derived source of truth.
export { STAR_EYE_IDOLS };

export function sceneIdolId(name) {
    return SCENE_IDOLS[String(name || '').replace(/[（(].*$/u, '').trim()] || '';
}

export function detectSceneCast(text) {
    const source = String(text || '');
    return Object.entries(SCENE_IDOLS)
        .filter(([name]) => source.includes(name))
        .map(([, idolId]) => idolId);
}

export function parseStageTag(value) {
    const match = /^<(stage-preload|stage-enter|stage-exit|stage-look|stage-action)\b([^<>]*)\/>$/iu.exec(String(value || '').trim());
    if (!match) return null;
    const attributes = {};
    for (const entry of match[2].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attributes[entry[1]] = entry[2];
    const tag = match[1].toLowerCase();
    if (tag === 'stage-preload') {
        const cast = [...new Set(String(attributes.idols || '').split(/[,，、]/u).map(sceneIdolId).filter(Boolean))];
        return { type: 'stage', action: 'preload', cast, speaker: '', text: '' };
    }
    const idolId = sceneIdolId(attributes.idol);
    if (!idolId) return { type: 'stage', action: 'ignore', speaker: '', text: '' };
    if (tag === 'stage-look') {
        const targetId = sceneIdolId(attributes.target);
        const rawTarget = String(attributes.target || '').toLowerCase();
        const target = targetId || ['camera', 'none', 'auto'].includes(rawTarget) ? targetId || rawTarget : 'camera';
        return { type: 'stage', action: 'look', idolId, target, duration: Math.max(0, Number(attributes.duration) || 0), speaker: '', text: '' };
    }
    if (tag === 'stage-action') return { type: 'stage', action: 'action', idolId, cue: String(attributes.cue || '').trim(), speaker: '', text: '' };
    return { type: 'stage', action: tag === 'stage-enter' ? 'enter' : 'exit', idolId,
        position: ['left', 'center', 'right'].includes(attributes.position) ? attributes.position : 'center', speaker: '', text: '' };
}

export function splitStageStory(text) {
    return String(text || '').split(/(<stage-(?:preload|enter|exit|look|action)\b[^<>]*\/?>)/giu)
        .filter(Boolean).map(part => /^<stage-/i.test(part) ? parseStageTag(part) || { type: 'stage', action: 'ignore', text: '', speaker: '' } : part);
}

export function stageSnapshot(slides, index) {
    const cast = new Set();
    const actors = {};
    const source = slides.map(slide => [slide.speaker, slide.text].filter(Boolean).join('\n')).join('\n');
    for (const idolId of detectSceneCast(source)) cast.add(idolId);
    for (const slide of slides) {
        if (slide.type === 'stage' && ['enter', 'exit'].includes(slide.action)
            && Object.values(SCENE_IDOLS).includes(slide.idolId)) cast.add(slide.idolId);
    }
    for (const slide of slides) if (slide.type === 'stage' && slide.action === 'preload') {
        for (const idolId of slide.cast || []) cast.add(idolId);
    }
    for (const slide of slides.slice(0, index + 1)) {
        if (slide.type !== 'stage' || !cast.has(slide.idolId)) continue;
        if (slide.action === 'enter') actors[slide.idolId] = { position: slide.position || 'center' };
        if (slide.action === 'exit') delete actors[slide.idolId];
        if (slide.action === 'position' && actors[slide.idolId]) actors[slide.idolId].position = slide.position || actors[slide.idolId].position;
        if (slide.action === 'look' && actors[slide.idolId]) { actors[slide.idolId].look = slide.target || 'camera'; actors[slide.idolId].duration = slide.duration || 0; }
        if (slide.action === 'action' && actors[slide.idolId]) actors[slide.idolId].action = slide.cue;
    }
    return { cast: [...cast], actors };
}

export function buildStageRules() {
    return [
        '<scene_stage_rules>',
        '3D演出与动作词分开控制。前端自动扫描本段剧情文本、说话人和进退场标签中的偶像全名，预加载对应模型，不需要输出stage-preload或演员名单。',
        '预加载不等于进场，所有角色初始隐藏。仅被提及、远程通话或画外音角色也可被预加载，但不应因此安排其进入镜头。',
        '按剧情时机输出 <stage-enter idol="藤田琴音" position="center"/> 或 <stage-exit idol="藤田琴音"/>，进场与退场分别播放对应动画。position仅可为left、center、right。',
        '多人对话可用 <stage-look idol="藤田琴音" target="秦谷美铃"/>、target="camera" 或 target="none" 控制注意方向；可用 <stage-action idol="藤田琴音" cue="点头"/> 让在场但未发言的角色做一次明确回应。只在注意对象或动作真正变化时输出，不要每句重复。',
        '进退场标签使用下列偶像全名。角色只有在剧情明确描写其进入、出现或开始参与当前镜头时才输出进场标签，进场标签放在实际出现的剧情描述之后、第一次说话或执行动作之前。若角色在场景设定中已经存在但文本没有描写其进入，可以在该角色第一次说话或执行动作之前补充一次进场；不要在整段剧情开头统一输出所有角色的进场标签。退场标签放在角色实际离开之后，不要每句重复。',
        '两名偶像互相对话时，默认让说话者看向听话者、听话者保持注视说话者；面向制作人、演讲或直播时使用camera。三人以上以当前交流对象优先，无法判断时使用camera。旁白、换说话人、暂时沉默不等于退场；提及姓名、说话标签也不会自动召唤模型。结尾只有剧情确实离场才输出退场。不要为展示动画虚构进退场。',
        '新场景按剧情安排进场，无需声明名单。控制标签不属于台词、旁白或选项，不解释标签。可用偶像：' + Object.keys(SCENE_IDOLS).join('、') + '。',
        'VN中标签独立成行，位于<dialogue>和<narration>之外。NIA直播中使用单独的action beat，speaker留空，text只填一个舞台控制标签；其余beats照常写台词，无需预加载beat。',
        '</scene_stage_rules>',
    ].join('\n');
}
