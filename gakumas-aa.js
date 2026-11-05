export const AA_LEVELS = Object.freeze([
    Object.freeze({
        id: 'off',
        label: '关',
        note: '不额外平滑边缘。',
        taa: false,
        fxaa: false,
        renderScale: 1,
        renderPixelBudget: 2500000,
    }),
    Object.freeze({
        id: 'low',
        label: '低',
        note: '单帧平滑边缘，不叠历史帧。',
        taa: false,
        fxaa: true,
        renderScale: 1,
        renderPixelBudget: 2500000,
    }),
    Object.freeze({
        id: 'medium',
        label: '中',
        note: '时间抗锯齿，默认画质。',
        taa: true,
        fxaa: false,
        renderScale: 1.35,
        renderPixelBudget: 2500000,
    }),
    Object.freeze({
        id: 'high',
        label: '高',
        note: '时间抗锯齿，并提高内部绘制分辨率。',
        taa: true,
        fxaa: false,
        renderScale: 1.5,
        renderPixelBudget: 4000000,
    }),
    Object.freeze({
        id: 'ultra',
        label: '极高',
        note: '时间抗锯齿，内部绘制分辨率接近上限。',
        taa: true,
        fxaa: false,
        renderScale: 1.6,
        renderPixelBudget: 6500000,
    }),
]);

const AA_BY_ID = new Map(AA_LEVELS.map(level => [level.id, level]));

export function aaLevel(id) {
    return AA_BY_ID.get(id) || AA_BY_ID.get('medium');
}
