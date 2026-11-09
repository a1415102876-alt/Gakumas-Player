import * as THREE from './vendor/three/build/three.module.js';
import { isHairCoverSourceMaterial } from './gakumas-passes.js?v=20261024-crowd-budget-v1';
import { injectActorShader } from './gakumas-shader.js?v=20261109-actor-light-v3';

export const HAIR_FADE_PARAMETERS = Object.freeze([0.75, 2, 0.4, 4]);

export function evaluateHairCoverAlpha(facing, vertical, mask, minimum = 0, parameters = HAIR_FADE_PARAMETERS) {
    const clamp = value => Math.max(0, Math.min(1, value));
    const fadeX = clamp((parameters[0] - facing) * parameters[1]);
    const fadeZ = clamp((Math.abs(vertical) - parameters[2]) * parameters[3]);
    return 1 + (Math.max(fadeX, fadeZ, clamp(minimum)) - 1) * clamp(mask);
}

function isVisible(mesh, camera) {
    if (!mesh.layers.test(camera.layers)) return false;
    for (let ancestor = mesh; ancestor; ancestor = ancestor.parent) {
        if (!ancestor.visible) return false;
    }
    return true;
}

export class HairCoverStage {
    constructor() {
        this.entries = [];
        this.highlightEntries = [];
        this.lastDraws = [];
        this.active = false;
        this.uniforms = {
            gkHairHeadForward: { value: new THREE.Vector3(0, 0, 1) },
            gkHairHeadUp: { value: new THREE.Vector3(0, 1, 0) },
            gkHairFadeParameters: { value: new THREE.Vector4(...HAIR_FADE_PARAMETERS) },
            gkHairMinimumCoverage: { value: 0.35 },
        };
    }

    add(mesh, source, materialIndex, actorUniforms, textureName) {
        if (!isHairCoverSourceMaterial(source.name, textureName)) return;
        const geometry = mesh.geometry;
        const groups = Array.isArray(mesh.material)
            ? geometry.groups.filter(group => group.materialIndex === materialIndex)
            : [{ start: 0, count: geometry.index?.count ?? geometry.attributes.position.count, materialIndex: 0 }];
        if (!groups.length) return;
        const material = source.clone();
        for (const [name, uniform] of Object.entries(source.uniforms || {})) {
            if (!uniform.value?.isTexture) continue;
            const copiedTexture = material.uniforms[name].value;
            if (copiedTexture && copiedTexture !== uniform.value) copiedTexture.dispose();
            material.uniforms[name].value = uniform.value;
        }
        material.name = `${source.name}:HairCover`;
        material.defines = { ...source.defines, GK_HAIR: true, GK_FACE: false, GK_EYE: false, GK_HAIR_COVER_PASS: true };
        delete material.defines.GK_HAIR_COVER;
        material.transparent = true;
        material.depthWrite = false;
        material.depthTest = true;
        material.depthFunc = THREE.LessEqualDepth;
        material.polygonOffset = false;
        // This model's eyes already use a higher stencil layer and show
        // through the ordinary hair pass. HairCover only supplies the view
        // dependent fade; it must not add a late stencil-gated redraw that
        // paints the whole face in front of the eye layer.
        material.stencilWrite = false;
        material.alphaTest = 0;
        material.colorWrite = true;
        material.blending = THREE.CustomBlending;
        material.blendEquation = THREE.AddEquation;
        material.blendSrc = THREE.SrcAlphaFactor;
        material.blendDst = THREE.OneMinusSrcAlphaFactor;
        material.blendEquationAlpha = THREE.AddEquation;
        material.blendSrcAlpha = THREE.OneFactor;
        material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
        material.premultipliedAlpha = false;
        material.onBeforeCompile = shader => injectActorShader(shader, { ...actorUniforms, ...this.uniforms });
        material.customProgramCacheKey = () => 'gakumas-actor-hair-cover-pass-view-v12';
        this.entries.push({ mesh, source, material, groups });
    }

    addHighlight(mesh, source, materialIndex) {
        const geometry = mesh.geometry;
        const groups = Array.isArray(mesh.material)
            ? geometry.groups.filter(group => group.materialIndex === materialIndex)
            : [{ start: 0, count: geometry.index?.count ?? geometry.attributes.position.count, materialIndex: 0 }];
        if (!groups.length) return;
        this.highlightEntries.push({
            mesh,
            source,
            groups,
            // GLB m_hir+ is a color overlay. Its source material is kept
            // out of the ordinary render list and is drawn exactly once in
            // this post pass, otherwise the 0.55 layer is accumulated twice.
            postOnly: source.userData?.gakumasPostHighlightOnly === true,
        });
    }

