import * as THREE from './vendor/three/build/three.module.js';
import { STAR_EYE_IDOLS, STAR_EYE_RESOURCES } from './star-eye-resources.js?v=20261006-star-eyes-v1';

export const STAR_EYE_TEXTURES = Object.freeze(Object.fromEntries(
    Object.entries(STAR_EYE_RESOURCES).map(([id, resource]) => [id, resource.col]),
));

export const FACIAL_EFFECT_DEFINITIONS = Object.freeze({
    starEyes: { label: '星星眼', kind: 'eye-mode' },
    noHighlight: { label: '无高光眼睛', kind: 'eye-mode' },
    tears: { label: '眼泪', mount: 'eye-under', kind: 'overlay' },
    blackFace: { label: '黑脸阴影', kind: 'overlay' },
    blackLines: { label: '黑线脸', mount: 'head', kind: 'overlay' },
    futougou: { label: '不等号眼', kind: 'eye-mode' },
});

const DEFAULT_STATE = Object.freeze({
    starEyes: false,
    noHighlight: false,
    tears: 'off',
    blackFace: false,
    blackLines: false,
    futougou: false,
});

export function effectLabel(id) {
    return FACIAL_EFFECT_DEFINITIONS[id]?.label || id;
}

export function blackFaceMaskAt(normalizedY) {
    const value = Math.max(0, Math.min(1, Number(normalizedY) || 0));
    const edge0 = 0.22;
    const edge1 = 0.62;
    const ratio = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return ratio * ratio * (3 - 2 * ratio);
}

export function normalizeFacialEffectState(input = {}) {
    const next = {
        ...DEFAULT_STATE,
        ...input,
        tears: ['off', 'basic', 'filled'].includes(input.tears) ? input.tears : DEFAULT_STATE.tears,
    };
    // The Unity effects replace the eye material/prefab. They are mutually
    // exclusive; tears and face overlays can still be combined with one.
    const eyeMode = next.starEyes ? 'starEyes' : next.noHighlight ? 'noHighlight' : next.futougou ? 'futougou' : '';
    next.starEyes = eyeMode === 'starEyes';
    next.noHighlight = eyeMode === 'noHighlight';
    next.futougou = eyeMode === 'futougou';
    next.blackFace = Boolean(next.blackFace);
    next.blackLines = Boolean(next.blackLines);
    return next;
}

function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function loadTexture(loader, url, colorSpace = THREE.SRGBColorSpace) {
    return loader.loadAsync(url).then(texture => {
        texture.colorSpace = colorSpace;
        texture.flipY = false;
        texture.needsUpdate = true;
        return texture;
    });
}

function parseObj(text) {
    const vertices = [];
    const uvs = [];
    const normals = [];
    const positions = [];
    const texcoords = [];
    const normalValues = [];
    const readIndex = (value, length) => {
        const index = Number(value);
        return index < 0 ? length + index : index - 1;
    };
    for (const rawLine of String(text).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        if (parts[0] === 'v' && parts.length >= 4) vertices.push(parts.slice(1, 4).map(Number));
        else if (parts[0] === 'vt' && parts.length >= 3) uvs.push(parts.slice(1, 3).map(Number));
        else if (parts[0] === 'vn' && parts.length >= 4) normals.push(parts.slice(1, 4).map(Number));
        else if (parts[0] === 'f' && parts.length >= 4) {
            const face = parts.slice(1).map(token => token.split('/'));
            for (let index = 1; index < face.length - 1; index += 1) {
                for (const entry of [face[0], face[index], face[index + 1]]) {
                    const position = vertices[readIndex(entry[0], vertices.length)] || [0, 0, 0];
                    positions.push(...position);
                    const uv = entry[1] ? uvs[readIndex(entry[1], uvs.length)] : null;
                    texcoords.push(...(uv || [0, 0]));
                    const normal = entry[2] ? normals[readIndex(entry[2], normals.length)] : null;
                    normalValues.push(...(normal || [0, 0, 1]));
                }
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(texcoords, 2));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalValues, 3));
    if (!normalValues.length) geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

async function loadObj(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`OBJ 加载失败：${response.status}`);
    return parseObj(await response.text());
}

