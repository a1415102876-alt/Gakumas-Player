function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${Math.round(bytes)} B`;
}

function createCell(document, value, className = '') {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = value;
    return cell;
}

function createMetric(document, label, value) {
    const item = document.createElement('div');
    item.className = 'gp-resource-metric';
    const name = document.createElement('span');
    name.textContent = label;
    const amount = document.createElement('strong');
    amount.textContent = formatBytes(value);
    item.append(name, amount);
    return item;
}

function renderRows(document, body, renderers) {
    const fragment = document.createDocumentFragment();
    const sorted = [...renderers].sort((left, right) => right.memory.estimatedBytes - left.memory.estimatedBytes);
    for (const renderer of sorted) {
        const row = document.createElement('tr');
        const identity = document.createElement('th');
        identity.scope = 'row';
        const name = document.createElement('strong');
        name.textContent = renderer.label;
        const state = document.createElement('small');
        state.textContent = `${renderer.kind}${renderer.present ? ' · 显示中' : ' · 隐藏'}`;
        identity.append(name, state);
        row.append(identity);
        row.append(createCell(document, formatBytes(renderer.memory.estimatedBytes), 'is-total'));
        row.append(createCell(document, formatBytes(renderer.memory.modelTextureBytes)));
        row.append(createCell(document, formatBytes(renderer.memory.sceneTextureBytes)));
        row.append(createCell(document, formatBytes(renderer.memory.plateTextureBytes)));
        row.append(createCell(document, formatBytes(renderer.memory.renderTargetBytes)));
        row.append(createCell(document, formatBytes(renderer.memory.shadowMapBytes)));
        row.append(createCell(document, formatBytes(renderer.memory.geometryBytes + renderer.memory.canvasBytes)));
        row.append(createCell(document, `${renderer.memory.rendererTextureCount} / ${renderer.memory.rendererGeometryCount}`, 'is-count'));
        fragment.append(row);
    }
    body.replaceChildren(fragment);
}

export function mountResourceMonitor({ app, button, panel, closeButton, summary, rows, status }) {
    const document = panel.ownerDocument;
    let interval = 0;

    const refresh = () => {
        const snapshot = app.getResourceSnapshot?.();
        const renderers = snapshot?.renderers || [];
        const totals = renderers.reduce((sum, renderer) => {
            for (const key of ['estimatedBytes', 'modelTextureBytes', 'sceneTextureBytes', 'plateTextureBytes', 'renderTargetBytes', 'shadowMapBytes']) {
                sum[key] += Number(renderer.memory?.[key]) || 0;
            }
            return sum;
        }, { estimatedBytes: 0, modelTextureBytes: 0, sceneTextureBytes: 0, plateTextureBytes: 0, renderTargetBytes: 0, shadowMapBytes: 0 });
        summary.replaceChildren(
            createMetric(document, 'GPU 总估算', totals.estimatedBytes),
            createMetric(document, '偶像模型贴图', totals.modelTextureBytes),
            createMetric(document, '3D 场景贴图', totals.sceneTextureBytes),
            createMetric(document, '2D 背景贴图', totals.plateTextureBytes),
            createMetric(document, '渲染目标', totals.renderTargetBytes),
            createMetric(document, '阴影贴图', totals.shadowMapBytes),
        );
        renderRows(document, rows, renderers);
        status.textContent = renderers.length
            ? `${renderers.length} 个 WebGL renderer · ${new Date(snapshot.timestamp).toLocaleTimeString()}`
            : '尚无已初始化的 WebGL renderer';
    };

    const close = () => {
        panel.hidden = true;
        button?.setAttribute('aria-expanded', 'false');
        clearInterval(interval);
        interval = 0;
    };

    const open = () => {
        panel.hidden = false;
        button?.setAttribute('aria-expanded', 'true');
        refresh();
        if (!interval) interval = setInterval(refresh, 1000);
    };

    const onClick = () => panel.hidden ? open() : close();
    button?.addEventListener('click', onClick);
    closeButton?.addEventListener('click', close);
    return {
        open,
        close,
        refresh,
        dispose() {
            close();
            button?.removeEventListener('click', onClick);
        },
    };
}
