import { BEAT_BGM_STOP, beatAudioAssetUrl, normalizeBeatAudioVolumes } from './beat-audio.js?v=beat-volume-v1';

export class BeatAudioPlayback {
    constructor({ createAudio = url => new Audio(url), onError = () => {}, volumes } = {}) {
        this.createAudio = createAudio;
        this.onError = onError;
        this.volumes = normalizeBeatAudioVolumes(volumes);
        this.bgm = null;
        this.effects = new Map();
    }

    setVolumes(volumes) {
        this.volumes = normalizeBeatAudioVolumes({ ...this.volumes, ...volumes });
        if (this.bgm) this.bgm.audio.volume = this.volumes.bgm;
        for (const audio of this.effects.values()) audio.volume = this.volumes.sfx;
    }

    apply(beat, { kind } = {}) {
        if (!kind || kind === 'bgm') this.setBgm(beat?.bgm);
        if (!kind || kind === 'sfx') this.setEffects(beat?.sfx, { keepPlaying: kind === 'sfx' });
    }

    setBgm(filename) {
        if (filename === BEAT_BGM_STOP) {
            this.clearBgm();
            return;
        }
        const url = beatAudioAssetUrl('bgm', filename);
        if (!url || this.bgm?.url === url) return;
        this.clearBgm();

        const audio = this.createAudio(url);
        audio.loop = true;
        audio.volume = this.volumes.bgm;
        this.bgm = { url, audio };
        this.start(audio, () => {
            if (this.bgm?.audio !== audio) return false;
            this.clearBgm();
            return true;
        }, `BGM 播放失败：${filename}`);
    }

    setEffects(filenames, { keepPlaying }) {
        const tracks = new Map();
        for (const filename of filenames || []) {
            const url = beatAudioAssetUrl('sfx', filename);
            if (url) tracks.set(url, filename);
        }
        for (const url of this.effects.keys()) {
            if (!keepPlaying || !tracks.has(url)) this.clearEffect(url);
        }
        for (const [url, filename] of tracks) {
            if (this.effects.has(url)) continue;
            const audio = this.createAudio(url);
            audio.volume = this.volumes.sfx;
            this.effects.set(url, audio);
            this.start(audio, () => {
                if (this.effects.get(url) !== audio) return false;
                this.clearEffect(url);
                return true;
            }, `音效播放失败：${filename}`);
        }
    }

    start(audio, clear, errorMessage) {
        const onError = () => {
            if (clear()) this.onError(errorMessage);
        };
        audio.onended = clear;
        audio.onerror = onError;
        try {
            audio.play()?.catch(onError);
        } catch {
            onError();
        }
    }

    release(audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
    }

    clearBgm() {
        const track = this.bgm;
        this.bgm = null;
        if (track) this.release(track.audio);
    }

    clearEffect(url) {
        const audio = this.effects.get(url);
        this.effects.delete(url);
        this.release(audio);
    }

    clearEffects() {
        for (const url of this.effects.keys()) this.clearEffect(url);
    }

    stop() {
        this.clearBgm();
        this.clearEffects();
    }
}
