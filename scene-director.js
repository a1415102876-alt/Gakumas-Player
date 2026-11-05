import { stageSnapshot, sceneIdolId, SCENE_IDOLS } from './scene-protocol.js?v=20261102-krnh-3d-v1';
import { StageAttentionController } from './stage-attention.js?v=20261030-perf-diagnostic-v2';
import { stagePositionOffset } from './beat-player-core.js?v=20261011-action-rules-v3';
import { costumeEntryKey, resolveBeatCostume } from './beat-costumes.js?v=20261013-all-idol-solo1-v1';

export class SceneDirector {
    constructor(container, createRuntime) {
        this.container = container;
        this.createRuntime = createRuntime;
        this.entries = new Map();
        this.costumeEntries = new Map();
        this.generation = 0;
        this.controller = new AbortController();
    }

    allEntries() {
        return [...new Set([...this.entries.values(), ...this.costumeEntries.values()])];
    }

    getPerformanceSnapshot() {
        const actors = this.allEntries().map(entry => entry.player?.getPerformanceSnapshot?.({
            idolId: entry.canvas?.dataset?.idol || '',
            costume: entry.canvas?.dataset?.costume || '',
            present: entry.present === true && entry.canvas?.style?.visibility !== 'hidden',
        })).filter(Boolean);
        const active = actors.filter(actor => actor.present && actor.ready);
        return {
            loadedActors: actors.filter(actor => actor.ready).length,
            activeActors: active.length,
            actors,
            aggregate: {
                drawCalls: active.reduce((total, actor) => total + (Number(actor.renderer?.calls) || 0), 0),
                triangles: active.reduce((total, actor) => total + (Number(actor.renderer?.triangles) || 0), 0),
                updateMs: active.reduce((total, actor) => total + (Number(actor.frame?.updateMs) || 0), 0),
                renderMs: active.reduce((total, actor) => total + (Number(actor.frame?.renderMs) || 0), 0),
                pixelRatio: active.reduce((total, actor) => total + (Number(actor.renderer?.pixelRatio) || 0), 0),
                geometries: active.reduce((total, actor) => total + (Number(actor.renderer?.geometries) || 0), 0),
                textures: active.reduce((total, actor) => total + (Number(actor.renderer?.textures) || 0), 0),
                phases: active.reduce((totals, actor) => {
                    for (const [name, value] of Object.entries(actor.frame?.phases || {})) {
                        totals[name] = (Number(totals[name]) || 0) + (Number(value) || 0);
                    }
                    return totals;
                }, {}),
                fixedSteps: active.reduce((total, actor) => total + (Number(actor.physics?.fixedSteps) || 0), 0),
                staticCollisionHits: active.reduce((total, actor) => total + (Number(actor.physics?.staticCollisionHits) || 0), 0),
                chainCollisionHits: active.reduce((total, actor) => total + (Number(actor.physics?.chainCollisionHits) || 0), 0),
            },
        };
    }

    activateCostumes(costumes = {}) {
        for (const idolId of this.entries.keys()) {
            const next = this.costumeEntries.get(costumeEntryKey(idolId, costumes[idolId] || 'Default'));
            const previous = this.entries.get(idolId);
            if (!next || next === previous) continue;
            previous.present = false;
            previous.canvas.style.visibility = 'hidden';
            previous.canvas.style.opacity = '0';
            previous.player.setPresentationActive?.(false);
            next.position = previous.position;
            next.present = false;
            this.entries.set(idolId, next);
        }
    }

