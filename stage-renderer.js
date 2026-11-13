import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js?v=20261005-hair-outline-v1';
import { GakumasLookPass } from './gakumas-look.js?v=20261112-nvidia-sharpen-v1';
import { GakumasPostPass, disposePostTargets } from './gakumas-post.js?v=20261112-single-renderer-v1';
import { collectPostTargets, estimateRendererResources } from './gpu-resource-estimator.js?v=20261112-single-renderer-v1';
import { resetRendererCanvasViewport, shouldAccumulateStageLayers } from './stage-renderer-core.js?v=20261112-2d-plate-grade-v2';

// Everything that is bound to one WebGL context: the canvas, the renderer, the
// outline effect, the look pass and the post-processing targets.
//
// An actor (LivePortraitRuntime) owns its Scene, camera, lights, model and
// materials, and reaches the GPU only through the stage it is attached to.
//
// A private stage serves one actor on that actor's own canvas for the legacy
// embedding entry point. A shared stage serves every actor and the scene pool on one canvas: it runs
// the only render loop, clears the canvas once a frame and has each visible
// layer draw itself over the previous one. Scene textures, shader programs,
// post targets and the shadow map then exist once, and changing the speaker
// allocates nothing.
export class StageRenderer {
    constructor(canvas, { outline = {}, shared = false, container = null } = {}) {
        this.shared = Boolean(shared);
        this.ownsCanvas = !canvas;
        if (!canvas) {
            canvas = container.ownerDocument.createElement('canvas');
            canvas.dataset.stage = 'shared';
            // Above the flat background and stage dressing, below the vignette
            // and the dialogue chrome: the layer a focused actor canvas uses.
            canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;';
            container.append(canvas);
        }
        this.canvas = canvas;
        // Every draw path renders into a post/look target and reaches the canvas
        // as a full-screen quad, so a multisampled drawing buffer only cost VRAM.
        try {
            this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, stencil: true, powerPreference: 'high-performance' });
        } catch (error) {
            // Do not leave a dead canvas over the stage when the context fails.
            if (this.ownsCanvas) canvas.remove();
            throw error;
        }
        this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
        if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1;
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.outlineEffect = new OutlineEffect(this.renderer, {
            defaultThickness: outline.thickness,
            defaultColor: [0, 0, 0],
            defaultAlpha: outline.alpha,
            defaultKeepAlive: true,
        });
        this.lookPass = new GakumasLookPass(this.renderer);
        this.lookPass.enabled = true;
        this.lookPass.layered = this.shared;
        this.postTargets = {};
        this.postPasses = new Set();
        // A private stage has exactly one view, so it carries that view's pass.
        this.postPass = this.shared ? null : this.createPostPass();
        this.actors = new Set();
        this.backgroundLayer = null;
        this.backgroundPost = null;
        this.backgroundVisible = false;
        this.backgroundSceneId = null;
        this.backgroundPlate = null;
        this.backgroundPlateTexture = null;
        this.backgroundPlateMaterial = null;
        this.backgroundPlateScene = null;
        this.backgroundPlateCamera = null;
        this.accumulating = false;
        this.accumulationTarget = null;
        this.accumulationOutput = null;
        this.accumulationType = THREE.UnsignedByteType;
        this.accumulationMaterial = new THREE.ShaderMaterial({
            uniforms: { gkSource: { value: null } },
            vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
            fragmentShader: 'uniform sampler2D gkSource; varying vec2 vUv; void main(){gl_FragColor=texture2D(gkSource,vUv);}',
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            transparent: true,
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
        });
        this.accumulationScene = new THREE.Scene();
        this.accumulationCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.accumulationMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.accumulationMaterial);
        this.accumulationMesh.frustumCulled = false;
        this.accumulationScene.add(this.accumulationMesh);
        this.shadowMaps = new Map();
        this.scratch = null;
        this.composing = false;
        // Hidden prewarm draws are only used to compile programs and upload
        // resources. Keep the shared renderer in a tiny framebuffer while one
        // is running so every post target follows that size instead of the
        // visible canvas dimensions.
        this.hiddenRendering = false;
        this.pendingCompose = false;
        // Optional editor/UI overlay rendered after all stage layers have been
        // presented.  Shared actors otherwise draw their `afterRender` hooks
        // into an intermediate post-processing target, which would blur or
        // color-grade editor controls along with the scene.
        this.afterCompose = null;
        this.frameId = 0;
        this.contextLost = false;
        this.handleContextLost = event => {
            // Three's WebGLRenderer also listens to this event. Calling
            // preventDefault keeps the browser eligible to restore the
            // context instead of permanently losing the shared stage.
            event?.preventDefault?.();
            this.contextLost = true;
            if (this.frameId) cancelAnimationFrame(this.frameId);
            this.frameId = 0;
            this.pendingCompose = false;
            for (const pass of this.postPasses) pass.resetHistory = true;
        };
        this.handleContextRestored = () => {
            if (this.disposed) return;
            this.contextLost = false;
            this.renderer?.resetState?.();
            for (const pass of this.postPasses) {
                pass.resetHistory = true;
                pass.velocityMemory = new WeakMap();
            }
            this.syncSize();
            // A restore can happen while no actor has an animation loop (for
            // example while a hidden dialogue line is being prepared), so an
            // explicit invalidation is required to put the first frame back.
            if (this.shared) {
                this.invalidate();
                this.startLoop();
            }
        };
        this.canvas.addEventListener?.('webglcontextlost', this.handleContextLost, false);
        this.canvas.addEventListener?.('webglcontextrestored', this.handleContextRestored, false);
        this.disposed = false;
    }

    // One pass per view. On a shared stage they all build their frames in the
    // same scratch targets and keep only their own TAA history.
    createPostPass() {
        const pass = new GakumasPostPass(this.renderer, { keepAlpha: true, targets: this.shared ? this.postTargets : null });
        pass.enabled = true;
        pass.setModule('taa', true);
        pass.layered = this.shared;
        this.postPasses.add(pass);
        return pass;
    }

    releasePostPass(pass) {
        if (!pass || !this.postPasses.delete(pass)) return;
        pass.dispose();
    }

    attach(actor) {
        this.actors.add(actor);
    }

    detach(actor) {
        this.actors.delete(actor);
        this.invalidate();
    }

    // Every actor's shadow light renders into the same map: three redraws it at
    // the start of each actor's own render call.
    bindShadowMap(light) {
        const shadow = light?.shadow;
        if (!shadow) return;
        const size = shadow.mapSize.x;
        let map = this.shadowMaps.get(size);
        if (!map) {
            map = new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
            map.texture.name = `stage.shadowMap.${size}`;
            this.shadowMaps.set(size, map);
        }
        if (shadow.map !== map) {
            shadow.map = map;
            shadow.camera.updateProjectionMatrix();
        }
    }

    syncSize() {
        const canvas = this.canvas;
        if (!canvas || !this.renderer) return null;
        const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 0;
        const height = canvas.clientHeight || canvas.parentElement?.clientHeight || 0;
        if (!width || !height) return null;
        const pixelRatio = this.renderer.getPixelRatio();
        if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) {
            this.renderer.setSize(width, height, false);
        }
        return { width, height };
    }

    // Three.js keeps the viewport and scissor rectangle when switching
    // between the shared canvas and intermediate render targets.  A previous
    // post pass can therefore leave a smaller rectangle active; clearing and
    // drawing the next frame would then affect only the upper-left part of
    // the canvas, leaving the old scene visible around a custom background.
    // Always restore the complete drawing buffer before touching the visible
    // canvas (and after selecting a target whose size matches it).
    resetCanvasViewport() {
        resetRendererCanvasViewport(this.renderer, this.canvas);
    }

    isVisible(actor) {
        return Boolean(actor.ready && !actor.paused && actor.view?.visible !== false);
    }

    visibleActors() {
        return [...this.actors].filter(actor => this.isVisible(actor))
            .sort((a, b) => (a.view?.order || 0) - (b.view?.order || 0));
    }

    setBackgroundPlate(image, cover = null) {
        if (!this.shared) return;
        if (!image?.width || !image?.height) {
            this.backgroundPlate = null;
            this.backgroundPlateTexture?.dispose();
            this.backgroundPlateTexture = null;
            this.backgroundPlateMaterial?.dispose();
            this.backgroundPlateMaterial = null;
            this.backgroundPlateScene = null;
            this.invalidate();
            return;
        }
        // Three r152 allocates immutable storage sized to the first image.
        // Swapping `.image` to a different-sized background only overwrites
        // the top-left corner and leaves the previous scene around it, so a
        // new image always gets a new texture.
        if (this.backgroundPlateTexture && this.backgroundPlateTexture.image !== image) {
            this.backgroundPlateTexture.dispose();
            this.backgroundPlateTexture = null;
        }
        if (!this.backgroundPlateTexture) {
            this.backgroundPlateTexture = new THREE.Texture(image);
            this.backgroundPlateTexture.colorSpace = THREE.SRGBColorSpace;
            this.backgroundPlateTexture.flipY = false;
            this.backgroundPlateTexture.generateMipmaps = false;
            this.backgroundPlateTexture.minFilter = THREE.LinearFilter;
            this.backgroundPlateTexture.magFilter = THREE.LinearFilter;
            this.backgroundPlateTexture.needsUpdate = true;
        }
        if (!this.backgroundPlateMaterial) {
            this.backgroundPlateMaterial = new THREE.ShaderMaterial({
                uniforms: { gkPlate: { value: this.backgroundPlateTexture }, gkCover: { value: new THREE.Vector4(1, 1, 0, 0) } },
                vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
                fragmentShader: 'uniform sampler2D gkPlate; uniform vec4 gkCover; varying vec2 vUv; void main(){vec2 uv=vec2(vUv.x,1.0-vUv.y)*gkCover.xy+gkCover.zw; gl_FragColor=vec4(texture2D(gkPlate,clamp(uv,vec2(0.0),vec2(1.0))).rgb,1.0);}',
                depthTest: false, depthWrite: false, toneMapped: false,
            });
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.backgroundPlateMaterial);
            mesh.frustumCulled = false;
            this.backgroundPlateScene = new THREE.Scene();
            this.backgroundPlateScene.add(mesh);
            this.backgroundPlateCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        }
        this.backgroundPlateMaterial.uniforms.gkPlate.value = this.backgroundPlateTexture;
        if (cover) {
            // Accept the plain cover object returned by beat-player-core as
            // well as a THREE.Vector4. Keeping this boundary data-only avoids
            // making the player import Three.js just to place a 2D plate.
            const value = cover.isVector4 ? cover : {
                x: cover.x ?? cover.scaleX ?? 1,
                y: cover.y ?? cover.scaleY ?? 1,
                z: cover.z ?? cover.offsetX ?? 0,
                w: cover.w ?? cover.offsetY ?? 0,
            };
            this.backgroundPlateMaterial.uniforms.gkCover.value.set(value.x, value.y, value.z, value.w);
        }
        this.backgroundPlate = true;
        this.invalidate();
    }

    drawBackgroundPlate() {
        if (!this.backgroundPlate || !this.backgroundPlateScene || !this.renderer) return;
        if (!this.accumulating) {
            // A flat 2D plate used to be drawn straight to the canvas. That
            // bypassed the same LookPass used by actor layers, so a frame with
            // no visible actor looked darker than the identical frame after an
            // actor was added. Render the plate through the shared pass so its
            // saturation, warmth and output encoding are identical in both
            // cases. The pass also restores the full canvas viewport when it
            // presents the result, which avoids stale sub-viewport remnants
            // around a newly scaled image.
            this.lookPass.presentPlate(
                this.backgroundPlateTexture,
                this.backgroundPlateMaterial.uniforms.gkCover.value,
            );
            return;
        }

        // Accumulation defers the final LookPass until all actor layers have
        // been blended. Keep the plate in that composition target so it
        // receives exactly one final grade with the rest of the frame.
        const autoClear = this.renderer.autoClear;
        this.renderer.autoClear = false;
        this.renderer.setRenderTarget(this.accumulationTarget);
        this.renderer.setScissorTest(false);
        this.renderer.render(this.backgroundPlateScene, this.backgroundPlateCamera);
        this.renderer.autoClear = autoClear;
    }

    renderActorLayer(actor, draw) {
        const pass = actor?.postPass;
        if (!pass || typeof draw !== 'function') return;
        // Render into the pass target first, then source-over the resolved
        // texture over the already composed 2D plate and background.
        const source = pass.renderLayer(draw, actor.camera, {
            velocityRoot: actor.scene || null,
        });
        if (source?.isTexture) this.lookPass.presentTexture(source);
        this.layerStarted = true;
    }

    postCompositionKey(pass) {
        if (!pass) return null;
        try {
            return JSON.stringify({
                hdr: pass.usesSceneHDR,
                modules: Object.fromEntries(Object.entries(pass.modules || {}).filter(([name]) => name !== 'taa' && name !== 'fxaa')),
                settings: pass.settings || null,
                depthOfField: pass.depthOfField || null,
            });
        } catch {
            return null;
        }
    }

    canAccumulate(layers) {
        const passes = layers.map(actor => actor?.postPass);
        if (passes.some(pass => !pass?.active)) return false;
        // A configured shared background is part of the composed image even
        // though its callback can return no texture while hidden. Require its
        // pass to participate in compatibility checks whenever it is present.
        const hasBackground = Boolean(this.backgroundLayer && this.backgroundVisible);
        const background = hasBackground ? this.backgroundPost : null;
        if (hasBackground && !background?.active) return false;
        for (const actor of layers) {
            const pass = actor?.postPass;
            if (pass?.usesSceneHDR && (!actor.stageScene?.sidecar?.scene
                || pass.settings?.sceneId !== actor.stageScene.sidecar.scene)) return false;
        }
        if (background?.usesSceneHDR && (!this.backgroundSceneId
            || background.settings?.sceneId !== this.backgroundSceneId)) return false;
        if (!passes.length && !background) return false;
        const all = [...(background ? [background] : []), ...passes];
        const key = this.postCompositionKey(all[0]);
        if (key == null || !all.every(pass => this.postCompositionKey(pass) === key)) return false;
        // `usesSceneHDR` describes scene grading, while `color` describes the
        // actual per-view storage format. Ungraded views on an HDR-capable
        // renderer still contain linear half-float values; blending them into
        // an 8-bit target would clamp highlights before the final pass.
        const colorType = all[0].color?.texture?.type;
        if (!all.every(pass => pass.color?.texture?.type === colorType)) return false;
        const floatingPoint = colorType === THREE.HalfFloatType || colorType === THREE.FloatType;
        if (floatingPoint && (!this.renderer.capabilities?.isWebGL2
            || typeof this.renderer.extensions?.has !== 'function'
            || !this.renderer.extensions.has('EXT_float_blend'))) return false;
        this.accumulationType = colorType;
        // A flat 2D plate is already resolved in canvas space by
        // drawBackgroundPlate(). Keeping it out of the accumulation target
        // makes the no-actor frame and the actor-over-plate frame use exactly
        // the same LookPass path. 3D scene backgrounds still use accumulation.
        return shouldAccumulateStageLayers({
            hasFlatPlate: Boolean(this.backgroundPlate),
            compatible: true,
        });
    }

    ensureAccumulationTargets() {
        this.accumulationTarget ||= new THREE.WebGLRenderTarget(1, 1, {
            type: this.accumulationType,
            depthBuffer: false,
            stencilBuffer: false,
        });
        this.accumulationOutput ||= new THREE.WebGLRenderTarget(1, 1, {
            type: this.accumulationType,
            depthBuffer: false,
            stencilBuffer: false,
        });
        const width = this.canvas.width || 1;
        const height = this.canvas.height || 1;
        if (this.accumulationTarget.texture.type !== this.accumulationType) {
            this.accumulationTarget.dispose();
            this.accumulationTarget = null;
        }
        if (this.accumulationOutput.texture.type !== this.accumulationType) {
            this.accumulationOutput.dispose();
            this.accumulationOutput = null;
        }
        if (!this.accumulationTarget || !this.accumulationOutput) return this.ensureAccumulationTargets();
        if ('colorSpace' in this.accumulationTarget.texture) {
            this.accumulationTarget.texture.colorSpace = this.accumulationType === THREE.HalfFloatType
                ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
            this.accumulationOutput.texture.colorSpace = this.accumulationTarget.texture.colorSpace;
        }
        this.accumulationTarget.setSize(width, height);
        this.accumulationOutput.setSize(width, height);
    }

    accumulateTexture(texture) {
        if (!this.accumulating || !texture) return;
        this.accumulationMaterial.uniforms.gkSource.value = texture;
        const previous = this.renderer.autoClear;
        this.renderer.autoClear = false;
        this.renderer.setRenderTarget(this.accumulationTarget);
        try {
            this.renderer.render(this.accumulationScene, this.accumulationCamera);
        } finally {
            this.renderer.autoClear = previous;
        }
    }

    finishAccumulation(finalPass) {
        if (!this.accumulating || !finalPass || !this.accumulationTarget) return;
        const output = finalPass.renderCaptured(this.accumulationTarget.texture, this.accumulationOutput);
        this.renderer.setRenderTarget(null);
        this.lookPass.presentTexture(output);
    }

    finishActorLayers() {
        // Layers are presented as they are rendered. Keep this hook for
        // callers that used the old deferred-composite API.
        this.layerStarted = false;
    }

    setPresentTarget(target) {
        this.lookPass.presentTarget = target;
        for (const pass of this.postPasses) pass.presentTarget = target;
    }

    getResourceSnapshot({ sceneTextureBytes = 0 } = {}) {
        const renderTargetRefs = new Set();
        for (const pass of this.postPasses) {
            for (const target of collectPostTargets(pass)) renderTargetRefs.add(target);
        }
        if (this.accumulationTarget) renderTargetRefs.add(this.accumulationTarget);
        if (this.accumulationOutput) renderTargetRefs.add(this.accumulationOutput);
        for (const target of collectPostTargets(null, this.lookPass)) renderTargetRefs.add(target);
        return {
            label: '共享舞台',
            kind: '共享 WebGL renderer',
            present: this.visibleActors().length > 0,
            memory: estimateRendererResources({
                renderer: this.renderer,
                lookPass: this.lookPass,
                sceneTextureBytes,
                renderTargetRefs,
                shadowMapRefs: this.shadowMaps.values(),
                three: THREE,
            }),
        };
    }

    getPerformanceSnapshot() {
        const render = this.renderer?.info?.render || {};
        const memory = this.renderer?.info?.memory || {};
        return {
            calls: Number(render.calls) || 0,
            triangles: Number(render.triangles) || 0,
            points: Number(render.points) || 0,
            lines: Number(render.lines) || 0,
            geometries: Number(memory.geometries) || 0,
            textures: Number(memory.textures) || 0,
            pixelRatio: Number(this.renderer?.getPixelRatio?.()) || 0,
            width: Number(this.renderer?.domElement?.width) || 0,
            height: Number(this.renderer?.domElement?.height) || 0,
        };
    }

    // Draw one frame of the whole stage. `drawActor` is how each visible actor
    // contributes its layer: the loop advances and draws, a redraw only draws.
    compose(drawActor = actor => actor.renderFrame()) {
        if (!this.shared || this.disposed || this.contextLost || this.composing || !this.renderer) return;
        this.composing = true;
        try {
            this.syncSize();
            const actors = this.visibleActors();
            if (this.renderer?.info) {
                // Aggregate renderer counters only while at least one visible
                // actor requests diagnostics. Otherwise preserve Three's
                // default per-render reset behavior and avoid stale totals.
                const monitoring = actors.some(actor => actor.performanceMonitor?.enabled);
                this.renderer.info.autoReset = !monitoring;
                if (monitoring) this.renderer.info.reset();
            }
            this.accumulating = this.canAccumulate(actors);
            if (this.accumulating) this.ensureAccumulationTargets();
            this.renderer.setRenderTarget(null);
            this.resetCanvasViewport();
            this.renderer.clear(true, true, true);
            if (this.accumulating) {
                this.renderer.setRenderTarget(this.accumulationTarget);
                this.renderer.setScissorTest(false);
                this.renderer.clear(true, false, false);
            }
            this.drawBackgroundPlate();
            const background = this.backgroundLayer?.();
            // Shared scene backgrounds return their captured frame so the
            // stage can composite it in the same order as the 2D plate and
            // character layers. Keep legacy callbacks that draw directly.
            if (background?.isTexture) {
                if (this.accumulating) this.accumulateTexture(background);
                else this.lookPass.presentTexture(background);
            }
            this.layerStarted = false;
            for (const actor of actors) drawActor(actor);
            if (this.accumulating) this.finishAccumulation(this.backgroundPost || actors[0]?.postPass);
            this.finishActorLayers();
            if (this.afterCompose) {
                // Composition paths may leave a shared intermediate target
                // bound. UI overlays must always land on the visible canvas.
                this.renderer.setRenderTarget(null);
                this.afterCompose(this.renderer, this.canvas);
            }
        } finally {
            this.accumulating = false;
            this.composing = false;
        }
    }

    // Redraw before the next paint. Several actors change state while a Beat
    // flips; they all land in one composition.
    invalidate() {
        if (!this.shared || this.disposed || this.pendingCompose) return;
        this.pendingCompose = true;
        queueMicrotask(() => {
            this.pendingCompose = false;
            this.compose();
        });
    }

    // Run a layer's full draw without touching the canvas: compiles its shader
    // programs and uploads its textures while it is still off camera.
    drawHidden(draw) {
        if (!this.shared || this.disposed || this.contextLost || this.composing || !this.renderer) return;
        this.scratch ||= new THREE.WebGLRenderTarget(4, 4);
        const renderer = this.renderer;
        const previousSize = renderer.getSize(new THREE.Vector2());
        const previousTarget = renderer.getRenderTarget();
        const previousViewport = renderer.getViewport(new THREE.Vector4());
        const previousScissor = renderer.getScissor(new THREE.Vector4());
        const previousScissorTest = renderer.getScissorTest();
        const previousAutoClear = renderer.autoClear;
        const previousHiddenRendering = this.hiddenRendering;
        this.composing = true;
        this.hiddenRendering = true;
        // A hidden frame has no visible pixels. Four logical pixels are
        // enough to compile every material while keeping TAA/history/bloom
        // allocations bounded on low-VRAM GPUs.
        renderer.setSize(4, 4, false);
        this.scratch.setSize(4, 4);
        this.setPresentTarget(this.scratch);
        try {
            draw();
        } finally {
            this.setPresentTarget(null);
            renderer.setRenderTarget(previousTarget || null);
            renderer.setSize(previousSize.x, previousSize.y, false);
            renderer.setViewport(previousViewport);
            renderer.setScissor(previousScissor);
            renderer.setScissorTest(previousScissorTest);
            renderer.autoClear = previousAutoClear;
            this.hiddenRendering = previousHiddenRendering;
            // The visible canvas may have changed while the hidden draw was
            // running. Reconcile its drawing buffer and restore the complete
            // canvas viewport before the next presented frame.
            this.syncSize();
            this.resetCanvasViewport();
            this.composing = false;
        }
    }

    startLoop() {
        if (!this.shared || this.frameId || this.disposed) return;
        const tick = () => {
            this.frameId = 0;
            // Keep running while any actor is live; one that is not shown yet
            // may be revealed without another startLoop() call.
            if (this.disposed || ![...this.actors].some(actor => actor.ready && !actor.paused)) return;
            this.frameId = requestAnimationFrame(tick);
            this.compose(actor => actor.runFrame());
        };
        this.frameId = requestAnimationFrame(tick);
    }

    dispose() {
        this.disposed = true;
        this.canvas?.removeEventListener?.('webglcontextlost', this.handleContextLost, false);
        this.canvas?.removeEventListener?.('webglcontextrestored', this.handleContextRestored, false);
        if (this.frameId) cancelAnimationFrame(this.frameId);
        this.frameId = 0;
        this.actors.clear();
        this.backgroundLayer = null;
        this.backgroundPost = null;
        this.backgroundSceneId = null;
        this.afterCompose = null;
        this.backgroundVisible = false;
        this.backgroundPlateTexture?.dispose();
        this.backgroundPlateMaterial?.dispose();
        this.backgroundPlateScene?.traverse(object => object.geometry?.dispose());
        this.backgroundPlateTexture = null;
        this.backgroundPlateMaterial = null;
        this.backgroundPlateScene = null;
        this.backgroundPlateCamera = null;
        this.lookPass?.dispose();
        this.lookPass = null;
        for (const pass of this.postPasses) pass.dispose();
        this.postPasses.clear();
        this.postPass = null;
        disposePostTargets(this.postTargets);
        for (const map of this.shadowMaps.values()) map.dispose();
        this.shadowMaps.clear();
        this.scratch?.dispose();
        this.scratch = null;
        this.accumulationTarget?.dispose();
        this.accumulationOutput?.dispose();
        this.accumulationMaterial?.dispose();
        this.accumulationMesh?.geometry?.dispose();
        this.outlineEffect = null;
        this.renderer?.dispose();
        this.renderer = null;
        if (this.ownsCanvas) this.canvas?.remove();
        this.canvas = null;
    }
}
