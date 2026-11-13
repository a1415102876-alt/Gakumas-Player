import * as THREE from 'three';
import { GakumasSceneStage } from './gakumas-scene.js?v=20261112-single-renderer-v1';
import { GakumasPostPass } from './gakumas-post.js?v=20261112-single-renderer-v1';
import { isBeatScene, resolveBeatBackgroundAsset, sceneAssetUrl } from './beat-background-assets.js?v=20261108-chat-clock-v1';
import { applyCameraFocal, applyCameraPose, SceneFreeLook } from './scene-free-look.js?v=20261103-camera-lens-v1';
import { createFreeLookControls } from './scene-free-look-controls.js?v=20261102-beat-camera-pose-v1';
import { collectSceneTextures, downscaleTextureSources } from './portrait-texture-budget.js?v=20261108-texture-budget-v1';
import { estimateRendererResources } from './gpu-resource-estimator.js?v=20261112-single-renderer-v1';

function warmScene(renderer, scene, camera) {
    const textures = new Set();
    scene.traverse(object => {
        for (const material of [object.material].flat().filter(Boolean)) {
            for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
            for (const uniform of Object.values(material.uniforms || {})) {
                for (const value of [uniform.value].flat()) if (value?.isTexture) textures.add(value);
            }
        }
    });
    textures.forEach(texture => renderer.initTexture(texture));
    renderer.compile(scene, camera);
}

// One parsed scene per resource. Only the focused character's renderer owns
// its root/sky at a time; background and character then share depth and camera.
export class BeatScenePool {
    // With a shared `stage` the pool has no canvas or renderer of its own: a
    // background without a focused actor is the stage's bottom layer.
    constructor(container, { stage = null } = {}) {
        this.container = container;
        this.sharedStage = stage;
        this.fallbackVisible = false;
        this.entries = new Map();
        this.activePlayer = null;
        this.warmQueue = Promise.resolve();
        this.disposed = false;
        this.fallbackCanvas = null;
        this.fallbackCameraAnimation = 0;
        this.freeLook = new SceneFreeLook(() => {
            this.freeLookControls?.update();
            if (this.disposed) return;
            if (this.activePlayer?.camera) {
                if (this.activePlayer.postPass) this.activePlayer.postPass.resetHistory = true;
                this.activePlayer.renderFrame();
            } else if (this.fallbackStage && this.fallbackVisible) {
                this.fallbackPost.resetHistory = true;
                this.renderBackground();
            }
        });
        this.freeLookControls = createFreeLookControls(container, this.freeLook);
    }

    async preload(names) {
        const selected = [...new Set(names.filter(isBeatScene))];
        await Promise.all(selected.map(async name => {
            if (this.entries.has(name)) return this.entries.get(name).ready;
            const asset = resolveBeatBackgroundAsset(name);
            if (!asset.matched) return false;
            const stage = new GakumasSceneStage({ scene: new THREE.Scene(), scale: 12.5 });
            stage.resources = this.resources;
            const entry = { asset, stage, loaded: false };
            this.entries.set(name, entry);
            entry.ready = stage.load(sceneAssetUrl(asset), { layout: asset.defaultLayout || 'generic-medium' }).then(async stats => {
                entry.loaded = Boolean(stats) && !this.disposed;
                if (entry.loaded) {
                    entry.textureBudget = await downscaleTextureSources(collectSceneTextures(stage.scene));
                    stage.textureBudget = entry.textureBudget;
                }
                if (this.disposed) stage.unload();
                return entry.loaded;
            }).catch(error => {
                console.warn('[BeatScenePool] scene preload failed', name, error);
                return false;
            });
            return entry.ready;
        }));
        return selected.every(name => this.entries.get(name)?.loaded);
    }

    warmPlayers(players, names, isCurrent = () => true) {
        this.warmQueue = this.warmQueue.catch(() => {}).then(async () => {
            for (const name of names.filter(isBeatScene)) {
                const entry = this.entries.get(name);
                if (entry?.loaded && isCurrent() && !this.disposed) this.drawBackground(entry.stage, 'medium', 'center', false);
            }
            for (const player of players) {
                if (!isCurrent() || this.disposed) return false;
                player.setPresentationActive(false);
                for (const name of names.filter(isBeatScene)) {
                    const entry = this.entries.get(name);
                    if (!entry?.loaded) continue;
                    // Compile off-screen materials and upload their textures too.
                    // The warmup does not advance the prepared character pose.
                    try {
                        player.setStageScene(entry.stage, 'medium', 'center');
                        warmScene(player.renderer, player.scene, player.camera);
                        player.renderFrame();
                    } finally {
                        player.setStageScene(null);
                        player.releasePresentationBuffers?.();
                    }
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    if (!isCurrent() || this.disposed) return false;
                }
            }
            return true;
        });
        return this.warmQueue;
    }

