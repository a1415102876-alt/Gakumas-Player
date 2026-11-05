import { actorPoseFromObject, cameraPoseFromObject } from './scene-free-look.js?v=20261102-actor-pose-v1';
import { BeatPlayerApp } from './beat-player.js?v=20261104-clock-transition-v1';
import { BEAT_BACKGROUND_NAMES } from './beat-backgrounds.js?v=20261017-browser-cache-v1';
import { BEAT_SCENE_ASSETS } from './beat-scene-assets.js?v=20261027-scene-library-v1';
import { BEAT_CUES, BEAT_EFFECTS, BEAT_FACES, BEAT_OVERLAYS, BEAT_POSITIONS, BEAT_SHOTS, BEAT_CAMERA_PRESETS, BEAT_SPEAKER_NAMES, beatActorId } from './beat-player-core.js?v=20261102-krnh-3d-v1';
import { BEAT_BODY_CUE_SPECS, BEAT_CUE_ALIASES, beatMotionFileKey, isBeatMotionFile, isBeatPairedCue } from './beat-cues.js?v=20261103-paired-face-v1';
import { MOTION_BUCKETS } from './core.js?v=20261011-stage-cue-rules-v4';
import { createEditorBeat, cloneEditorBeat, moveBeat, parseBeatEditorSource, serializeBeatEditorScript, updateBeat, validateEditorDocument } from './beat-editor-model.js?v=20261104-clock-transition-v1';
import { createActorPoseGizmo } from './beat-actor-gizmo.js?v=20261103-actor-gizmo-v1';

const qs = (id) => document.getElementById(id);
const unique = (values) => [...new Set((values || []).map(value => String(value ?? '').trim()).filter(Boolean))];
const CUE_LABELS = Object.freeze({
    ...BEAT_CUE_ALIASES,
    'talk-neutral': '平静说话', 'talk-inspecting': '打量着说话', 'talk-excited': '兴奋说话', 'talk-concerned': '担心着说话', 'talk-proud': '抱胸说话',
    greet: '尊敬鞠躬', akkanbe: '做鬼脸', kakutou: '格斗姿势', niramu: '瞪视', tanoshimu: '享受', yarukinashi: '没干劲',
});
const withId = (name, id) => (name && name !== id ? `${name} ${id}` : id);
const motionCatalog = [];
const motionByKey = new Map();
const labelFor = (value) => {
    const key = String(value ?? '');
    const fixed = { auto: '自动', camera: '镜头', none: '无' };
    if (fixed[key]) return fixed[key];
    if (BEAT_SPEAKER_NAMES[key]) return withId(BEAT_SPEAKER_NAMES[key], key);
    const motion = motionByKey.get(beatMotionFileKey(key));
    if (motion) return withId(motion.title, motion.label);
    return withId(CUE_LABELS[key], key);
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const PREVIEW_SETTINGS_KEY = 'hatsuBeatEditorPreviewSettings';
const DEFAULT_PREVIEW_SETTINGS = Object.freeze({ stageWidth: 900, dialogueWidth: 760 });

const elementMap = {
    stage: qs('beatEditorStage'), background: qs('beatEditorStageBackground'), script: qs('beatScript'),
    dialogueCard: qs('beatEditorDialogueCard'), portrait: qs('beatEditorSpeakerPortrait'), choices: qs('beatEditorChoices'), choiceList: qs('beatEditorChoiceList'),
    play: qs('beatEditorPlay'), previous: qs('beatEditorPrevious'), next: qs('beatEditorNext'), stop: qs('beatEditorStop'), auto: qs('beatEditorAuto'),
    progress: qs('beatEditorProgress'), speaker: qs('beatEditorSpeaker'), text: qs('beatEditorText'), shot: qs('beatEditorShotPreview'), status: qs('beatEditorStatus'),
    diagnostics: qs('beatDiagnostics'),
};

const state = {
    document: parseBeatEditorSource(sessionStorage.getItem('hatsuBeatEditorSource') || ''),
    selectedIndex: 0,
    undo: [],
    redo: [],
    dirty: false,
    previewToken: 0,
    previewSettings: loadPreviewSettings(),
};
if (!state.document.beats.length) state.document = { ...state.document, beats: [createEditorBeat()], source: '' };

let previewTimer = 0;
let previewSilent = true;
let previewNeedsResources = true;

function clampPreviewWidth(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number / 20) * 20)) : fallback;
}

function loadPreviewSettings() {
    try {
        const raw = JSON.parse(localStorage.getItem(PREVIEW_SETTINGS_KEY) || '{}');
        return {
            stageWidth: clampPreviewWidth(raw.stageWidth, DEFAULT_PREVIEW_SETTINGS.stageWidth, 620, 1600),
            dialogueWidth: clampPreviewWidth(raw.dialogueWidth, DEFAULT_PREVIEW_SETTINGS.dialogueWidth, 420, 1320),
        };
    } catch {
        return { ...DEFAULT_PREVIEW_SETTINGS };
    }
}

function savePreviewSettings() {
    try { localStorage.setItem(PREVIEW_SETTINGS_KEY, JSON.stringify(state.previewSettings)); } catch { /* embedded previews may deny storage */ }
}

function applyPreviewSettings() {
    const stage = qs('beatEditorStage');
    if (stage) {
        stage.style.setProperty('--editor-stage-width', `${state.previewSettings.stageWidth}px`);
        stage.style.setProperty('--editor-dialogue-width', `${state.previewSettings.dialogueWidth}px`);
    }
    const stageField = qs('beatEditorStageWidth');
    const dialogueField = qs('beatEditorDialogueWidth');
    const stageValue = qs('beatEditorStageWidthValue');
    const dialogueValue = qs('beatEditorDialogueWidthValue');
    if (stageField) stageField.value = String(state.previewSettings.stageWidth);
    if (dialogueField) dialogueField.value = String(state.previewSettings.dialogueWidth);
    if (stageValue) stageValue.textContent = `${state.previewSettings.stageWidth}px`;
    if (dialogueValue) dialogueValue.textContent = `${state.previewSettings.dialogueWidth}px`;
    requestAnimationFrame(() => {
        for (const entry of app?.director?.allEntries?.() || []) {
            if (entry.present) entry.player?.renderFrame?.();
        }
        app?.scenePool?.activePlayer?.renderFrame?.();
    });
}

