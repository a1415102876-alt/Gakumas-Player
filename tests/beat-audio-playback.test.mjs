import assert from 'node:assert/strict';
import test from 'node:test';
import { BeatAudioPlayback } from '../beat-audio-playback.js';
import { readBeatAudioVolumes, writeBeatAudioVolumes } from '../beat-audio.js';
import { parseBeatScript } from '../beat-protocol.js';

function mockPlayback() {
    const tracks = [];
    const errors = [];
    const playback = new BeatAudioPlayback({
        createAudio(src) {
            const track = {
                src,
                loop: false,
                paused: true,
                playCount: 0,
                play() {
                    this.playCount += 1;
                    this.paused = false;
                    return new Promise((resolve, reject) => { this.rejectPlay = reject; });
                },
                pause() { this.paused = true; },
                removeAttribute(name) { delete this[name]; },
                load() {},
            };
            tracks.push(track);
            return track;
        },
        onError: message => errors.push(message),
    });
    return { playback, tracks, errors };
}

test('beats play one looping BGM and all configured one-shot effects together', () => {
    const { playback, tracks } = mockPlayback();
    playback.apply({ bgm: 'theme.mp3', sfx: ['door.wav', 'steps.wav'] });
    assert.equal(tracks.length, 3);
    const [theme, door, steps] = tracks;
    assert.ok(theme.loop);
    assert.ok(!door.loop && !steps.loop);
    assert.deepEqual(tracks.map(track => track.volume), [0.7, 1, 1]);
    assert.ok(tracks.every(track => track.playCount === 1 && !track.paused));

    playback.apply({ bgm: 'theme.mp3', sfx: ['door.wav'] });
    const repeatedDoor = tracks.at(-1);
    assert.equal(theme.playCount, 1);
    assert.ok(!theme.paused && door.paused && steps.paused && !repeatedDoor.paused);

    playback.apply({ bgm: 'next.mp3' });
    const next = tracks.at(-1);
    assert.ok(theme.paused && repeatedDoor.paused && !next.paused);

    playback.apply({});
    assert.ok(!next.paused);
    assert.equal(next.playCount, 1);
    playback.apply({ bgm: 'None' });
    assert.ok(next.paused);
    assert.ok(tracks.every(track => !track.src));
});

test('volume changes are independent and apply to active and future audio without restarting it', () => {
    const { playback, tracks } = mockPlayback();
    playback.apply({ bgm: 'theme.mp3', sfx: ['door.wav', 'steps.wav'] });
    playback.setVolumes({ bgm: 0 });
    assert.deepEqual(tracks.map(track => track.volume), [0, 1, 1]);
    playback.setVolumes({ sfx: 0.25 });
    assert.deepEqual(tracks.map(track => track.volume), [0, 0.25, 0.25]);
    assert.ok(tracks.every(track => track.playCount === 1 && !track.paused));

    playback.apply({ bgm: 'next.mp3', sfx: ['rain.wav'] });
    assert.deepEqual(tracks.slice(3).map(track => track.volume), [0, 0.25]);
});

test('saved volume restores muted channels and validates stored values', () => {
    let stored = 'invalid JSON';
    const storage = {
        getItem: () => stored,
        setItem: (_, value) => { stored = value; },
    };
    assert.deepEqual(readBeatAudioVolumes(storage), { bgm: 0.7, sfx: 1 });
    writeBeatAudioVolumes({ bgm: 0, sfx: 0.35 }, storage);
    assert.deepEqual(readBeatAudioVolumes(storage), { bgm: 0, sfx: 0.35 });
    writeBeatAudioVolumes({ bgm: 2, sfx: -1 }, storage);
    assert.deepEqual(readBeatAudioVolumes(storage), { bgm: 1, sfx: 0 });
});

test('editing one audio field preserves the other and keeps selected effects playing', () => {
    const { playback, tracks } = mockPlayback();
    playback.apply({ bgm: 'theme.mp3', sfx: ['door.wav', 'steps.wav'] });
    const [theme, door, steps] = tracks;

    playback.apply({ sfx: ['door.wav', 'rain.wav'] }, { kind: 'sfx' });
    assert.equal(tracks.length, 4);
    const rain = tracks.at(-1);
    assert.ok(!theme.paused && !door.paused && steps.paused && !rain.paused);

    playback.apply({ bgm: '' }, { kind: 'bgm' });
    assert.ok(!theme.paused && !door.paused && !rain.paused);
    playback.apply({ bgm: 'None' }, { kind: 'bgm' });
    assert.ok(theme.paused && !door.paused && !rain.paused);

    rain.onended();
    assert.ok(rain.paused && !rain.src);
    playback.stop();
    assert.ok(tracks.every(track => track.paused && !track.src));
});

test('default script Beats leave the current BGM state alone before and after a stop', () => {
    const { playback, tracks } = mockPlayback();
    const { beats, errors } = parseBeatScript([
        '<beat speaker="producer">先安静一下。</beat>',
        '<beat speaker="producer" bgm="theme.mp3">你来了。</beat>',
        '<beat speaker="producer">请坐。</beat>',
        '<beat speaker="producer" bgm="None">先把音乐停一下。</beat>',
        '<beat speaker="producer">我们开始吧。</beat>',
    ].join('\n'));
    assert.deepEqual(errors, []);

    playback.apply(beats[0]);
    assert.equal(tracks.length, 0);
    playback.apply(beats[1]);
    playback.apply(beats[2]);
    assert.equal(tracks.length, 1);
    assert.ok(!tracks[0].paused);
    playback.apply(beats[3]);
    playback.apply(beats[4]);
    assert.equal(tracks.length, 1);
    assert.ok(tracks[0].paused);
});

test('failed tracks can be retried and stale media rejections cannot stop replacements', async () => {
    const { playback, tracks, errors } = mockPlayback();
    playback.apply({ bgm: 'theme.mp3', sfx: ['door.wav'] });
    const [theme, door] = tracks;
    playback.apply({ bgm: 'next.mp3', sfx: ['door.wav'] });
    const [, , next, nextDoor] = tracks;
    theme.rejectPlay(new Error('aborted'));
    door.rejectPlay(new Error('aborted'));
    await Promise.resolve();
    assert.deepEqual(errors, []);
    assert.ok(!next.paused && !nextDoor.paused);

    next.rejectPlay(new Error('not supported'));
    await Promise.resolve();
    assert.equal(errors.length, 1);
    assert.ok(next.paused && !nextDoor.paused);

    playback.apply({ bgm: 'next.mp3' }, { kind: 'bgm' });
    assert.equal(tracks.length, 5);
    assert.ok(!tracks.at(-1).paused);
    playback.stop();
});
