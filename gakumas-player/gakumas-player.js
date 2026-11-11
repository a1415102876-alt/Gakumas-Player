import { BeatPlayerApp } from '../beat-player.js?v=20261111-beat-breath-tts-v2';
import { setLivePictureOptions } from '../live-portrait.js?v=20261111-beat-breath-tts-v2';
import { createLocalChatBridge, normalizeChatReply, playerChatScene } from '../beat-chat.js?v=20261111-beat-breath-tts-v2';
import { createChatMemoryPanel } from './chat-memory-panel.js?v=20261107-chat-memory-v1';
import { mountResourceMonitor } from '../resource-monitor.js?v=20261108-resource-monitor-v1';
import { loadTavernWorldbook } from '../worldbook-scan.js?v=20261024-worldbook-v1';
import { applyFishTtsSettings, fishTtsStatus, resolveFishTtsSettings } from '../free-chat-tts.js?v=20261107-tts-domain-v1';
import { SANDBOX_CHAT_SETTINGS_KEY, buildSandboxChatSettings, mergeStoredChatSettings, readStoredFreeChatSettings } from '../sandbox/sandbox-chat.js?v=20261106-player-chat-v1';
import { aaLevel } from '../gakumas-aa.js?v=20261105-aa-level-v1';
import { SANDBOX_PICTURE_KEY, normalizeSandboxPicture } from '../sandbox/sandbox-picture.js?v=20261105-floor-ssr-v1';
import { buildWeirdContinuationPrompt, buildWeirdScriptPrompt, extractClosedBeatScript, prepareDirectBeatScript, WEIRD_SCRIPT_MODE } from '../sandbox/sandbox-weird-script.js?v=20261110-hkne-3d-v1';
import { appendBeatScript, GP_MODE, gpModeCopy, gpModeUsesAi, normalizeGpMode, readGpDraft, summarizeBeatScript, writeGpDraft } from './gakumas-player-model.js?v=20261108-chat-clock-v1';

const field = id => document.getElementById(id);
const EDITOR_RESULT_KEY = 'hatsuBeatEditorResult';
const CANCELLED_MESSAGE = '已取消闲聊生成';

let worldbook = [];
let worldbookPromise = null;

function selectedChatIdolName() {
  const select = field('chatIdolSelect');
  return select?.selectedOptions?.[0]?.textContent?.trim() || '藤田琴音';
}

const bridge = createLocalChatBridge({
  getSettings: () => ({ ...buildSandboxChatSettings(readStoredFreeChatSettings(), {
    idolName: selectedChatIdolName(),
    worldbookEntries: worldbook,
  }), producerProfile: chatMemory.profile() }),
  loadHistory: (idol, query) => chatMemory.context(idol, query),
  onExchange: (idol, exchange) => chatMemory.remember(idol, exchange),
  onHistoryError: (error, action) => chatMemory.reportError(error, action),
});

const chatMemory = createChatMemoryPanel({
  selectedIdol: selectedChatIdolName,
  isBusy: () => Boolean(app.chatState?.pending),
  onClear: idol => bridge.clear(idol),
  onError: message => showToast(message),
});

function readPicture() {
  try {
    return normalizeSandboxPicture(JSON.parse(localStorage.getItem(SANDBOX_PICTURE_KEY) || '{}'));
  } catch {
    return normalizeSandboxPicture(null);
  }
}

const picture = readPicture();
setLivePictureOptions(picture);
document.body.style.setProperty('--gp-dialogue-font-size', `${picture.dialogueFontSize}px`);
applyFishTtsSettings(resolveFishTtsSettings(), {
  onError: message => showToast(String(message || '角色语音播放失败')),
});