function updatePreviewSetting(key, value) {
    const [min, max] = key === 'stageWidth' ? [620, 1600] : [420, 1320];
    state.previewSettings[key] = clampPreviewWidth(value, DEFAULT_PREVIEW_SETTINGS[key], min, max);
    savePreviewSettings();
    applyPreviewSettings();
}

const options = {
    speaker: Object.keys(BEAT_SPEAKER_NAMES),
    cue: unique(BEAT_CUES), face: unique(BEAT_FACES), overlay: unique(BEAT_OVERLAYS), effects: unique(BEAT_EFFECTS),
    position: unique(BEAT_POSITIONS), shot: unique(BEAT_SHOTS), camera: unique(BEAT_CAMERA_PRESETS),
    look: ['auto', 'camera', 'producer', ...Object.keys(BEAT_SPEAKER_NAMES)], wait: ['text', 'none', 'voice'],
    background: unique([...BEAT_BACKGROUND_NAMES, ...(BEAT_SCENE_ASSETS || []).map(item => item?.name)]),
};

function pushHistory() {
    state.undo.push(clone(state.document));
    if (state.undo.length > 40) state.undo.shift();
    state.redo = [];
}

function setDirty(value = true) {
    state.dirty = Boolean(value); state.document.dirty = state.dirty;
    const node = qs('beatEditorDirty'); if (node) { node.textContent = state.dirty ? '未保存修改' : '未修改'; node.dataset.state = state.dirty ? 'dirty' : 'clean'; }
    qs('beatEditorUndoBtn').disabled = !state.undo.length; qs('beatEditorRedoBtn').disabled = !state.redo.length;
}

function setStatus(message, level = '') {
    const node = qs('beatEditorPreviewStatus'); if (node) { node.textContent = message; node.dataset.level = level; }
    const footer = qs('beatEditorStatus'); if (footer) footer.textContent = message;
}

function populateSelect(select, values, includeBlank = false) {
    if (!select) return;
    select.replaceChildren();
    if (includeBlank) select.append(new Option('（无）', ''));
    values.forEach(value => select.append(new Option(labelFor(value), value)));
}

function renderMotionFiles() {
    const select = qs('beatEditorMotionFile');
    if (!select) return;
    const bucket = qs('beatEditorMotionBucket')?.value || 'all';
    const current = beatMotionFileKey(qs('beatEditorMotionName')?.value || state.document.beats[state.selectedIndex]?.cue);
    const items = motionCatalog.filter(item => bucket === 'all' || item.bucket === bucket);
    select.replaceChildren(new Option(motionCatalog.length ? '（从列表选择原文件）' : '动作列表载入中', ''));
    items.forEach(item => {
        const suffix = item.character && item.character !== 'cmmn' ? ` · ${item.character}` : '';
        const option = new Option(`${item.title}${suffix} ${item.label}`, item.label);
        option.dataset.key = beatMotionFileKey(item.label);
        select.append(option);
    });
    const match = [...select.options].find(option => option.dataset.key && option.dataset.key === current);
    select.value = match ? match.value : '';
}

function syncMotionPicker(cue) {
    const file = isBeatMotionFile(cue);
    const name = qs('beatEditorMotionName');
    if (name && document.activeElement !== name) name.value = file ? cue : '';
    const cueSelect = qs('beatEditorCue');
    if (cueSelect && file) {
        if (![...cueSelect.options].some(option => option.value === cue)) cueSelect.append(new Option(labelFor(cue), cue));
        cueSelect.value = cue;
    }
    const select = qs('beatEditorMotionFile');
    const match = select && [...select.options].find(option => option.dataset.key === beatMotionFileKey(file ? cue : ''));
    if (select) select.value = match ? match.value : '';
}

function renderFaceFiles() {
    const select = qs('beatEditorFaceFile');
    if (!select) return;
    const items = motionCatalog.filter(item => item.bucket === 'faceOnly');
    select.replaceChildren(new Option(items.length ? '（不另选表情文件）' : '表情列表载入中', ''));
    items.forEach(item => {
        const suffix = item.character && item.character !== 'cmmn' ? ` · ${item.character}` : '';
        const option = new Option(`${item.title}${suffix} ${item.label}`, item.label);
        option.dataset.key = beatMotionFileKey(item.label);
        select.append(option);
    });
    syncFaceFile(state.document.beats[state.selectedIndex]?.face);
}

function syncFaceFile(face) {
    const select = qs('beatEditorFaceFile');
    if (!select) return;
    const key = beatMotionFileKey(isBeatMotionFile(face) ? face : '');
    const match = [...select.options].find(option => option.dataset.key && option.dataset.key === key);
    select.value = match ? match.value : '';
}

function cueKeepsSeparateFace(cue) {
    const token = String(cue || '').trim().toLowerCase();
    if (!token) return false;
    if (isBeatPairedCue(token)) return true;
    if (isBeatMotionFile(cue)) return motionByKey.get(beatMotionFileKey(cue))?.bucket !== 'faceOnly';
    return token === 'talk' || token === 'shy' || Boolean(BEAT_BODY_CUE_SPECS[token]);
}

function applyMotionFile(label) {
    const entry = motionByKey.get(beatMotionFileKey(label));
    const beat = state.document.beats[state.selectedIndex];
    if (entry?.bucket === 'faceOnly' && cueKeepsSeparateFace(beat?.cue)) {
        mutate({ face: label });
        return;
    }
    mutate({ cue: label });
}