    update(head, minimumCoverage) {
        if (head) {
            this.uniforms.gkHairHeadForward.value.setFromMatrixColumn(head.matrixWorld, 2).normalize();
            this.uniforms.gkHairHeadUp.value.setFromMatrixColumn(head.matrixWorld, 1).normalize();
        }
        this.uniforms.gkHairMinimumCoverage.value = Math.max(0, Math.min(1, minimumCoverage));
    }

    draw(renderer, scene, camera) {
        for (const { mesh, source, material, groups } of this.entries) {
            if (!source.visible || !isVisible(mesh, camera)) continue;
            mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
            mesh.normalMatrix.getNormalMatrix(mesh.modelViewMatrix);
            material.opacity = source.opacity;
            material.color.copy(source.color);
            for (const group of groups) {
                renderer.renderBufferDirect(camera, scene, mesh.geometry, material, mesh, group);
                this.lastDraws.push({ name: source.name, start: group.start, count: group.count, materialIndex: group.materialIndex });
            }
        }
    }

    drawHighlights(renderer, scene, camera, postOnlyOnly = false) {
        for (const { mesh, source, groups, postOnly } of this.highlightEntries) {
            if (postOnlyOnly && !postOnly) continue;
            if ((!source.visible && !postOnly) || !isVisible(mesh, camera)) continue;
            mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
            mesh.normalMatrix.getNormalMatrix(mesh.modelViewMatrix);
            // This callback runs after the regular render list. Post-only GLB
            // highlights bypass the eye stencil, but keep depth testing so a
            // face drawn in front still occludes them. The historical PMX
            // redraw remains an unconditional overlay.
            const state = {
                depthTest: source.depthTest,
                depthWrite: source.depthWrite,
                stencilWrite: source.stencilWrite,
                stencilFunc: source.stencilFunc,
                stencilRef: source.stencilRef,
                stencilFuncMask: source.stencilFuncMask,
                stencilWriteMask: source.stencilWriteMask,
                stencilFail: source.stencilFail,
                stencilZFail: source.stencilZFail,
                stencilZPass: source.stencilZPass,
            };
            source.depthTest = postOnly ? state.depthTest : false;
            source.depthWrite = false;
            source.stencilWrite = false;
            source.stencilFunc = THREE.AlwaysStencilFunc;
            source.stencilRef = 0;
            source.stencilFuncMask = 0xff;
            source.stencilWriteMask = 0;
            source.stencilFail = THREE.KeepStencilOp;
            source.stencilZFail = THREE.KeepStencilOp;
            source.stencilZPass = THREE.KeepStencilOp;
            try {
                for (const group of groups) {
                    renderer.renderBufferDirect(camera, scene, mesh.geometry, source, mesh, group);
                }
            } finally {
                Object.assign(source, state);
            }
        }
    }

    renderFrame(renderer, outline, scene, camera, enabled) {
        this.lastDraws = [];
        const originalSceneAfter = scene.onAfterRender;
        const postOnlyHighlights = this.highlightEntries.some(entry => entry.postOnly);
        const scheduleCover = (enabled && this.entries.length) || postOnlyHighlights;
        const drawOutline = () => {
            if (!outline?.enabled || this.outlining) return;
            this.outlining = true;
            try {
                // The mesh was already drawn with the jittered TAA camera.
                // The outline has to use that same projection. Drawing it with
                // the stable camera leaves the one-pixel shell on the
                // unjittered grid, and the resolve then slides it every frame.
                outline.renderOutline(scene, camera);
            } finally {
                this.outlining = false;
            }
        };
        if (scheduleCover) {
            if (camera.isArrayCamera) {
                throw new Error('HairCover currently requires a single camera');
            }
            this.active = enabled && this.entries.length > 0;
            // Base scene, then the outline shell, then HairCover. The outline
            // pass writes the same stencil as its source material. HairCover
            // stays after it so the faded bangs can cover the face while the
            // extruded hair edge remains outside that redraw.
            scene.onAfterRender = (activeRenderer, activeScene, activeCamera) => {
                if (this.outlining) return;
                drawOutline();
                if (this.active) this.draw(activeRenderer, activeScene, activeCamera);
                // Highlight overlays also need a post pass when HairCover is
                // disabled. GLB m_hir+ uses this path exclusively; PMX keeps
                // its historical redraw only while HairCover is active.
                this.drawHighlights(activeRenderer, activeScene, activeCamera, !this.active);
                if (originalSceneAfter) originalSceneAfter.call(scene, activeRenderer, activeScene, activeCamera);
            };
        }
        try {
            renderer.render(scene, camera);
        } finally {
            this.active = false;
            scene.onAfterRender = originalSceneAfter;
        }
        if (!scheduleCover) drawOutline();
    }

    dispose() {
        this.entries.forEach(entry => entry.material.dispose());
        this.highlightEntries.forEach(entry => {
            if (entry.source.userData?.gakumasOwnedHighlightOverlay) entry.source.dispose();
        });
        this.entries = [];
        this.highlightEntries = [];
        this.lastDraws = [];
    }
}
