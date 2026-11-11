import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beatActorId, BEAT_SPEAKER_NAMES } from '../beat-player-core.js';
import { parseBeatScript, buildStageSlides } from '../beat-protocol.js';
import { buildDialogueAssetPlan } from '../dialogue-asset-plan.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('香名江及旧姓名作为 3D 角色进场，不使用 NPC 立绘', () => {
    for (const speaker of ['hkne', '冰渡香名江', '氷渡香名江', '香名江']) {
        assert.equal(beatActorId(speaker), 'hkne');
        const parsed = parseBeatScript(`<beat speaker="${speaker}"><display lang="zh">你好。</display></beat>`);
        assert.equal(parsed.beats.length, 1);
        assert.equal(parsed.beats[0].portrait, undefined);
        const { slides } = buildStageSlides(parsed.beats, BEAT_SPEAKER_NAMES);
        assert.ok(slides.some(slide => slide.action === 'enter' && slide.idolId === 'hkne'));
    }
});

test('香名江预加载模型、贴图和指定二次运动配置', () => {
    const library = {
        config: json('../library.json'),
        manifest: json('../resource-manifest.json'),
        map: json('../gakumas-motion-map.json'),
    };
    const parsed = parseBeatScript('<beat speaker="hkne"><display lang="zh">你好。</display></beat>');
    const { slides } = buildStageSlides(parsed.beats, BEAT_SPEAKER_NAMES);
    const plan = buildDialogueAssetPlan({ beats: parsed.beats, slides }, { cast: ['hkne'] }, library);
    assert.ok(plan.keys.includes('idols/hkne-othr-0004/hkne-othr-0004.glb'));
    assert.ok(plan.keys.some(key => key.startsWith('idols/hkne-othr-0004/Texture2D/')));
    assert.ok(plan.keys.includes('secondary-motion-profiles/hkne-othr-0004.json'));
    assert.ok(!plan.keys.some(key => key.startsWith('npc-portraits/') && key.includes('香名江')));
});