async function loadMotionCatalog() {
    try {
        const response = await fetch(new URL('./gakumas-motion-map.json', import.meta.url));
        if (!response.ok) throw new Error(response.statusText);
        const map = await response.json();
        motionCatalog.length = 0;
        motionByKey.clear();
        for (const bucket of map.buckets || []) {
            for (const family of bucket.families || []) {
                for (const item of family.items || []) {
                    if (!item?.label && !item?.stem) continue;
                    const entry = { bucket: bucket.id, bucketLabel: bucket.label || bucket.id, title: item.title || item.label, label: item.label || item.stem, character: item.character || '' };
                    motionCatalog.push(entry);
                    motionByKey.set(beatMotionFileKey(entry.label), entry);
                }
            }
        }
        const bucketSelect = qs('beatEditorMotionBucket');
        if (bucketSelect) {
            const counts = new Map();
            motionCatalog.forEach(item => counts.set(item.bucket, (counts.get(item.bucket) || 0) + 1));
            bucketSelect.replaceChildren(new Option(`全部分类 ${motionCatalog.length}`, 'all'));
            for (const bucket of map.buckets || []) {
                if (!counts.get(bucket.id)) continue;
                bucketSelect.append(new Option(`${MOTION_BUCKETS[bucket.id]?.label || bucket.label || bucket.id} ${counts.get(bucket.id)}`, bucket.id));
            }
        }
        renderMotionFiles();
        renderFaceFiles();
        renderAll();
    } catch (error) {
        const select = qs('beatEditorMotionFile');
        if (select) select.replaceChildren(new Option('动作列表读取失败，可手动填写文件名', ''));
        setStatus(`完整动作列表读取失败：${error?.message || error}`, 'warn');
    }
}

function setupFields() {
    populateSelect(qs('beatEditorSpeakerField'), options.speaker);
    populateSelect(qs('beatEditorCue'), options.cue);
    populateSelect(qs('beatEditorFace'), options.face, true);
    populateSelect(qs('beatEditorBackground'), options.background, true);
    populateSelect(qs('beatEditorPosition'), options.position, true);
    populateSelect(qs('beatEditorLook'), options.look, true);
    populateSelect(qs('beatEditorShot'), options.shot);
    populateSelect(qs('beatEditorCamera'), options.camera, true);
    populateSelect(qs('beatEditorOverlays'), options.overlay);
    populateSelect(qs('beatEditorEffects'), options.effects);
    populateSelect(qs('beatEditorWait'), options.wait);
}

function fieldValue(field) {
    if (!field) return '';
    if (field.multiple) return [...field.selectedOptions].map(option => option.value);
    return field.value;
}

function setField(field, value) {
    if (!field) return;
    if (field.multiple) { const values = new Set(Array.isArray(value) ? value : []); [...field.options].forEach(option => { option.selected = values.has(option.value); }); }
    else field.value = value == null ? '' : String(value);
}

function renderProperties() {
    const beat = state.document.beats[state.selectedIndex];
    const name = qs('beatEditorSelection'); if (name) name.textContent = beat ? `#${state.selectedIndex + 1}` : '—';
    if (!beat) return;
    const map = { beatEditorId: beat.id, beatEditorSpeakerField: beat.speaker, beatEditorCue: beat.cue, beatEditorFace: isBeatMotionFile(beat.face) ? '' : beat.face, beatEditorBackground: beat.background, beatEditorPosition: beat.position, beatEditorLook: beat.look, beatEditorShot: beat.shot, beatEditorCostume: beat.costume, beatEditorCamera: beat.camera, beatEditorOverlays: beat.overlay, beatEditorEffects: beat.effects, beatEditorWait: beat.wait, beatEditorTransition: beat.transition, beatEditorTextField: beat.text, beatEditorTts: beat.ttsText };
    Object.entries(map).forEach(([id, value]) => setField(qs(id), value));
    syncMotionPicker(beat.cue);
    syncFaceFile(beat.face);
    syncCameraPoseFields();
    syncLensFields();
    syncActorPoseFields();
    syncCameraMoveFields();
    syncActorMoveFields();
}

function renderList() {
    const list = qs('beatEditorList'); list.replaceChildren();
    state.document.beats.forEach((beat, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = `beat-list-item${index === state.selectedIndex ? ' is-selected' : ''}`; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(index === state.selectedIndex));
        button.innerHTML = `<span class="beat-list-index">${index + 1}</span><span><strong class="beat-list-title"></strong><small class="beat-list-meta"></small></span>`;
        button.querySelector('.beat-list-title').textContent = beat.text || '(空台词)'; button.querySelector('.beat-list-meta').textContent = `${beat.speaker ? labelFor(beat.speaker) : '未指定'} · ${labelFor(beat.cue || 'talk')} · ${beat.shot || 'medium'}`;
        button.addEventListener('click', () => {
            state.selectedIndex = index;
            renderAll();
            if (app.compiled?.beats?.length === state.document.beats.length && !app.resourceLoadingActive) {
                void app.goTo(index, { autoplay: false });
                setStatus(`已预览第 ${index + 1} 段`);
            } else {
                schedulePreviewRefresh({ silent: true });
            }
        }); list.append(button);
    });
}

function renderAll() {
    renderList(); renderProperties(); setDirty(state.dirty);
    const report = validateEditorDocument(state.document);
    const validation = qs('beatEditorValidation');
    if (validation) {
        validation.textContent = report.ok ? '当前 Beat 序列可以导出并播放。' : report.errors.join(' ');
        validation.dataset.level = report.ok ? 'ok' : 'warn';
    }
}

function patchNeedsResources(patch) {
    // Text, camera and attention edits can reuse the prepared stage. Motion,
    // facial effect and overlay edits may introduce a new clip/effect union,
    // so keep those on the resource-safe compile path as well.
    const resourceKeys = ['speaker', 'background', 'costume', 'cue', 'face', 'overlay', 'effects'];
    return Object.keys(patch || {}).some(key => resourceKeys.includes(key));
}