function materialList(model) {
    const list = [];
    model?.traverse(child => {
        if (!child.isMesh) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.filter(Boolean).forEach(material => list.push({ mesh: child, material }));
    });
    return list;
}

function findBone(model, patterns) {
    const list = [];
    model?.traverse(child => {
        if (child.isBone) list.push(child);
    });
    for (const pattern of patterns) {
        const exact = list.find(bone => pattern.test(bone.name));
        if (exact) return exact;
    }
    return null;
}

function isEyeMaterial(material) {
    const value = `${material.name || ''} ${material.userData?.gakumasActorPass || ''}`.toLowerCase();
    return /(?:^|[_\-])m_eye(?:$|[_\-])|\beye\b|eyeball|iris|pupil/.test(value);
}

function isHighlightMaterial(material) {
    const value = `${material.name || ''} ${material.userData?.gakumasActorPass || ''}`.toLowerCase();
    return /m_ehl|eye.?highlight|\behl\b/.test(value);
}

export function isFaceMaterial(material) {
    const value = `${material.name || ''} ${material.userData?.gakumasActorPass || ''}`.toLowerCase();
    return /(?:^|[_-])m_fce(?:$|\s|_|-|\[)|\bface\b|skin/.test(value) && !isEyeMaterial(material);
}

function findFaceMesh(model) {
    let result = null;
    model?.traverse(child => {
        if (result || !child.isMesh) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        if (materials.some(isFaceMaterial)) result = child;
    });
    return result;
}

function faceGeometryBounds(mesh) {
    const position = mesh?.geometry?.getAttribute?.('position');
    if (!position?.count) return { minX: -1, maxX: 1, minY: 0, maxY: 1 };
    const point = new THREE.Vector3();
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (let index = 0; index < position.count; index += 1) {
        point.fromBufferAttribute(position, index);
        bounds.minX = Math.min(bounds.minX, point.x);
        bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y);
        bounds.maxY = Math.max(bounds.maxY, point.y);
    }
    return bounds;
}

export class FacialEffectsStage {
    constructor({ basePath = './assets/facial-effects', onStatus = null, idolId = '' } = {}) {
        this.basePath = basePath.replace(/\/$/, '');
        this.onStatus = onStatus;
        this.idolId = String(idolId || '').trim().toLowerCase();
        this.loader = new THREE.TextureLoader();
        this.textureCache = new Map();
        this.geometryCache = new Map();
        this.model = null;
        this.format = 'glb';
        this.head = null;
        this.eyeUnder = { left: null, right: null };
        this.effectGroups = new Map();
        this.materialEntries = [];
        this.faceMeshes = [];
        this.state = normalizeFacialEffectState();
        this.starMaps = [];
        this.starFrame = -1;
        this.loading = new Map();
    }

    setIdolId(idolId) {
        this.idolId = String(idolId || '').trim().toLowerCase();
        return this.idolId;
    }

    hasStarEyes() {
        return STAR_EYE_IDOLS.includes(this.idolId) && Boolean(STAR_EYE_TEXTURES[this.idolId]);
    }

    starEyeResource() {
        return STAR_EYE_RESOURCES[this.idolId] || null;
    }

    report(text) {
        if (typeof this.onStatus === 'function') this.onStatus(text);
    }

    url(path) {
        return `${this.basePath}/${normalizePath(path)}`;
    }

    texture(path) {
        const url = this.url(path);
        const key = `color:${url}`;
        if (!this.textureCache.has(key)) this.textureCache.set(key, loadTexture(this.loader, url));
        return this.textureCache.get(key);
    }

    dataTexture(path) {
        const url = this.url(path);
        const key = `data:${url}`;
        if (!this.textureCache.has(key)) this.textureCache.set(key, loadTexture(this.loader, url, THREE.NoColorSpace));
        return this.textureCache.get(key);
    }

    geometry(path) {
        const url = this.url(path);
        if (!this.geometryCache.has(url)) this.geometryCache.set(url, loadObj(this.resources?.resolve(url) || url));
        return this.geometryCache.get(url);
    }

