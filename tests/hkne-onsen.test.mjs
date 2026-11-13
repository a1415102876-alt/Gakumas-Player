import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BEAT_SPEAKER_NAMES } from '../beat-player-core.js';
import { parseBeatScript, buildStageSlides } from '../beat-protocol.js';
import { buildDialogueAssetPlan } from '../dialogue-asset-plan.js';
import { idolCostumeVariant, resolveBeatCostume } from '../beat-costumes.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const library = () => ({
    config: json('../library.json'),
    manifest: json('../resource-manifest.json'),
    map: json('../gakumas-motion-map.json'),
});

test('温泉服只对香名江开放，并接受中英文别名', () => {
    for (const value of ['Onsen', 'onsen', '温泉', '温泉服', 'costume: onsen']) {
        assert.equal(resolveBeatCostume(value, 'hkne'), 'Onsen', value);
    }
    assert.equal(resolveBeatCostume('onsen', 'hume'), '');
    assert.equal(resolveBeatCostume('Solo1', 'hkne'), '');
    assert.equal(resolveBeatCostume('Default', 'hkne'), 'Default');
});

test('香名江温泉服解析为独立模型包', () => {
    const hkne = json('../library.json').idols.find(idol => idol.id === 'hkne');
    const onsen = idolCostumeVariant(hkne, 'onsen');
    assert.equal(onsen.id, 'hkne');
    assert.equal(onsen.pack, 'idols/hkne-onsen');
    assert.equal(onsen.model, 'hkne-head_hume-onsen.glb');
    assert.equal(idolCostumeVariant(hkne, 'Default').model, 'hkne-othr-0004.glb');
});

test('脚本切换温泉服时预加载温泉服模型、贴图和头发二次运动配置', () => {
    const parsed = parseBeatScript('<beat speaker="hkne" costume="温泉"><display lang="zh">泡温泉吧。</display></beat>');
    assert.deepEqual(parsed.errors.filter(error => error.code === 'unknown-costume'), []);
    const { slides } = buildStageSlides(parsed.beats, BEAT_SPEAKER_NAMES);
    const plan = buildDialogueAssetPlan({ beats: parsed.beats, slides }, { cast: ['hkne'], costumesById: { hkne: ['Onsen'] } }, library());
    assert.ok(plan.keys.includes('idols/hkne-onsen/hkne-head_hume-onsen.glb'));
    // Color maps are embedded in the GLB; the pack supplies the shading maps.
    assert.ok(plan.keys.includes('idols/hkne-onsen/Texture2D/t_chr_hume-othr-0000_bdy_sdw.png'));
    assert.ok(plan.keys.includes('idols/hkne-onsen/Texture2D/t_chr_hkne-base-0000_hir_sdw.png'));
    assert.ok(plan.keys.includes('secondary-motion-profiles/hkne-onsen.json'));
    assert.ok(!plan.keys.includes('idols/hkne-othr-0004/hkne-othr-0004.glb'));
});

test('温泉服二次运动配置只保留头发，并与清单哈希一致', () => {
    const manifest = json('../resource-manifest.json');
    const bytes = readFileSync(new URL('../secondary-motion-profiles/hkne-onsen.json', import.meta.url));
    const entry = manifest.assets['secondary-motion-profiles/hkne-onsen.json'];
    assert.equal(entry.size, bytes.length);
    assert.equal(entry.hash, createHash('sha256').update(bytes).digest('hex'));
    const profile = JSON.parse(bytes.toString('utf8'));
    assert.ok(profile.springs.length > 0);
    assert.ok(profile.springs.every(spring => spring.part === 'hair'));
    assert.ok(profile.drivers.every(driver => driver.className === 'ActorAnimationQuartzDriverHairBone'));
    assert.deepEqual(profile.chains, []);
    const status = manifest.status.packs['idols/hkne-onsen'];
    assert.ok(status.available);
    for (const file of status.files) assert.ok(manifest.assets[`idols/hkne-onsen/${file}`], file);
});