    present(name, player, shot = 'medium', position = 'center', cameraOptions = {}) {
        if (this.activePlayer && this.activePlayer !== player) {
            this.activePlayer.sceneFreeLook = null;
            this.activePlayer.setStageScene(null);
        }
        this.activePlayer = null;
        this.showFallback(false);
        this.fallbackStage = null;
        if (!isBeatScene(name)) {
            this.freeLook.setTarget('', null);
            if (player) player.sceneFreeLook = null;
            player?.setStageScene(null);
            return false;
        }
        const entry = this.entries.get(name);
        if (!entry?.loaded) { this.freeLook.setTarget('', null); return false; }
        if (player) {
            this.activePlayer = player;
            player.setStageScene(entry.stage, shot, position, cameraOptions);
            player.sceneFreeLook = this.freeLook;
            this.freeLook.setTarget(entry.stage, player.camera);
            player.renderFrame();
        } else {
            this.drawBackground(entry.stage, shot, position, true, cameraOptions);
            this.freeLook.setTarget(entry.stage, this.fallbackCamera);
        }
        return true;
    }

    showFallback(visible) {
        const changed = this.fallbackVisible !== Boolean(visible);
        this.fallbackVisible = Boolean(visible);
        if (this.sharedStage) this.sharedStage.backgroundVisible = this.fallbackVisible;
        if (this.fallbackCanvas) this.fallbackCanvas.style.visibility = visible ? 'visible' : 'hidden';
        else if (changed) this.sharedStage?.invalidate();
    }

    ensureFallback() {
        if (this.fallbackRenderer) return;
        if (this.sharedStage) {
            const stage = this.sharedStage;
            this.fallbackRenderer = stage.renderer;
            this.fallbackCamera = new THREE.PerspectiveCamera(36, 1, .1, 10000);
            this.fallbackPost = stage.createPostPass();
            stage.backgroundPost = this.fallbackPost;
            stage.backgroundLayer = () => {
                if (this.fallbackStage && this.fallbackVisible && !this.disposed) this.drawBackgroundLayer();
            };
            this.fallbackResize = new ResizeObserver(() => {
                if (this.fallbackStage && this.fallbackVisible) this.drawBackground(this.fallbackStage, this.fallbackShot, this.fallbackPosition, true, this.fallbackCameraOptions);
            });
            this.fallbackResize.observe(this.container);
        }
    }

