import { resourceStore } from './asset-runtime.js';

const mb = bytes => (Number(bytes || 0) / 1024 ** 2).toFixed(1);
export function resourceProgressText(progress = {}) {
    if (progress.phase === 'checking') return '正在检查本段资源与浏览器缓存…';
    if (progress.phase === 'preparing') return `正在加载模型、动作与场景，准备画面…${progress.task ? ' ' + progress.task : ''}`;
    if (progress.phase === 'ready') return '画面准备完成';
    if (progress.phase === 'error') return progress.message || '资源加载失败，请重试。';
    const percent = progress.downloadBytes ? Math.min(100, progress.receivedBytes / progress.downloadBytes * 100) : 100;
    return `下载 ${percent.toFixed(0)}% · ${mb(progress.receivedBytes)} / ${mb(progress.downloadBytes)} MB · 缓存复用 ${mb(progress.cachedBytes)} MB${progress.volatileFiles ? ' · 部分资源仅供本次使用' : ''}`;
}
export function createResourceLoading(host, retry) {
    const doc = host.ownerDocument;
    if (!doc.getElementById('mmd-resource-loading-style')) {
        const style = doc.createElement('style'); style.id = 'mmd-resource-loading-style';
        style.textContent = `.mmd-resource-loading{position:absolute;inset:0;z-index:80;display:grid;place-content:center;gap:18px;padding:24px;background:#6b9ff2;color:#fff;text-align:center;transition:opacity .25s;pointer-events:auto;font:14px/1.6 sans-serif}.mmd-resource-loading[hidden]{display:none}.mmd-resource-loading svg{width:68px;height:68px;margin:auto}.mmd-resource-loading svg path{transform-origin:50px 50px;animation:mmd-clock 2s linear infinite}.mmd-resource-loading progress{width:min(360px,70vw);height:7px;margin:auto;accent-color:white}.mmd-resource-loading button{border:1px solid #ffffffa0;border-radius:20px;background:#ffffff21;color:inherit;padding:7px 18px;cursor:pointer}.mmd-resource-loading small{max-width:440px;overflow-wrap:anywhere}.mmd-resource-loading [role=status]{color:#24364e;font-weight:650}.mmd-resource-settings{display:grid;gap:10px;padding:14px;border:1px solid #ffffff70;border-radius:12px}.mmd-resource-settings[hidden]{display:none}@keyframes mmd-clock{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.mmd-resource-loading svg path{animation:none}}`;
        doc.head.append(style);
    }
    const root = doc.createElement('div'); root.className = 'mmd-resource-loading'; root.hidden = true;
    root.innerHTML = `<small role="status" aria-live="polite"></small><svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" aria-hidden="true"><circle cx="50" cy="50" r="41"/><path d="M50 50V20M50 50L65 36"/></svg><strong>正在准备本段演出</strong><progress max="1"></progress><div><button class="retry" type="button" hidden>重试加载</button> <button class="settings" type="button">资源缓存</button></div><div class="mmd-resource-settings" hidden><label>缓存上限 <select><option value="268435456">256 MB</option><option value="536870912">512 MB</option><option value="1073741824">1 GB</option><option value="2147483648">2 GB</option><option value="4294967296">4 GB</option></select></label><small class="cache-info"></small><button class="clear" type="button">清理闲置资源</button><button class="persist" type="button">申请保留缓存</button></div>`;
    host.append(root);
    const status = root.querySelector('[role=status]'), bar = root.querySelector('progress'), retryButton = root.querySelector('.retry');
    retryButton.onclick = () => retry?.();
    const settings = root.querySelector('.mmd-resource-settings');
    const refresh = async () => {
        const stats = await resourceStore().stats();
        root.querySelector('.cache-info').textContent = `资源 ${mb(stats.bytes)} MB / 可用预算 ${mb(stats.effectiveBudget)} MB，${stats.files} 个文件${stats.persistent ? '' : ' · 当前浏览器仅临时保存'}`;
        root.querySelector('select').value = String(stats.budget);
    };
    root.querySelector('.settings').onclick = () => { settings.hidden = !settings.hidden; refresh(); };
    root.querySelector('select').onchange = async event => { await resourceStore().setBudget(Number(event.target.value)); refresh(); };
    root.querySelector('.clear').onclick = async () => { await resourceStore().clearUnused(); refresh(); };
    root.querySelector('.persist').onclick = async () => {
        const granted = await resourceStore().requestPersistence();
        root.querySelector('.cache-info').textContent = granted ? '浏览器已允许持久保存缓存。' : '浏览器未授予持久保存；仍按容量上限缓存。';
    };
    let disposed = false;
    return {
        update(progress) {
            if (disposed) return;
            root.hidden = false; root.style.opacity = '1';
            status.textContent = resourceProgressText(progress);
            retryButton.hidden = progress.phase !== 'error';
            if (progress.phase === 'downloading') bar.value = progress.downloadBytes ? Math.min(1, progress.receivedBytes / progress.downloadBytes) : 1;
            else bar.removeAttribute('value');
            doc.defaultView?.dispatchEvent(new CustomEvent('mmd-resource-progress', { detail: { ...progress, text: status.textContent } }));
        },
        ready() { if (!disposed) { root.hidden = true; doc.defaultView?.dispatchEvent(new CustomEvent('mmd-resource-progress', { detail: { phase: 'ready', text: '画面准备完成' } })); } },
        dispose() { disposed = true; root.remove(); },
    };
}
