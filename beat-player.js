import { createSceneDirector } from './live-portrait.js?v=20261108-resource-monitor-v1';
import { performanceRecommendations } from './performance-monitor-core.js?v=20261030-perf-diagnostic-v2';
import { sceneIdolId } from './scene-protocol.js?v=20261102-krnh-3d-v1';
import { buildStageSlides, cameraWalkOffset, parseBeatScript, resolveActorPoses, resolveBeatCue } from './beat-protocol.js?v=20261104-clock-transition-v1';
import { applyActorPose, applyCameraPose } from './scene-free-look.js?v=20261103-camera-lens-v1';
import { BeatScenePool } from './beat-scene-pool.js?v=20261108-resource-monitor-v1';
import { isBeatScene } from './beat-background-assets.js?v=20261108-chat-clock-v1';
import { beatSpeakerStyle } from './beat-speaker-theme.js?v=20261007-speaker-colors-v1';
import { BEAT_ACTOR_NAMES, BEAT_CUES, BEAT_EFFECTS, BEAT_FACES, BEAT_OVERLAYS, BEAT_POSITIONS, BEAT_SHOTS, BEAT_SPEAKER_NAMES, backgroundDepthBlur, backgroundPanAmount, backgroundPanPosition, beatActorId, beatBackgroundChanged, buildBackgroundPlan, estimateBeatHold, getShotPreset, plateCoverToBackground, preparedStageCovers, resolveBeatCameraPreset, resolveBeatShot, stagePlateCover, stagePositionOffset, zoomPlateCover } from './beat-player-core.js?v=20261103-camera-walk-v3';
import { BEAT_BACKGROUND_NAMES, backgroundAssetUrl, preloadBackgrounds } from './beat-backgrounds.js?v=20261017-browser-cache-v1';
import { TtsLipSyncAnalyzer } from './tts-lip-sync.js?v=20261107-surprise-mouth-v1';
import { loadResourceLibrary, ResourceSession } from './asset-runtime.js?v=20261104-krnh-motion-index-v1';
import { buildDialogueAssetPlan } from './dialogue-asset-plan.js?v=20261103-paired-face-v1';
import { createResourceLoading } from './resource-loading.js';
import { ResourceBarrier } from './resource-barrier.js';
import { buildChatPrompt, createChatBridge, normalizeChatReply } from './beat-chat.js?v=20261028-suggest-v1';
import { estimateTypewriterDuration, isProducerSpeaker, typewriterDelayMs, TYPEWRITER_DEFAULTS } from './dialogue-reveal.js';

// Resolve against this module. A document-relative ./backgrounds_2d path
// points at the produce page when the player is embedded there.
const BEAT_BACKGROUND_ROOT = new URL('./backgrounds_2d/', import.meta.url).href;
// Milliseconds. Must match the scene wipe keyframes in beat-player.css.
const CLOCK_WIPE_TIMING = Object.freeze({ close: 140, minCovered: 820, reveal: 390 });

const SAMPLE_SCRIPT = `<beat speaker="kotone" cue="greet" look="mao" position="center" background="宿舍门口-午" shot="medium">
啊、麻央宿舍长，早上好！
</beat>

<beat speaker="mao" cue="talk" look="kotone" shot="medium">
早安，琴音。一大早就打扫，辛苦了。
</beat>

<beat speaker="kotone" cue="happy" look="mao" shot="close">
感谢关心！晨练加油！
</beat>

<beat speaker="rinami" cue="greet" look="kotone" shot="reaction">
琴音妹妹早上好。
</beat>

<beat speaker="rinami" cue="happy" look="kotone">
谢谢你来打扫卫生。
</beat>`;

const CHOICE_SCRIPT = `<beat speaker="kotone" cue="talk" look="camera" position="center" background="宿舍门口-午" shot="medium">
制作人，清扫已经做完了。接下来要去哪里？
</beat>
<choice>
<option>先去教室准备下一节课。</option>
<option>回宿舍休息一下。</option>
<option>去操场做晨练。</option>
<option>在门口等麻央一起走。</option>
</choice>`;

const SCENE_SCRIPT = `<beat speaker="kotone" cue="talk" look="camera" position="center" background="声乐练习室-午" shot="medium" camera="medium">制作人，先从中景开始。</beat>
<beat speaker="producer" camera="close">把镜头切到近景，确认一下站位。</beat>
<beat speaker="mao" cue="talk" look="camera" position="right" shot="wide" camera="wide">我也准备好了，保持双人构图。</beat>
<beat speaker="kotone" cue="happy" look="camera" position="center" shot="close" camera="close">好！那我先来。</beat>
<beat speaker="rinami" cue="greet" look="camera" position="left" shot="reaction" camera="reaction">琴音妹妹，加油。</beat>`;

const NAME_MAP = BEAT_SPEAKER_NAMES;
const ACTOR_OPTIONS = [...new Set([...Object.keys(NAME_MAP), ...Object.values(NAME_MAP)])];
const CHAT_BACKGROUND = '家·教室（午）';
const CHAT_IDOL_OPTIONS = Object.entries(BEAT_ACTOR_NAMES)
    .filter(([id]) => !['nasr', 'asari'].includes(id))
    .map(([id, name]) => ({ id, name }));

function getElement(root, id) {
    return root.querySelector(`#${id}`) || document.getElementById(id);
}

export class BeatPlayerApp {
    constructor(root = document, options = {}) {
        this.root = root;
        this.elements = options.elements || {
            stage: getElement(root, 'beatStage'),
            background: getElement(root, 'beatBackground'),
            script: getElement(root, 'beatScript'),
            load: getElement(root, 'loadBeatBtn'),
            sample: getElement(root, 'sampleBeatBtn'),
            choiceSample: getElement(root, 'choiceBeatBtn'),
            sceneSample: getElement(root, 'sceneBeatBtn'),
            beatMode: getElement(root, 'beatModeBtn'),
            chatMode: getElement(root, 'chatModeBtn'),
            beatEditorPanel: getElement(root, 'beatEditorPanel'),
            chatEditorPanel: getElement(root, 'chatEditorPanel'),
            chatComposer: getElement(root, 'beatChatComposer'),
            chatIdol: getElement(root, 'chatIdolSelect'),
            chatLog: getElement(root, 'chatLog'),
            chatInput: getElement(root, 'chatInput'),
            sendChat: getElement(root, 'sendChatBtn'),
            chatStatus: getElement(root, 'chatStatus'),
            dialogueCard: getElement(root, 'beatDialogueCard'),
            portrait: getElement(root, 'beatSpeakerPortrait'),
            choices: getElement(root, 'beatChoices'),
            choiceList: getElement(root, 'beatChoiceList'),
            play: getElement(root, 'playBeatBtn'),
            previous: getElement(root, 'previousBeatBtn'),
            next: getElement(root, 'nextBeatBtn'),
            stop: getElement(root, 'stopBeatBtn'),
            auto: getElement(root, 'beatAutoPlay'),
            progress: getElement(root, 'beatProgress'),
            speaker: getElement(root, 'beatSpeaker'),
            text: getElement(root, 'beatText'),
            shot: getElement(root, 'beatShot'),
            status: getElement(root, 'beatStatus'),
            diagnostics: getElement(root, 'beatDiagnostics'),
        };
        this.director = createSceneDirector(this.elements.stage, {
            // Medium dialogue: head sits below the top of the portrait, and the
            // hips land near the dialogue box. Other shots zoom around that.
            cameraDistanceFactor: 1.6,
            cameraTargetY: 0.71,
            autoIdleAdditiveOnHold: true,
        });
        this.director.useShotFrame = true;
        this.scenePool = new BeatScenePool(this.elements.stage);
        this.resourceGeneration = 0;
        this.resourceLoading = createResourceLoading(this.elements.stage, () => this.retryResources());
        this.state = { generation: 0, current: -1, playing: false, timer: null, choosing: false, selectedChoice: -1 };
        this.compiled = { beats: [], slides: [], beatIndexes: [], choices: [], errors: [] };
        this.preloadPromise = Promise.resolve(false);
        this.preloadPlan = { cast: [], cuesById: {} };
        this.backgroundCategory = String(options.backgroundCategory || '').trim().toLowerCase();
        this.backgroundContext = String(options.backgroundContext || '').trim();
        this.defaultBackground = String(options.defaultBackground || '').trim();
        this.resolveSpeakerTheme = options.resolveSpeakerTheme;
        this.fixedPresentation = options.fixedPresentation || null;
        this.baseFixedPresentation = this.fixedPresentation;
        this.fixedCameraOptions = options.fixedCameraOptions || null;
        this.baseFixedCameraOptions = this.fixedCameraOptions;
        this.defaultCostumes = options.defaultCostumes || {};
        this.backgroundImages = new Map();
        this.backgroundPlan = [];
        this.focusedActor = '';
        this.tts = options.tts || globalThis.HatsuFishTts || null;
        this.ttsSession = '';
        this.ttsLipSync = options.ttsLipSync || new TtsLipSyncAnalyzer();
        this.ttsLipSyncSpeaker = '';
        this.dialogueReveal = {
            enabled: Boolean(options.dialogueReveal),
            active: false,
            token: 0,
            timer: null,
            index: 0,
            chars: [],
            options: { ...TYPEWRITER_DEFAULTS, ...(options.dialogueRevealOptions || {}) },
            audioSrc: options.dialogueRevealAudio || './assets/audio/sud_se_adv_message-01.wav',
            audio: null,
            audioContext: null,
            audioGain: null,
            audioBuffer: null,
            audioLoading: null,
            audioSources: new Set(),
            audioScheduleTimer: null,
            audioLoopToken: 0,
            unlockBound: false,
        };
        this.chatBridge = options.chatBridge || createChatBridge();
        this.chatState = {
            active: false,
            idolKey: this.elements.chatIdol?.value || CHAT_IDOL_OPTIONS[0]?.id || 'kotone',
            pending: false,
            introPending: false,
            saveScope: '',
            requestId: '',
            previousScript: '',
            previousAuto: false,
        };
        this.elements.portrait?.addEventListener('error', () => { this.elements.portrait.hidden = true; });
        if (options.bindEvents !== false) this.bindEvents();
        if (options.loadSample !== false && this.elements.script) {
            this.elements.script.value = SAMPLE_SCRIPT;
            this.compile();
        }
    }