function schedulePreviewRefresh({ silent = false, immediate = false, requiresResources = false } = {}) {
    previewNeedsResources ||= Boolean(requiresResources);
    previewSilent = previewSilent && Boolean(silent);
    clearTimeout(previewTimer);
    const run = () => {
        const nextSilent = previewSilent;
        const nextNeedsResources = previewNeedsResources;
        previewSilent = true;
        previewNeedsResources = false;
        previewTimer = 0;
        void refreshPreview({ silent: nextSilent, needsResources: nextNeedsResources });
    };
    if (immediate) run();
    else previewTimer = window.setTimeout(run, 90);
}

function mutate(patch) {
    if (!state.document.beats[state.selectedIndex]) return;
    pushHistory();
    state.document = updateBeat(state.document, state.selectedIndex, patch);
    setDirty(true); renderList(); renderProperties();
    const requiresResources = patchNeedsResources(patch);
    schedulePreviewRefresh({ silent: !requiresResources, requiresResources });
}

function currentPatchFromEvent(event) {
    const field = event.currentTarget; const key = field.dataset.field; let value = fieldValue(field);
    if (key === 'cameraDuration') value = Number(value) || 0;
    return { [key]: value };
}

function serializeAndStore() {
    const script = serializeBeatEditorScript(state.document); qs('beatScript').value = script; return script;
}

async function refreshPreview({ silent = false, needsResources = true } = {}) {
    const token = ++state.previewToken; const script = serializeAndStore();
    setStatus(silent ? '正在刷新预览…' : '正在解析并预加载资源…');
    const canReusePreparedPreview = !needsResources
        && app.compiled?.beats?.length === state.document.beats.length
        && (app.resourceLoadingActive || (app.resources && !app.resources.disposed));
    if (canReusePreparedPreview) app.refreshCompiledPreview();
    else app.compile({ silent });
    try {
        const ready = await app.preloadPromise;
        if (token !== state.previewToken) return;
        if (!ready) { setStatus('资源加载失败，请检查背景或角色资源。', 'warn'); return; }
        await app.goTo(Math.min(state.selectedIndex, Math.max(0, app.compiled.beats.length - 1)), { autoplay: false });
        syncCameraPoseFields();
        refreshActorGizmo();
        setStatus(`已预览第 ${state.selectedIndex + 1} 段`);
    } catch (error) { if (token === state.previewToken) setStatus(`预览失败：${error?.message || error}`, 'warn'); }
}

function addBeat() { pushHistory(); const index = state.document.beats.length; state.document = { ...state.document, beats: [...state.document.beats, createEditorBeat({ id: `b${String(index + 1).padStart(2, '0')}` })] }; state.selectedIndex = index; setDirty(true); renderAll(); schedulePreviewRefresh({ silent: false, immediate: true, requiresResources: true }); }
function deleteBeat() { if (state.document.beats.length <= 1) return; pushHistory(); const beats = state.document.beats.filter((_, index) => index !== state.selectedIndex); state.document = { ...state.document, beats }; state.selectedIndex = Math.min(state.selectedIndex, beats.length - 1); setDirty(true); renderAll(); schedulePreviewRefresh({ silent: false, immediate: true, requiresResources: true }); }
function duplicateBeat() { const beat = state.document.beats[state.selectedIndex]; if (!beat) return; pushHistory(); const beats = [...state.document.beats]; beats.splice(state.selectedIndex + 1, 0, cloneEditorBeat(beat, state.selectedIndex + 1)); state.document = { ...state.document, beats }; state.selectedIndex += 1; setDirty(true); renderAll(); schedulePreviewRefresh({ silent: false, immediate: true, requiresResources: true }); }
function shiftBeat(delta) { const target = state.selectedIndex + delta; if (target < 0 || target >= state.document.beats.length) return; pushHistory(); state.document = moveBeat(state.document, state.selectedIndex, target); state.selectedIndex = target; setDirty(true); renderAll(); schedulePreviewRefresh({ silent: true, immediate: true, requiresResources: true }); }
function undo() { const previous = state.undo.pop(); if (!previous) return; state.redo.push(clone(state.document)); state.document = previous; state.selectedIndex = Math.min(state.selectedIndex, state.document.beats.length - 1); setDirty(true); renderAll(); schedulePreviewRefresh({ silent: false, immediate: true, requiresResources: true }); }
function redo() { const next = state.redo.pop(); if (!next) return; state.undo.push(clone(state.document)); state.document = next; state.selectedIndex = Math.min(state.selectedIndex, state.document.beats.length - 1); setDirty(true); renderAll(); schedulePreviewRefresh({ silent: false, immediate: true, requiresResources: true }); }

function importSource(source) {
    const parsed = parseBeatEditorSource(source, { allowOtherSpeakers: true });
    if (!parsed.beats.length) { qs('beatEditorValidation').textContent = '没有找到可导入的 <beat> 段落。'; qs('beatEditorValidation').dataset.level = 'warn'; return; }
    pushHistory(); state.document = parsed; state.selectedIndex = 0; setDirty(true); renderAll(); schedulePreviewRefresh({ silent: false, immediate: true, requiresResources: true });
}

async function copyExport() { const script = serializeAndStore(); try { await navigator.clipboard.writeText(script); setStatus('脚本已复制到剪贴板。'); } catch { setStatus('脚本已生成，请从导入框复制。'); } }
function returnToSandbox() { const script = serializeAndStore(); sessionStorage.setItem('hatsuBeatEditorResult', script); const target = sessionStorage.getItem('hatsuBeatEditorReturn') || './gakumas-player.html'; window.location.href = target; }
function exportScript() {
    const script = serializeAndStore();
    sessionStorage.setItem('hatsuBeatEditorResult', script);
    void copyExport();
    setStatus('脚本已导出并暂存，点击“返回怪文书”可直接载入。');
}

const CAMERA_POSE_FIELDS = [['beatEditorCamX', 'x'], ['beatEditorCamY', 'y'], ['beatEditorCamZ', 'z'], ['beatEditorCamYaw', 'yaw'], ['beatEditorCamPitch', 'pitch']];
let cameraPoseHistoryOpen = false;
let lensHistoryOpen = false;