const app = new BeatPlayerApp(document, { loadSample: false, chatBridge: bridge });
app.chatBackground = () => playerChatScene().background;
app.chatContext = () => playerChatScene().context;
const resourceMonitor = mountResourceMonitor({
  app,
  button: field('gpPlayerResourceBtn'),
  panel: field('gpResourceMonitor'),
  closeButton: field('gpResourceCloseBtn'),
  summary: field('gpResourceSummary'),
  rows: field('gpResourceRows'),
  status: field('gpResourceStatus'),
});
app.resourceMonitor = resourceMonitor;
if (new URLSearchParams(location.search).get('gpu-debug') === '1') resourceMonitor.open();
const updateBeatPlayButton = app.updatePlayButton.bind(app);
app.updatePlayButton = () => {
  updateBeatPlayButton();
  syncAutoButton();
};

const view = {
  mode: GP_MODE.FULL,
  phase: 'compose',
  busy: false,
  controller: null,
  continuable: false,
  saveTimer: null,
  toastTimer: null,
};

function showToast(message) {
  const toast = field('gpToast');
  if (!toast) return;
  toast.textContent = String(message || '');
  toast.hidden = false;
  toast.classList.remove('is-visible');
  void toast.offsetWidth;
  toast.classList.add('is-visible');
  clearTimeout(view.toastTimer);
  view.toastTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
    view.toastTimer = setTimeout(() => { toast.hidden = true; }, 260);
  }, 2400);
}

function setStatus(id, message = '', tone = '') {
  const node = field(id);
  if (!node) return;
  node.textContent = String(message || '');
  node.dataset.tone = tone;
}

function persistDraft() {
  clearTimeout(view.saveTimer);
  view.saveTimer = setTimeout(() => {
    writeGpDraft({ mode: view.mode, input: field('gpInput')?.value, script: field('gpScript')?.value });
  }, 240);
}

function flushDraft() {
  clearTimeout(view.saveTimer);
  writeGpDraft({ mode: view.mode, input: field('gpInput')?.value, script: field('gpScript')?.value });
}