    bindEvents() {
        this.elements.beatMode?.addEventListener('click', () => this.exitChatMode());
        this.elements.chatMode?.addEventListener('click', () => this.enterChatMode(this.elements.chatIdol?.value));
        this.elements.chatIdol?.addEventListener('change', () => {
            if (this.chatState.active) this.enterChatMode(this.elements.chatIdol.value);
        });
        this.elements.sendChat?.addEventListener('click', () => this.sendChatMessage(this.elements.chatInput?.value || ''));
        this.elements.chatInput?.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
            if (!this.inlineChat && !(event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            this.sendChatMessage(this.elements.chatInput.value);
        });
        this.elements.load?.addEventListener('click', () => this.compile());
        this.elements.sample?.addEventListener('click', () => {
            this.elements.script.value = SAMPLE_SCRIPT;
            this.compile();
        });
        this.elements.choiceSample?.addEventListener('click', () => {
            this.elements.script.value = CHOICE_SCRIPT;
            this.compile();
        });
        this.elements.sceneSample?.addEventListener('click', () => {
            this.elements.script.value = SCENE_SCRIPT;
            this.compile();
        });
        this.elements.play?.addEventListener('click', () => this.togglePlay());
        this.elements.previous?.addEventListener('click', () => this.goTo(Math.max(0, this.state.current - 1), { autoplay: false }));
        this.elements.next?.addEventListener('click', () => this.advanceDialogue());
        getElement(this.root, 'advanceBeatBtn')?.addEventListener('click', () => this.advanceDialogue());
        this.elements.dialogueCard?.addEventListener('click', event => {
            if (event.defaultPrevented || event.target.closest('button, a, input, textarea, select, label')) return;
            this.advanceDialogue();
        });
        this.elements.dialogueCard?.addEventListener('keydown', event => {
            if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            this.advanceDialogue();
        });

        this.elements.stop?.addEventListener('click', () => this.stop());
        this.elements.auto?.addEventListener('change', () => {
            if (this.state.playing && this.state.current >= 0) this.scheduleNext();
        });
    }

    parseScript(source = this.elements.script.value) {
        return parseBeatScript(source, {
            actors: ACTOR_OPTIONS,
            allowOtherSpeakers: true,
            cues: BEAT_CUES,
            faces: BEAT_FACES,
            overlays: BEAT_OVERLAYS,
            effects: BEAT_EFFECTS,
            shots: BEAT_SHOTS,
            positions: BEAT_POSITIONS,
            backgrounds: BEAT_BACKGROUND_NAMES,
            backgroundCategory: this.backgroundCategory,
            backgroundContext: this.backgroundContext,
            defaultBackground: this.defaultBackground,
            defaultCostumes: this.defaultCostumes,
        });
    }

    /**
     * Rebuild only the parsed Beat/stage description while retaining the
     * currently prepared ResourceSession and ResourceBarrier. The editor uses
     * this for text, camera, look and other local edits that do not change the
     * cast, costume or background plan. Re-running compile() for these edits
     * would stop the director and restart the whole multi-actor preload.
     */
    refreshCompiledPreview() {
        const parsed = this.parseScript();
        const stage = buildStageSlides(parsed.beats, NAME_MAP);
        const previousIndex = this.state.current;
        this.compiled = { ...parsed, ...stage };
        this.preloadPlan = this.buildPreloadPlan(parsed.beats);
        this.backgroundPlan = buildBackgroundPlan(parsed.beats);
        this.renderDiagnostics();
        if (!parsed.beats.length) {
            this.state.current = -1;
            this.renderBeat(null);
            return false;
        }
        this.state.current = Math.min(Math.max(previousIndex, -1), parsed.beats.length - 1);
        this.renderBeat(this.state.current >= 0 ? this.compiled.beats[this.state.current] : null);
        return true;
    }

    compile({ prepareCompiled, silent = false } = {}) {
        const parsed = this.parseScript();
        const stage = buildStageSlides(parsed.beats, NAME_MAP);
        const preloadPlan = this.buildPreloadPlan(parsed.beats);
        const backgroundPlan = buildBackgroundPlan(parsed.beats);
        const reuseStage = this.canReusePreparedStage(preloadPlan, backgroundPlan);
        this.stop();
        this.state.selectedChoice = -1;
        this.needsResourcePreparation = false;
        this.hideChoicePanel();
        this.resourceBarrier?.cancel();
        this.ttsSession = this.tts?.beginSession?.(`beat-${Date.now()}`) || '';
        if (!reuseStage) {
            this.resources?.dispose();
            if (this.resourceGeneration) this.resetResourcePlayers();
            this.scenePool.present('', null);
            for (const entry of this.director.allEntries()) {
                entry.present = false;
                entry.canvas.style.visibility = 'hidden';
                entry.canvas.style.opacity = '0';
            }
        }
        this.resourceGeneration += 1;
        this.compiled = { ...parsed, ...stage };
        prepareCompiled?.(this.compiled);
        this.preloadPlan = preloadPlan;
        this.backgroundPlan = backgroundPlan;
        this.renderDiagnostics();
        this.state.current = -1;
        if (!reuseStage) this.renderBeat(null);
        if (!parsed.beats.length) {
            this.preloadPromise = Promise.resolve(false);
            this.setStatus('没有可播放的 Beat。');
            return;
        }
        const generation = this.resourceGeneration;
        const choiceNote = parsed.choices.length === 4 ? '，结尾有选项事件' : '';
        if (!reuseStage && !silent) this.setStatus(`已解析 ${parsed.beats.length} 段 Beat${choiceNote}，正在预加载角色资源…`);
        this.resourceBarrier = new ResourceBarrier({
            prepare: () => this.prepareResources(this.preloadPlan, generation, { reuse: reuseStage, silent }),
            beforeRetry: () => { this.resources?.dispose(); this.resetResourcePlayers(); },
            isCurrent: () => generation === this.resourceGeneration,
        });
        this.preloadPromise = this.resourceBarrier.run();
        // A rejected barrier remains rejected for callers, without an unhandled
        // rejection when the user is still looking at the script editor.
        this.preloadPromise.catch(() => {});
        this.prepareBeatVoices();
        if (this.chatState.active) {
            this.preloadPromise
                .then(ready => this.finishChatCompile(generation, ready))
                .catch(error => this.setChatStatus(`资源加载失败：${error.message || error}`, 'error'));
        }
    }

    canReusePreparedStage(plan, backgrounds) {
        const cast = [];
        for (const [idolId, entry] of this.director?.entries || []) {
            if (entry?.player?.ready) cast.push(idolId);
        }
        const loadedBackgrounds = [];
        for (const [name, entry] of this.scenePool?.entries || []) {
            if (entry?.loaded) loadedBackgrounds.push(name);
        }
        // Flat plates are stored on the player, not in the 3D scene pool.
        // Counting only the pool made every 2D beat look unprepared.
        for (const name of this.backgroundImages?.keys() || []) loadedBackgrounds.push(name);
        return preparedStageCovers({
            ready: Boolean(this.resources && !this.resources.disposed && cast.length),
            cast,
            backgrounds: loadedBackgrounds,
        }, {
            cast: plan?.cast || [],
            backgrounds: backgrounds || [],
        });
    }

    getPerformanceSnapshot() {
        const director = this.director?.getPerformanceSnapshot?.() || {
            actors: [],
            aggregate: {},
            activeActors: 0,
            loadedActors: 0,
        };
        const frames = director.actors
            .filter(actor => actor.present && actor.ready)
            .map(actor => actor.frame || {});
        const frameMs = frames.reduce((total, frame) => total + (Number(frame.frameMs) || 0), 0);
        const fpsValues = frames.map(frame => Number(frame.fps) || 0).filter(value => value > 0);
        const snapshot = {
            timestamp: Date.now(),
            state: {
                current: this.state.current,
                total: this.compiled.beats.length,
                playing: this.state.playing,
                resourceLoading: this.resourceLoadingActive,
            },
            cast: [...(this.preloadPlan?.cast || [])],
            scene: {
                loaded: [...(this.scenePool?.entries || [])]
                    .filter(([, entry]) => entry?.loaded)
                    .map(([name]) => name),
                active: this.scenePool?.activePlayer?.canvas?.dataset?.idol || '',
            },
            activeActors: director.activeActors,
            loadedActors: director.loadedActors,
            actors: director.actors,
            aggregate: director.aggregate,
            fps: fpsValues.length ? Math.min(...fpsValues) : 0,
            frameMs,
        };
        snapshot.recommendations = performanceRecommendations(snapshot);
        return snapshot;
    }