    async preload(cast, { prewarm = false, cuesById = null, costumesById = null, resources = this.resources, performances = this.performances } = {}) {
        this.resources = resources;
        this.performances = performances;
        const ids = [...new Set((Array.isArray(cast) ? cast : []).map(String).filter(Boolean))];
        const pending = [];
        for (const idolId of ids) {
          const costumes = [...new Set(costumesById?.[idolId]?.length ? costumesById[idolId] : ['Default'])];
          for (const value of costumes) {
            const costume = resolveBeatCostume(value, idolId);
            if (!costume) return false;
            const entryKey = costumeEntryKey(idolId, costume);
            if (this.controller.signal.aborted) return false;
            if (!this.costumeEntries.has(entryKey)) {
                const canvas = this.container.ownerDocument.createElement('canvas');
                // Keep preloaded canvases in the layout so Three.js can compile
                // their shader programs during warmup. Visibility controls
                // presentation; `hidden` would collapse the render surface.
                canvas.hidden = false;
                canvas.dataset.idol = idolId;
                canvas.dataset.costume = costume;
                canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;visibility:hidden;opacity:0;';
                this.container.append(canvas);
                const entry = { canvas, player: this.createRuntime(canvas), present: false, warmed: false };
                entry.player.resources = resources;
                entry.player.plannedPerformances = performances?.get(idolId);
                this.costumeEntries.set(entryKey, entry);
                if (!this.entries.has(idolId)) this.entries.set(idolId, entry);
                entry.ready = entry.player.ensure(idolId, costume).catch(error => {
                    console.warn('[SceneDirector] model unavailable', idolId, error);
                    return false;
                }).then(ready => {
                    if (this.controller.signal.aborted) { entry.player.dispose(); return false; }
                    return ready;
                });
            }
            const existing = this.costumeEntries.get(entryKey);
            existing.player.resources = resources;
            existing.player.plannedPerformances = performances?.get(idolId);
            if (existing.player.facialEffects && resources) {
                existing.player.facialEffects.resources = resources;
                existing.player.facialEffects.loader.manager.setURLModifier(value => resources.resolve(value));
            }
            pending.push(existing);
          }
        }
        const readyEntries = (await Promise.all(pending.map(async entry => ({ entry, ready: await entry.ready })))).filter(item => item.ready).map(item => item.entry);
        let motionsReady = true;
        if (prewarm && readyEntries.length) {
            await Promise.all(readyEntries.map(async entry => {
                if (!entry.warmed && entry.player.prewarm) {
                    entry.warmed = await entry.player.prewarm();
                }
                const cues = cuesById instanceof Map ? cuesById.get(entry.canvas.dataset.idol) : cuesById?.[entry.canvas.dataset.idol];
                if (cues?.length && entry.player.preloadCues) {
                    const ready = await entry.player.preloadCues(cues);
                    motionsReady &&= ready;
                }
            }));
        }
        return readyEntries.length === pending.length && motionsReady;
    }

    async sync(slides, index, { animate = true, entryCue = '', deferPresentation = false, onEntryCuePrepared = () => {}, costumes = {} } = {}) {
        const generation = ++this.generation;
        this.transitionAbort?.abort();
        this.transitionAbort = new AbortController();
        const signal = this.transitionAbort.signal;
        const snapshot = stageSnapshot(slides, index);
        const current = slides[index];
        const currentSpeaker = sceneIdolId(current?.speaker);
        const isCurrent = () => generation === this.generation && !this.controller.signal.aborted;
        await this.preload(snapshot.cast, { costumesById: Object.fromEntries(snapshot.cast.map(id => [id, [costumes[id] || 'Default']])) });
        if (!isCurrent()) return false;
        this.activateCostumes(costumes);
        await Promise.all([...this.entries].map(async ([idolId, entry]) => {
            const target = snapshot.actors[idolId];
            const position = target?.position || entry.position || 'center';
            if (!this.useShotFrame) entry.canvas.style.transform = `translateX(${stagePositionOffset(position)}%)`;
            entry.position = position;
            let firstFrameReady = false;
            const prepareDialogueCue = target && (!entry.present || deferPresentation)
                && current?.type === 'dialogue' && currentSpeaker === idolId && entryCue;
            if (prepareDialogueCue && entry.player.playSpeakerCue) {
                if (!await entry.ready || !isCurrent()) return;
                // Beat owns the reveal after it applies the camera. Select the
                // cue once, and pose offscreen actors before their canvas shows.
                const firstFrame = !entry.present || entry.canvas.style.visibility !== 'visible';
                firstFrameReady = await entry.player.playSpeakerCue(entryCue, { slideType: 'dialogue', isCurrent, firstFrame });
                if (!isCurrent()) return;
                if (firstFrameReady) onEntryCuePrepared(entryCue, idolId);
            }
            if (target && !entry.present) {
                if (!await entry.ready || !isCurrent()) return;
                const animated = animate && current?.type === 'stage' && current.action === 'enter' && current.idolId === idolId;
                if (animated) {
                    await entry.player.playStageTransition('enter', { signal, isCurrent, onStart: () => {
                        entry.present = true;
                        entry.canvas.style.visibility = 'visible';
                        entry.canvas.style.opacity = '1';
                        entry.player.resume();
                    } });
                } else {
                    if (!firstFrameReady && entry.player.prepareStageFirstFrame) {
                        const idleIndex = await entry.player.ensureFamily?.('idle', { play: false });
                        if (idleIndex >= 0) entry.player.prepareStageFirstFrame(idleIndex);
                    }
                    entry.present = true;
                    if (!deferPresentation) {
                        entry.canvas.style.visibility = 'visible';
                        entry.canvas.style.opacity = '1';
                        entry.player.resume();
                    }
                }
            } else if (!target && entry.present) {
                const animated = animate && current?.type === 'stage' && current.action === 'exit' && current.idolId === idolId;
                if (animated) await entry.player.playStageTransition('exit', { signal, isCurrent });
                if (!isCurrent()) return;
                entry.present = false;
                entry.canvas.style.visibility = 'hidden';
                entry.canvas.style.opacity = '0';
                entry.player.pause();
            }
        }));
        const present = Object.entries(snapshot.actors);
        const names = Object.fromEntries(Object.entries(SCENE_IDOLS).map(([name, id]) => [id, name]));
        const actionPromises = [];
        for (const [idolId, actor] of present) {
            const entry = this.entries.get(idolId);
            if (!entry) continue;
            if (!entry.player.setAttentionTarget) continue;
            let target = actor.look || null;
            if (target === 'auto') target = null;
            if (!target && currentSpeaker && currentSpeaker !== idolId && current?.type === 'dialogue') target = currentSpeaker;
            if (!target && present.length === 2 && (current?.type === 'narration' || current?.type === 'stage')) target = present.find(([other]) => other !== idolId)?.[0] || 'camera';
            if (!target && currentSpeaker === idolId && present.length === 2) target = present.find(([other]) => other !== idolId)?.[0] || 'camera';
            const vector = !target || target === 'camera' || target === 'none'
                ? { x: 0, y: 0 }
                : StageAttentionController.resolveTarget(idolId, target, Object.fromEntries(present.map(([id, value]) => [id, value.position])));
            entry.player.setAttentionTarget(target || 'camera', vector, actor.duration || 720);
            if (actor.action && entry.player.playSpeakerCue && names[idolId]) actionPromises.push(entry.player.playSpeakerCue(names[idolId] + '(' + actor.action + ')', { slideType: 'action', isCurrent }));
        }
        await Promise.all(actionPromises);
        this.refreshCrowdBudget(currentSpeaker);
        return isCurrent();
    }