    async attach(model, { format = 'glb', idolId = this.idolId } = {}) {
        this.disposeRuntime();
        this.model = model;
        this.format = format;
        this.setIdolId(idolId);
        this.head = findBone(model, [/^Head$/i, /head/i, /头/]);
        this.eyeUnder.left = findBone(model, [/LeftEyeUnder/i, /EyeUnder.*Left/i, /左眼/i]);
        this.eyeUnder.right = findBone(model, [/RightEyeUnder/i, /EyeUnder.*Right/i, /右眼/i]);
        this.materialEntries = materialList(model);
        this.faceMeshes = [];
        model.traverse(child => {
            if (!child.isMesh) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            if (materials.some(isFaceMaterial)) this.faceMeshes.push(child);
        });
        this.report(`面部特殊效果：已就绪（${this.materialEntries.length} 个材质）`);
        await this.applyAll();
    }

    async setEffect(id, value) {
        if (!(id in DEFAULT_STATE)) return;
        this.state = normalizeFacialEffectState({ ...this.state, [id]: value });
        await this.applyAll();
        return this.state;
    }

    async setState(value) {
        this.state = normalizeFacialEffectState(value);
        await this.applyAll();
        return this.state;
    }

    getState() {
        return { ...this.state };
    }

    async applyAll() {
        if (!this.model) return;
        this.applyEyeMaterials();
        this.applyBlackFace();
        await this.applyTears();
        await this.applyBlackLines();
        await this.applyFutougou();
        if (this.resources) await Promise.all([...this.loading.values()]);
        this.report(`面部特殊效果：${this.activeLabels().join('、') || '全部关闭'}`);
    }

    activeLabels() {
        const labels = [];
        if (this.state.starEyes) labels.push('星星眼');
        if (this.state.noHighlight) labels.push('无高光');
        if (this.state.futougou) labels.push('不对称眼');
        if (this.state.tears !== 'off') labels.push(this.state.tears === 'filled' ? '充满眼泪' : '眼泪');
        if (this.state.blackFace) labels.push('黑脸阴影');
        if (this.state.blackLines) labels.push('黑线脸');
        return labels;
    }

    applyEyeMaterials() {
        const entries = this.materialEntries;
        for (const { material } of entries) {
            if (isEyeMaterial(material) && !isHighlightMaterial(material)) {
                material.userData.facialBaseMap ??= material.map || null;
                material.userData.facialBaseRepeat ??= material.map?.repeat?.clone() || new THREE.Vector2(1, 1);
                material.userData.facialBaseOffset ??= material.map?.offset?.clone() || new THREE.Vector2(0, 0);
                if (this.state.starEyes) {
                    this.ensureStarMaterial(material);
                } else if (material.userData.facialBaseMap) {
                    material.map = material.userData.facialBaseMap;
                    material.map.repeat.copy(material.userData.facialBaseRepeat);
                    material.map.offset.copy(material.userData.facialBaseOffset);
                    material.needsUpdate = true;
                }
                this.restoreStarUniforms(material);
                if (this.state.starEyes) this.ensureStarUniforms(material);
            }
            if (isHighlightMaterial(material)) {
                material.userData.facialBaseOpacity ??= material.opacity;
                material.userData.facialBaseTransparent ??= material.transparent;
                material.opacity = this.state.noHighlight ? 0 : material.userData.facialBaseOpacity;
                material.transparent = this.state.noHighlight || material.userData.facialBaseTransparent;
                material.needsUpdate = true;
            }
        }
    }