function liveBeatCamera() {
    const pool = app.scenePool;
    if (pool?.freeLook?.enabled) {
        const posed = pool.freeLook.readPose?.();
        if (posed) return posed;
    }
    const found = app.sceneCamera?.();
    return found?.camera ? cameraPoseFromObject(found.camera) : null;
}

function syncCameraPoseFields() {
    const pose = state.document.beats[state.selectedIndex]?.cameraPose || null;
    const toggle = qs('beatEditorFreeLook');
    const panel = qs('beatEditorFreeLookPanel');
    if (!toggle) return;
    if (document.activeElement !== toggle) toggle.checked = Boolean(pose);
    if (panel) panel.hidden = !pose;
    for (const id of ['beatEditorCamera', 'beatEditorShot']) {
        const field = qs(id);
        if (field) field.disabled = Boolean(pose);
    }
    if (!pose) return;
    for (const [id, key] of CAMERA_POSE_FIELDS) {
        const field = qs(id);
        if (!field || document.activeElement === field) continue;
        const digits = key === 'yaw' || key === 'pitch' ? 1 : 3;
        field.value = Number(pose[key]).toFixed(digits);
    }
}

function syncLensFields() {
    const beat = state.document.beats[state.selectedIndex];
    const focal = qs('beatEditorFocal');
    const toggle = qs('beatEditorDof');
    const panel = qs('beatEditorDofPanel');
    const aperture = qs('beatEditorDofAperture');
    const focus = qs('beatEditorDofFocus');
    const dof = beat?.dof || null;
    if (focal && document.activeElement !== focal) focal.value = beat?.focal ? String(Math.round(beat.focal * 10) / 10) : '';
    if (toggle && document.activeElement !== toggle) toggle.checked = Boolean(dof);
    if (panel) panel.hidden = !dof;
    if (aperture && document.activeElement !== aperture) aperture.value = dof ? String(Math.round(dof.aperture * 10) / 10) : '';
    if (focus && document.activeElement !== focus) focus.value = Number.isFinite(dof?.focus) ? String(Math.round(dof.focus * 1000) / 1000) : '';
}

function commitLens({ history = false } = {}) {
    if (!state.document.beats[state.selectedIndex]) return;
    const focalText = String(qs('beatEditorFocal')?.value ?? '').trim();
    const focal = focalText === '' ? null : Number(focalText);
    if (focalText !== '' && !Number.isFinite(focal)) return;
    let dof = null;
    if (qs('beatEditorDof')?.checked) {
        const aperture = Number(qs('beatEditorDofAperture')?.value);
        const focusText = String(qs('beatEditorDofFocus')?.value ?? '').trim();
        dof = { aperture: Number.isFinite(aperture) && aperture > 0 ? aperture : 8 };
        if (focusText) {
            const focus = Number(focusText);
            if (!Number.isFinite(focus) || focus <= 0) return;
            dof.focus = focus;
        }
    }
    if (history) pushHistory();
    state.document = updateBeat(state.document, state.selectedIndex, { focal, dof });
    setDirty(true);
    serializeAndStore();
    const saved = state.document.beats[state.selectedIndex] || {};
    const beat = app.compiled?.beats?.[state.selectedIndex];
    if (beat) {
        if (saved.focal) beat.focal = saved.focal;
        else delete beat.focal;
        if (saved.dof) beat.dof = { ...saved.dof };
        else delete beat.dof;
        app.applyShot(beat);
    }
    syncLensFields();
}

function commitCameraPose(pose, { history = false } = {}) {
    if (!state.document.beats[state.selectedIndex]) return;
    app.scenePool?.freeLook?.setEnabled(false);
    if (history) pushHistory();
    state.document = updateBeat(state.document, state.selectedIndex, { cameraPose: pose });
    setDirty(true);
    serializeAndStore();
    const saved = state.document.beats[state.selectedIndex]?.cameraPose || null;
    const beat = app.compiled?.beats?.[state.selectedIndex];
    if (beat) {
        if (saved) beat.cameraPose = { ...saved };
        else delete beat.cameraPose;
        app.applyShot(beat);
    }
    syncCameraPoseFields();
}

function poseFromFields() {
    const pose = {};
    for (const [id, key] of CAMERA_POSE_FIELDS) {
        const raw = qs(id)?.value ?? '';
        if (raw.trim() === '') return null;
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        pose[key] = value;
    }
    return pose;
}

