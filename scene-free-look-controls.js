import { LookDrag } from './scene-free-look.js?v=20261102-beat-camera-pose-v1';

export function createFreeLookControls(container, view) {
    const doc = container.ownerDocument;
    if (!doc.getElementById('beat-free-look-style')) {
        const link = doc.createElement('link'); link.id = 'beat-free-look-style'; link.rel = 'stylesheet';
        link.href = new URL('./scene-free-look.css?v=20261026-free-look-v1', import.meta.url).href;
        doc.head.append(link);
    }
    const tools = doc.createElement('div'); tools.className = 'beat-view-tools'; tools.hidden = true;
    const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.className = 'beat-view-toggle';
    const reset = doc.createElement('button'); reset.type = 'button'; reset.textContent = '回正'; reset.title = '回到当前剧情机位';
    const hint = doc.createElement('span'); hint.className = 'beat-view-hint'; hint.textContent = '拖动查看周围';
    tools.append(toggle, reset, hint);
    const surface = doc.createElement('div'); surface.className = 'beat-view-drag'; surface.hidden = true;
    surface.setAttribute('aria-hidden', 'true');
    container.append(surface, tools);
    const drag = new LookDrag(), listeners = [];
    const listen = (node, name, callback) => { node.addEventListener(name, callback); listeners.push(() => node.removeEventListener(name, callback)); };
    const cancel = () => {
        const id = drag.pointer?.id;
        drag.cancel(); surface.classList.remove('is-dragging');
        if (id != null && surface.hasPointerCapture?.(id)) surface.releasePointerCapture(id);
    };
    listen(toggle, 'click', event => { event.stopPropagation(); view.setEnabled(!view.enabled); });
    listen(reset, 'click', event => { event.stopPropagation(); view.recenter(); });
    listen(surface, 'pointerdown', event => {
        if (!view.enabled || event.button !== 0 || !drag.start(event.pointerId, event.clientX, event.clientY)) return;
        event.preventDefault(); event.stopPropagation();
        surface.setPointerCapture(event.pointerId);
        surface.classList.add('is-dragging');
    });
    listen(surface, 'pointermove', event => {
        const movement = drag.move(event.pointerId, event.clientX, event.clientY);
        if (!movement) return;
        event.preventDefault(); event.stopPropagation();
        const rect = surface.getBoundingClientRect();
        view.drag(...movement, rect.width, rect.height);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(surface, name, event => {
        if (drag.pointer?.id === event.pointerId) cancel();
    });
    // Embedded business players also listen for stage clicks. Exploring must
    // never advance a segment; the dialogue card above this surface still can.
    listen(surface, 'click', event => { event.preventDefault(); event.stopPropagation(); });
    listen(surface, 'dblclick', event => { event.preventDefault(); event.stopPropagation(); });
    listen(doc.defaultView, 'blur', cancel);
    listen(doc, 'keydown', event => {
        if (view.enabled && event.key === 'Escape') { cancel(); view.setEnabled(false); }
    });
    const update = () => {
        tools.hidden = !view.available; surface.hidden = !view.enabled;
        reset.hidden = !view.enabled; hint.hidden = !view.enabled;
        toggle.textContent = view.enabled ? '锁定视角' : '视角解锁';
        toggle.setAttribute('aria-pressed', String(view.enabled));
        toggle.title = view.enabled ? '恢复剧情机位' : '原地转动视角，查看3D环境';
        container.dataset.viewUnlocked = String(view.enabled);
        if (!view.enabled) cancel();
    };
    update();
    return { update, dispose() { cancel(); listeners.forEach(remove => remove()); tools.remove(); surface.remove(); delete container.dataset.viewUnlocked; } };
}