    drawBackground(stage, shot, position, visible = true, cameraOptions = {}) {
        this.ensureFallback();
        if (!this.fallbackRenderer) {
            const canvas = this.container.ownerDocument.createElement('canvas');
            canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
            this.container.append(canvas);
            this.fallbackCanvas = canvas;
            // The background reaches this canvas as a full-screen post quad.
            this.fallbackRenderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, stencil: true, powerPreference: 'high-performance' });
            this.fallbackRenderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
            this.fallbackRenderer.outputColorSpace = THREE.SRGBColorSpace;
            this.fallbackRenderer.toneMapping = THREE.NoToneMapping;
            this.fallbackCamera = new THREE.PerspectiveCamera(36, 1, .1, 10000);
            this.fallbackPost = new GakumasPostPass(this.fallbackRenderer, { keepAlpha: true });
            this.fallbackResize = new ResizeObserver(() => {
                if (this.fallbackStage && this.fallbackVisible) this.drawBackground(this.fallbackStage, this.fallbackShot, this.fallbackPosition, true, this.fallbackCameraOptions);
            });
            this.fallbackResize.observe(this.container);
        }
        if (this.fallbackCameraAnimation) cancelAnimationFrame(this.fallbackCameraAnimation);
        this.fallbackCameraAnimation = 0;
        stage.applyBeatLayout(shot, position, cameraOptions);
        stage.attachTo();
        const rect = this.container.getBoundingClientRect();
        const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
        if (this.sharedStage) this.sharedStage.syncSize();
        else this.fallbackRenderer.setSize(width, height, false);
        const camera = this.fallbackCamera;
        const applyCamera = progress => {
            const view = stage.cameraView(stage.layoutId, null, progress);
            if (!view) return;
            camera.position.fromArray(view.position); camera.up.fromArray(view.up); camera.lookAt(new THREE.Vector3().fromArray(view.target));
            camera.aspect = width / height; camera.fov = view.fov; camera.near = view.near; camera.far = view.far;
            applyCameraPose(camera, cameraOptions?.pose);
            applyCameraFocal(camera, cameraOptions?.focal);
            stage.ensureCameraRange(camera); camera.updateProjectionMatrix();
        };
        const duration = Number(cameraOptions?.duration) > 0 ? Number(cameraOptions.duration) * 1000 : 0;
        applyCamera(duration && visible ? 0 : 1);
        if (!visible) warmScene(this.fallbackRenderer, stage.scene, camera);
        this.fallbackPost.enabled = true;this.fallbackPost.apply(stage.post);this.fallbackPost.resetHistory = true;
        const focus = Number(cameraOptions?.dof?.focus);
        this.fallbackPost.setDepthOfField?.(cameraOptions?.dof?.aperture && focus > 0 ? { aperture: cameraOptions.dof.aperture, focus } : null);
        this.fallbackStage = stage; this.fallbackShot = shot; this.fallbackPosition = position; this.fallbackCameraOptions = cameraOptions;
        if (this.sharedStage) this.sharedStage.backgroundSceneId = stage.sidecar?.scene || null;
        this.showFallback(visible);
        this.renderBackground();
        if (duration && visible) {
            const started = performance.now();
            const tick = now => {
                if (this.disposed || this.fallbackStage !== stage) return;
                const progress = Math.min(1, (now - started) / duration);
                applyCamera(progress);
                this.renderBackground();
                if (progress < 1) this.fallbackCameraAnimation = requestAnimationFrame(tick);
                else this.fallbackCameraAnimation = 0;
            };
            this.fallbackCameraAnimation = requestAnimationFrame(tick);
        }
    }

    renderBackground() {
        if (!this.fallbackStage) return;
        if (!this.sharedStage) {
            this.drawBackgroundLayer();
        } else if (this.fallbackVisible) {
            this.sharedStage.invalidate();
        } else {
            // Warm-up draw of a scene that is not on screen.
            this.sharedStage.drawHidden(() => this.drawBackgroundLayer());
        }
    }

    drawBackgroundLayer() {
        const camera = this.fallbackCamera;
        const shared = Boolean(this.sharedStage);
        return this.freeLook.withCamera(camera, () => this.fallbackPost.render(
            () => this.fallbackStage.withPostProcessing(this.fallbackPost, () => this.fallbackRenderer.render(this.fallbackStage.scene, camera)),
            camera,
            // A shared stage presents the captured background through its
            // LookPass after the 2D plate has been drawn. Private stages keep
            // the historical direct-to-canvas path.
            {
                present: !shared,
                composite: !(shared && this.sharedStage.accumulating),
                velocityRoot: this.fallbackStage.scene,
            },
        ));
    }

    getResourceSnapshots() {
        // In shared mode the StageRenderer owns this renderer, its post targets
        // and canvas. SceneDirector reports that single stage row, so a second
        // fallback row would count the same GPU allocations twice.
        if (this.sharedStage) return [];
        const loaded = [...this.entries.values()].filter(entry => entry.loaded);
        const snapshots = [];
        if (this.fallbackRenderer) {
            const scenes = loaded.map(entry => entry.stage.scene);
            const sceneTextureBytes = loaded.reduce((total, entry) => total
                + (Number(entry.textureBudget?.estimatedBytesAfter) || 0), 0);
            snapshots.push({
                label: '场景池 / 隐藏背景预热',
                kind: '共享背景 WebGL context',
                present: this.fallbackVisible,
                memory: estimateRendererResources({
                    renderer: this.fallbackRenderer,
                    roots: scenes,
                    postPass: this.fallbackPost,
                    sceneTextureBytes,
                    three: THREE,
                }),
            });
        }
        return snapshots;
    }

    dispose() {
        this.disposed = true;
        this.freeLook.setTarget('', null);
        this.freeLookControls.dispose();
        if (this.fallbackCameraAnimation) cancelAnimationFrame(this.fallbackCameraAnimation);
        this.fallbackCameraAnimation = 0;
        this.fallbackStage = null;
        if (this.activePlayer) this.activePlayer.sceneFreeLook = null;
        this.activePlayer?.setStageScene(null);
        this.activePlayer = null;
        this.fallbackResize?.disconnect();
        if (this.sharedStage) {
            // The renderer and canvas are the stage's; only the pass is ours.
            if (this.sharedStage.backgroundLayer) this.sharedStage.backgroundLayer = null;
            if (this.sharedStage.backgroundPost === this.fallbackPost) this.sharedStage.backgroundPost = null;
            if (this.sharedStage.postPasses.has(this.fallbackPost)) this.sharedStage.releasePostPass(this.fallbackPost);
        } else {
            this.fallbackPost?.dispose();
            this.fallbackRenderer?.dispose();
        }
        this.fallbackCanvas?.remove();
        for (const { stage } of this.entries.values()) {
            stage.attachTo();
            stage.unload();
        }
        this.entries.clear();
    }
}
