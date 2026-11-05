import * as THREE from './vendor/three/build/three.module.js';

const VELOCITY_VERTEX = `
uniform mat4 gkCurrViewProj;
uniform mat4 gkPrevViewProj;
uniform mat4 gkPrevModelMatrix;
uniform float gkHasPrevBones;
uniform sampler2D prevBoneTexture;
uniform float prevBoneTextureSize;
varying vec2 vVelocity;

#ifdef GK_VELOCITY_SKIN
uniform mat4 bindMatrix;
uniform mat4 bindMatrixInverse;
uniform highp sampler2D boneTexture;
uniform int boneTextureSize;

mat4 gkCurrentBone(float index) {
    float j = index * 4.0;
    float x = mod(j, float(boneTextureSize));
    float y = floor(j / float(boneTextureSize));
    float dx = 1.0 / float(boneTextureSize);
    y = dx * (y + 0.5);
    vec4 v1 = texture2D(boneTexture, vec2(dx * (x + 0.5), y));
    vec4 v2 = texture2D(boneTexture, vec2(dx * (x + 1.5), y));
    vec4 v3 = texture2D(boneTexture, vec2(dx * (x + 2.5), y));
    vec4 v4 = texture2D(boneTexture, vec2(dx * (x + 3.5), y));
    return mat4(v1, v2, v3, v4);
}

mat4 gkPreviousBone(float index) {
    float j = index * 4.0;
    float x = mod(j, prevBoneTextureSize);
    float y = floor(j / prevBoneTextureSize);
    float dx = 1.0 / prevBoneTextureSize;
    y = dx * (y + 0.5);
    vec4 v1 = texture2D(prevBoneTexture, vec2(dx * (x + 0.5), y));
    vec4 v2 = texture2D(prevBoneTexture, vec2(dx * (x + 1.5), y));
    vec4 v3 = texture2D(prevBoneTexture, vec2(dx * (x + 2.5), y));
    vec4 v4 = texture2D(prevBoneTexture, vec2(dx * (x + 3.5), y));
    return mat4(v1, v2, v3, v4);
}

vec3 gkApplyBones(vec3 localPos, mat4 boneMatX, mat4 boneMatY, mat4 boneMatZ, mat4 boneMatW) {
    vec4 skinVertex = bindMatrix * vec4(localPos, 1.0);
    vec4 skinned = boneMatX * skinVertex * skinWeight.x;
    skinned += boneMatY * skinVertex * skinWeight.y;
    skinned += boneMatZ * skinVertex * skinWeight.z;
    skinned += boneMatW * skinVertex * skinWeight.w;
    return (bindMatrixInverse * skinned).xyz;
}
#endif

void main() {
    vec3 currLocal = position;
    vec3 prevLocal = position;
#ifdef GK_VELOCITY_SKIN
    currLocal = gkApplyBones(position, gkCurrentBone(skinIndex.x), gkCurrentBone(skinIndex.y), gkCurrentBone(skinIndex.z), gkCurrentBone(skinIndex.w));
    if (gkHasPrevBones > 0.5) {
        prevLocal = gkApplyBones(position, gkPreviousBone(skinIndex.x), gkPreviousBone(skinIndex.y), gkPreviousBone(skinIndex.z), gkPreviousBone(skinIndex.w));
    } else {
        prevLocal = currLocal;
    }
#endif
    vec4 currClip = gkCurrViewProj * modelMatrix * vec4(currLocal, 1.0);
    vec4 prevClip = gkPrevViewProj * gkPrevModelMatrix * vec4(prevLocal, 1.0);
    if (currClip.w > 1e-4 && prevClip.w > 1e-4) {
        vec2 currUv = currClip.xy / currClip.w * 0.5 + 0.5;
        vec2 prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;
        vVelocity = currUv - prevUv;
    } else {
        vVelocity = vec2(0.0);
    }
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(currLocal, 1.0);
}
`;

const VELOCITY_FRAGMENT = `
varying vec2 vVelocity;
void main() {
    gl_FragColor = vec4(vVelocity, 0.0, 1.0);
}
`;

function fallbackTexture() {
    const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.needsUpdate = true;
    return texture;
}

function velocityMaterial(uniforms, defines = {}) {
    const material = new THREE.ShaderMaterial({
        uniforms,
        defines,
        vertexShader: VELOCITY_VERTEX,
        fragmentShader: VELOCITY_FRAGMENT,
        depthTest: true,
        depthWrite: true,
        toneMapped: false,
        side: THREE.DoubleSide,
    });
    material.precision = 'highp';
    return material;
}

export function createVelocityMaterial() {
    const fallback = fallbackTexture();
    const uniforms = {
        gkCurrViewProj: { value: new THREE.Matrix4() },
        gkPrevViewProj: { value: new THREE.Matrix4() },
        gkPrevModelMatrix: { value: new THREE.Matrix4() },
        gkHasPrevBones: { value: 0 },
        prevBoneTexture: { value: fallback },
        prevBoneTextureSize: { value: 1 },
    };
    const material = velocityMaterial(uniforms);
    const skinnedMaterial = velocityMaterial(uniforms, { GK_VELOCITY_SKIN: '' });
    return {
        material,
        skinnedMaterial,
        fallbackTexture: fallback,
        dispose() {
            material.dispose();
            skinnedMaterial.dispose();
            fallback.dispose();
        },
    };
}