function syncSteps() {
  const hasScript = summarizeBeatScript(field('gpScript')?.value).count > 0;
  const current = view.phase === 'play' ? 'play' : (hasScript ? 'script' : 'input');
  const order = ['input', 'script', 'play'];
  document.querySelectorAll('.gp-steps [data-step]').forEach((item) => {
    const index = order.indexOf(item.dataset.step);
    const active = order.indexOf(current);
    item.classList.toggle('is-current', index === active);
    item.classList.toggle('is-done', index < active);
    if (index === active) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
}

function syncScriptSummary() {
  const script = field('gpScript');
  const summary = summarizeBeatScript(script?.value);
  const count = field('gpScriptCount');
  if (count) {
    count.textContent = `${summary.count} Beat`;
    count.classList.toggle('is-ready', summary.ready);
  }
  const play = field('gpPlayBtn');
  if (play) play.disabled = view.busy || !summary.count;
  const copy = field('gpCopyBtn');
  if (copy) copy.disabled = !String(script?.value || '').trim();
  const clear = field('gpClearBtn');
  if (clear) clear.disabled = view.busy || !String(script?.value || '').trim();
  const continueButton = field('gpContinueBtn');
  if (continueButton) {
    continueButton.hidden = !(view.continuable && gpModeUsesAi(view.mode) && summary.count);
    continueButton.disabled = view.busy;
  }
  if (!view.busy) setStatus('gpScriptStatus', summary.message, summary.hasOpenBeat ? 'warn' : (summary.ready ? 'ok' : ''));
  syncSteps();
  return summary;
}

function syncInputCount() {
  const input = field('gpInput');
  const count = field('gpInputCount');
  if (count) count.textContent = `${String(input?.value || '').length.toLocaleString('zh-CN')} 字`;
}

function syncMode() {
  const copy = gpModeCopy(view.mode);
  const ai = gpModeUsesAi(view.mode);
  const editor = view.mode === GP_MODE.EDITOR;
  const chat = view.mode === GP_MODE.CHAT;
  document.querySelectorAll('[data-gp-mode]').forEach((button) => {
    const selected = button.dataset.gpMode === view.mode;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-checked', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
    button.disabled = view.busy && !selected;
  });
  document.body.dataset.mode = view.mode;
  const inputCard = field('gpInputCard');
  const editorCard = field('gpEditorCard');
  const chatCard = field('gpChatCard');
  const scriptPanel = field('gpScriptPanel');
  if (inputCard) inputCard.hidden = !ai;
  if (editorCard) editorCard.hidden = !editor;
  if (chatCard) chatCard.hidden = !chat;
  if (scriptPanel) scriptPanel.hidden = chat;
  if (ai) {
    field('gpInputTitle').textContent = view.mode === GP_MODE.EXPAND ? '故事大纲' : '完整文案';
    field('gpInputEnglish').textContent = copy.english;
    field('gpInputSummary').textContent = copy.summary;
    const input = field('gpInput');
    input.placeholder = copy.placeholder;
    input.disabled = view.busy;
  }
  const generate = field('gpGenerateBtn');
  if (generate) {
    generate.classList.toggle('is-busy', view.busy);
    generate.querySelector('span').textContent = view.busy ? '取消生成' : copy.action;
  }
  const enterChatButton = field('gpEnterChatBtn');
  if (enterChatButton) {
    enterChatButton.disabled = view.busy;
    enterChatButton.querySelector('span').textContent = view.busy && chat ? '正在读取' : '进入教室';
  }
  const script = field('gpScript');
  if (script) script.readOnly = view.busy;
  ['gpScriptEditorBtn', 'gpOpenEditorBtn'].forEach((id) => {
    const button = field(id);
    if (button) button.disabled = view.busy;
  });
  syncScriptSummary();
}

function setMode(mode) {
  if (view.busy) return;
  const next = normalizeGpMode(mode);
  if (next !== view.mode) view.continuable = false;
  view.mode = next;
  setStatus('gpComposeStatus', '');
  syncMode();
  persistDraft();
}

function chatSettingsReady() {
  const stored = readStoredFreeChatSettings();
  return Boolean(String(stored.baseUrl || '').trim() && String(stored.model || '').trim());
}

async function ensureWorldbook() {
  if (worldbook.length) return worldbook;
  worldbookPromise ||= loadTavernWorldbook('初星学园').catch(() => []);
  const loaded = await worldbookPromise;
  worldbook = (Array.isArray(loaded) ? loaded : []).filter(entry => String(entry?.comment || '') !== '编年史');
  return worldbook;
}

async function generate({ continuation = false } = {}) {
  if (view.busy) {
    view.controller?.abort();
    return;
  }
  if (!gpModeUsesAi(view.mode)) return;
  const input = field('gpInput');
  const script = field('gpScript');
  const text = String(input?.value || '').trim();
  const existing = String(script?.value || '').trim();
  if (!continuation && !text) {
    setStatus('gpComposeStatus', view.mode === GP_MODE.EXPAND ? '先写下故事大纲。' : '先贴入完整文案。', 'warn');
    input?.focus();
    return;
  }
  if (!chatSettingsReady()) {
    setStatus('gpComposeStatus', '还没有填写 AI 接口，请先在设置里填写 API 地址和模型。', 'warn');
    openSettings();
    return;
  }
  const copy = gpModeCopy(view.mode);
  view.busy = true;
  view.controller = new AbortController();
  syncMode();
  setStatus('gpComposeStatus', continuation ? '正在续写后面的 Beat……' : copy.busy, 'busy');
  setStatus('gpScriptStatus', continuation ? '续写完成后会接在现有脚本后面。' : '生成完成后，完整的 Beat 脚本会出现在这里。', 'busy');
  document.body.classList.add('is-generating');
  const normalizeOptions = { preserveBackground: true, preserveStaging: true };
  const closedExisting = extractClosedBeatScript(existing);
  const expanding = view.mode === GP_MODE.EXPAND;
  const prompt = continuation
    ? buildWeirdContinuationPrompt({
      completedScript: closedExisting.script,
      completedCount: closedExisting.count,
      lastBackground: closedExisting.lastBackground,
      style: expanding,
    })
    : buildWeirdScriptPrompt({
      mode: expanding ? WEIRD_SCRIPT_MODE.EXPAND : WEIRD_SCRIPT_MODE.FULL,
      text,
    });
  const bridgeOptions = {
    timeoutMs: 300000,
    maxTokensLimit: 48000,
    useWorldbook: false,
    useHistory: false,
    systemPrompt: '',
    characterName: '',
    normalizeOptions,
    signal: view.controller.signal,
  };
  try {
    if (view.mode === GP_MODE.EXPAND) {
      bridgeOptions.useWorldbook = true;
      bridgeOptions.worldbookEntries = await ensureWorldbook();
    }
    const payload = await bridge.send(prompt, bridgeOptions);
    const raw = String(payload?.rawText || payload?.text || '');
    const normalized = normalizeChatReply(raw, normalizeOptions);
    if (!normalized.ok) {
      const error = new Error(normalized.error || '生成结果不是可播放的 Beat。');
      error.rawText = raw;
      throw error;
    }
    const closed = extractClosedBeatScript(normalized.script);
    if (!closed.count) throw Object.assign(new Error('没有收到完整的 Beat，请重试。'), { rawText: raw });
    script.value = continuation ? appendBeatScript(closedExisting.script, closed.script) : closed.script;
    view.continuable = closed.hasOpenBeat;
    setStatus('gpComposeStatus', continuation ? `已续写 ${closed.count} 个 Beat。` : `已生成 ${closed.count} 个 Beat，确认脚本后点击“开始播放”。`, 'ok');
    revealScriptPanel();
  } catch (error) {
    const aborted = error?.message === CANCELLED_MESSAGE || view.controller?.signal.aborted;
    const raw = String(error?.rawText || '');
    const closed = raw ? extractClosedBeatScript(raw) : { script: '', count: 0 };
    if (closed.count > 0) {
      script.value = continuation ? appendBeatScript(closedExisting.script, closed.script) : closed.script;
      view.continuable = true;
      setStatus('gpComposeStatus', `已收到 ${closed.count} 个完整 Beat，输出被截断，可以继续生成。`, 'warn');
      revealScriptPanel();
    } else if (aborted) {
      setStatus('gpComposeStatus', '已取消生成。', '');
    } else {
      setStatus('gpComposeStatus', String(error?.message || error || '生成失败，请重试。'), 'error');
    }
  } finally {
    view.controller = null;
    view.busy = false;
    document.body.classList.remove('is-generating');
    syncMode();
    persistDraft();
  }
}

function revealScriptPanel() {
  const panel = field('gpScriptPanel');
  if (!panel || window.matchMedia?.('(min-width: 1080px)').matches) return;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openEditor() {
  if (view.busy) return;
  flushDraft();
  sessionStorage.setItem('hatsuBeatEditorSource', String(field('gpScript')?.value || '').trim());
  sessionStorage.setItem('hatsuBeatEditorReturn', `${location.pathname}${location.search}`);
  location.href = './beat-editor.html?from=gakumas-player';
}

function consumeEditorResult() {
  const result = sessionStorage.getItem(EDITOR_RESULT_KEY);
  if (result == null) return false;
  sessionStorage.removeItem(EDITOR_RESULT_KEY);
  const script = field('gpScript');
  if (script) script.value = result;
  view.continuable = false;
  showToast('已从可视化编辑器载入脚本。');
  return true;
}

async function copyScript() {
  const script = field('gpScript');
  const text = String(script?.value || '');
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    script.select();
    document.execCommand?.('copy');
    script.setSelectionRange(0, 0);
  }
  showToast('Beat 脚本已复制。');
}

function clearScript() {
  if (view.busy) return;
  const script = field('gpScript');
  if (!script?.value.trim()) return;
  script.value = '';
  view.continuable = false;
  syncScriptSummary();
  persistDraft();
  showToast('脚本已清空。');
}

function resizeStage() {
  const entries = app.director?.allEntries?.();
  entries?.forEach(entry => entry?.player?.resize?.());
}

const CHROME_HIDE_MS = 1000;
const CHROME_REVEAL_PX = 96;
let chromeTimer = null;

function showPlayerChrome() {
  clearTimeout(chromeTimer);
  chromeTimer = null;
  field('gpPlayerChrome')?.classList.remove('is-hidden');
}

function schedulePlayerChromeHide() {
  if (chromeTimer != null) return;
  chromeTimer = setTimeout(() => {
    chromeTimer = null;
    if (!stageOpen()) return;
    const chrome = field('gpPlayerChrome');
    if (!chrome || chrome.contains(document.activeElement)) return;
    chrome.classList.add('is-hidden');
  }, CHROME_HIDE_MS);
}

function stageOpen() {
  return view.phase === 'play' || view.phase === 'chat';
}

function playerPointerInChrome(event) {
  const player = field('gpPlayer');
  const chrome = field('gpPlayerChrome');
  if (!player || !chrome || !stageOpen()) return;
  const fromTop = event.clientY - player.getBoundingClientRect().top;
  const inZone = fromTop <= CHROME_REVEAL_PX || chrome.contains(event.target);
  if (!inZone) {
    schedulePlayerChromeHide();
    return;
  }
  showPlayerChrome();
  if (event.pointerType === 'touch') schedulePlayerChromeHide();
}

function setPhase(phase) {
  view.phase = phase;
  document.body.dataset.phase = phase;
  const player = field('gpPlayer');
  if (player) {
    player.hidden = !stageOpen();
    player.classList.toggle('is-chat', phase === 'chat');
  }
  const chatBar = field('gpChatBar');
  if (chatBar) chatBar.hidden = phase !== 'chat';
  if (stageOpen()) {
    showPlayerChrome();
    schedulePlayerChromeHide();
  } else {
    clearTimeout(chromeTimer);
    chromeTimer = null;
    field('gpPlayerChrome')?.classList.remove('is-hidden');
  }
  syncSteps();
  requestAnimationFrame(resizeStage);
}

function syncAutoButton() {
  const button = field('gpAutoBtn');
  if (!button) return;
  const playing = Boolean(app.state.playing) && stageOpen();
  button.setAttribute('aria-pressed', playing ? 'true' : 'false');
  button.querySelector('span').textContent = playing ? '暂停' : '自动';
}

function toggleAutoplay() {
  if (!stageOpen()) return;
  if (app.state.playing) {
    app.clearTimer();
    app.state.playing = false;
    app.updatePlayButton();
    return;
  }
  const auto = field('beatAutoPlay');
  if (auto) auto.checked = true;
  app.state.playing = true;
  app.updatePlayButton();
  void app.goTo(app.state.current < 0 ? 0 : app.state.current, { autoplay: true });
}

async function play() {
  if (view.busy || view.phase === 'play') return;
  const prepared = prepareDirectBeatScript(field('gpScript')?.value);
  if (!prepared.ok) {
    setStatus('gpScriptStatus', prepared.error, 'error');
    field('gpScript')?.focus();
    return;
  }
  flushDraft();
  setPhase('play');
  app.stop();
  app.setDialogueRevealEnabled?.(false);
  field('beatSpeaker').textContent = '';
  field('beatText').textContent = '';
  app.elements.script.value = prepared.script;
  app.compile();
  if (!app.compiled.beats.length) {
    leavePlayer();
    setStatus('gpScriptStatus', '脚本没有可播放的 Beat，请检查格式。', 'error');
    return;
  }
  const ready = await app.preloadPromise.catch(() => false);
  if (view.phase !== 'play') return;
  if (!ready) {
    leavePlayer();
    setStatus('gpScriptStatus', 'Beat 资源没有准备好，请重试。', 'error');
    return;
  }
  app.setDialogueRevealEnabled?.(true);
  await app.goTo(0, { autoplay: false });
  field('beatDialogueCard')?.focus({ preventScroll: true });
}

function leavePlayer() {
  if (!stageOpen()) return;
  const chatting = view.phase === 'chat';
  app.setDialogueRevealEnabled?.(false);
  if (chatting && app.chatState?.active) app.exitChatMode();
  else app.stop();
  setPhase('compose');
  syncScriptSummary();
  (chatting ? field('gpEnterChatBtn') : field('gpPlayBtn'))?.focus({ preventScroll: true });
}

async function enterChat() {
  if (view.busy || view.phase === 'chat') return;
  if (view.mode !== GP_MODE.CHAT) setMode(GP_MODE.CHAT);
  view.busy = true;
  syncMode();
  setStatus('gpComposeStatus', '正在读取世界书……', 'busy');
  try {
    await ensureWorldbook();
  } finally {
    view.busy = false;
    syncMode();
  }
  if (view.mode !== GP_MODE.CHAT) return;
  setStatus('gpComposeStatus', '');
  setPhase('chat');
  app.enterChatMode(field('chatIdolSelect')?.value || 'kotone');
  app.fixedCameraOptions = { layout: 'home-home', zoom: 1 };
  field('chatInput')?.focus({ preventScroll: true });
}

function selectedAa() {
  return document.querySelector('input[name="gpAa"]:checked')?.value || readPicture().aa;
}

function writeAaNote(id) {
  const note = field('gpAaNote');
  const level = aaLevel(id);
  if (note) note.textContent = level.note;
}

function syncAaControls(id) {
  const level = aaLevel(typeof id === 'string' && aaLevel(id).id === id ? id : readPicture().aa);
  document.querySelectorAll('input[name="gpAa"]').forEach((input) => {
    input.checked = input.value === level.id;
  });
  writeAaNote(level.id);
}

function savePicture(aa = selectedAa()) {
  const stored = readPicture();
  const blur = field('gpMotionBlur');
  const picture = normalizeSandboxPicture({
    ...stored,
    aa,
    motionBlur: blur ? blur.checked : stored.motionBlur,
  });
  localStorage.setItem(SANDBOX_PICTURE_KEY, JSON.stringify(picture));
  setLivePictureOptions(picture);
  writeAaNote(picture.aa);
  return picture;
}

function openSettings() {
  const stored = readStoredFreeChatSettings();
  field('gpApiBase').value = stored.baseUrl || '';
  field('gpApiModel').value = stored.model || '';
  field('gpApiKey').value = stored.apiKey || '';
  const voice = resolveFishTtsSettings();
  field('gpTtsEnabled').checked = Boolean(voice.enabled);
  field('gpTtsProxy').value = voice.proxyUrl || '';
  field('gpTtsModel').value = voice.model || '';
  field('gpTtsKey').value = voice.apiKey || '';
  const picture = readPicture();
  syncAaControls(picture.aa);
  const blur = field('gpMotionBlur');
  if (blur) blur.checked = picture.motionBlur;
  setStatus('gpSettingsStatus', '');
  const dialog = field('gpSettings');
  if (dialog && !dialog.open) dialog.showModal();
}

function saveSettings() {
  const next = mergeStoredChatSettings(readStoredFreeChatSettings(), {
    baseUrl: field('gpApiBase').value,
    model: field('gpApiModel').value,
    apiKey: field('gpApiKey').value,
  }, { allowEmpty: true });
  localStorage.setItem(SANDBOX_CHAT_SETTINGS_KEY, JSON.stringify(next));
  const voice = applyFishTtsSettings({
    enabled: field('gpTtsEnabled').checked,
    proxyUrl: field('gpTtsProxy').value || '',
    model: field('gpTtsModel').value || '',
    apiKey: field('gpTtsKey').value || '',
  }, {
    persist: true,
    onError: message => showToast(String(message || '角色语音播放失败')),
  });
  field('gpTtsProxy').value = voice.proxyUrl || '';
  const picture = savePicture();
  const chatText = next.baseUrl && next.model ? 'AI 接口已记下。' : 'AI 接口未填写，扩写时再补也可以。';
  const aaText = `抗锯齿：${aaLevel(picture.aa).label}。`;
  const blurText = picture.motionBlur ? '运动模糊：开。' : '运动模糊：关。';
  setStatus('gpSettingsStatus', `设置已保存在本机。${chatText}${aaText}${blurText}${fishTtsStatus(voice)}`, 'ok');
}

function moveModeFocus(current, step) {
  const buttons = [...document.querySelectorAll('[data-gp-mode]')];
  const index = buttons.indexOf(current);
  const target = buttons[(index + step + buttons.length) % buttons.length];
  setMode(target.dataset.gpMode);
  target.focus();
}

document.querySelectorAll('[data-gp-mode]').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.gpMode));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); moveModeFocus(button, 1); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); moveModeFocus(button, -1); }
  });
});
field('gpGenerateBtn')?.addEventListener('click', () => { void generate(); });
field('gpContinueBtn')?.addEventListener('click', () => { void generate({ continuation: true }); });
field('gpOpenEditorBtn')?.addEventListener('click', openEditor);
field('gpScriptEditorBtn')?.addEventListener('click', openEditor);
field('gpCopyBtn')?.addEventListener('click', () => { void copyScript(); });
field('gpClearBtn')?.addEventListener('click', clearScript);
field('gpPlayBtn')?.addEventListener('click', () => { void play(); });
field('gpEnterChatBtn')?.addEventListener('click', () => { void enterChat(); });
field('gpHeaderChatBtn')?.addEventListener('click', () => { void enterChat(); });
field('gpChatBar')?.addEventListener('submit', (event) => { event.preventDefault(); });
field('gpPlayer')?.addEventListener('pointermove', playerPointerInChrome);
field('gpPlayer')?.addEventListener('pointerdown', playerPointerInChrome);
field('gpPlayerChrome')?.addEventListener('focusin', showPlayerChrome);
field('gpPlayerChrome')?.addEventListener('focusout', schedulePlayerChromeHide);
field('gpPlayerBackBtn')?.addEventListener('click', leavePlayer);
field('gpAutoBtn')?.addEventListener('click', (event) => {
  event.preventDefault();
  toggleAutoplay();
});
field('gpSettingsBtn')?.addEventListener('click', openSettings);
field('gpPlayerSettingsBtn')?.addEventListener('click', openSettings);
field('gpSettingsSaveBtn')?.addEventListener('click', saveSettings);
document.querySelectorAll('input[name="gpAa"]').forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) savePicture(input.value);
  });
});
field('gpMotionBlur')?.addEventListener('change', () => { savePicture(); });
field('gpInput')?.addEventListener('input', () => {
  syncInputCount();
  persistDraft();
});
field('gpScript')?.addEventListener('input', () => {
  view.continuable = view.continuable && summarizeBeatScript(field('gpScript').value).count > 0;
  syncScriptSummary();
  persistDraft();
});
field('gpInput')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault();
    void generate();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !stageOpen() || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  leavePlayer();
});
window.addEventListener('resize', resizeStage, { passive: true });
window.addEventListener('pagehide', () => {
  flushDraft();
  view.controller?.abort();
  resourceMonitor.dispose();
});

const draft = readGpDraft();
view.mode = draft.mode;
field('gpInput').value = draft.input;
field('gpScript').value = draft.script;
const loadedFromEditor = consumeEditorResult();
syncInputCount();
syncMode();
if (loadedFromEditor) {
  setStatus('gpComposeStatus', '');
  flushDraft();
  revealScriptPanel();
}

field('gpProducerProfileBtn')?.addEventListener('click', () => chatMemory.open('profile'));
field('gpChatHistoryBtn')?.addEventListener('click', () => chatMemory.open('history'));
field('gpPlayerChatMemoryBtn')?.addEventListener('click', () => chatMemory.open('history'));

window.gakumasPlayer = Object.freeze({
  app,
  bridge,
  generate,
  play,
  leavePlayer,
  setMode,
  openEditor,
  state: view,
});