    refreshCrowdBudget(speakerId = this.crowdSpeaker || '') {
        if (speakerId) this.crowdSpeaker = speakerId;
        const present = [...this.entries.values()].filter(entry => entry.present);
        const count = Math.max(1, present.length);
        const speakerPresent = present.some(entry => entry.canvas.dataset.idol === this.crowdSpeaker);
        const fallback = speakerPresent ? null : present[0];
        for (const entry of this.allEntries()) {
            const visible = present.includes(entry);
            entry.player.setCrowdBudget?.({
                count: visible ? count : 1,
                focused: !visible || count <= 1 || entry.canvas.dataset.idol === this.crowdSpeaker || entry === fallback,
            });
        }
    }

    async speak(speaker, slideType) {
        const speakerId = sceneIdolId(speaker);
        if (speakerId) this.refreshCrowdBudget(speakerId);
        const entry = this.entries.get(speakerId);
        if (!entry?.present) return false;
        const generation = this.generation;
        return entry.player.playSpeakerCue(speaker, { slideType,
            isCurrent: () => generation === this.generation && entry.present && !this.controller.signal.aborted });
    }

    async setFacialEffects(speaker, effects = [], fallbackId = '') {
        const idolId = sceneIdolId(speaker) || fallbackId;
        const entry = idolId ? this.entries.get(idolId) : null;
        if (!entry?.player?.setFacialEffects) return false;
        return entry.player.setFacialEffects(effects);
    }

    setTalkLevel(speaker, level = 0, options = {}) {
        const idolId = sceneIdolId(speaker) || String(speaker || '').trim();
        const entry = idolId ? this.entries.get(idolId) : null;
        if (!entry?.player?.setTalkLevel) return false;
        entry.player.setTalkLevel(level, options);
        return true;
    }

    pause() {
        this.generation++;
        this.transitionAbort?.abort();
        for (const entry of this.allEntries()) entry.player.pause();
    }

    resume() {
        this.refreshCrowdBudget();
        for (const entry of this.entries.values()) {
            // An actor can be on stage but out of frame: Beat's applyShot() hides
            // it and pauses its loop. Waking it here made every off-camera actor
            // run a full animation, physics and draw loop into a hidden canvas.
            if (entry.present && entry.canvas?.style?.visibility !== 'hidden') entry.player.resume();
        }
    }

    dispose() {
        this.pause();
        this.controller.abort();
        for (const entry of this.allEntries()) { entry.player.dispose(); entry.canvas.remove(); }
        this.entries.clear();
        this.costumeEntries.clear();
    }
}