const app = new BeatPlayerApp(document, { elements: elementMap, bindEvents: false, loadSample: false });
// Keep the editor preview inspectable from DevTools and smoke tests, matching
// the existing window.beatPlayer hook on the standalone player page.
window.beatEditorApp = app;
setupFields();
applyPreviewSettings();
if (state.document.source) qs('beatEditorImportSource').value = state.document.source;
document.querySelectorAll('[data-field]').forEach(field => {
    const eventName = field.tagName === 'SELECT' ? 'change' : 'input';
    field.addEventListener(eventName, event => mutate(currentPatchFromEvent(event)));
});
qs('beatEditorNewBtn').addEventListener('click', addBeat); qs('beatEditorDeleteBtn').addEventListener('click', deleteBeat); qs('beatEditorDuplicateBtn').addEventListener('click', duplicateBeat); qs('beatEditorUpBtn').addEventListener('click', () => shiftBeat(-1)); qs('beatEditorDownBtn').addEventListener('click', () => shiftBeat(1)); qs('beatEditorUndoBtn').addEventListener('click', undo); qs('beatEditorRedoBtn').addEventListener('click', redo);
qs('beatEditorImportBtn').addEventListener('click', () => importSource(qs('beatEditorImportSource').value));
qs('beatEditorFile').addEventListener('change', async event => { const file = event.target.files?.[0]; if (file) importSource(await file.text()); event.target.value = ''; });
qs('beatEditorMotionBucket')?.addEventListener('change', renderMotionFiles);
qs('beatEditorMotionFile')?.addEventListener('change', event => { if (event.currentTarget.value) applyMotionFile(event.currentTarget.value); });
qs('beatEditorMotionName')?.addEventListener('change', event => { const value = event.currentTarget.value.trim(); if (value) applyMotionFile(value); });
qs('beatEditorFaceFile')?.addEventListener('change', event => mutate({ face: event.currentTarget.value }));
qs('beatEditorFreeLook')?.addEventListener('change', () => {
    const toggle = qs('beatEditorFreeLook');
    if (!toggle) return;
    if (!toggle.checked) {
        cameraPoseHistoryOpen = false;
        commitCameraPose(null, { history: true });
        return;
    }
    const pose = liveBeatCamera();
    if (!pose) {
        toggle.checked = false;
        setStatus('当前画面还没有 3D 摄像机，不能写入机位。', 'warn');
        return;
    }
    cameraPoseHistoryOpen = false;
    commitCameraPose(pose, { history: true });
});
qs('beatEditorFreeActor')?.addEventListener('change', () => {
    const toggle = qs('beatEditorFreeActor');
    if (!toggle) return;
    if (!toggle.checked) {
        actorPoseHistoryOpen = false;
        commitActorPose(null, { history: true });
        return;
    }
    const pose = liveActorPose();
    if (!pose) {
        toggle.checked = false;
        setStatus('当前画面还没有 3D 角色，不能写入站位。', 'warn');
        return;
    }
    actorPoseHistoryOpen = false;
    commitActorPose(pose, { history: true });
});
qs('beatEditorCameraMove')?.addEventListener('change', () => {
    const toggle = qs('beatEditorCameraMove');
    if (!toggle) return;
    if (!toggle.checked) {
        cameraMoveHistoryOpen = false;
        commitCameraMove(null, { history: true });
        return;
    }
    let pose = liveBeatCamera();
    if (!pose) {
        const beat = app.compiled?.beats?.[state.selectedIndex];
        if (beat) app.applyShot(beat);
        pose = liveBeatCamera();
    }
    if (!pose) {
        toggle.checked = false;
        setStatus('当前画面还没有 3D 摄像机，不能写入运动。', 'warn');
        return;
    }
    cameraMoveHistoryOpen = false;
    commitCameraMove({ from: pose, to: { ...pose }, duration: 1.2 }, { history: true });
});
qs('beatEditorCameraWalk')?.addEventListener('change', () => {
    const move = withCameraWalk(moveFromFields(CAMERA_MOVE_FIELDS));
    if (!move) return;
    cameraMoveHistoryOpen = false;
    commitCameraMove(move, { history: true });
});
qs('beatEditorActorMove')?.addEventListener('change', () => {
    const toggle = qs('beatEditorActorMove');
    if (!toggle) return;
    if (!toggle.checked) {
        actorMoveHistoryOpen = false;
        commitActorMove(null, { history: true });
        return;
    }
    const pose = liveActorPose();
    if (!pose) {
        toggle.checked = false;
        setStatus('当前画面还没有 3D 角色，不能写入运动。', 'warn');
        return;
    }
    actorMoveHistoryOpen = false;
    commitActorMove({ from: pose, to: { ...pose }, duration: 1.2 }, { history: true });
});
qs('beatEditorDof')?.addEventListener('change', () => {
    const toggle = qs('beatEditorDof');
    const aperture = qs('beatEditorDofAperture');
    if (toggle?.checked && aperture && !String(aperture.value).trim()) aperture.value = '8';
    lensHistoryOpen = false;
    commitLens({ history: true });
});
for (const id of ['beatEditorFocal', 'beatEditorDofAperture', 'beatEditorDofFocus']) {
    const field = qs(id);
    field?.addEventListener('input', () => {
        if (!lensHistoryOpen) {
            lensHistoryOpen = true;
            commitLens({ history: true });
            return;
        }
        commitLens();
    });
    field?.addEventListener('blur', () => { lensHistoryOpen = false; syncLensFields(); });
}
qs('beatEditorStageWidth').addEventListener('input', event => updatePreviewSetting('stageWidth', event.currentTarget.value));
qs('beatEditorDialogueWidth').addEventListener('input', event => updatePreviewSetting('dialogueWidth', event.currentTarget.value));
for (const [id] of CAMERA_POSE_FIELDS) {
    const field = qs(id);
    field?.addEventListener('input', () => {
        const pose = poseFromFields();
        if (!pose) return;
        if (!cameraPoseHistoryOpen) {
            cameraPoseHistoryOpen = true;
            commitCameraPose(pose, { history: true });
            return;
        }
        commitCameraPose(pose);
    });
    field?.addEventListener('blur', () => { cameraPoseHistoryOpen = false; syncCameraPoseFields(); });
}

const ACTOR_POSE_FIELDS = [['beatEditorActorX', 'x'], ['beatEditorActorY', 'y'], ['beatEditorActorZ', 'z'], ['beatEditorActorYaw', 'yaw']];
let actorPoseHistoryOpen = false;

function liveActorPose() {
    const beat = state.document.beats[state.selectedIndex];
    const idolId = beatActorId(beat?.speaker);
    const model = idolId ? app.director?.entries?.get(idolId)?.player?.model : null;
    return model ? actorPoseFromObject(model) : null;
}

function syncActorPoseFields() {
    const pose = state.document.beats[state.selectedIndex]?.actorPose || null;
    const toggle = qs('beatEditorFreeActor');
    const panel = qs('beatEditorFreeActorPanel');
    if (!toggle) return;
    if (document.activeElement !== toggle) toggle.checked = Boolean(pose);
    if (panel) panel.hidden = !pose;
    const position = qs('beatEditorPosition');
    if (position) position.disabled = Boolean(pose);
    if (!pose) {
        refreshActorGizmo();
        return;
    }
    for (const [id, key] of ACTOR_POSE_FIELDS) {
        const field = qs(id);
        if (!field || document.activeElement === field) continue;
        const digits = key === 'yaw' ? 1 : 3;
        field.value = Number(pose[key]).toFixed(digits);
    }
    refreshActorGizmo();
}

