import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// Screen-space handles for one actor. Move and rotate are alternate modes:
// the translate arrows and the yaw ring are never shown together.
export function createActorPoseGizmo(stage, { onChange, onDragStart, onDragEnd } = {}) {
    const overlay = new THREE.Scene();
    const control = new TransformControls(new THREE.PerspectiveCamera(), stage);
    control.setSpace('world');
    control.setSize(1.05);
    control.enabled = false;
    overlay.add(control);
    stage.removeEventListener('pointerdown', control._onPointerDown);
    stage.removeEventListener('pointermove', control._onPointerHover);
    stage.removeEventListener('pointerup', control._onPointerUp);

    let enabled = false;
    let mode = 'translate';
    let dragging = false;

    function applyMode() {
        const rotate = mode === 'rotate';
        control.setMode(rotate ? 'rotate' : 'translate');
        control.showX = !rotate;
        control.showY = true;
        control.showZ = !rotate;
    }

    function pointer(event, button = event.button) {
        const rect = stage.getBoundingClientRect();
        return {
            x: rect.width ? (event.clientX - rect.left) / rect.width * 2 - 1 : 0,
            y: rect.height ? -((event.clientY - rect.top) / rect.height) * 2 + 1 : 0,
            button,
        };
    }

    function finish(cancel) {
        if (!dragging) return;
        dragging = false;
        stage.style.touchAction = '';
        if (cancel && control.dragging) control.reset();
        if (control.dragging) control.pointerUp({ button: 0 });
        onDragEnd?.({ cancelled: Boolean(cancel) });
    }

    function onPointerDown(event) {
        if (!enabled || event.button !== 0 || dragging) return;
        if (event.target?.closest?.('.story-chrome, .beat-view-tools')) return;
        control.updateMatrixWorld(true);
        control.pointerHover(pointer(event));
        if (!control.axis) return;
        event.preventDefault();
        event.stopPropagation();
        control.pointerDown(pointer(event));
        dragging = Boolean(control.dragging);
        if (!dragging) return;
        onDragStart?.();
        stage.style.touchAction = 'none';
        stage.setPointerCapture?.(event.pointerId);
    }

    function onPointerMove(event) {
        if (!enabled) return;
        if (!dragging) {
            control.updateMatrixWorld(true);
            control.pointerHover(pointer(event));
            return;
        }
        control.pointerMove(pointer(event, -1));
    }

    function onPointerUp(event) {
        if (!dragging) return;
        if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
        finish(false);
    }

    function onKeyDown(event) {
        if (event.key === 'Escape' && dragging) {
            finish(true);
            event.preventDefault();
        }
    }

    const cancelPointer = () => finish(true);
    control.addEventListener('objectChange', () => { if (dragging) onChange?.(); });
    stage.addEventListener('pointerdown', onPointerDown, true);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('keydown', onKeyDown);
    applyMode();

    return {
        get dragging() { return dragging; },
        setMode(next) {
            const resolved = next === 'rotate' ? 'rotate' : 'translate';
            if (resolved === mode) return;
            if (dragging) finish(true);
            mode = resolved;
            applyMode();
        },
        setEnabled(value, object, camera) {
            value = Boolean(value && object && camera);
            if (camera) control.camera = camera;
            if (!value) {
                if (dragging) finish(false);
                control.detach();
                control.enabled = false;
                enabled = false;
                return;
            }
            enabled = true;
            control.enabled = true;
            if (control.object !== object) control.attach(object);
        },
        render(renderer, camera) {
            if (!enabled || !renderer || !camera) return;
            control.camera = camera;
            control.updateMatrixWorld(true);
            const previous = renderer.autoClear;
            try {
                renderer.autoClear = false;
                renderer.clearDepth();
                renderer.render(overlay, camera);
            } finally {
                renderer.autoClear = previous;
            }
        },
        dispose() {
            if (dragging) finish(false);
            control.detach();
            control.dispose();
            stage.removeEventListener('pointerdown', onPointerDown, true);
            stage.removeEventListener('pointermove', onPointerMove);
            stage.removeEventListener('pointerup', onPointerUp);
            stage.removeEventListener('pointercancel', cancelPointer);
            window.removeEventListener('keydown', onKeyDown);
        },
    };
}