    ensureStarMaterial(material) {
        const resource = this.starEyeResource();
        const path = resource?.col;
        if (!resource || !path) {
            if (!this.loading.has('__star-eyes-missing__')) {
                this.loading.set('__star-eyes-missing__', Promise.resolve());
                this.report(`当前角色没有可用的星星眼材质：${this.idolId || '未知角色'}`);
            }
            return;
        }
        const key = `star:${this.idolId}`;
        if (!this.loading.has(key)) {
            this.loading.set(key, Promise.all([
                this.texture(resource.col),
                this.dataTexture(resource.shade),
                this.dataTexture(resource.def),
            ]).then(([texture, shade, def]) => {
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.set(1 / Math.max(1, resource.tileX || 3), 1 / Math.max(1, resource.tileY || 3));
                this.starMaps.push(texture);
                return { texture, shade, def };
            }));
        }
        const promise = this.loading.get(key);
        promise.then(({ texture, shade, def }) => {
            if (!this.state.starEyes || !this.model) return;
            material.userData.facialStarMap = texture;
            material.map = texture;
            const uniforms = material.userData.gakumasUniforms;
            if (uniforms) {
                material.userData.facialStarUniforms ??= {
                    shade: uniforms.gkShadeMap?.value,
                    def: uniforms.gkDefMap?.value,
                    hasShade: uniforms.gkHasShade?.value,
                    hasDef: uniforms.gkHasDef?.value,
                };
                if (uniforms.gkShadeMap) uniforms.gkShadeMap.value = shade;
                if (uniforms.gkDefMap) uniforms.gkDefMap.value = def;
                if (uniforms.gkHasShade) uniforms.gkHasShade.value = 1;
            }
            material.needsUpdate = true;
            this.setStarFrame(this.starFrame < 0 ? 0 : this.starFrame);
        }).catch(error => this.report(`面部特殊效果加载失败：${error.message}`));
    }

    setStarFrame(frame) {
        const resource = this.starEyeResource() || {};
        const tileX = Math.max(1, resource.tileX || 3);
        const tileY = Math.max(1, resource.tileY || 3);
        const index = Math.max(0, frame) % (tileX * tileY);
        const x = index % tileX;
        const y = Math.floor(index / tileX);
        for (const texture of this.starMaps) texture.offset.set(x / tileX, 1 - (y + 1) / tileY);
    }