function commitActorPose(pose, { history = false, apply = true } = {}) {
    if (!state.document.beats[state.selectedIndex]) return;
    if (history) pushHistory();
    state.document = updateBeat(state.document, state.selectedIndex, { actorPose: pose });
    setDirty(true);
    serializeAndStore();
    const saved = state.document.beats[state.selectedIndex]?.actorPose || null;
    const beat = app.compiled?.beats?.[state.selectedIndex];
    if (apply && beat) {
        if (saved) beat.actorPose = { ...saved };
        else delete beat.actorPose;
        app.applyShot(beat);
    }
    syncActorPoseFields();
}

function actorPoseFromFields() {
    const pose = {};
    for (const [id, key] of ACTOR_POSE_FIELDS) {
        const raw = qs(id)?.value ?? '';
        if (raw.trim() === '') return null;
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        pose[key] = value;
    }
    return pose;
}
for (const [id] of ACTOR_POSE_FIELDS) {
    const field = qs(id);
    field?.addEventListener('input', () => {
        const pose = actorPoseFromFields();
        if (!pose) return;
        if (!actorPoseHistoryOpen) {
            actorPoseHistoryOpen = true;
            commitActorPose(pose, { history: true });
            return;
        }
        commitActorPose(pose);
    });
    field?.addEventListener('blur', () => { actorPoseHistoryOpen = false; syncActorPoseFields(); });
}

const CAMERA_MOVE_FIELDS = [['beatEditorCamMoveFromX', 'from', 'x', 3], ['beatEditorCamMoveFromY', 'from', 'y', 3], ['beatEditorCamMoveFromZ', 'from', 'z', 3], ['beatEditorCamMoveFromYaw', 'from', 'yaw', 1], ['beatEditorCamMoveFromPitch', 'from', 'pitch', 1], ['beatEditorCamMoveToX', 'to', 'x', 3], ['beatEditorCamMoveToY', 'to', 'y', 3], ['beatEditorCamMoveToZ', 'to', 'z', 3], ['beatEditorCamMoveToYaw', 'to', 'yaw', 1], ['beatEditorCamMoveToPitch', 'to', 'pitch', 1], ['beatEditorCamMoveDuration', 'duration', '', 1]];
const ACTOR_MOVE_FIELDS = [['beatEditorActorMoveFromX', 'from', 'x', 3], ['beatEditorActorMoveFromY', 'from', 'y', 3], ['beatEditorActorMoveFromZ', 'from', 'z', 3], ['beatEditorActorMoveFromYaw', 'from', 'yaw', 1], ['beatEditorActorMoveToX', 'to', 'x', 3], ['beatEditorActorMoveToY', 'to', 'y', 3], ['beatEditorActorMoveToZ', 'to', 'z', 3], ['beatEditorActorMoveToYaw', 'to', 'yaw', 1], ['beatEditorActorMoveDuration', 'duration', '', 1]];
let cameraMoveHistoryOpen = false;
let actorMoveHistoryOpen = false;

function syncMoveFields(move, toggleId, panelId, fields) {
    const toggle = qs(toggleId);
    const panel = qs(panelId);
    if (!toggle) return;
    if (document.activeElement !== toggle) toggle.checked = Boolean(move);
    if (panel) panel.hidden = !move;
    if (!move) return;
    for (const [id, group, key, digits] of fields) {
        const field = qs(id);
        if (!field || document.activeElement === field) continue;
        const value = group === 'duration' ? move.duration : move[group]?.[key];
        field.value = Number(value).toFixed(digits);
    }
}

function moveFromFields(fields) {
    const move = { from: {}, to: {} };
    for (const [id, group, key] of fields) {
        const raw = qs(id)?.value ?? '';
        if (raw.trim() === '') return null;
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        if (group === 'duration') move.duration = value;
        else move[group][key] = value;
    }
    if (!(move.duration > 0)) return null;
    return move;
}

function commitCameraMove(move, { history = false } = {}) {
    if (!state.document.beats[state.selectedIndex]) return;
    if (history) pushHistory();
    state.document = updateBeat(state.document, state.selectedIndex, { cameraMove: move });
    setDirty(true);
    serializeAndStore();
    const saved = state.document.beats[state.selectedIndex]?.cameraMove || null;
    const beat = app.compiled?.beats?.[state.selectedIndex];
    if (beat) {
        if (saved) {
            beat.cameraMove = { from: { ...saved.from }, to: { ...saved.to }, duration: saved.duration };
            if (saved.walk) beat.cameraMove.walk = true;
        } else delete beat.cameraMove;
        app.applyShot(beat);
    }
    syncCameraMoveFields();
}

function commitActorMove(move, { history = false } = {}) {
    if (!state.document.beats[state.selectedIndex]) return;
    if (history) pushHistory();
    state.document = updateBeat(state.document, state.selectedIndex, { actorMove: move });
    setDirty(true);
    serializeAndStore();
    const saved = state.document.beats[state.selectedIndex]?.actorMove || null;
    const beat = app.compiled?.beats?.[state.selectedIndex];
    if (beat) {
        if (saved) beat.actorMove = { from: { ...saved.from }, to: { ...saved.to }, duration: saved.duration };
        else delete beat.actorMove;
        app.applyShot(beat);
    }
    syncActorMoveFields();
}

function withCameraWalk(move) {
    if (!move) return null;
    if (qs('beatEditorCameraWalk')?.checked) move.walk = true;
    return move;
}

function syncCameraMoveFields() {
    const move = state.document.beats[state.selectedIndex]?.cameraMove || null;
    syncMoveFields(move, 'beatEditorCameraMove', 'beatEditorCameraMovePanel', CAMERA_MOVE_FIELDS);
    const walk = qs('beatEditorCameraWalk');
    if (walk && document.activeElement !== walk) walk.checked = Boolean(move?.walk);
}

function syncActorMoveFields() {
    syncMoveFields(state.document.beats[state.selectedIndex]?.actorMove || null, 'beatEditorActorMove', 'beatEditorActorMovePanel', ACTOR_MOVE_FIELDS);
}

