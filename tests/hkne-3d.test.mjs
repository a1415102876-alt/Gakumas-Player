import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexMotionFiles } from '../core.js';
import { beatActorId, BEAT_SPEAKER_NAMES } from '../beat-player-core.js';
import { parseBeatScript, buildStageSlides } from '../beat-protocol.js';
import { buildDialogueAssetPlan, resourceCatalog } from '../dialogue-asset-plan.js';
import { motionAssetUrls, motionAvailability } from '../library-client.js';
import { beatStageHint, buildChatPrompt } from '../beat-chat.js';
import { buildIdol3dRules } from '../portrait-cues.js';
import { buildStageRules } from '../scene-protocol.js';

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

test('自定义背景只使用浏览器本地仓库，不生成资源清单键', () => {
    const library = {
        config: json('../library.json'),
        manifest: json('../resource-manifest.json'),
        map: json('../gakumas-motion-map.json'),
    };
    const parsed = parseBeatScript('<beat speaker="hkne" background="custom1"><display lang="zh">你好。</display></beat>', {
        customBackgrounds: ['custom1'],
    });
    assert.deepEqual(parsed.errors, []);
    const { slides } = buildStageSlides(parsed.beats, BEAT_SPEAKER_NAMES);
    const plan = buildDialogueAssetPlan({ beats: parsed.beats, slides }, { cast: ['hkne'] }, library);
    assert.ok(!plan.keys.includes('backgrounds_2d/custom1'));
});

test('香名江专属动作和表情均在编辑器及资源索引中可用', () => {
    const library = {
        config: json('../library.json'),
        manifest: json('../resource-manifest.json'),
        map: json('../gakumas-motion-map.json'),
    };
    const catalog = resourceCatalog(library.map).filter(item => item.character === 'hkne');
    assert.equal(catalog.length, 9);
    assert.equal(catalog.filter(item => item.pairing === 'paired').length, 3);
    assert.equal(catalog.filter(item => item.pairing === 'faceOnly').length, 6);

    const index = new Map(Object.entries(library.manifest.status.packs)
        .map(([id, pack]) => [id, indexMotionFiles(pack.files)]));
    let fileCount = 0;
    for (const item of catalog) {
        assert.equal(motionAvailability(item, index).ready, true, item.label);
        const files = motionAssetUrls(item, library.config, index);
        assert.ok(files.length > 0, item.label);
        for (const file of files) {
            const key = `${library.config.packs[file.packId].r2Prefix}/${file.name}`;
            assert.ok(library.manifest.assets[key], key);
            fileCount++;
        }
    }
    assert.equal(fileCount, 12);
});

test('制作人视线目标在提示词和脚本解析中统一指向镜头', () => {
    const constraint = /(?:偶像)?对制作人.*必须(?:用 camera|写 look="camera"|看向camera)/;
    assert.match(beatStageHint(), constraint);
    assert.match(buildChatPrompt({ idolName: '冰渡香名江', userText: '你好' }), constraint);
    assert.match(buildChatPrompt({ idolName: '冰渡香名江', userText: '你好', staging: true }), constraint);
    assert.match(buildChatPrompt({ idolName: '冰渡香名江', userText: '你好', company: true, staging: true }), constraint);
    assert.match(buildIdol3dRules('冰渡香名江'), /对制作人说话时必须看向camera/);
    assert.match(buildStageRules(), /偶像对制作人说话或面向制作人交流时必须看向camera/);
    for (const target of ['producer', '制作人']) {
        const parsed = parseBeatScript(`<beat speaker="hkne" cue="talk" look="${target}"><display lang="zh">你好。</display></beat>`);
        assert.equal(parsed.beats[0].look, 'camera');
        const slides = buildStageSlides(parsed.beats, BEAT_SPEAKER_NAMES).slides;
        assert.ok(slides.some(slide => slide.action === 'look' && slide.target === 'camera'));
    }
});