    applyBlackFace() {
        for (const mesh of this.faceMeshes) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.filter(isFaceMaterial).forEach(material => {
                material.userData.facialBlackFaceEnabled = this.state.blackFace;
                material.userData.facialBlackFaceMesh = mesh;
                material.userData.facialBlackFaceBounds = faceGeometryBounds(mesh);
                material.userData.facialBaseColor ??= material.color?.clone?.() || new THREE.Color(1, 1, 1);
                if (material.color) material.color.copy(material.userData.facialBaseColor);
                const baseKey = material.userData.facialBaseColor?.getHex?.() || 0;
                material.customProgramCacheKey = () => `facial-black-face:${this.state.blackFace ? 'on' : 'off'}:${baseKey}`;
                if (!material.userData.facialBlackFaceWrapper) {
                    material.userData.facialOriginalOnBeforeCompile = material.onBeforeCompile;
                    material.userData.facialBlackFaceWrapper = true;
                }
                if (!this.state.blackFace) {
                    material.onBeforeCompile = material.userData.facialOriginalOnBeforeCompile;
                    material.needsUpdate = true;
                    return;
                }
                material.onBeforeCompile = shader => {
                    const previous = material.userData.facialOriginalOnBeforeCompile;
                    if (typeof previous === 'function') previous(shader);
                    const bounds = material.userData.facialBlackFaceBounds;
                    const minY = Number(bounds?.minY ?? 0);
                    const spanY = Math.max(Number(bounds?.maxY ?? 1) - minY, 1e-5);
                    if (shader.vertexShader.includes('varying vec3 vViewPosition;')) shader.vertexShader = shader.vertexShader.replace('varying vec3 vViewPosition;', `varying vec3 vViewPosition;\nvarying float facialBlackFaceY;`);
                    else shader.vertexShader = `varying float facialBlackFaceY;\n${shader.vertexShader}`;
                    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nfacialBlackFaceY = clamp((transformed.y - ${minY.toFixed(8)}) / ${spanY.toFixed(8)}, 0.0, 1.0);`);
                    if (shader.fragmentShader.includes('varying vec3 vViewPosition;')) shader.fragmentShader = shader.fragmentShader.replace('varying vec3 vViewPosition;', `varying vec3 vViewPosition;\nvarying float facialBlackFaceY;`);
                    else shader.fragmentShader = `varying float facialBlackFaceY;\n${shader.fragmentShader}`;
                    const facialBlackCode = `
// Game black-face is a forehead/eye-area overlay. Fade it out before the
// lower face instead of darkening the entire face material.
float facialBlackMask = smoothstep(0.22, 0.62, facialBlackFaceY);
// Keep the effect close to a warm skin shadow. Equal RGB multiplication made
// the dark face inherit the cool cyan cast from the current stage lighting.
vec3 facialBlackWarmShadow = gl_FragColor.rgb * vec3(0.30, 0.13, 0.10);
gl_FragColor.rgb = mix(gl_FragColor.rgb, facialBlackWarmShadow, facialBlackMask * 0.88);
`;
                    const shaderMarkers = ['#include <opaque_fragment>', '#include <tonemapping_fragment>', '#include <encodings_fragment>'];
                    const marker = shaderMarkers.find(candidate => shader.fragmentShader.includes(candidate));
                    if (marker) shader.fragmentShader = shader.fragmentShader.replace(marker, `${marker}\n${facialBlackCode}`);
                    else {
                        const end = shader.fragmentShader.lastIndexOf('}');
                        if (end >= 0) shader.fragmentShader = `${shader.fragmentShader.slice(0, end)}${facialBlackCode}${shader.fragmentShader.slice(end)}`;
                    }
                };
                material.needsUpdate = true;
            });
        }
    }

    makeOverlayMaterial(texture, { opacity = 1 } = {}) {
        return new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
        });
    }

    ensureStarUniforms(material) {
        // Loading the color map is enough for PMX materials; GLB/Gakumas
        // materials also receive the character-specific shade and Def maps in
        // ensureStarMaterial once the asynchronous bundle textures are ready.
        if (!material.userData.gakumasUniforms) return;
        material.userData.facialStarUniforms ??= {
            shade: material.userData.gakumasUniforms.gkShadeMap?.value,
            def: material.userData.gakumasUniforms.gkDefMap?.value,
            hasShade: material.userData.gakumasUniforms.gkHasShade?.value,
            hasDef: material.userData.gakumasUniforms.gkHasDef?.value,
        };
    }

    restoreStarUniforms(material) {
        const uniforms = material.userData.gakumasUniforms;
        const base = material.userData.facialStarUniforms;
        if (!uniforms || !base || this.state.starEyes) return;
        if (uniforms.gkShadeMap) uniforms.gkShadeMap.value = base.shade;
        if (uniforms.gkDefMap) uniforms.gkDefMap.value = base.def;
        if (uniforms.gkHasShade) uniforms.gkHasShade.value = base.hasShade;
        if (uniforms.gkHasDef) uniforms.gkHasDef.value = base.hasDef;
        delete material.userData.facialStarUniforms;
    }

    attachMesh(name, geometry, texture, parent, { position = [0, 0, 0], quaternion = null, scale = 1, opacity = 1 } = {}) {
        const material = this.makeOverlayMaterial(texture, { opacity });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `FacialEffect_${name}`;
        mesh.renderOrder = 45;
        mesh.position.set(...position);
        if (quaternion) mesh.quaternion.set(...quaternion);
        mesh.scale.setScalar(scale);
        (parent || this.head || this.model)?.add(mesh);
        const group = parent || this.head || this.model;
        return { mesh, material, group };
    }

    clearGroup(key) {
        const items = this.effectGroups.get(key) || [];
        for (const item of items) {
            item.mesh?.parent?.remove(item.mesh);
            item.material?.dispose?.();
        }
        this.effectGroups.delete(key);
    }

    async applyTears() {
        this.clearGroup('tears');
        if (this.state.tears === 'off' || !this.model) return;
        const filled = this.state.tears === 'filled';
        const items = [];
        for (const hand of ['left', 'right']) {
            const suffix = hand === 'left' ? 'l' : 'r';
            const base = filled ? `common-tears-filled-002-${hand}` : `common-tears-001-${hand}`;
            const obj = filled ? 'eff_ps_live_mdl_tears_01.obj' : 'eff_ps_live_mdl_tears_02.obj';
            const texture = filled ? 'eff_ps_adv_tex_tears_01.png' : 'eff_ps_adv_tex_tears_02.png';
            try {
                const [geometry, map] = await Promise.all([this.geometry(`${base}/meshes/${obj}`), this.texture(`${base}/textures/${texture}`)]);
                const parent = this.eyeUnder[hand] || this.head || this.model;
                const position = this.eyeUnder[hand] ? [0, 0, 0] : [hand === 'left' ? -0.0569 : 0.0569, 0.0383, 0.0691];
                items.push(this.attachMesh(`tears-${filled ? 'filled-002' : '001'}-${suffix}`, geometry, map, parent, {
                    position,
                    scale: this.format === 'glb' ? 1 : 12.5,
                    opacity: 0.95,
                }));
            } catch (error) {
                this.report(`眼泪资源加载失败：${error.message}`);
            }
        }
        this.effectGroups.set('tears', items);
    }

    async applyBlackLines() {
        this.clearGroup('blackLines');
        if (!this.state.blackLines || !this.model) return;
        try {
            const [geometry, map] = await Promise.all([
                this.geometry('jsna-head-gaan/meshes/Geo_gaan.obj'),
                this.texture('jsna-head-gaan/textures/t_chr_cmmn_head-normal-001_col_alp.png'),
            ]);
            const item = this.attachMesh('gaan', geometry, map, this.head || this.model, {
                position: [0.0499, 0.0266, 0.0908],
                quaternion: [0, 0.205648, 0, 0.978626],
                scale: this.format === 'glb' ? 1 : 12.5,
                opacity: 1,
            });
            this.effectGroups.set('blackLines', [item]);
        } catch (error) {
            this.report(`黑线资源加载失败：${error.message}`);
        }
    }

    async applyFutougou() {
        this.clearGroup('futougou');
        if (!this.state.futougou || !this.model) return;
        const items = [];
        for (const hand of ['left', 'right']) {
            const suffix = hand === 'left' ? 'l' : 'r';
            const base = `kcna-eye-futougou-${hand}`;
            try {
                const [geometry, map] = await Promise.all([
                    this.geometry(`${base}/meshes/Geo_futougou_${suffix}.obj`),
                    this.texture(`${base}/textures/t_chr_cmmn_eye-normal-001_col_alp.png`),
                ]);
                items.push(this.attachMesh(`futougou-${suffix}`, geometry, map, this.head || this.model, {
                    position: [hand === 'left' ? -0.03885 : 0.03885, 0.052, 0.07937],
                    scale: this.format === 'glb' ? 1 : 12.5,
                    opacity: 1,
                }));
            } catch (error) {
                this.report(`不对称眼资源加载失败：${error.message}`);
            }
        }
        this.effectGroups.set('futougou', items);
    }

    update() {
        if (!this.state.starEyes || !this.starMaps.length) return;
        const resource = this.starEyeResource() || {};
        const frame = Math.floor((performance.now() / 1000) * (resource.tileFPS || 10));
        if (frame !== this.starFrame) {
            this.starFrame = frame;
            this.setStarFrame(frame);
        }
    }

    disposeRuntime() {
        for (const key of this.effectGroups.keys()) this.clearGroup(key);
        for (const { material } of this.materialEntries) {
            if (material.userData?.facialBaseMap) material.map = material.userData.facialBaseMap;
            const uniforms = material.userData?.gakumasUniforms;
            const starBase = material.userData?.facialStarUniforms;
            if (uniforms && starBase) {
                if (uniforms.gkShadeMap) uniforms.gkShadeMap.value = starBase.shade;
                if (uniforms.gkDefMap) uniforms.gkDefMap.value = starBase.def;
                if (uniforms.gkHasShade) uniforms.gkHasShade.value = starBase.hasShade;
                delete material.userData.facialStarUniforms;
            }
            if (material.userData?.facialBaseColor && material.color) material.color.copy(material.userData.facialBaseColor);
            if (material.userData?.facialBaseOpacity !== undefined) material.opacity = material.userData.facialBaseOpacity;
            if (material.userData?.facialBaseTransparent !== undefined) material.transparent = material.userData.facialBaseTransparent;
            material.needsUpdate = true;
        }
        this.materialEntries = [];
        this.faceMeshes = [];
        this.model = null;
        this.head = null;
        this.eyeUnder = { left: null, right: null };
        this.starMaps = [];
        this.starFrame = -1;
        // disposeObject() owns the previous model's materials and textures.
        // Do not reuse cached objects after that call: its recursive cleanup
        // disposes maps and child geometries as well.
        this.textureCache.clear();
        this.geometryCache.clear();
        this.loading.clear();
    }

    dispose() {
        this.disposeRuntime();
    }
}
