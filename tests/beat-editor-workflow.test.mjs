import test from 'node:test';
import assert from 'node:assert/strict';
import { ActorView } from '../actor-view.js';
import { beatBackgroundLabel } from '../beat-background-labels.js';
import { BEAT_BACKGROUND_NAMES } from '../beat-backgrounds.js';
import { parseBeatEditorSource, serializeBeatEditorScript, updateBeat } from '../beat-editor-model.js';
import { BEAT_SPEAKER_NAMES } from '../beat-player-core.js';
import { buildStageSlides, parseBeatScript, resolveBeatCue } from '../beat-protocol.js';
import { compactGeneratedBeatStaging, extractClosedBeatScript, prepareDirectBeatScript } from '../sandbox/sandbox-weird-script.js';
import { SceneDirector } from '../scene-director.js';

const line = attrs => `<beat speaker="krnh" ${attrs}><display lang="zh">开始吧。</display></beat>`;
const sceneOptions = { backgrounds: BEAT_BACKGROUND_NAMES, customBackgrounds: ['custom1'] };
const stageSettings = source => parseBeatScript(source, sceneOptions).beats.map(({ background, shot, camera }) => ({ background, shot, camera }));

test('generated scripts compact equal backgrounds and shots without changing framing', () => {
    const original = [
        line('background="宿舍走廊-午" shot="近景"'),
        line('background="env_2d_adv_dormitory-corridor-00-noon.png" shot="close"'),
        line('shot="close" camera="wide"'),
        line('camera="medium"'),
        line('shot="keep"'),
        line('shot="close" background="宿舍走廊-夜"'),
        line('shot="close" background="none"'),
    ].join('\n');
    const compacted = compactGeneratedBeatStaging(original);
    const tags = compacted.split('\n');
    assert.doesNotMatch(tags[1], /\s(?:background|shot)=/u);
    assert.match(tags[2], /shot="close" camera="wide"/u);
    assert.match(tags[3], /camera="medium"/u);
    assert.match(tags[4], /shot="keep"/u);
    assert.match(tags[5], /shot="close" background="宿舍走廊-夜"/u);
    assert.doesNotMatch(tags[6], /\s(?:background|shot)=/u);
    assert.deepEqual(stageSettings(compacted), stageSettings(original));
    assert.equal(compactGeneratedBeatStaging(compacted), compacted);
    assert.equal(prepareDirectBeatScript(original).script, original);
});

test('continued and truncated replies use the last completed background and shot', () => {
    const earlier = [line('background="custom1" shot="wide"'), line('camera="reaction"')].join('\n');
    const existing = extractClosedBeatScript(earlier);
    const reply = extractClosedBeatScript([line('background="custom1" shot="wide"'), line('shot="medium"'), '<beat shot="close">'].join('\n'));
    assert.equal(reply.hasOpenBeat, true);
    assert.equal(reply.tail, '<beat shot="close">');
    assert.equal(existing.lastBackground, 'custom1');
    assert.equal(existing.lastShot, 'wide');
    const compacted = compactGeneratedBeatStaging(reply.script, existing);
    assert.doesNotMatch(compacted.split('\n')[0], /\s(?:background|shot)=/u);
    assert.match(compacted.split('\n')[1], /shot="medium"/u);
    assert.deepEqual(stageSettings([earlier, compacted].join('\n')), stageSettings([earlier, reply.script].join('\n')));
    assert.equal(extractClosedBeatScript([earlier, line('shot="keep"')].join('\n')).lastShot, 'keep');
});

test('the editor preserves inherited backgrounds when another field is edited', () => {
    const { beats } = parseBeatScript([line('background="custom1"'), line('background="none"'), line('')].join('\n'), sceneOptions);
    assert.deepEqual(beats.map(beat => [beat.background, beat.backgroundExplicit]), [
        ['custom1', true], ['custom1', false], ['custom1', false],
    ]);
    const document = parseBeatEditorSource([line('background="custom1"'), line('background="none"'), line('')].join('\n'));
    assert.deepEqual(document.beats.map(beat => beat.background), ['custom1', '', '']);
    const saved = serializeBeatEditorScript(updateBeat(document, 1, { text: '新台词' }));
    assert.doesNotMatch(saved.split('\n')[1], /\sbackground=/u);
    assert.equal(parseBeatScript(saved, sceneOptions).beats[1].background, 'custom1');
    assert.match(beatBackgroundLabel('env_2d_adv_dormitory-corridor-00-noon.png'), /宿舍走廊.*白天/u);
});

test('holding a character cue preserves dialogue and restores its own cue on seek', async () => {
    const { beats, errors } = parseBeatScript([
        line('cue="talk" face="sad"'),
        '<beat speaker="mao" cue="happy">我在听。</beat>',
        line('cue="保持不变" face="happy" overlay="yes-additive"'),
        line('cue="happy"'),
        line('cue="keep"'),
    ].join('\n'));
    assert.deepEqual(errors, []);
    assert.equal(beats[2].cue, 'keep');
    assert.equal(beats[2].text, '开始吧。');
    assert.equal(beats[2].face, undefined);
    assert.equal(beats[2].overlay, undefined);
    const { slides, beatIndexes } = buildStageSlides(beats, BEAT_SPEAKER_NAMES);
    const talk = `贺阳燐羽(${resolveBeatCue('talk', 'sad')})`;
    const happy = `贺阳燐羽(${resolveBeatCue('happy')})`;
    assert.equal(slides[beatIndexes[2]].heldBeatCue, talk);
    assert.equal(slides[beatIndexes[4]].heldBeatCue, happy);
    const director = new SceneDirector(null);
    director.preload = async () => true;
    const played = [];
    for (const id of ['krnh', 'amao']) {
        const view = Object.assign(new ActorView({ idolId: id }), { visible: true });
        director.entries.set(id, {
            ready: Promise.resolve(true), present: true, view,
            player: { playSpeakerCue: async cue => { played.push(cue); return true; } },
        });
    }
    await director.sync(slides, beatIndexes[2], { deferPresentation: true });
    await director.sync(slides, beatIndexes[2], { deferPresentation: true });
    await director.sync(slides, beatIndexes[4], { deferPresentation: true });
    await director.sync(slides, beatIndexes[2], { deferPresentation: true });
    assert.deepEqual(played, [talk, happy, talk]);
});
