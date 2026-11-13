// How one actor is presented on stage: who it is, whether it is shown and in
// which layer. Director and player code talk to this instead of a canvas, so
// the same calls work whether the actor has a canvas of its own or is drawn by
// a stage shared with every other actor.
export class ActorView {
    constructor({ idolId = '', costume = 'Default', canvas = null } = {}) {
        this.idolId = String(idolId || '');
        this.costume = String(costume || 'Default');
        this.canvas = canvas;
        this.visible = false;
        this.order = 0;
        this.offset = 0;
        if (canvas) {
            // Keep preloaded canvases in the layout so Three.js can compile
            // their shader programs during warmup. Visibility controls
            // presentation; `hidden` would collapse the render surface.
            canvas.hidden = false;
            canvas.dataset.idol = this.idolId;
            canvas.dataset.costume = this.costume;
            canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;visibility:hidden;opacity:0;';
        }
    }

    // Without a canvas the shared stage reads `visible` and `order` when it
    // composes a frame; the actor's runtime asks it to recompose.
    show(visible = true) {
        this.visible = Boolean(visible);
        if (!this.canvas) return;
        this.canvas.style.visibility = this.visible ? 'visible' : 'hidden';
        this.canvas.style.opacity = this.visible ? '1' : '0';
    }

    hide() {
        this.show(false);
    }

    // Layer among the visible actors; higher draws on top.
    setOrder(order) {
        this.order = Number(order) || 0;
        if (this.canvas) this.canvas.style.zIndex = String(this.order);
    }

    // Horizontal station offset in percent of the stage width. Only directors
    // that do not frame actors through the camera use it.
    setOffset(percent) {
        this.offset = Number(percent) || 0;
        if (this.canvas) this.canvas.style.transform = `translateX(${this.offset}%)`;
    }

    clearOffset() {
        this.offset = 0;
        if (!this.canvas) return;
        this.canvas.style.transition = 'none';
        this.canvas.style.transform = 'none';
    }

    dispose() {
        this.canvas?.remove();
        this.canvas = null;
        this.visible = false;
    }
}