    getResourceSnapshot() {
        const loadedScenes = [...(this.scenePool?.entries?.values?.() || [])].filter(entry => entry?.loaded);
        const sceneTextureBytes = loadedScenes.reduce((total, entry) => total
            + (Number(entry.textureBudget?.estimatedBytesAfter) || 0), 0);
        return {
            timestamp: Date.now(),
            renderers: [
                ...(this.director?.getResourceSnapshots?.({ sceneTextureBytes }) || []),
                ...(this.scenePool?.getResourceSnapshots?.() || []),
            ],
            loadedScenes: loadedScenes.map(entry => ({
                name: entry.asset?.name || entry.asset?.id || '3D 场景',
                estimatedTextureBytes: Number(entry.textureBudget?.estimatedBytesAfter) || 0,
                estimatedTextureBytesSaved: Number(entry.textureBudget?.estimatedBytesSaved) || 0,
            })),
        };
    }

    setModeUi(chatActive) {
        if (this.elements.chatComposer) this.elements.chatComposer.hidden = !chatActive;
        if (this.elements.beatEditorPanel) this.elements.beatEditorPanel.hidden = chatActive;
        if (this.elements.chatEditorPanel) this.elements.chatEditorPanel.hidden = !chatActive;
        if (this.elements.beatMode) {
            this.elements.beatMode.classList.toggle('is-active', !chatActive);
            this.elements.beatMode.setAttribute('aria-selected', String(!chatActive));
        }
        if (this.elements.chatMode) {
            this.elements.chatMode.classList.toggle('is-active', chatActive);
            this.elements.chatMode.setAttribute('aria-selected', String(chatActive));
        }
    }

    setChatStatus(message, level = '') {
        if (!this.elements.chatStatus) return;
        this.elements.chatStatus.textContent = String(message || '');
        if (level) this.elements.chatStatus.dataset.level = level;
        else delete this.elements.chatStatus.dataset.level;
    }

    setChatControlsDisabled(disabled) {
        if (this.elements.chatIdol) this.elements.chatIdol.disabled = Boolean(disabled);
        if (this.elements.chatInput) this.elements.chatInput.disabled = Boolean(disabled);
        if (this.elements.sendChat) this.elements.sendChat.disabled = Boolean(disabled);
    }

    clearChatLog() {
        if (!this.elements.chatLog) return;
        this.elements.chatLog.replaceChildren();
    }

    appendChatLine(role, text, label = '') {
        const log = this.elements.chatLog;
        if (!log) return;
        const empty = log.querySelector('.chat-log-empty');
        empty?.remove();
        const line = document.createElement('div');
        line.className = 'chat-line';
        line.dataset.role = role;
        if (label) {
            const title = document.createElement('span');
            title.className = 'chat-line-label';
            title.textContent = label;
            line.append(title);
        }
        const body = document.createElement('span');
        body.textContent = String(text || '');
        line.append(body);
        log.append(line);
        log.scrollTop = log.scrollHeight;
    }

    resolveChatBackground() {
        const value = typeof this.chatBackground === 'function' ? this.chatBackground() : this.chatBackground;
        return String(value || CHAT_BACKGROUND).trim() || CHAT_BACKGROUND;
    }

    selectedChatIdol() {
        const key = String(this.chatState.idolKey || this.elements.chatIdol?.value || 'kotone');
        return CHAT_IDOL_OPTIONS.find(option => option.id === key) || CHAT_IDOL_OPTIONS[0];
    }

    enterChatMode(idolKey = this.elements.chatIdol?.value || 'kotone') {
        const requested = String(idolKey || '').trim();
        const option = CHAT_IDOL_OPTIONS.find(item => item.id === requested || item.name === requested) || CHAT_IDOL_OPTIONS[0];
        if (!option) return false;
        if (!this.chatState.active) {
            this.chatState.previousScript = this.elements.script?.value || '';
            this.chatState.previousAuto = Boolean(this.elements.auto?.checked);
        }
        this.stop();
        this.chatState.active = true;
        this.chatState.idolKey = option.id;
        this.chatState.pending = false;
        this.chatState.requestId = '';
        this.chatState.introPending = true;
        this.chatState.saveScope = '';
        this.fixedPresentation = { shot: 'medium', focus: beatActorId(option.id) };
        this.fixedCameraOptions = { layout: 'home-home', zoom: 0.84 };
        if (this.elements.chatIdol) this.elements.chatIdol.value = option.id;
        this.elements.auto.checked = true;
        this.setModeUi(true);
        this.clearChatLog();
        this.appendChatLine('system', `已进入${option.name}的闲聊场景。`, '系统');
        const idolReady = Boolean(this.director?.entries?.get(beatActorId(option.id))?.player?.ready);
        this.setChatStatus(idolReady ? '正在准备闲聊。' : '正在加载家·教室，并准备制作察觉动作…', 'busy');
        this.elements.script.value = `<beat id="chat-intro" speaker="${option.id}" cue="idle" face="neutral" look="camera" position="center" background="${this.resolveChatBackground()}" shot="medium" wait="none">……</beat>`;
        this.compile();
        this.chatBridge.requestContext?.()
            .then(context => {
                if (this.chatState.active) this.chatState.saveScope = String(context?.saveScope || '');
            })
            .catch(() => {
                if (this.chatState.active) this.setChatStatus('已进入场景；当前对话档案读取较慢，仍可稍后发送。', '');
            });
        return true;
    }

    exitChatMode() {
        if (!this.chatState.active) {
            this.setModeUi(false);
            return false;
        }
        this.stop();
        this.chatState.active = false;
        this.chatState.pending = false;
        this.chatState.introPending = false;
        this.chatState.requestId = '';
        this.fixedPresentation = this.baseFixedPresentation;
        this.fixedCameraOptions = this.baseFixedCameraOptions;
        if (this.elements.auto) this.elements.auto.checked = this.chatState.previousAuto;
        this.setChatControlsDisabled(false);
        this.setModeUi(false);
        if (this.elements.script) this.elements.script.value = this.chatState.previousScript || SAMPLE_SCRIPT;
        this.compile();
        return true;
    }

    async finishChatCompile(generation, ready) {
        if (!this.chatState.active || generation !== this.resourceGeneration) return false;
        if (!ready) {
            this.setChatStatus('场景资源未完整就绪，请点击资源缓存中的重试。', 'error');
            return false;
        }
        const first = await this.goTo(0, { autoplay: false });
        if (!first || !this.chatState.active || generation !== this.resourceGeneration) return false;
        if (this.chatState.introPending) {
            this.chatState.introPending = false;
            await this.playChatIntroAction();
            if (this.chatState.active) this.setChatStatus('已进入待机，可以开始闲聊。');
            return true;
        }
        this.state.playing = true;
        this.updatePlayButton();
        await this.goTo(0, { autoplay: true });
        if (this.inlineChat) {
            this.chatState.active = false;
            if (!this.chatState.pending) this.setChatStatus('');
            return true;
        }
        if (this.chatState.active && !this.state.playing && !this.chatState.pending) this.setChatStatus('回复播放完毕，可以继续输入。');
        return true;
    }

    async playChatIntroAction() {
        const option = this.selectedChatIdol();
        const idolId = beatActorId(option?.id || '');
        const entry = idolId ? this.director.entries.get(idolId) : null;
        if (!entry?.player || !entry.present) return false;
        const generation = this.state.generation;
        const isCurrent = () => this.chatState.active && generation === this.state.generation && entry.present;
        try {
            const played = await entry.player.playStageTransition('kiduku', { isCurrent, onStart: () => {
                entry.present = true;
                entry.canvas.style.visibility = 'visible';
                entry.canvas.style.opacity = '1';
                entry.player.resume();
            } });
            if (!isCurrent()) return false;
            await entry.player.ensureFamily('idle', { play: true });
            entry.player.resume();
            return played;
        } catch (error) {
            console.warn('[BeatPlayer] chat intro action unavailable', error);
            await entry.player.ensureFamily('idle', { play: true }).catch(() => {});
            return false;
        }
    }