function bindMoveInputs(fields, read, commit, historyFlag) {
    for (const [id] of fields) {
        const field = qs(id);
        field?.addEventListener('input', () => {
            const move = read();
            if (!move) return;
            if (!historyFlag.open) {
                historyFlag.open = true;
                commit(move, { history: true });
                return;
            }
            commit(move);
        });
        field?.addEventListener('blur', () => { historyFlag.open = false; });
    }
}
bindMoveInputs(CAMERA_MOVE_FIELDS, () => withCameraWalk(moveFromFields(CAMERA_MOVE_FIELDS)), commitCameraMove, { get open() { return cameraMoveHistoryOpen; }, set open(value) { cameraMoveHistoryOpen = value; } });
bindMoveInputs(ACTOR_MOVE_FIELDS, () => moveFromFields(ACTOR_MOVE_FIELDS), commitActorMove, { get open() { return actorMoveHistoryOpen; }, set open(value) { actorMoveHistoryOpen = value; } });

let actorGizmoMode = 'translate';
let actorGizmoHistory = false;
let actorGizmoOrigin = null;
let actorGizmoPlayer = null;
const actorGizmo = createActorPoseGizmo(qs('beatEditorStage'), {
    onDragStart() {
        actorGizmoOrigin = state.document.beats[state.selectedIndex]?.actorPose
            ? { ...state.document.beats[state.selectedIndex].actorPose }
            : null;
        actorGizmoHistory = false;
        speakerPlayer()?.attention?.hold(true);
        app.stopPoseMove();
    },
    onChange() {
        const pose = poseFromGizmo();
        if (!pose) return;
        if (!actorGizmoHistory) {
            actorGizmoHistory = true;
            commitActorPose(pose, { history: true, apply: false });
        } else {
            commitActorPose(pose, { apply: false });
        }
        speakerPlayer()?.renderFrame?.();
    },
    onDragEnd({ cancelled = false } = {}) {
        if (cancelled && actorGizmoHistory) state.undo.pop();
        actorGizmoHistory = false;
        const player = speakerPlayer();
        const pose = cancelled ? actorGizmoOrigin : poseFromGizmo();
        if (pose) commitActorPose(pose, { apply: true });
        player?.attention?.hold(false);
        player?.attention?.update?.(1);
        player?.renderFrame?.();
        actorGizmoOrigin = null;
    },
});

function speakerPlayer() {
    const beat = state.document.beats[state.selectedIndex];
    const idolId = beatActorId(beat?.speaker);
    return idolId ? app.director?.entries?.get(idolId)?.player || null : null;
}

function poseFromGizmo() {
    const player = speakerPlayer();
    const live = player?.model ? actorPoseFromObject(player.model) : null;
    if (!live) return null;
    const saved = state.document.beats[state.selectedIndex]?.actorPose;
    if (actorGizmoMode === 'translate') return { x: live.x, y: live.y, z: live.z, yaw: Number(saved?.yaw) || 0 };
    return { x: live.x, y: live.y, z: live.z, yaw: live.yaw - (player.attention?.lookYawDegrees?.() || 0) };
}

function setActorGizmoMode(mode) {
    actorGizmoMode = mode === 'rotate' ? 'rotate' : 'translate';
    actorGizmo.setMode(actorGizmoMode);
    qs('beatEditorActorGizmoMove')?.setAttribute('aria-pressed', String(actorGizmoMode === 'translate'));
    qs('beatEditorActorGizmoRotate')?.setAttribute('aria-pressed', String(actorGizmoMode === 'rotate'));
    speakerPlayer()?.renderFrame?.();
}

function refreshActorGizmo() {
    if (actorGizmo.dragging) return;
    const beat = state.document.beats[state.selectedIndex];
    const player = speakerPlayer();
    const active = Boolean(beat?.actorPose && player?.model && player?.camera && player?.renderer);
    if (actorGizmoPlayer && actorGizmoPlayer !== player) actorGizmoPlayer.afterRender = null;
    actorGizmoPlayer = active ? player : null;
    if (actorGizmoPlayer) actorGizmoPlayer.afterRender = () => actorGizmo.render(actorGizmoPlayer.renderer, actorGizmoPlayer.camera);
    actorGizmo.setEnabled(active, player?.model, player?.camera);
    if (active) player.renderFrame();
}

qs('beatEditorActorGizmoMove')?.addEventListener('click', () => setActorGizmoMode('translate'));
qs('beatEditorActorGizmoRotate')?.addEventListener('click', () => setActorGizmoMode('rotate'));
qs('beatEditorPreviewReset').addEventListener('click', () => { state.previewSettings = { ...DEFAULT_PREVIEW_SETTINGS }; savePreviewSettings(); applyPreviewSettings(); });
qs('beatEditorExportBtn').addEventListener('click', exportScript); qs('beatEditorBackBtn').addEventListener('click', returnToSandbox);
void loadMotionCatalog();
qs('beatEditorPlay').addEventListener('click', () => { qs('beatEditorAuto').checked = true; void app.togglePlay(); }); qs('beatEditorPrevious').addEventListener('click', () => { state.selectedIndex = Math.max(0, state.selectedIndex - 1); renderAll(); void app.goTo(state.selectedIndex, { autoplay: false }); }); qs('beatEditorNext').addEventListener('click', () => { state.selectedIndex = Math.min(state.document.beats.length - 1, state.selectedIndex + 1); renderAll(); void app.goTo(state.selectedIndex, { autoplay: false }); }); qs('beatEditorStop').addEventListener('click', () => app.stop()); qs('beatEditorAdvance').addEventListener('click', () => { state.selectedIndex = Math.min(state.document.beats.length - 1, state.selectedIndex + 1); renderAll(); void app.goTo(state.selectedIndex, { autoplay: false }); });
window.addEventListener('beforeunload', () => app.dispose?.(), { once: true });
renderAll(); void refreshPreview({ silent: false, needsResources: true });