function motionEntry(memory, mesh) {
    let entry = memory.get(mesh);
    if (!entry) {
        entry = { matrix: new THREE.Matrix4(), texture: null, size: 0 };
        memory.set(mesh, entry);
    }
    return entry;
}

export function rememberSceneMotion(root, memory) {
    if (!root?.traverse || !memory) return;
    root.traverse((obj) => {
        if (!obj.isMesh) return;
        const entry = motionEntry(memory, obj);
        entry.matrix.copy(obj.matrixWorld);
        if (!obj.isSkinnedMesh || !obj.skeleton?.bones?.length) return;
        const skeleton = obj.skeleton;
        if (!skeleton.boneTexture) skeleton.computeBoneTexture();
        const size = skeleton.boneTextureSize || 0;
        const src = skeleton.boneMatrices;
        if (!size || !src) return;
        const needed = size * size * 4;
        if (!entry.texture || entry.size !== size || entry.texture.image?.data?.length !== needed) {
            entry.texture?.dispose();
            const data = new Float32Array(needed);
            const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
            texture.needsUpdate = true;
            entry.texture = texture;
            entry.size = size;
        }
        entry.texture.image.data.set(src.subarray(0, Math.min(src.length, needed)));
        entry.texture.needsUpdate = true;
    });
}

export function renderSceneVelocity(renderer, root, pass, target, camera, { currentViewProj, previousViewProj, memory }) {
    if (!renderer || !root?.traverse || !pass || !target || !camera || !memory) return;
    const uniforms = pass.material.uniforms;
    uniforms.gkCurrViewProj.value.copy(currentViewProj);
    uniforms.gkPrevViewProj.value.copy(previousViewProj);
    const hooks = [];
    const hidden = [];
    const skinnedLayers = [];
    // Layer 31 is reserved for this pass. A shared override material keeps the
    // rigid program once the room has been drawn, so skinned meshes never get
    // USE_SKINNING and their motion stays at zero.
    const skinLayer = 31;
    root.traverse((obj) => {
        if (obj.isInstancedMesh || obj.isLine || obj.isPoints || obj.isSprite) {
            hidden.push([obj, obj.visible]);
            obj.visible = false;
            return;
        }
        if (obj.isSkinnedMesh) {
            skinnedLayers.push([obj, obj.layers.mask]);
            obj.layers.set(skinLayer);
        }
        if (!obj.isMesh) return;
        const previous = obj.onBeforeRender;
        hooks.push([obj, previous]);
        obj.onBeforeRender = function (...args) {
            if (typeof previous === 'function') previous.call(this, ...args);
            const entry = memory.get(obj);
            uniforms.gkPrevModelMatrix.value.copy(entry?.matrix || obj.matrixWorld);
            uniforms.gkHasPrevBones.value = entry?.texture ? 1 : 0;
            uniforms.prevBoneTexture.value = entry?.texture || pass.fallbackTexture;
            uniforms.prevBoneTextureSize.value = entry?.size || 1;
            pass.material.uniformsNeedUpdate = true;
            if (pass.skinnedMaterial) pass.skinnedMaterial.uniformsNeedUpdate = true;
        };
    });
    const background = root.background;
    const override = root.overrideMaterial;
    const clear = new THREE.Color();
    renderer.getClearColor(clear);
    const clearAlpha = renderer.getClearAlpha();
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const shadowNeeds = renderer.shadowMap.needsUpdate;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const cameraLayerMask = camera.layers.mask;
    if ('background' in root) root.background = null;
    root.overrideMaterial = pass.material;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    try {
        // The character pass often leaves depth writes off. A clear then
        // keeps the old depth, and every motion sample fails the depth test.
        renderer.state.buffers.color.setMask(true);
        renderer.state.buffers.depth.setMask(true);
        renderer.state.buffers.stencil.setMask(0xff);
        renderer.clear(true, true, true);
        camera.layers.disable(skinLayer);
        renderer.render(root, camera);
        if (skinnedLayers.length && pass.skinnedMaterial) {
            camera.layers.set(skinLayer);
            root.overrideMaterial = pass.skinnedMaterial;
            renderer.autoClear = false;
            renderer.render(root, camera);
        }
    } finally {
        camera.layers.mask = cameraLayerMask;
        for (const [obj, mask] of skinnedLayers) obj.layers.mask = mask;
        if ('background' in root) root.background = background;
        root.overrideMaterial = override;
        renderer.setClearColor(clear, clearAlpha);
        renderer.shadowMap.autoUpdate = shadowAuto;
        renderer.shadowMap.needsUpdate = shadowNeeds;
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear = previousAutoClear;
        for (const [obj, hook] of hooks) obj.onBeforeRender = hook;
        for (const [obj, visible] of hidden) obj.visible = visible;
    }
}