    async sendChatMessage(value) {
        const text = String(value || '').trim();
        const inline = Boolean(this.inlineChat);
        if ((!this.chatState.active && !inline) || !text || this.chatState.pending) return false;
        if (this.state.playing && !inline) return false;
        if (inline) this.stop();
        const option = this.selectedChatIdol();
        const background = this.resolveChatBackground();
        const idolHere = typeof this.idolPresent === 'function' ? this.idolPresent() !== false : true;
        const company = typeof this.companyPresent === 'function' && this.companyPresent() === true;
        let prompt;
        try {
            const context = typeof this.chatContext === 'function' ? this.chatContext() : String(this.chatContext || '');
            prompt = buildChatPrompt({ idolName: option.name, userText: text, background, context, present: idolHere, company, staging: Boolean(this.chatStaging), suggestActions: this.suggestActions === true });
        } catch (error) {
            this.setChatStatus(error.message || String(error), 'error');
            return false;
        }
        this.appendChatLine('user', text, '你');
        if (this.elements.chatInput) this.elements.chatInput.value = '';
        this.chatState.pending = true;
        this.chatState.idolPresent = idolHere;
        this.chatState.requestId = `beat-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.setChatControlsDisabled(true);
        this.setChatStatus(inline ? (idolHere ? `${option.name}正在回复…` : company ? '在场的偶像正在回复…' : '正在整理这段行动…') : '偶像正在思考…', 'busy');
        try {
            if (!this.chatState.saveScope) {
                const context = await this.chatBridge.requestContext();
                this.chatState.saveScope = String(context?.saveScope || '');
            }
            const payload = await this.chatBridge.send(prompt, {
                saveScope: this.chatState.saveScope || `beat-chat-${Date.now()}`,
                requestId: this.chatState.requestId,
                ...((idolHere || company) && Number(this.chatReplyTokens) > 0 ? {
                    maxTokens: this.chatReplyTokens,
                    timeoutMs: this.chatReplyTimeoutMs,
                } : {}),
            });
            return this.handleChatReply(payload);
        } catch (error) {
            this.chatState.pending = false;
            this.chatState.requestId = '';
            this.setChatControlsDisabled(false);
            this.setChatStatus(error.message || '闲聊生成失败，请重试。', 'error');
            this.appendChatLine('system', error.message || '闲聊生成失败，请重试。', '系统');
            return false;
        }
    }

    handleChatReply(payload) {
        if ((!this.chatState.active && !this.inlineChat) || String(payload?.requestId || '') !== String(this.chatState.requestId || '')) return false;
        if (this.inlineChat) {
            this.chatState.active = true;
            this.chatState.introPending = false;
        }
        const background = this.resolveChatBackground();
        let source = payload?.text || payload?.rawText || '';
        if (this.chatState.idolPresent === false && typeof this.rewriteAbsentScript === 'function') {
            source = this.rewriteAbsentScript(source);
        }
        if (typeof this.rewriteReplySource === 'function') {
            const rewritten = this.rewriteReplySource(source);
            if (typeof rewritten === 'string') source = rewritten;
        }
        const result = normalizeChatReply(source, { background, preserveStaging: Boolean(this.preserveChatStaging) });
        this.chatState.pending = false;
        this.chatState.requestId = '';
        this.setChatControlsDisabled(false);
        if (!result.ok) {
            if (this.inlineChat) this.chatState.active = false;
            this.setChatStatus(result.error || '闲聊回复无法播放。', 'error');
            this.appendChatLine('system', result.error || '闲聊回复无法播放。', '系统');
            return false;
        }
        const replyText = result.beats.map(beat => `${NAME_MAP[beat.speaker] || beat.speaker}：${beat.text}`).join('\n');
        this.appendChatLine('assistant', replyText, this.chatState.idolPresent === false ? '旁白' : (this.selectedChatIdol()?.name || '偶像'));
        if (typeof this.onSuggestedActions === 'function') this.onSuggestedActions(result.options || []);
        this.setChatStatus(this.inlineChat ? '' : '正在准备动作和语音…', this.inlineChat ? '' : 'busy');
        this.chatState.introPending = false;
        this.elements.script.value = result.script;
        if (this.inlineChat) this.prepareInlineChatStage?.();
        // The classroom and idol are already on stage. Recompiling the reply
        // must not cover them with the full-screen resource clock.
        this.compile({ silent: true });
        return true;
    }

    async togglePlay() {
        if (this.state.playing) {
            this.stop();
            return;
        }
        if (!this.compiled.beats.length || this.needsResourcePreparation) this.compile();
        if (!this.compiled.beats.length) return;
        this.state.playing = true;
        this.updatePlayButton();
        const generation = ++this.state.generation;
        if (!await this.preloadPromise) return false;
        if (!this.state.playing || generation !== this.state.generation) return;
        const index = this.state.current < 0 ? 0 : this.state.current;
        await this.goTo(index, { autoplay: true });
    }

    async goTo(index, { autoplay = this.state.playing } = {}) {
        if (index >= this.compiled.beats.length) {
            if (this.compiled.choices?.length === 4 && this.state.selectedChoice < 0) {
                this.presentChoices();
                return false;
            }
            // Let the final sentence finish playing when autoplay reaches the
            // end of the script. Explicit stop/compile actions still cancel it.
            this.stop({ cancelTts: false });
            return false;
        }
        if (index < 0) return false;
        const previousIndex = this.state.current;
        this.state.choosing = false;
        this.state.selectedChoice = -1;
        this.hideChoicePanel();
        this.clearTimer();
        this.stopDialogueReveal();
        this.state.current = index;
        const generation = ++this.state.generation;
        const beat = this.compiled.beats[index];
        const slideIndex = this.compiled.beatIndexes[index];
        const speakerName = NAME_MAP[beat.speaker] || beat.speaker;
        const entryCue = speakerName && sceneIdolId(speakerName)
            ? `${speakerName}(${resolveBeatCue(beat.cue, beat.face)})`
            : '';
        const previousBackground = previousIndex >= 0 && previousIndex !== index
            ? this.compiled.beats[previousIndex]?.background
            : '';
        const sceneChanged = beatBackgroundChanged(previousBackground, beat.background);
        this.cancelSceneWipe();
        const theme = beatSpeakerStyle(speakerName, this.resolveSpeakerTheme);
        const clockTransition = previousIndex >= 0 && previousIndex !== index && beat.transition === 'clock';
        const wipe = clockTransition
            ? this.playClockWipe()
            : (sceneChanged ? this.playSceneWipe(theme.color === '#978c83' ? '#ff4f9a' : theme.color) : null);
        if (!wipe) this.renderBeat(beat);
        this.setStatus(`正在准备第 ${index + 1} / ${this.compiled.beats.length} 段…`);
        try {
            if (!await this.preloadPromise) return false;
            if (generation !== this.state.generation) return false;
            if (wipe) await wipe.covered;
            if (generation !== this.state.generation || (wipe && !wipe.active())) return false;
            if (wipe) this.renderBeat(beat);
            let cuePrepared = false;
            const ready = await this.director.sync(this.compiled.slides, slideIndex, {
                animate: false,
                entryCue,
                costumes: beat.costumes,
                deferPresentation: true,
                onEntryCuePrepared: () => { cuePrepared = true; },
            });
            if (generation !== this.state.generation) return false;
            const sceneReady = this.applyShot(beat);
            if (ready && beat.effects?.length) {
                await this.director.setFacialEffects(speakerName, beat.effects, this.focusedActor);
            } else if (ready && speakerName && sceneIdolId(speakerName)) {
                await this.director.setFacialEffects(speakerName, [], this.focusedActor);
            }
            if (ready && speakerName && sceneIdolId(speakerName)) {
                // sync already selected and posed this Beat's body/face pair. A
                // second selection would choose another variant and move its root
                // from the first entry motion's start to the second one's start.
                if (!cuePrepared) await this.director.speak(entryCue, 'dialogue');
                for (const overlay of beat.overlay || []) {
                    await this.director.speak(`${speakerName}(${resolveBeatCue(overlay)})`, 'overlay');
                }
            }
            if (generation !== this.state.generation) return false;
            this.director.resume();
            const revealDuration = this.startDialogueReveal(beat, generation);
            const voicePlayback = this.playBeatVoice(beat, generation);
            if (wipe?.active()) wipe.finish();
            this.setStatus(ready && sceneReady ? `第 ${index + 1} / ${this.compiled.beats.length} 段` : '部分角色或场景资源未就绪，已保留台词和可用内容。');
            if (autoplay && this.elements.auto.checked) this.scheduleNext(generation, voicePlayback, revealDuration);
            return true;
        } finally {
            if (wipe?.active() && !wipe.revealed) this.cancelSceneWipe();
        }
    }

    prepareBeatVoices() {
        if (!this.tts?.prepare || !this.ttsSession) return;
        this.compiled.beats.forEach((beat, index) => {
            if (!beat?.ttsText) return;
            const speakerName = NAME_MAP[beat.speaker] || beat.speaker;
            this.tts.prepare({
                id: beat.id || `${index}`,
                speaker: speakerName,
                text: beat.ttsText,
                session: this.ttsSession,
                priority: index
            });
        });
    }

    isTtsLipSyncEnabled() {
        const config = this.tts?.getConfig?.();
        return config ? config.enabled !== false : true;
    }

    stopTtsLipSync() {
        this.ttsLipSync?.stop?.();
        if (this.ttsLipSyncSpeaker) {
            this.director.setTalkLevel?.(this.ttsLipSyncSpeaker, 0, { active: false });
        }
        this.ttsLipSyncSpeaker = '';
    }

    startTtsLipSync(audio, speakerName, generation) {
        this.stopTtsLipSync();
        if (!audio || !this.isTtsLipSyncEnabled() || generation !== this.state.generation) return false;
        this.ttsLipSyncSpeaker = speakerName;
        const started = this.ttsLipSync?.start?.(audio, metrics => {
            if (generation !== this.state.generation || this.ttsLipSyncSpeaker !== speakerName) return;
            this.director.setTalkLevel?.(speakerName, metrics.talkPower, {
                active: true,
                isTalk: metrics.isTalk,
            });
        });
        if (!started) {
            this.ttsLipSyncSpeaker = '';
            return false;
        }
        return true;
    }

    playBeatVoice(beat, generation) {
        const speakerName = NAME_MAP[beat?.speaker] || beat?.speaker || '';
        if (!beat?.ttsText || typeof this.tts?.playPrepared !== 'function') {
            this.stopTtsLipSync();
            this.tts?.stopPlayback?.();
            return Promise.resolve(false);
        }
        this.stopTtsLipSync();
        return this.tts.playPrepared({
            id: beat.id || `${this.state.current}`,
            speaker: speakerName,
            text: beat.ttsText,
            session: this.ttsSession,
            isCurrent: () => generation === this.state.generation,
            onAudio: audio => this.startTtsLipSync(audio, speakerName, generation),
            onPlaybackEnd: () => {
                if (generation === this.state.generation && this.ttsLipSyncSpeaker === speakerName) {
                    this.stopTtsLipSync();
                }
            },
        });
    }

    scheduleNext(generation = this.state.generation, voicePlayback = null, revealDuration = 0) {
        this.clearTimer();
        if (!this.state.playing || generation !== this.state.generation) return;
        const beat = this.compiled.beats[this.state.current];
        if (!beat) return;
        const hold = Math.max(
            beat.wait === 'none' ? 80 : estimateBeatHold(beat.text),
            Number(revealDuration) > 0 ? revealDuration + 120 : 0,
        );
        const advance = () => {
            if (generation !== this.state.generation) return;
            this.goTo(this.state.current + 1, { autoplay: true });
        };
        if (beat.wait !== 'none' && voicePlayback && typeof voicePlayback.then === 'function') {
            const timer = window.setTimeout(advance, Math.max(hold, 20000));
            this.state.timer = timer;
            voicePlayback.then((played) => {
                if (generation !== this.state.generation || this.state.timer !== timer) return;
                this.clearTimer();
                this.state.timer = window.setTimeout(advance, played ? 240 : hold);
            });
            return;
        }
        this.state.timer = window.setTimeout(advance, hold);
    }

    clearTimer() {
        if (this.state.timer !== null) window.clearTimeout(this.state.timer);
        this.state.timer = null;
    }

    presentChoices() {
        this.clearTimer();
        this.state.playing = false;
        this.state.choosing = true;
        this.updatePlayButton();
        this.renderChoiceButtons();
        if (this.elements.dialogueCard) this.elements.dialogueCard.hidden = true;
        if (this.elements.choices) this.elements.choices.hidden = false;
        this.setStatus('请从四个行动里选择。');
    }

    renderChoiceButtons() {
        const list = this.elements.choiceList;
        if (!list) return;
        list.replaceChildren();
        this.compiled.choices.forEach((choice, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'beat-choice-button';
            const label = document.createElement('span');
            label.className = 'beat-choice-label';
            label.textContent = choice.text;
            button.append(label);
            button.addEventListener('click', () => this.selectChoice(index));
            list.append(button);
        });
    }

    selectChoice(index) {
        const choice = this.compiled.choices[index];
        if (!choice || !this.state.choosing) return;
        this.state.selectedChoice = index;
        this.state.choosing = false;
        this.hideChoicePanel();
        this.renderSpeaker('制作人');
        this.renderPortrait(null);
        this.elements.text.textContent = choice.text;
        this.setStatus(`已选择：${choice.text}`);
    }

    hideChoicePanel() {
        this.state.choosing = false;
        if (this.elements.choices) this.elements.choices.hidden = true;
        if (this.elements.dialogueCard) this.elements.dialogueCard.hidden = false;
    }

    stop({ cancelTts = true } = {}) {
        if (this.resourceLoadingActive) this.cancelResourceLoad();
        this.clearTimer();
        this.stopDialogueReveal();
        this.cancelSceneWipe();
        this.state.playing = false;
        if (cancelTts) this.state.generation++;
        if (this.state.choosing) this.hideChoicePanel();
        if (cancelTts) {
            this.director.pause();
            this.stopTtsLipSync();
            this.tts?.stopPlayback?.();
        }
        this.updatePlayButton();
    }

    ensureSceneWipe() {
        if (this.sceneWipe) return this.sceneWipe;
        const stage = this.elements.stage;
        if (!stage) return null;
        const layer = document.createElement('div');
        layer.className = 'beat-scene-wipe';
        layer.hidden = true;
        layer.setAttribute('aria-hidden', 'true');
        for (let index = 0; index < 6; index += 1) {
            const stripe = document.createElement('div');
            stripe.className = 'beat-scene-wipe-stripe';
            stripe.style.setProperty('--i', String(index));
            layer.append(stripe);
        }
        stage.append(layer);
        this.sceneWipe = layer;
        return layer;
    }

    ensureClockWipe() {
        if (this.clockWipe) return this.clockWipe;
        const stage = this.elements.stage;
        if (!stage) return null;
        const layer = document.createElement('div');
        layer.className = 'beat-clock-wipe';
        layer.hidden = true;
        layer.setAttribute('aria-hidden', 'true');
        layer.innerHTML = '<div class="beat-clock-wipe-cover"><i class="beat-clock-wipe-corner is-top"></i><i class="beat-clock-wipe-corner is-bottom"></i></div>'
            + '<div class="beat-clock-wipe-clock"><i class="beat-clock-wipe-trail"></i><i class="beat-clock-wipe-hand is-hour"></i><i class="beat-clock-wipe-hand is-minute"></i></div>';
        stage.append(layer);
        this.clockWipe = layer;
        return layer;
    }

    cancelSceneWipe() {
        this.sceneWipeToken = (this.sceneWipeToken || 0) + 1;
        this.sceneWipeRelease?.();
        this.sceneWipeRelease = null;
        (this.sceneWipeTimers || []).forEach(timer => window.clearTimeout(timer));
        this.sceneWipeTimers = [];
        for (const layer of [this.sceneWipe, this.clockWipe]) {
            if (!layer) continue;
            layer.classList.remove('is-covering', 'is-holding', 'is-revealing');
            layer.hidden = true;
        }
    }

    playSceneWipe(color) {
        const token = (this.sceneWipeToken || 0) + 1;
        this.sceneWipeToken = token;
        this.sceneWipeRelease?.();
        const layer = this.ensureSceneWipe();
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        let resolveCovered = () => {};
        const covered = new Promise((resolve) => {
            resolveCovered = resolve;
        });
        this.sceneWipeRelease = resolveCovered;
        const active = () => token === this.sceneWipeToken;
        if (!layer || reduced) {
            resolveCovered();
            this.sceneWipeRelease = null;
            return { covered, active, finish() {}, revealed: true };
        }
        layer.style.setProperty('--wipe-color', color || '#ff4f9a');
        layer.hidden = false;
        layer.classList.remove('is-covering', 'is-holding', 'is-revealing');
        void layer.offsetWidth;
        layer.classList.add('is-covering');
        let coveredOnce = false;
        const finishCover = () => {
            if (!active() || coveredOnce) return;
            coveredOnce = true;
            window.clearTimeout(coverTimer);
            layer.classList.add('is-holding');
            layer.classList.remove('is-covering');
            this.sceneWipeRelease = null;
            resolveCovered();
        };
        const coverTimer = window.setTimeout(finishCover, 720);
        layer.lastElementChild?.addEventListener('animationend', () => {
            window.clearTimeout(coverTimer);
            finishCover();
        }, { once: true });
        return {
            covered,
            active,
            revealed: false,
            finish() {
                if (!active() || layer.hidden) return;
                this.revealed = true;
                layer.classList.remove('is-covering', 'is-holding');
                void layer.offsetWidth;
                layer.classList.add('is-revealing');
                const hide = () => {
                    if (!active()) return;
                    layer.classList.remove('is-revealing');
                    layer.hidden = true;
                };
                const revealTimer = window.setTimeout(hide, 680);
                layer.lastElementChild?.addEventListener('animationend', () => {
                    window.clearTimeout(revealTimer);
                    hide();
                }, { once: true });
            },
        };
    }

    playClockWipe() {
        const token = (this.sceneWipeToken || 0) + 1;
        this.sceneWipeToken = token;
        this.sceneWipeRelease?.();
        const layer = this.ensureClockWipe();
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        let resolveCovered = () => {};
        const covered = new Promise((resolve) => {
            resolveCovered = resolve;
        });
        this.sceneWipeRelease = resolveCovered;
        const active = () => token === this.sceneWipeToken;
        if (!layer || reduced) {
            resolveCovered();
            this.sceneWipeRelease = null;
            return { covered, active, finish() {}, revealed: true };
        }
        const width = this.elements.stage.clientWidth || 1920;
        const height = this.elements.stage.clientHeight || 1080;
        layer.style.setProperty('--clock-max', `${Math.ceil(Math.hypot(width, height) / 2) + 4}px`);
        layer.style.setProperty('--clock-unit', `${height / 100}px`);
        (this.sceneWipeTimers || []).forEach(timer => window.clearTimeout(timer));
        const timers = this.sceneWipeTimers = [];
        const later = (callback, delay) => timers.push(window.setTimeout(() => {
            if (active()) callback();
        }, delay));
        layer.hidden = false;
        layer.classList.remove('is-covering', 'is-holding', 'is-revealing');
        void layer.offsetWidth;
        layer.classList.add('is-covering');
        const startedAt = performance.now();
        later(() => {
            layer.classList.add('is-holding');
            layer.classList.remove('is-covering');
            this.sceneWipeRelease = null;
            resolveCovered();
        }, CLOCK_WIPE_TIMING.close);
        return {
            covered,
            active,
            revealed: false,
            finish() {
                if (!active() || layer.hidden) return;
                this.revealed = true;
                const wait = Math.max(0, CLOCK_WIPE_TIMING.minCovered - (performance.now() - startedAt));
                later(() => {
                    layer.classList.remove('is-covering', 'is-holding');
                    void layer.offsetWidth;
                    layer.classList.add('is-revealing');
                    later(() => {
                        layer.classList.remove('is-revealing');
                        layer.hidden = true;
                    }, CLOCK_WIPE_TIMING.reveal);
                }, wait);
            },
        };
    }

    sceneCamera() {
        const pool = this.scenePool;
        if (pool?.activePlayer?.camera) return { camera: pool.activePlayer.camera, player: pool.activePlayer };
        for (const entry of this.director?.entries?.values?.() || []) {
            if (entry.player?.stageScene && entry.player.camera) return { camera: entry.player.camera, player: entry.player };
        }
        if (pool?.fallbackStage && pool.fallbackCamera) return { camera: pool.fallbackCamera, player: null };
        return null;
    }

    applyShot(beat) {
        const compiledBeats = this.compiled?.beats || [];
        const foundBeat = compiledBeats.indexOf(beat);
        const presentation = this.fixedPresentation || resolveBeatShot(compiledBeats, foundBeat >= 0 ? foundBeat : this.state.current);
        const cameraShot = beat?.camera ? resolveBeatCameraPreset(beat.camera, presentation.shot) : presentation.shot;
        const effectiveShot = cameraShot === 'keep' ? presentation.shot : cameraShot;
        const preset = getShotPreset(effectiveShot, presentation.focus);
        const interaction = ['pinch', 'pinch-receive', 'shake', 'shake-receive'].includes(String(beat?.cue || '').toLowerCase());
        const solo = Boolean(preset.focus) && (!interaction || Boolean(this.fixedPresentation));
        this.focusedActor = preset.focus || '';
        const focusedEntry = preset.focus ? this.director.entries.get(preset.focus) : null;
        const scene3d = isBeatScene(beat?.background);
        const platePosition = focusedEntry?.position || 'center';
        this.applyBackground(beat, platePosition);
        this.applyFlatBackgroundCamera(scene3d ? '' : beat?.background, preset, platePosition);
        this.elements.stage.dataset.shot = effectiveShot;
        const speakerPoses = resolveActorPoses(compiledBeats, foundBeat >= 0 ? foundBeat : this.state?.current);
        for (const [idolId, entry] of this.director.entries) {
            if (!entry.canvas) continue;
            const base = stagePositionOffset(entry.position);
            const focused = !solo || preset.focus === idolId;
            const visible = Boolean(entry.present && focused);
            // Focused actors return to the viewport center. The background is
            // panned separately to the actor's left/center/right station.
            const translate = solo && focused ? 0 : base;
            const scale = solo ? (focused ? preset.scale : 0.84) : preset.scale;
            entry.canvas.style.transition = 'none';
            entry.canvas.style.transform = 'none';
            entry.player.setShotFrame?.(scene3d ? { scale: 1, shiftX: 0, originY: .5 } : { scale, shiftX: (translate / 100) * 2, originY: preset.originY });
            entry.canvas.style.zIndex = focused ? '3' : '1';
            entry.canvas.style.visibility = visible ? 'visible' : 'hidden';
            entry.canvas.style.opacity = visible ? '1' : '0';
            entry.player.setPresentationActive?.(visible);
            entry.player.setActorPose?.(speakerPoses.get(idolId) || null);
        }
        const scenePlayer = focusedEntry?.present && focusedEntry.player.ready ? focusedEntry.player : null;
        if (!scenePlayer) {
            for (const entry of this.director.entries.values()) {
                if (entry.player?.stageScene) entry.player.setStageScene(null);
            }
        }
        const cameraOptions = { ...(this.fixedCameraOptions || {}) };
        if (beat?.cameraPose) cameraOptions.pose = beat.cameraPose;
        const lens = { focal: beat?.focal || 0, dof: beat?.dof || null };
        if (lens.focal) cameraOptions.focal = lens.focal;
        if (lens.dof) cameraOptions.dof = lens.dof;
        for (const entry of this.director.entries.values()) entry.player?.setCameraLens?.(lens);
        this.elements.stage.dataset.cameraPreset = beat?.camera || '';
        this.elements.stage.dataset.cameraLayout = cameraOptions.layout || '';
        this.elements.stage.dataset.cameraZoom = cameraOptions.zoom || '';
        // `camera` and `shot` are one shared framing channel. Both the 2D plate
        // and the 3D scene receive the same effective value.
        const presented = this.scenePool.present(beat?.background || '', scenePlayer, cameraShot, focusedEntry?.position || 'center', cameraOptions) || !scene3d;
        this.startPoseMove(beat);
        return presented;
    }

    stopPoseMove() {
        if (this.poseMoveFrame) cancelAnimationFrame(this.poseMoveFrame);
        this.poseMoveFrame = 0;
        this.poseMoveToken = (this.poseMoveToken || 0) + 1;
    }

    startPoseMove(beat) {
        this.stopPoseMove();
        const cameraMove = beat?.cameraMove;
        const actorMove = beat?.actorMove;
        if (!cameraMove && !actorMove) return;
        const player = this.scenePool?.activePlayer || null;
        const camera = player?.camera || this.sceneCamera()?.camera || null;
        const speakerId = beatActorId(beat?.speaker);
        const entry = speakerId ? this.director.entries.get(speakerId) : null;
        const model = entry?.player?.model || null;
        const cameraReady = Boolean(camera && cameraMove?.from && cameraMove?.to);
        const actorReady = Boolean(model && actorMove?.from && actorMove?.to);
        if (!cameraReady && !actorReady) return;
        const started = performance.now();
        const token = this.poseMoveToken;
        const ease = t => t * t * (3 - 2 * t);
        const mix = (from, to, t) => from + (to - from) * t;
        const mixPose = (from, to, t, keys) => Object.fromEntries(keys.map(key => [key, mix(from[key], to[key], t)]));
        const apply = progress => {
            if (cameraReady) {
                const pose = mixPose(cameraMove.from, cameraMove.to, progress.camera, ['x', 'y', 'z', 'yaw', 'pitch']);
                if (cameraMove.walk) pose.y += cameraWalkOffset(progress.elapsed, cameraMove.duration);
                applyCameraPose(camera, pose);
            }
            if (actorReady) applyActorPose(model, mixPose(actorMove.from, actorMove.to, progress.actor, ['x', 'y', 'z', 'yaw']));
        };
        apply({ camera: 0, actor: 0, elapsed: 0 });
        player?.renderFrame?.();
        if (!player) this.scenePool?.renderBackground?.();
        const tick = now => {
            if (token !== this.poseMoveToken) return;
            let pending = false;
            const cameraT = cameraReady ? Math.min(1, (now - started) / (cameraMove.duration * 1000)) : 1;
            const actorT = actorReady ? Math.min(1, (now - started) / (actorMove.duration * 1000)) : 1;
            const elapsed = cameraReady ? Math.min(cameraMove.duration, (now - started) / 1000) : 0;
            apply({ camera: ease(cameraT), actor: ease(actorT), elapsed });
            if (cameraT < 1 || actorT < 1) pending = true;
            player?.renderFrame?.();
            if (!player) this.scenePool?.renderBackground?.();
            if (pending) this.poseMoveFrame = requestAnimationFrame(tick);
            else this.poseMoveFrame = 0;
        };
        this.poseMoveFrame = requestAnimationFrame(tick);
    }

    buildPreloadPlan(beats) {
        const cast = [];
        const cuesById = {};
        const costumesById = {};
        for (const beat of Array.isArray(beats) ? beats : []) {
            const idolId = beatActorId(beat?.speaker);
            if (!idolId) continue;
            if (!cast.includes(idolId)) cast.push(idolId);
            costumesById[idolId] ||= [];
            if (!costumesById[idolId].includes(beat.costume || 'Default')) costumesById[idolId].push(beat.costume || 'Default');
            const speakerName = NAME_MAP[beat.speaker] || beat.speaker || '';
            const cue = `${speakerName}(${resolveBeatCue(beat.cue, beat.face)})`;
            cuesById[idolId] ||= [];
            if (!cuesById[idolId].includes(cue)) cuesById[idolId].push(cue);
            for (const overlay of beat.overlay || []) {
                const overlayCue = `${speakerName}(${resolveBeatCue(overlay)})`;
                if (!cuesById[idolId].includes(overlayCue)) cuesById[idolId].push(overlayCue);
            }
        }
        return { cast, cuesById, costumesById };
    }

    async prepareResources(plan, generation, { reuse = false, silent = false } = {}) {
        const director = this.director, scenePool = this.scenePool, compiled = this.compiled, backgroundPlan = [...this.backgroundPlan];
        const current = () => generation === this.resourceGeneration;
        const keepStage = reuse && this.resources && !this.resources.disposed;
        // A visual-only editor change can reuse the prepared stage. Keep the
        // barrier and compiled beats in sync, but do not flash the full-screen
        // loading layer while no new asset is expected. Chat replies are the
        // same: the classroom is already showing, so the clock must stay hidden.
        const chatReply = Boolean(this.chatState?.active && !this.chatState?.introPending);
        const quietReuse = Boolean(silent && keepStage) || chatReply;
        this.resourceLoadingActive = !quietReuse;
        try {
            if (!quietReuse) this.resourceLoading.update({ phase: 'checking' });
            const library = await loadResourceLibrary();
            if (generation !== this.resourceGeneration) return false;
            const chatIdolId = this.chatState.active ? beatActorId(this.chatState.idolKey) : '';
            const selected = buildDialogueAssetPlan(compiled, plan, library, {
                preloadFamiliesById: chatIdolId ? { [chatIdolId]: ['kiduku'] } : {},
            });
            const resources = keepStage ? this.resources : (this.resources = new ResourceSession(library, { onProgress: progress => {
                if (generation === this.resourceGeneration && !chatReply) this.resourceLoading.update(progress);
            }}));
            if (keepStage) {
                resources.onProgress = progress => {
                    if (generation === this.resourceGeneration && !silent && !chatReply && progress?.downloadBytes > 0) this.resourceLoading.update(progress);
                };
            }
            await resources.prepare(selected.keys, { extend: keepStage });
            if (generation !== this.resourceGeneration) return false;
            plan = selected;
            this.preloadPlan = selected;
            scenePool.resources = resources;
            const [ready, backgrounds, scenesReady, portraitsReady] = await Promise.all([
                director.preload(plan.cast, {
                prewarm: true,
                focusedId: beatActorId(compiled.beats[0]?.speaker),
                cuesById: plan.cuesById,
                costumesById: plan.costumesById,
                resources,
                performances: plan.performances,
                }),
                preloadBackgrounds(backgroundPlan, { base: BEAT_BACKGROUND_ROOT, resolveUrl: url => resources.resolve(url) }),
                scenePool.preload(backgroundPlan),
                this.preloadPortraits(compiled.beats, resources),
            ]);
            if (generation !== this.resourceGeneration) return false;
            backgrounds.loaded.forEach((image, name) => this.backgroundImages.set(name, image));
            const castEntries = director.allEntries().filter(entry => plan.cast.includes(entry.canvas.dataset.idol) && entry.player.ready);
            const effectCombinations = [...new Map(compiled.beats.map(beat => {
                const effects = [...(beat.effects || [])].sort();
                return [JSON.stringify(effects), effects];
            })).values()].filter(effects => effects.length);
            // director.preload({ prewarm: true }) already warms every newly
            // created actor. Only effect variants need a second warm pass; the
            // old `!keepStage` branch repeated the base actor warmup on every
            // first multi-actor load.
            if (castEntries.some(entry => !entry.warmed) || effectCombinations.length) {
                for (const entry of castEntries) {
                    if (!current()) return false;
                    if (!entry.warmed) {
                        entry.warmed = await entry.player.prewarm();
                    }
                    // Some eye effects are mutually exclusive. Prepare each
                    // non-empty combination actually used by the sequence.
                    for (const effects of effectCombinations) {
                        await entry.player.setFacialEffects(effects);
                        if (!current()) return false;
                        await entry.player.prewarm();
                        if (!current()) return false;
                    }
                    await entry.player.setFacialEffects([]);
                }
                if (!current()) return false;
            }
            // Scene materials are owned by each actor renderer and still need
            // their first-load shader/texture warmup. Keep this independent of
            // actor warmup so removing the duplicate actor pass is safe.
            if (!keepStage) await scenePool.warmPlayers(castEntries.map(entry => entry.player), backgroundPlan, current);
            if (!current()) return false;
            const allReady = ready && backgrounds.ready && scenesReady && portraitsReady;
            if (!allReady) throw new Error('角色、动作、背景或场景未能完整加载，请重试。');
            resources.report('preparing', { task: '首帧渲染' });
            const first = compiled.beats[0];
            const speaker = NAME_MAP[first.speaker] || first.speaker || '';
            const cue = `${speaker}(${resolveBeatCue(first.cue, first.face)})`;
            if (!await director.sync(compiled.slides, compiled.beatIndexes[0], {
                animate: false, entryCue: cue, costumes: first.costumes, deferPresentation: true,
            })) throw new Error('首帧动作准备失败。');
            if (generation !== this.resourceGeneration) return false;
            if (!this.applyShot(first)) throw new Error('首帧场景准备失败。');
            await director.setFacialEffects(speaker, first.effects || [], this.focusedActor);
            if (!current()) return false;
            for (const entry of director.allEntries()) {
                if (entry.present) entry.player.renderFrame();
                entry.player.pause();
            }
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            if (generation !== this.resourceGeneration) return false;
            this.resourceLoading.ready();
            this.resourceLoadingActive = false;
            if (generation === this.resourceGeneration && !this.state.playing) {
                this.setStatus(allReady
                    ? (plan.cast.length ? '角色、贴图、动作和背景已预加载，可以播放。' : '背景已预加载，可以播放制作人或旁白段落。')
                    : '部分角色或背景资源未就绪，播放时会保留可用内容。');
            }
            return allReady;
        } catch (error) {
            if (generation !== this.resourceGeneration || error.name === 'AbortError') return false;
            console.warn('[BeatPlayer] preload failed', error);
            this.setStatus(`资源加载失败：${error.message}`);
            this.resourceLoading.update({ phase: 'error', message: String(error.message || error) });
            throw error;
        }
    }

    retryResources() {
        if (this.resourceBarrier?.resume) { this.resourceBarrier.retry(); return; }
        this.resourceGeneration++;
        this.resources?.dispose();
        this.resetResourcePlayers();
        this.preloadPromise = this.prepareResources(this.preloadPlan, this.resourceGeneration);
        this.preloadPromise.then(ready => ready && this.goTo(Math.max(0, this.state.current), { autoplay: false })).catch(() => {});
    }

    resetResourcePlayers() {
        this.director.dispose();
        this.director = createSceneDirector(this.elements.stage, { cameraDistanceFactor: 1.6, cameraTargetY: .71, autoIdleAdditiveOnHold: true });
        this.director.useShotFrame = true;
        this.scenePool.dispose();
        this.scenePool = new BeatScenePool(this.elements.stage);
        this.backgroundImages.clear();
    }

    cancelResourceLoad() {
        this.resourceGeneration++;
        this.resourceBarrier?.cancel();
        this.resourceLoadingActive = false;
        this.needsResourcePreparation = true;
        this.resources?.dispose();
        this.resources = null;
        this.resourceLoading.ready();
        this.resetResourcePlayers();
    }

    renderSpeaker(name) {
        const label = this.elements.speaker;
        label.textContent = name;
        const plate = label.closest('.speaker-plate');
        if (!plate) return;
        const { color, textColor } = beatSpeakerStyle(name, this.resolveSpeakerTheme);
        plate.style.setProperty('--speaker-theme-color', color);
        plate.style.setProperty('--speaker-text-color', textColor);
    }

    setDialogueRevealEnabled(enabled) {
        this.dialogueReveal.enabled = Boolean(enabled);
        if (this.dialogueReveal.enabled) {
            this.armDialogueRevealAudioUnlock();
            return;
        }
        this.stopDialogueReveal();
        const beat = this.compiled.beats[this.state.current];
        if (this.elements.text && beat) this.elements.text.textContent = beat.text || '';
    }

    ensureDialogueRevealAudio() {
        if (this.dialogueReveal.audio || typeof Audio !== 'function') return this.dialogueReveal.audio;
        const audio = new Audio(this.dialogueReveal.audioSrc);
        audio.preload = 'auto';
        audio.volume = 0.34;
        audio.playbackRate = Math.max(0.5, Math.min(4, Number(this.dialogueReveal.options.audioPlaybackRate) || 1));
        this.dialogueReveal.audio = audio;
        return audio;
    }

    ensureDialogueRevealAudioContext() {
        if (this.dialogueReveal.audioContext) return this.dialogueReveal.audioContext;
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (typeof Context !== 'function') return null;
        try {
            const context = new Context();
            const gain = context.createGain();
            gain.gain.value = 0.34;
            gain.connect(context.destination);
            this.dialogueReveal.audioContext = context;
            this.dialogueReveal.audioGain = gain;
            return context;
        } catch {
            return null;
        }
    }

    loadDialogueRevealAudioBuffer() {
        if (this.dialogueReveal.audioBuffer) return Promise.resolve(this.dialogueReveal.audioBuffer);
        if (this.dialogueReveal.audioLoading) return this.dialogueReveal.audioLoading;
        const context = this.ensureDialogueRevealAudioContext();
        if (!context || typeof fetch !== 'function') return Promise.resolve(null);
        this.dialogueReveal.audioLoading = fetch(this.dialogueReveal.audioSrc, { cache: 'force-cache' })
            .then(response => {
                if (!response.ok) throw new Error('音效载入失败：' + response.status);
                return response.arrayBuffer();
            })
            .then(data => context.decodeAudioData(data))
            .then(buffer => {
                this.dialogueReveal.audioBuffer = buffer;
                return buffer;
            })
            .catch(error => {
                console.warn('[BeatPlayer] dialogue reveal audio unavailable', error);
                return null;
            })
            .finally(() => { this.dialogueReveal.audioLoading = null; });
        return this.dialogueReveal.audioLoading;
    }

    armDialogueRevealAudioUnlock() {
        if (this.dialogueReveal.unlockBound || !this.root?.addEventListener) return;
        this.dialogueReveal.unlockBound = true;
        this.root.addEventListener('pointerdown', () => {
            const context = this.ensureDialogueRevealAudioContext();
            if (context) {
                context.resume?.().catch?.(() => {});
                void this.loadDialogueRevealAudioBuffer();
                return;
            }
            const audio = this.ensureDialogueRevealAudio();
            if (!audio) return;
            audio.muted = true;
            const playback = audio.play();
            playback?.then?.(() => {
                audio.pause();
                try { audio.currentTime = 0; } catch {}
                audio.muted = false;
            }).catch?.(() => { audio.muted = false; });
        }, { once: true, capture: true });
    }

    startDialogueRevealAudio(speaker) {
        if (!isProducerSpeaker(speaker)) return;
        const context = this.ensureDialogueRevealAudioContext();
        if (context) {
            const token = this.dialogueReveal.audioLoopToken;
            this.loadDialogueRevealAudioBuffer().then(buffer => {
                if (!buffer || token !== this.dialogueReveal.audioLoopToken || !this.dialogueReveal.active) return;
                context.resume?.().catch?.(() => {});
                const rate = Math.max(0.5, Math.min(4, Number(this.dialogueReveal.options.audioPlaybackRate) || 1));
                const sampleDuration = buffer.duration;
                const duration = sampleDuration / rate;
                const fade = Math.min(0.006, duration / 4);
                let nextTime = context.currentTime + 0.01;
                const schedule = () => {
                    if (token !== this.dialogueReveal.audioLoopToken || !this.dialogueReveal.active) return;
                    const source = context.createBufferSource();
                    const gain = context.createGain();
                    source.buffer = buffer;
                    // Keep the sample at its original pitch. The rate setting
                    // shortens each tick instead of changing playbackRate.
                    source.playbackRate.value = 1;
                    gain.gain.setValueAtTime(0, nextTime);
                    gain.gain.linearRampToValueAtTime(1, nextTime + fade);
                    gain.gain.setValueAtTime(1, nextTime + Math.max(fade, duration - fade));
                    gain.gain.linearRampToValueAtTime(0, nextTime + duration);
                    source.connect(gain).connect(this.dialogueReveal.audioGain);
                    source.onended = () => {
                        this.dialogueReveal.audioSources.delete(source);
                        gain.disconnect();
                    };
                    this.dialogueReveal.audioSources.add(source);
                    source.start(nextTime);
                    source.stop(nextTime + duration + 0.01);
                    nextTime += duration;
                    this.dialogueReveal.audioScheduleTimer = window.setTimeout(
                        schedule,
                        Math.max(10, (nextTime - context.currentTime - 0.04) * 1000),
                    );
                };
                schedule();
            });
            return;
        }
        const audio = this.ensureDialogueRevealAudio();
        if (!audio) return;
        audio.currentTime = 0;
        const playback = audio.play();
        playback?.catch?.(() => {});
    }

    stopDialogueRevealAudio() {
        this.dialogueReveal.audioLoopToken += 1;
        if (this.dialogueReveal.audioScheduleTimer !== null) {
            window.clearTimeout(this.dialogueReveal.audioScheduleTimer);
            this.dialogueReveal.audioScheduleTimer = null;
        }
        for (const source of this.dialogueReveal.audioSources) {
            try { source.stop(); } catch {}
            source.disconnect?.();
        }
        this.dialogueReveal.audioSources.clear();
        const audio = this.dialogueReveal.audio;
        if (!audio) return;
        audio.pause();
        try { audio.currentTime = 0; } catch {}
    }

    stopDialogueReveal() {
        this.dialogueReveal.token += 1;
        if (this.dialogueReveal.timer !== null) window.clearTimeout(this.dialogueReveal.timer);
        this.dialogueReveal.timer = null;
        this.dialogueReveal.active = false;
        this.dialogueReveal.index = 0;
        this.dialogueReveal.chars = [];
        this.stopDialogueRevealAudio();
    }

    completeDialogueReveal() {
        if (!this.dialogueReveal.active) return false;
        const text = this.dialogueReveal.chars.join('');
        this.stopDialogueReveal();
        if (this.elements.text) this.elements.text.textContent = text;
        return true;
    }

    startDialogueReveal(beat, generation) {
        const text = String(beat?.text || '');
        if (!this.dialogueReveal.enabled || !text) {
            if (this.elements.text) this.elements.text.textContent = text;
            return 0;
        }
        this.stopDialogueReveal();
        const token = this.dialogueReveal.token;
        const chars = Array.from(text);
        this.dialogueReveal.active = true;
        this.dialogueReveal.chars = chars;
        this.dialogueReveal.index = 0;
        if (this.elements.text) this.elements.text.textContent = '';
        this.startDialogueRevealAudio(beat.speaker);
        const tick = () => {
            if (!this.dialogueReveal.active || token !== this.dialogueReveal.token) return;
            if (generation !== this.state.generation) {
                this.stopDialogueReveal();
                return;
            }
            this.dialogueReveal.index += 1;
            if (this.elements.text) this.elements.text.textContent = chars.slice(0, this.dialogueReveal.index).join('');
            if (this.dialogueReveal.index >= chars.length) {
                this.stopDialogueReveal();
                if (this.elements.text) this.elements.text.textContent = text;
                return;
            }
            const character = chars[this.dialogueReveal.index - 1];
            const delay = typewriterDelayMs(character, this.dialogueReveal.options);
            this.dialogueReveal.timer = window.setTimeout(tick, delay);
        };
        tick();
        return estimateTypewriterDuration(text, this.dialogueReveal.options);
    }

    advanceDialogue() {
        if (this.completeDialogueReveal()) return true;
        if (this.state.choosing) return false;
        return this.goTo(this.state.current + 1, { autoplay: this.state.playing });
    }

    renderPortrait(beat) {
        const image = this.elements.portrait;
        if (!image) return;
        const portrait = beat?.portrait;
        if (!portrait) {
            image.hidden = true;
            image.removeAttribute('src');
            image.alt = '';
            delete image.dataset.character;
            delete image.dataset.emotion;
            return;
        }
        image.alt = portrait.name + ' · ' + portrait.emotion;
        image.dataset.character = portrait.characterId;
        image.dataset.emotion = portrait.emotion;
        image.src = this.resources?.resolve(portrait.src) || portrait.src;
        image.hidden = false;
    }

    async preloadPortraits(beats = this.compiled.beats, resources = this.resources) {
        const sources = [...new Set(beats.map(beat => beat.portrait?.src).filter(Boolean))];
        const ready = await Promise.all(sources.map(src => new Promise(resolve => {
            const image = new Image();
            image.onload = () => resolve(true);
            image.onerror = () => resolve(false);
            image.src = resources?.resolve(src) || src;
        })));
        return ready.every(Boolean);
    }

    renderBeat(beat) {
        const current = this.state.current;
        this.elements.progress.textContent = beat ? `${current + 1} / ${this.compiled.beats.length}` : '—';
        this.renderSpeaker(beat ? (NAME_MAP[beat.speaker] || beat.speaker || '旁白') : '等待播放');
        this.elements.text.textContent = this.dialogueReveal.enabled && beat?.text
            ? ''
            : beat?.text || '在左侧输入 Beat，或载入示例开始。';
        this.renderPortrait(beat);
        const presentation = beat ? (this.fixedPresentation || resolveBeatShot(this.compiled.beats, current)) : null;
        this.elements.shot.textContent = beat
            ? `镜头：` + presentation.shot + (beat.camera ? ' · camera ' + beat.camera : '') + (presentation.inherited ? '（沿用上一位偶像）' : '')
            : '镜头：—';
    }

    applyFlatBackgroundCamera(name, preset, position = 'center') {
        const node = this.elements.background;
        if (!node) return;
        if (!name || isBeatScene(name)) {
            node.style.backgroundSize = '';
            node.style.filter = '';
            return;
        }
        const image = this.backgroundImages.get(name);
        const viewW = this.elements.stage?.clientWidth || image?.width || 1;
        const viewH = this.elements.stage?.clientHeight || image?.height || 1;
        const blur = backgroundDepthBlur(preset?.scale);
        const zoom = (Number(preset?.scale) || 1) * (blur ? 1.08 : 1);
        const cover = zoomPlateCover(
            stagePlateCover(viewW, viewH, image?.width || viewW, image?.height || viewH, backgroundPanAmount(position), 0.5),
            zoom,
            0.5,
            preset?.originY ?? 0.5,
        );
        const css = plateCoverToBackground(cover);
        node.style.backgroundSize = css.size;
        node.style.backgroundPosition = css.position;
        node.style.filter = `blur(${blur}px)`;
    }

    applyBackground(beat, position = 'center') {
        const name = String(beat?.background || '').trim();
        const image = this.backgroundImages.get(name);
        const url = backgroundAssetUrl(name, BEAT_BACKGROUND_ROOT);
        if (!this.elements.background) return;
        const plate = url ? `url("${this.resources?.resolve(url) || url}")` : '';
        this.elements.background.style.backgroundImage = plate;
        this.elements.background.style.backgroundPosition = backgroundPanPosition(position);
        for (const entry of this.director.entries.values()) entry.player.setStagePlate?.(image || null, position);
        this.elements.stage.dataset.background = name;
        this.elements.stage.dataset.backgroundKind = isBeatScene(name) ? '3d' : '2d';
        this.elements.stage.dataset.backgroundPosition = String(position || 'center').trim().toLowerCase();
    }

    renderDiagnostics() {
        const errors = this.compiled.errors || [];
        this.elements.diagnostics.replaceChildren();
        if (!errors.length) {
            this.elements.diagnostics.textContent = '协议检查通过';
            this.elements.diagnostics.dataset.level = 'ok';
            return;
        }
        this.elements.diagnostics.dataset.level = 'warn';
        const fragment = document.createDocumentFragment();
        for (const error of errors) {
            const item = document.createElement('li');
            item.textContent = error.message;
            fragment.append(item);
        }
        this.elements.diagnostics.append(fragment);
    }

    updatePlayButton() {
        if (!this.elements.play) return;
        const playLabel = this.elements.play.querySelector('.toolbar-label');
        if (playLabel) playLabel.textContent = this.state.playing ? '暂停' : '播放';
        else this.elements.play.textContent = this.state.playing ? '暂停' : '播放';
        this.elements.play.setAttribute('aria-pressed', String(this.state.playing));
    }

    setStatus(message) {
        if (this.elements.status) this.elements.status.textContent = message;
    }

    dispose() {
        this.stopPoseMove();
        this.stop();
        this.resourceGeneration += 1;
        this.resources?.dispose();
        this.resourceLoading.dispose();
        this.scenePool.dispose();
        this.director.dispose();
    }
}

if (/\/beat-player\.html$/i.test(window.location.pathname)) {
    const app = new BeatPlayerApp(document);
    window.beatPlayer = app;
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'chat') {
        window.requestAnimationFrame(() => app.enterChatMode(params.get('idol') || ''));
    }
    window.addEventListener('beforeunload', () => app.dispose(), { once: true });
}

