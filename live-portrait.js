import * as THREE from 'three';
import { applyActorPose, applyCameraFocal, applyCameraPose } from './scene-free-look.js?v=20261103-camera-lens-v1';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js?v=20261005-hair-outline-v1';
import {
    MOTION_FADE,
    buildPlaylist,
    classifyClipTracks,
    fadeDurationForClip,
    fadeDurationForTransition,
    findGesturePlaylistIndex,
    findIdlePlaylistIndex,
    indexMotionFiles,
    playlistClipIds,
    sortPlaylistByCatalog,
} from './core.js?v=20261011-stage-cue-rules-v4';
import { idolAssetUrls, motionAssetUrls, motionAvailability } from './library-client.js?v=20261017-browser-cache-v1';
import { idolCostumeVariant, resolveBeatCostume } from './beat-costumes.js?v=20261013-all-idol-solo1-v1';
import { GAKUMAS_TEXTURE_KINDS, GAKUMAS_ACTIVE_TEXTURE_KINDS, selectMaterialTextures, setTextureColorSpace, textureDescriptor, textureUsesColorSpace } from './gakumas-materials.js?v=20261105-face-layer-off-v1';
import { injectActorShader } from './gakumas-shader.js?v=20261109-actor-light-v3';
import { actorStencilState, classifyActorPass, placeCharacterShadowLight, shouldCastCharacterShadow, shouldReceiveCharacterShadow } from './gakumas-passes.js?v=20261024-crowd-budget-v1';
import { HairCoverStage } from './gakumas-hair-cover.js?v=20261109-actor-light-v3';
import { ACTOR_ADDITIONAL_LIGHTS, GAKUMAS_LOOK, GakumasLookPass, actorEnvironmentSample, actorScenePoint, applyGakumasLookUniforms, applySceneActorUniforms, createActorRoomUniforms, createGakumasLookUniformValues, matcapKeyDirection } from './gakumas-look.js?v=20261109-actor-light-v3';
import { aaLevel } from './gakumas-aa.js?v=20261105-aa-level-v1';
import { GakumasPostPass, setCaptureMotionBlur } from './gakumas-post.js?v=20261105-floor-ssr-v1';
import { motionFromPositions } from './gakumas-taa-motion.js?v=20261027-motion-aware-taa-v1';
import { backgroundDepthBlur, backgroundPanAmount, stagePlateCover, zoomPlateCover } from './beat-player-core.js?v=20261110-hkne-3d-v1';
import { hasGakumasVertexColorAttribute } from './gakumas-outline.js?v=20260909-outline1';
import {
    LIVE_PORTRAIT_IDOL_ID,
    LIVE_PORTRAIT_PACK,
    canUseLivePortrait,
    isLivePortraitSpeaker,
    shouldPlayLivePortraitTalk,
    shouldShowLivePortrait,
} from './live-portrait-policy.js?v=20261006-beat-effects-v1';
import { parsePortraitCue, selectPortraitPerformance, portraitPerformanceCandidates } from './portrait-cues.js?v=20261103-paired-face-v1';
import { StageAttentionController } from './stage-attention.js?v=20261103-adopt-base-v1';
import { bindVisemeMorphs } from './dialogue-intent.js?v=20261011-emotion-cue-labels-v2';
import { applyTalkMouthProfile, selectTalkMouthProfile, talkArticulationFromPhase } from './tts-lip-sync.js?v=20261107-surprise-mouth-v1';
import { SceneDirector } from './scene-director.js?v=20261111-hkne-motions-v1';
import { portraitCrowdBudget } from './portrait-crowd-budget.js?v=20261024-crowd-budget-v1';
import { configureGlbAnimationTarget, detectLivePortraitFormat } from './live-portrait-model.js';
import { bindGlbMorphTracks } from './glb-morph-tracks.js?v=20260929-face-primitives-v1';
import { SecondaryMotion, applyHairRestRotationRebase, rebaseHairAnimationTracks, refreshRestInverseBinds } from './gakumas-secondary-motion.js?v=20261102-krnh-sleeve-gravity-v1';
import { SecondaryMotionProxy, physicsLead, physicsWorkerSupported } from './secondary-motion-proxy.js?v=20261106-physics-worker-v1';
import { FacialEffectsStage } from './facial-effects-stage.js?v=20261017-browser-cache-v1';
import { loadResourceLibrary } from './asset-runtime.js?v=20261111-hkne-motions-v1';
import { filterPreferredSitItems } from './seated-posture.js?v=20261027-seated-rollback-v1';
import { createPerformanceBucket, recordPerformanceSample, snapshotPerformanceBucket } from './performance-monitor-core.js?v=20261030-perf-diagnostic-v2';
import { phonePropForIdol, propVisibilityForCue, resolvePropAnchorName } from './stage-props.js';
import { collectSceneTextures, downscaleTextureSources } from './portrait-texture-budget.js?v=20261108-texture-budget-v1';
import { collectPostTargets, estimateImageTextureBytes, estimateRendererResources } from './gpu-resource-estimator.js?v=20261108-resource-monitor-v1';

function portraitMotionLoops(item) {
    const family = item?.family || item?.catalog?.family || '';
    if (family === 'walk' || family === 'running') return true;
    const phase = item?.phase || item?.catalog?.phase || '';
    if (phase === 'lp') return true;
    return String(item?.title || '').includes('循环');
}

export function createSceneDirector(container, runtimeOptions = {}) {
    return new SceneDirector(container, canvas => new LivePortraitRuntime(canvas, runtimeOptions));
}

export {
    LIVE_PORTRAIT_IDOL_ID,
    LIVE_PORTRAIT_PACK,
    canUseLivePortrait,
    isLivePortraitSpeaker,
    shouldPlayLivePortraitTalk,
    shouldShowLivePortrait,
};

const LIBRARY_JSON = './library.json?v=20261111-hkne-motions-v1';
const MOTION_MAP_JSON = './gakumas-motion-map.json?v=20261111-hkne-motions-v1';
const PRESENTATION_BUFFER_RELEASE_DELAY_MS = 8000;
const GPU_TEXTURE_RELEASE_DELAY_MS = 20000;
const STAGE_ASSET_ROOT = new URL('./', import.meta.url);
const SECONDARY_MOTION_JSON = new URL('gakumas-secondary-motion.json?v=20261002-secondary-motion-v25-kcna-native-skirt', STAGE_ASSET_ROOT).href;
const SECONDARY_MOTION_MANIFEST = new URL('secondary-motion-manifest.json?v=20261111-hkne-motions-v1', STAGE_ASSET_ROOT).href;
const SECONDARY_PROFILE_VERSION = '20261109-ssmk-collision-restore-v1';
const secondaryMotionTables = new Map();

// One worker per actor. Module workers must be same-origin, so when the stage
// is served from another origin (HATSU_ASSET_BASE) a tiny blob module imports
// the real worker script instead.
function createPhysicsWorker() {
    const url = new URL('./secondary-motion-worker.js?v=20261106-physics-worker-v1', import.meta.url);
    const options = { type: 'module', name: 'secondary-motion' };
    if (url.origin === globalThis.location?.origin) return new Worker(url, options);
    const wrapper = URL.createObjectURL(new Blob([`import ${JSON.stringify(url.href)};`], { type: 'text/javascript' }));
    const worker = new Worker(wrapper, options);
    setTimeout(() => URL.revokeObjectURL(wrapper), 60000);
    return worker;
}
const LIVE_PORTRAIT_GLB_SCALE = 12.5;
const VMD_GLB_BONE_ALIASES = new Map([
    ['センター', 'Center'], ['全ての親', 'Root'], ['上半身', 'UpperBody'], ['上半身2', 'UpperBody2'],
    ['下半身', 'LowerBody'], ['首', 'Neck'], ['頭', 'Head'], ['左目', 'LeftEye'], ['右目', 'RightEye'],
    ['左肩', 'LeftShoulder'], ['右肩', 'RightShoulder'], ['左腕', 'LeftArm'], ['右腕', 'RightArm'],
    ['左ひじ', 'LeftForeArm'], ['右ひじ', 'RightForeArm'], ['左手首', 'LeftHand'], ['右手首', 'RightHand'],
    ['左足', 'LeftUpLeg'], ['右足', 'RightUpLeg'], ['左ひざ', 'LeftLeg'], ['右ひざ', 'RightLeg'],
    ['左足首', 'LeftFoot'], ['右足首', 'RightFoot'], ['左つま先', 'LeftToeBase'], ['右つま先', 'RightToeBase'],
    // VMD bone names are limited to 15 bytes. The PMX writer shortens the
    // right middle finger; the GLB keeps Unity's full names.
    ['RHandMiddle1', 'RightHandMiddle1'], ['RHandMiddle2', 'RightHandMiddle2'], ['RHandMiddle3', 'RightHandMiddle3'],
]);

function modelVariantKey(name) {
    return String(name || '')
        .split(/[\\/]/).pop()
        .replace(/\.[^.]+$/, '')
        .replace(/-glb-hair-layer$/i, '')
        .toLowerCase();
}

function secondaryMotionReady(profileKey, fallbackId = '', resources = null) {
    if (resources) {
        const entry = resources.manifest.profiles.find(item => item.modelKey === profileKey || item.aliases?.includes(profileKey));
        const profilePath = entry?.profile || `secondary-motion-profiles/${fallbackId || profileKey}.json`;
        return resources.fetch(new URL(`${profilePath}?v=${SECONDARY_PROFILE_VERSION}`, STAGE_ASSET_ROOT).href).then(response => response.json());
    }
    const key = profileKey || fallbackId || 'fallback';
    if (secondaryMotionTables.has(key)) return secondaryMotionTables.get(key);
    const request = fetch(SECONDARY_MOTION_MANIFEST)
        .then(response => response.ok ? response.json() : null)
        .catch(() => null)
        .then(manifest => {
            const entry = manifest?.models?.find(item =>
                item?.modelKey === profileKey || item?.aliases?.includes(profileKey));
            const profilePath = entry?.profile
                ? String(entry.profile).replace(/^\.\//, '')
                : `secondary-motion-profiles/${encodeURIComponent(fallbackId || profileKey || 'fktn')}.json`;
            const profileUrl = new URL(`${profilePath}?v=${SECONDARY_PROFILE_VERSION}`, STAGE_ASSET_ROOT).href;
            return fetch(profileUrl)
                .then(response => response.ok ? response.json() : fetch(SECONDARY_MOTION_JSON).then(fallback => {
                    if (!fallback.ok) throw new Error(fallback.statusText);
                    return fallback.json();
                }));
        })
        .catch(error => {
            console.warn('[LivePortrait] secondary motion table failed', error);
            return null;
        });
    secondaryMotionTables.set(key, request);
    return request;
}

function collectModelComplexity(model) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    const bones = new Set();
    let meshes = 0;
    let skinnedMeshes = 0;
    let vertices = 0;
    let triangles = 0;
    const textureKeys = ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap', 'lightMap', 'envMap', 'matcap', 'toonMap', 'specularMap'];
    model?.traverse?.(object => {
        if (object.isMesh) meshes += 1;
        if (object.isSkinnedMesh) {
            skinnedMeshes += 1;
            object.skeleton?.bones?.forEach(bone => bones.add(bone));
        }
        if (object.geometry && !geometries.has(object.geometry)) {
            geometries.add(object.geometry);
            const position = object.geometry.attributes?.position;
            const index = object.geometry.index;
            vertices += Number(position?.count) || 0;
            triangles += Math.floor((Number(index?.count) || Number(position?.count) || 0) / 3);
        }
        for (const material of (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean)) {
            if (materials.has(material)) continue;
            materials.add(material);
            textureKeys.forEach(key => {
                const texture = material[key];
                if (texture?.isTexture) textures.add(texture);
            });
            Object.values(material.uniforms || {}).forEach(uniform => {
                const texture = uniform?.value;
                if (texture?.isTexture) textures.add(texture);
            });
        }
    });
    return { meshes, skinnedMeshes, geometries: geometries.size, materials: materials.size, textures: textures.size, bones: bones.size, vertices, triangles };
}

function normalizedBoneKey(name) {
    return String(name || '').trim().replace(/[\s_\-.]/g, '').toLowerCase();
}

function resolveVmdBoneName(rawName, bones) {
    const list = Array.isArray(bones) ? bones : [];
    const exact = new Map(list.map(bone => [bone.name, bone.name]));
    const raw = String(rawName || '').trim();
    if (exact.has(raw)) return raw;
    const alias = VMD_GLB_BONE_ALIASES.get(raw);
    if (alias && exact.has(alias)) return alias;
    const byKey = new Map(list.map(bone => [normalizedBoneKey(bone.name), bone.name]));
    const key = normalizedBoneKey(raw);
    const variants = [
        key,
        key.replace(/^(?:j)?(?:bip)?(?:c|l|r)?/, ''),
        key.replace(/^(?:j_)?(?:bip_)?(?:c_|l_|r_)?/i, ''),
    ].filter(Boolean);
    for (const variant of variants) if (byKey.has(variant)) return byKey.get(variant);
    const suffixMatches = list.filter(bone => {
        const candidate = normalizedBoneKey(bone.name);
        return Math.min(candidate.length, key.length) >= 5 && (candidate.endsWith(key) || key.endsWith(candidate));
    });
    return suffixMatches.length === 1 ? suffixMatches[0].name : raw;
}

let singleton = null;
const livePicture = { taa: true, aa: 'medium', plateSharpen: true, motionBlur: false };
const livePictureRuntimes = new Set();

export function setLivePictureOptions(options = {}) {
    if (typeof options.plateSharpen === 'boolean') livePicture.plateSharpen = options.plateSharpen;
    if (typeof options.motionBlur === 'boolean') livePicture.motionBlur = options.motionBlur;
    setCaptureMotionBlur(livePicture.motionBlur);
    const requested = typeof options.aa === 'string' ? aaLevel(options.aa) : null;
    if (requested && requested.id === options.aa) {
        livePicture.aa = requested.id;
        livePicture.taa = requested.taa;
    } else if (typeof options.taa === 'boolean') {
        livePicture.taa = options.taa;
        const current = aaLevel(livePicture.aa);
        if (options.taa && !current.taa) livePicture.aa = 'medium';
        if (!options.taa && current.taa) livePicture.aa = 'off';
    }
    for (const runtime of livePictureRuntimes) runtime.syncPictureOptions({ render: true });
}

export function attachLivePortrait(canvas) {
    if (singleton) {
        if (canvas) singleton.adoptCanvas(canvas);
        return singleton;
    }
    singleton = new LivePortraitRuntime(canvas);
    return singleton;
}

export class LivePortraitRuntime {
    constructor(canvas, options = {}) {
        this.canvas = canvas || null;
        this.autoIdleAdditiveOnHold = options.autoIdleAdditiveOnHold === true;
        this.cameraFrame = {
            distanceFactor: Number.isFinite(Number(options.cameraDistanceFactor)) && Number(options.cameraDistanceFactor) > 0
                ? Number(options.cameraDistanceFactor)
                : 1.72,
            targetY: Number.isFinite(Number(options.cameraTargetY))
                ? Math.min(1, Math.max(0, Number(options.cameraTargetY)))
                : 0.52,
        };
        // The camera is framed from the model bounds once the model/first
        // visible pose is ready. Keep that framing while a beat is held: the
        // action and secondary-motion poses can change the bounds by a few
        // pixels, which must not move an already established shot.
        this.cameraFrameReady = false;
        this.stageScene = null;
        this.sceneModelFrame = null;
        this.stageSceneViewKey = '';
        this.libraryReady = false;
        this.available = false;
        this.ready = false;
        this.talking = false;
        this.talkPhase = 0;
        this.talkLevel = 0;
        this.talkLevelDriven = false;
        this.talkSpeechActive = false;
        this.talkProfileHint = '';
        this.talkOverlay = [];
        this.talkTakeoverActive = false;
        this.talkBasePreparedForFrame = false;
        this.activeTalkProfile = null;
        this.visemeBound = {};
        this.paused = true;
        this.crowdBudget = null;
        this.gpuTexturesReleased = false;
        this.performanceMonitor = {
            enabled: globalThis.__HATSU_PERF_MONITOR_ENABLED === true,
            bucket: createPerformanceBucket(),
            model: null,
            modelStats: null,
        };
        this.crowdSerial = 0;
        this.physicsDebt = 0;
        this.config = null;
        this.map = null;
        this.status = null;
        this.indexByPack = new Map();
        this.model = null;
        this.animationTarget = null;
        this.props = new Map();
        this.propLoadPromise = null;
        this.modelFormat = '';
        this.animationMixer = null;
        this.taaMotionTarget = null;
        this.taaPreviousPositions = [];
        this.restPose = null;
        this.helper = new MMDAnimationHelper({ afterglow: 0, sync: true });
        this.secondaryMotion = new SecondaryMotion();
        this.secondaryMotionBound = false;
        // Set only while a worker holds an identical binding; otherwise the
        // in-thread solver above runs exactly as before.
        this.physicsProxy = null;
        this.hairRestRebase = [];
        this.modelKey = '';
        this.actions = new Map();
        this.playlist = [];
        this.playlistIndex = -1;
        this.liveActions = [];
        this.fadingActions = [];
        this.finishedHandler = null;
        this.pendingFinish = null;
        this.additiveAction = null;
        this.additiveFinishedHandler = null;
        this.pendingAdditiveFinish = null;
        this.additiveClipId = '';
        this.basePerformanceFinished = false;
        this.performanceKey = '';
        this.performanceSelection = null;
        this.playGeneration = 0;
        this.frameId = 0;
        this.presentationReleaseTimer = 0;
        this.clock = new THREE.Clock();
        this.gakumasHeadBone = null;
        this.gakumasHeadRight = new THREE.Vector3(1, 0, 0);
        this.gakumasLightDirection = new THREE.Vector3();
        this.gakumasTextures = [];
        this.gakumasFallbacks = {};
        this.gakumasUniforms = new Set();
        this.hairCoverStage = new HairCoverStage();
        this.facialEffects = new FacialEffectsStage({
            basePath: './assets/facial-effects',
            idolId: LIVE_PORTRAIT_IDOL_ID,
        });
        this.shadowStrength = GAKUMAS_LOOK.shadow;
        this.gakumasPasses = { characterShadow: true, hairCover: true, hairCoverMinimum: 0.35 };
        this.outline = { color: '#000000', alpha: 0.82, thickness: 0.004 };
        this.characterCenter = new THREE.Vector3(0, 8, 0);
        this.characterShadowFit = { center: new THREE.Vector3(0, 8, 0), radius: 10 };
        this.renderer = null;
        this.outlineEffect = null;
        this.lookPass = null;
        this.postPass = null;
        this.plateTexture = null;
        this.plateImage = null;
        this.platePan = { x: 0.5, y: 0.5 };
        this.plateCover = new THREE.Vector4(1, 1, 0, 0);
        this.plateScene = null;
        this.plateCamera = null;
        this.plateMaterial = null;
        this.shotFrame = { scale: 1, originX: 0.5, originY: 0.62, shiftX: 0 };
        this.shotMatrix = new THREE.Matrix4();
        this.scene = null;
        this.camera = null;
        this.attention = new StageAttentionController();
        this.hemi = null;
        this.keyLight = null;
        this.keyPointLight = null;
        this.rimLight = null;
        this.characterShadowLight = null;
        this.ensurePromise = null;
        livePictureRuntimes.add(this);
        if (canvas) this.setupRenderer(canvas);
    }

    adoptCanvas(canvas) {
        if (!canvas || this.canvas === canvas) return;
        this.disposeRenderer();
        this.canvas = canvas;
        this.setupRenderer(canvas);
        if (this.model && this.scene) this.scene.add(this.model);
        this.frameVnCamera();
        this.resize();
    }

    setupRenderer(canvas) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1;
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.outlineEffect = new OutlineEffect(this.renderer, {
            defaultThickness: this.outline.thickness,
            defaultColor: [0, 0, 0],
            defaultAlpha: this.outline.alpha,
            defaultKeepAlive: true,
        });
        this.lookPass = new GakumasLookPass(this.renderer);
        this.lookPass.enabled = true;
        this.postPass = new GakumasPostPass(this.renderer, { keepAlpha: true });
        this.postPass.enabled = true;
        this.postPass.setModule('taa', true);
        this.syncPictureOptions();
        this.scene = new THREE.Scene();
        this.cameraFrameReady = false;
        this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 1000);
        const updateProjection = this.camera.updateProjectionMatrix.bind(this.camera);
        this.camera.updateProjectionMatrix = () => {
            updateProjection();
            this.applyShotProjection();
        };
        this.plateCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.plateMaterial = new THREE.ShaderMaterial({
            uniforms: {
                gkPlate: { value: null },
                gkPlateCover: { value: this.plateCover },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D gkPlate;
                uniform vec4 gkPlateCover;
                varying vec2 vUv;
                void main() {
                    vec2 uv = vec2(vUv.x, 1.0 - vUv.y) * gkPlateCover.xy + gkPlateCover.zw;
                    gl_FragColor = vec4(texture2D(gkPlate, clamp(uv, 0.0, 1.0)).rgb, 0.0);
                }
            `,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        });
        const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.plateMaterial);
        plateMesh.frustumCulled = false;
        this.plateScene = new THREE.Scene();
        this.plateScene.add(plateMesh);
        this.hemi = new THREE.HemisphereLight(0xdce8ff, 0x6d7777, GAKUMAS_LOOK.hemi);
        this.keyLight = new THREE.DirectionalLight(GAKUMAS_LOOK.keyColor, GAKUMAS_LOOK.key);
        this.keyLight.position.set(8, 16, 10);
        this.keyLight.target.position.copy(this.characterCenter);
        this.keyPointLight = new THREE.PointLight(GAKUMAS_LOOK.keyColor, GAKUMAS_LOOK.key * 0.05, 0, 0);
        this.rimLight = new THREE.DirectionalLight(0xffffff, 1);
        this.rimLight.position.set(-8, 10, -7);
        this.characterShadowLight = new THREE.DirectionalLight(0xffffff, 0);
        this.characterShadowLight.castShadow = true;
        this.characterShadowLight.shadow.mapSize.set(4096, 4096);
        this.characterShadowLight.shadow.bias = 0;
        this.characterShadowLight.shadow.normalBias = 0;
        this.characterShadowLight.shadow.radius = 0;
        this.characterShadowLight.userData.gakumasCharacterShadow = true;
        this.scene.add(this.hemi, this.keyLight.target, this.keyLight, this.keyPointLight, this.rimLight, this.characterShadowLight.target, this.characterShadowLight);
        this.applyKeyLight(GAKUMAS_LOOK.keyAzimuth, GAKUMAS_LOOK.keyElevation);
    }

    disposeRenderer() {
        this.setStageScene(null);
        this.stopLoop();
        this.lookPass?.dispose();
        this.lookPass = null;
        this.postPass?.dispose();
        this.postPass = null;
        this.plateTexture?.dispose();
        this.plateTexture = null;
        this.plateImage = null;
        this.plateMaterial?.dispose();
        this.plateScene?.traverse(object => object.geometry?.dispose());
        this.plateMaterial = null;
        this.plateScene = null;
        this.plateCamera = null;
        this.outlineEffect = null;
        this.renderer?.dispose();
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.hemi = null;
        this.keyLight = null;
        this.keyPointLight = null;
        this.rimLight = null;
        this.characterShadowLight = null;
    }

    async prepare() {
        if (this.libraryReady) return this.available;
        try {
            const { config, map, status } = await loadResourceLibrary();
            this.config = config;
            this.map = map;
            this.status = status;
            this.indexByPack = new Map(Object.entries(this.status?.packs || {}).map(([packId, pack]) => [packId, indexMotionFiles(pack.files || [])]));
            this.available = this.config.idols.length > 0 && (
                !this.status?.packs || Boolean(this.status?.packs?.[LIVE_PORTRAIT_PACK]?.available)
            );
        } catch (error) {
            console.warn('[LivePortrait] library unavailable', error);
            this.available = false;
        }
        this.libraryReady = true;
        return this.available;
    }

    canUse(idolId = LIVE_PORTRAIT_IDOL_ID, costume = 'Default') {
        const idol = idolCostumeVariant(this.config?.idols?.find(item => item.id === idolId), costume);
        if (!idol) return false;
        if (!this.status?.packs) return true;
        return Boolean(this.status.packs[idol.pack]?.available);
    }

    async ensure(idolId = LIVE_PORTRAIT_IDOL_ID, costume = 'Default') {
        const costumeId = resolveBeatCostume(costume, idolId);
        if (!costumeId) return false;
        if (this.ready && this.model) return this.idolId === idolId && (this.costumeId || 'Default') === costumeId;
        if (this.ensurePromise) return this.ensurePromise;
        this.ensurePromise = this.loadIdol(idolId, costumeId).finally(() => {
            this.ensurePromise = null;
        });
        return this.ensurePromise;
    }

    async loadIdol(idolId, costume = 'Default') {
        await this.prepare();
        if (!this.canUse(idolId, costume) || !this.canvas || !this.renderer) return false;
        const idol = idolCostumeVariant(this.config?.idols?.find(item => item.id === idolId), costume);
        if (!idol) return false;
        this.idolId = idolId;
        this.costumeId = resolveBeatCostume(costume, idolId);
        const packFiles = this.status?.packs?.[idol.pack]?.files || [];
        const textureNames = packFiles
            .filter(name => !idol.textureDir || name.startsWith(`${idol.textureDir}/`) || !name.includes('/'))
            .map(name => name.split('/').pop());
        const assets = idolAssetUrls(idol, this.config, textureNames.filter(name => /\.(png|jpe?g|webp)$/i.test(name)), idol.localOnly ? { source: 'local' } : undefined);
        const format = detectLivePortraitFormat(idol);
        const { loader } = this.createModelLoader(idol, assets.textures || []);
        const loaded = await new Promise((resolve, reject) => loader.load(assets.modelUrl, resolve, undefined, reject));
        const model = format === 'glb' ? loaded?.scene : loaded;
        if (!model) throw new Error(`${format.toUpperCase()} 没有可显示的场景根节点`);
        let animationTarget = model;
        if (format === 'glb') {
            const skinned = [];
            model.traverse(child => {
                if (!child.isMesh) return;
                const geometry = child.geometry;
                const packed = geometry?.getAttribute?.('_gakumas_vertex_color') || geometry?.getAttribute?.('color');
                if (packed?.itemSize === 4) {
                    geometry.setAttribute('gakumasVertexColor', packed);
                    geometry.userData.gakumasPackedVertexColor = true;
                }
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.filter(Boolean).forEach(material => {
                    if (material.map) material.userData.gakumasEmbeddedBaseMap = material.map;
                    material.vertexColors = false;
                    material.name = material.name.replace(/\s*\[(?:HairPortFallback|GLB)\]/g, '').trim();
                    material.needsUpdate = true;
                });
                if (child.isSkinnedMesh && child.skeleton) skinned.push(child);
            });
            animationTarget = configureGlbAnimationTarget(model, skinned).animationTarget;
            model.scale.setScalar(LIVE_PORTRAIT_GLB_SCALE);
        }
        this.model = model;
        this.animationTarget = animationTarget;
        this.modelFormat = format;
        this.modelKey = format === 'glb' ? modelVariantKey(idol.model) : '';
        this.captureRestPose(model);
        this.attention.bind(model);
        this.gakumasHeadBone = null;
        model.traverse(child => {
            if (!this.gakumasHeadBone && child.isBone && /^(?:head|頭|頭部)$/i.test(child.name)) this.gakumasHeadBone = child;
            if (child.isMesh) {
                child.castShadow = false;
                child.receiveShadow = false;
            }
        });
        this.scene.add(model);
        model.updateMatrixWorld(true);
        const sceneFrameBox = new THREE.Box3().setFromObject(model);
        this.sceneModelFrame = sceneFrameBox.isEmpty() ? null : {
            height: (sceneFrameBox.max.y - sceneFrameBox.min.y) / LIVE_PORTRAIT_GLB_SCALE,
            footY: sceneFrameBox.min.y / LIVE_PORTRAIT_GLB_SCALE,
        };
        await this.waitForModelTextures(model);
        await this.loadGakumasTextures(assets.textures || []);
        this.applyGakumasMaterials();
        this.facialEffects.setIdolId(idolId);
        this.facialEffects.resources = this.resources;
        if (this.resources) this.facialEffects.loader = new THREE.TextureLoader(this.resources.manager(THREE));
        await this.facialEffects.attach(model, { format, idolId });
        this.bindVisemeMorphs(idol);
        this.secondaryMotion.worldScale = format === 'glb' ? LIVE_PORTRAIT_GLB_SCALE : 1;
        // MMDAnimationHelper expects PMX metadata (geometry.userData.MMD.iks
        // and grants). GLB exports do not contain that metadata, so drive
        // their shared skeleton with a plain AnimationMixer instead.
        if (format !== 'glb') this.helper.add(animationTarget, { physics: false });
        else this.animationMixer = new THREE.AnimationMixer(model);
        await this.bindSecondaryMotion(model);
        await this.loadPhoneProp(idolId);
        this.textureBudget = await downscaleTextureSources([
            ...collectSceneTextures(this.scene),
            ...this.gakumasTextures.map(entry => entry.texture),
            ...Object.values(this.gakumasFallbacks),
        ]);
        this.frameVnCamera();
        await this.ensureFamily('idle', { play: true });
        this.ready = Boolean(this.model);
        return this.ready;
    }

    async loadPhoneProp(idolId = this.idolId) {
        const definition = phonePropForIdol(idolId);
        if (!definition || !this.model || this.modelFormat !== 'glb') return false;
        if (this.props.has(definition.id)) return true;
        if (this.propLoadPromise) return this.propLoadPromise;
        this.propLoadPromise = (async () => {
            const sourceUrl = new URL(definition.local, STAGE_ASSET_ROOT).href;
            const url = this.resources?.resolve(sourceUrl) || sourceUrl;
            const loader = new GLTFLoader(this.resources?.manager(THREE));
            const loaded = await loader.loadAsync(url);
            const root = loaded?.scene;
            if (!root) return false;
            const boneNames = [];
            this.model.traverse(child => { if (child.isBone) boneNames.push(child.name); });
            const anchorName = resolvePropAnchorName(boneNames, definition.anchorNames);
            const anchor = anchorName ? this.model.getObjectByName(anchorName) : null;
            if (!anchor) return false;
            root.name = `stage-prop-${definition.id}`;
            root.position.fromArray(definition.offset || [0, 0, 0]);
            root.rotation.fromArray(definition.rotation || [0, 0, 0]);
            root.scale.setScalar(Number(definition.scale) || 1);
            root.visible = false;
            root.traverse(child => {
                if (!child.isMesh) return;
                child.castShadow = true;
                child.receiveShadow = true;
            });
            anchor.add(root);
            this.props.set(definition.id, { definition, root, anchor, anchorName });
            return true;
        })().catch(error => {
            console.warn('[LivePortrait] phone prop unavailable', idolId, error);
            return false;
        }).finally(() => { this.propLoadPromise = null; });
        return this.propLoadPromise;
    }

    setPropVisibility(propId, visible) {
        const entry = this.props.get(String(propId || ''));
        if (!entry?.root) return false;
        entry.root.visible = Boolean(visible);
        return true;
    }

    applyPropCue(cue) {
        const visibility = propVisibilityForCue(cue);
        if (visibility === null) return false;
        return this.setPropVisibility('phone', visibility);
    }

    disposeProps() {
        for (const { root } of this.props.values()) {
            root.removeFromParent();
            root.traverse(child => {
                if (child.geometry?.dispose) child.geometry.dispose();
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.filter(Boolean).forEach(material => {
                    Object.values(material).forEach(value => { if (value?.isTexture) value.dispose(); });
                    material.dispose?.();
                });
            });
        }
        this.props.clear();
        this.propLoadPromise = null;
    }

    bindVisemeMorphs(idol) {
        const names = [];
        this.model?.traverse(child => {
            if (child.isMesh && child.morphTargetDictionary) names.push(...Object.keys(child.morphTargetDictionary));
        });
        this.visemeBound = bindVisemeMorphs([...new Set(names)], idol?.visemes || {});
    }

    restoreTalkOverlay() {
        this.talkOverlay ||= [];
        if (!this.talkOverlay.length) return;
        for (const { child, name, weight } of this.talkOverlay) {
            const index = child?.morphTargetDictionary?.[name];
            if (Number.isInteger(index) && child.morphTargetInfluences) child.morphTargetInfluences[index] = weight;
        }
        this.talkOverlay.length = 0;
    }

    restoreTalkBaseMouth() {
        this.talkOverlay ||= [];
        for (const { child, name, weight } of this.talkOverlay) {
            const index = child?.morphTargetDictionary?.[name];
            if (Number.isInteger(index) && child.morphTargetInfluences) child.morphTargetInfluences[index] = weight;
        }
    }

    refreshTalkBaseMouth() {
        this.talkOverlay ||= [];
        for (const item of this.talkOverlay) {
            const index = item.child?.morphTargetDictionary?.[item.name];
            if (Number.isInteger(index) && item.child.morphTargetInfluences) {
                item.weight = item.child.morphTargetInfluences[index] || 0;
            }
        }
    }

    recordTalkOverlay(names) {
        this.talkOverlay ||= [];
        if (!this.model || !Array.isArray(names) || !names.length) return;
        this.model.traverse(child => {
            if (!child.morphTargetDictionary || !child.morphTargetInfluences) return;
            for (const name of names) {
                const index = child.morphTargetDictionary[name];
                if (!Number.isInteger(index) || this.talkOverlay.some(item => item.child === child && item.name === name)) continue;
                this.talkOverlay.push({ child, name, weight: child.morphTargetInfluences[index] || 0 });
            }
        });
    }

    talkMorphBindings() {
        const bindings = [];
        this.model?.traverse(child => {
            if (child.morphTargetDictionary && child.morphTargetInfluences) {
                bindings.push({ child, dictionary: child.morphTargetDictionary, influences: child.morphTargetInfluences });
            }
        });
        return bindings;
    }

    talkMorphNames() {
        const names = new Set();
        for (const { dictionary } of this.talkMorphBindings()) {
            for (const name of Object.keys(dictionary || {})) {
                if (/^(?:b_mouth\.)?mouth_\d+$/i.test(name)) names.add(name);
            }
        }
        for (const target of [...(this.visemeBound?.A || []), ...(this.visemeBound?.I || [])]) {
            if (target?.name) names.add(target.name);
        }
        return [...names];
    }

    beginTalkMorphTakeover() {
        if (this.talkTakeoverActive) return;
        this.recordTalkOverlay(this.talkMorphNames());
        this.talkTakeoverActive = true;
        this.talkBasePreparedForFrame = false;
    }

    prepareTalkMorphProfile() {
        if (this.activeTalkProfile) return this.activeTalkProfile;
        const binding = this.talkMorphBindings().find(item => Object.keys(item.dictionary).some(name => /^(?:b_mouth\.)?mouth_\d+$/i.test(name)));
        if (!binding) return null;
        this.activeTalkProfile = selectTalkMouthProfile({
            dictionary: binding.dictionary,
            influences: binding.influences,
            hint: this.talkProfileHint || this.performanceSelection?.face || '',
        });
        return this.activeTalkProfile;
    }

    refreshTalkMorphProfile() {
        const binding = this.talkMorphBindings().find(item => Object.keys(item.dictionary).some(name => /^(?:b_mouth\.)?mouth_\d+$/i.test(name)));
        if (!binding) {
            this.activeTalkProfile = null;
            return null;
        }
        this.activeTalkProfile = selectTalkMouthProfile({
            dictionary: binding.dictionary,
            influences: binding.influences,
            hint: this.talkProfileHint || this.performanceSelection?.face || '',
        });
        return this.activeTalkProfile;
    }

    clearTalkMorphTargets() {
        const names = new Set([
            ...(this.visemeBound?.A || []).map(target => String(target?.name || '').toLowerCase()),
            ...(this.visemeBound?.I || []).map(target => String(target?.name || '').toLowerCase()),
        ]);
        for (const { dictionary, influences } of this.talkMorphBindings()) {
            for (const [name, index] of Object.entries(dictionary || {})) {
                if (/^(?:b_mouth\.)?mouth_\d+$/i.test(name) || names.has(name.toLowerCase())) {
                    if (Number.isInteger(index)) influences[index] = 0;
                }
            }
        }
    }

    endTalkMorphTakeover() {
        if (!this.talkTakeoverActive) {
            this.activeTalkProfile = null;
            return;
        }
        this.restoreTalkOverlay();
        this.talkTakeoverActive = false;
        this.talkBasePreparedForFrame = false;
        // The persistent overlay is the current expression layer. Restore it
        // and leave it visible when the voice line ends; a neutral expression
        // already has zero mouth weights.
        this.activeTalkProfile = null;
    }

    updateNumberedTalkMorph(talkPower, phase = 0) {
        const binding = this.talkMorphBindings().find(item => Object.keys(item.dictionary).some(name => /^(?:b_mouth\.)?mouth_\d+$/i.test(name)));
        if (!binding) return false;
        const profile = this.prepareTalkMorphProfile();
        if (!profile) return false;
        let applied = false;
        for (const item of this.talkMorphBindings()) {
            applied = applyTalkMouthProfile({
                influences: item.influences,
                dictionary: item.dictionary,
                profile,
                talkPower,
                phase,
                replace: true,
            }) || applied;
        }
        return applied;
    }

    talkMorphIndex(dictionary, name) {
        const wanted = String(name || '').toLowerCase();
        const candidates = new Set([wanted, `b_mouth.${wanted}`]);
        const actual = Object.keys(dictionary || {}).find(key => candidates.has(String(key).toLowerCase()));
        const index = actual ? dictionary[actual] : -1;
        return Number.isInteger(index) ? index : -1;
    }

    talkBaseWeight(child, dictionary, name) {
        const index = this.talkMorphIndex(dictionary, name);
        if (index < 0) return 0;
        const actual = Object.keys(dictionary || {}).find(key => dictionary[key] === index);
        const entry = this.talkOverlay?.find(item => item.child === child && String(item.name).toLowerCase() === String(actual || '').toLowerCase());
        return Number(entry?.weight) || 0;
    }

    updateNumberedTalkMorphBlend(talkPower, phase = 0) {
        const profile = this.prepareTalkMorphProfile();
        if (!profile) return false;
        const power = Math.min(1, Math.max(0, Number(talkPower) || 0));
        const opening = talkArticulationFromPhase(power, phase, 0.92);
        let applied = false;
        for (const { child, dictionary, influences } of this.talkMorphBindings().map(binding => ({
            child: binding.child,
            dictionary: binding.dictionary,
            influences: binding.influences,
        }))) {
            for (const [name, index] of Object.entries(dictionary || {})) {
                if (!/^(?:b_mouth\.)?mouth_\d+$/i.test(name) || !Number.isInteger(index)) continue;
                influences[index] = this.talkBaseWeight(child, dictionary, name) * (1 - power);
            }
            for (const name of profile.driver || []) {
                const index = this.talkMorphIndex(dictionary, name);
                if (index < 0) continue;
                influences[index] = this.talkBaseWeight(child, dictionary, name) * (1 - power) + opening;
                applied = true;
            }
        }
        return applied;
    }

    updateVisemeTalkMorph(talkPower, { replace = false, phase = 0 } = {}) {
        const targets = [...(this.visemeBound?.A || []), ...(this.visemeBound?.I || [])];
        if (!targets.length) return false;
        const cycle = 0.5 + 0.5 * Math.cos(Number(phase) || 0);
        const appliedPower = replace ? talkPower * (0.62 + cycle * 0.3) : talkPower;
        if (!replace) this.recordTalkOverlay(targets.map(target => target.name).filter(Boolean));
        let applied = false;
        this.model.traverse(child => {
            if (!child.morphTargetDictionary || !child.morphTargetInfluences) return;
            for (const target of targets) {
                const index = child.morphTargetDictionary[target.name];
                if (!Number.isInteger(index)) continue;
                const value = appliedPower * (target.weight || 1);
                const base = replace ? this.talkBaseWeight(child, child.morphTargetDictionary, target.name) * (1 - Math.min(1, Math.max(0, Number(talkPower) || 0))) : 0;
                child.morphTargetInfluences[index] = replace
                    ? base + value
                    : Math.max(child.morphTargetInfluences[index] || 0, value);
                applied = true;
            }
        });
        return applied;
    }

    updateTalkingMorph(delta) {
        if (!this.model) return;
        if (this.talkLevelDriven) {
            if (this.talking) {
                this.beginTalkMorphTakeover();
                if (this.talkBasePreparedForFrame) this.refreshTalkBaseMouth();
                this.refreshTalkMorphProfile();
                if (!this.talkSpeechActive || this.talkLevel <= 0.001) {
                    // A short unvoiced gap is still part of the same TTS
                    // session. Keep the saved expression so the next voiced
                    // frame can resume Talk without taking a new snapshot.
                    this.restoreTalkBaseMouth();
                    this.talkBasePreparedForFrame = false;
                    return;
                }
                this.talkPhase = (Number(this.talkPhase) || 0) + delta * (14 + this.talkLevel * 10);
                this.clearTalkMorphTargets();
                if (!this.updateNumberedTalkMorphBlend(this.talkLevel, this.talkPhase)) {
                    this.updateVisemeTalkMorph(this.talkLevel, { replace: true, phase: this.talkPhase });
                }
                this.talkBasePreparedForFrame = false;
            } else {
                this.endTalkMorphTakeover();
            }
            return;
        }
        this.endTalkMorphTakeover();
        this.restoreTalkOverlay();
        if (!this.talking) return;
        this.talkPhase = (Number(this.talkPhase) || 0) + delta * 9;
        const weight = 0.18 + (Math.sin(this.talkPhase) * 0.5 + 0.5) * 0.48;
        this.updateVisemeTalkMorph(weight);
    }

    async bindSecondaryMotion(model) {
        if (!model || !this.restPose?.length) return false;
        try {
            const glbProfile = this.modelFormat === 'glb';
            const table = await secondaryMotionReady(glbProfile ? this.modelKey : this.idolId, this.idolId || LIVE_PORTRAIT_IDOL_ID, this.resources);
            if (!table || this.model !== model) return false;
            // GLB profiles keep Unity's authored skirt frame. PMX keeps the
            // historical rest rebase because that export uses a different bind.
            this.secondaryMotion.table = glbProfile
                ? { ...table, skirtDriverBasis: 'gltf-unity', skirtDriverSettingsConverted: false }
                : table;
            this.hairRestRebase = glbProfile ? [] : applyHairRestRotationRebase(this.restPose, table);
            if (this.hairRestRebase.length) refreshRestInverseBinds(model);
            this.secondaryMotion.bind(this.restPose);
            this.secondaryMotionBound = true;
            await this.bindPhysicsWorker(model);
            return true;
        } catch (error) {
            if (this.resources) throw error;
            console.warn('[LivePortrait] secondary motion unavailable', error);
            this.secondaryMotionBound = false;
            this.hairRestRebase = [];
            return false;
        }
    }

    /**
     * Mirror the model's skeleton into a worker and run the solver there. The
     * in-thread solver stays bound as the reference: the worker is used only if
     * it reports the same spring count and the same missing bones.
     */
    async bindPhysicsWorker(model) {
        this.physicsProxy?.dispose();
        this.physicsProxy = null;
        // GLB is the production path. PMX rewrites live hair rest rotations
        // before binding, which the mirror would have to replay.
        if (this.modelFormat !== 'glb' || !physicsWorkerSupported()) return false;
        const proxy = new SecondaryMotionProxy({
            createWorker: createPhysicsWorker,
            lead: physicsLead(),
            onFail: reason => {
                if (this.physicsProxy === proxy) {
                    this.physicsProxy = null;
                    // The in-thread solver has been idle; re-seed it from the current pose.
                    if (this.secondaryMotionBound) this.secondaryMotion.reset();
                }
                console.warn('[LivePortrait] physics worker unavailable, using the in-thread solver:', reason);
            },
        });
        this.physicsProxy = proxy;
        const ok = await proxy.bind({
            restPose: this.restPose,
            table: this.secondaryMotion.table,
            worldScale: this.secondaryMotion.worldScale,
            expect: { springs: this.secondaryMotion.springs.length, missing: this.secondaryMotion.missing },
        });
        if (!ok || this.model !== model) {
            if (this.physicsProxy === proxy) this.physicsProxy = null;
            proxy.dispose();
            return false;
        }
        return true;
    }

    physicsRuntime() {
        return this.physicsProxy?.ready ? this.physicsProxy.runtime : this.secondaryMotion?.runtime;
    }

    catalogItems({ anyCharacter = false } = {}) {
        const buckets = this.map?.buckets || [];
        return filterPreferredSitItems(buckets.flatMap(bucket => bucket.families.flatMap(family => family.items.map(item => ({
            ...item,
            key: item.stem,
            catalog: {
                bucket: bucket.id,
                family: family.id,
                pairing: item.pairing,
                character: item.character,
                phase: item.phase,
                additive: item.additive,
            },
        })))).filter(item => anyCharacter || ['cmmn', this.idolId || LIVE_PORTRAIT_IDOL_ID].includes(item.character)));
    }

    async setFacialEffects(effects = []) {
        const values = new Set(Array.isArray(effects) ? effects : [effects]);
        return this.facialEffects.setState({
            starEyes: values.has('star-eyes'),
            noHighlight: values.has('no-highlight'),
            blackFace: values.has('black-face'),
            blackLines: values.has('black-lines'),
            futougou: values.has('unequal-eyes') || values.has('futougou'),
        });
    }

    idleAdditiveItems() {
        return this.catalogItems().filter(item => {
            const family = item.catalog?.family || item.family || '';
            const stem = String(item.stem || item.key || '');
            return item.additive === true
                && family === 'idle-preview'
                && /idle-\d+-add-lp/i.test(stem)
                && item.body;
        });
    }

    async ensureFamily(family, { play = false, skipFace = false, preferPairing = '', preferPhase = '' } = {}) {
        if (!this.model) return -1;
        const catalog = this.catalogItems();
        let index = -1;
        if (family === 'idle') {
            index = findIdlePlaylistIndex(catalog, this.idolId || LIVE_PORTRAIT_IDOL_ID);
            if (index < 0) {
                await this.playPlannedStandIn({ play, skipFace });
                return -1;
            }
        } else {
            index = findGesturePlaylistIndex(catalog, family, this.idolId || LIVE_PORTRAIT_IDOL_ID, {
                preferPairing: preferPairing || (skipFace ? 'bodyOnly' : 'paired'),
            });
            if (preferPhase && index >= 0) {
                const selected = catalog[index];
                const preferred = catalog.findIndex((item, itemIndex) => {
                    const familyId = item.catalog?.family || item.family || '';
                    return (familyId === family || familyId.startsWith(`${family}-`))
                        && (item.catalog?.phase || item.phase) === preferPhase
                        && (item.catalog?.variant || item.variant || '') === (selected.catalog?.variant || selected.variant || '')
                        && (item.catalog?.character || item.character) === (selected.catalog?.character || selected.character)
                        && (!preferPairing || (item.catalog?.pairing || item.pairing) === preferPairing);
                });
                if (preferred >= 0) index = preferred;
            }
        }
        if (index < 0) return -1;
        const item = catalog[index];
        const files = motionAssetUrls(item, this.config, this.indexByPack);
        if (!files.length) return -1;
        await this.importMotionEntries(files.map(file => ({
            id: file.id,
            label: item.label,
            url: file.url,
            name: file.name,
            additive: Boolean(item.additive),
        })));
        const playlistIndex = this.playlist.findIndex(entry => entry.key === (item.stem || item.key)
            || playlistClipIds(entry).some(id => files.some(file => file.id === id)));
        if (play && playlistIndex >= 0) this.playPlaylistIndex(playlistIndex, { skipFace, fade: MOTION_FADE.standing });
        return playlistIndex;
    }

    plannedStandIn() {
        const map = this.plannedPerformances;
        if (!map) return null;
        for (const [speaker, item] of map) {
            if (String(speaker).endsWith('(待机)') && item?.body) return item;
        }
        return null;
    }

    async playPlannedStandIn({ play = false, skipFace = false } = {}) {
        const item = this.plannedStandIn();
        if (!item?.body || !this.model) return false;
        let files = motionAssetUrls(item, this.config, this.indexByPack);
        if (skipFace) files = files.filter(file => file.kind === 'body');
        if (!files.length || files.some(file => file.guessed)) return false;
        await this.importMotionEntries(files.map(file => ({ ...file, label: item.label })));
        const clips = files.map(file => {
            const source = this.actions.get(file.id)?.clip;
            if (!source) return null;
            const tracks = source.tracks.filter(track => /\.morphTargetInfluences\[/.test(track.name) === (file.kind === 'face'));
            if (!tracks.length) return null;
            return {
                id: file.id,
                kind: file.kind,
                clip: new THREE.AnimationClip(`${file.id}:${file.kind}`, source.duration, tracks.map(track => track.clone())),
            };
        });
        if (clips.some(clip => !clip)) return false;
        if (!play) return true;
        return this.playPlaylistIndex(-1, { item, clips, fade: MOTION_FADE.standing });
    }

    cancelPerformance() {
        this.performanceGeneration = (this.performanceGeneration || 0) + 1;
    }

    async playStageTransition(family, { signal, isCurrent = () => true, onStart = () => {} } = {}) {
        this.cancelPerformance();
        this.performanceKey = '';
        this.performanceSelection = null;
        const index = await this.ensureFamily(family, { play: false });
        if (signal?.aborted || !isCurrent()) return false;
        if (index < 0) {
            console.warn(`[LivePortrait] transition unavailable`, family, this.idolId);
            return false;
        }

        if (!this.prepareStageFirstFrame(index)) return false;
        if (signal?.aborted || !isCurrent()) return false;
        onStart();
        const mixer = this.ensureMixer();
        const clips = this.liveActions.map(action => action.getClip());
        const longest = clips.reduce((left, right) => right.duration > left.duration ? right : left);
        return new Promise(resolve => {
            const finish = result => {
                mixer.removeEventListener('finished', handler);
                signal?.removeEventListener('abort', abort);
                resolve(result);
            };
            const handler = event => { if (event.action.getClip() === longest) finish(true); };
            const abort = () => finish(false);
            mixer.addEventListener('finished', handler);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
        });
    }

    async playSpeakerCue(speaker, { slideType = '', isCurrent = () => true, firstFrame = false } = {}) {
        this.cancelPerformance();
        const generation = this.performanceGeneration;
        let cue = parsePortraitCue(speaker, slideType, this.idolId || LIVE_PORTRAIT_IDOL_ID);
        if (!cue || !this.ready) return false;
        this.applyPropCue(cue);
        if (cue.mode === 'keep') {
            if (this.performanceKey) return true;
            cue = parsePortraitCue('藤田琴音(待机)');
        }
        const faceFileSuffix = cue.faceFile ? `:${cue.faceFile}` : '';
        const key = cue.mode === 'file'
            ? `file:${cue.file}:${cue.face || ''}${faceFileSuffix}`
            : cue.bodySelector
            ? `${cue.mode}:${cue.gesture}:${cue.bodySelector}:${cue.face}${faceFileSuffix}`
            : `${cue.mode}:${cue.gesture}:${cue.face}${faceFileSuffix}`;
        const catalog = this.catalogItems({ anyCharacter: cue.mode === 'file' || Boolean(cue.faceFile) }).filter(item => motionAvailability(item, this.indexByPack).ready);
        const previousSelection = key === this.performanceKey ? this.performanceSelection : null;
        const item = this.plannedPerformances?.get(speaker) || selectPortraitPerformance(cue, catalog, this.idolId || LIVE_PORTRAIT_IDOL_ID, {
            avoidBody: previousSelection?.body,
            avoidFace: previousSelection?.face,
        });
        if (!item) return false;
        if (cue.mode !== 'additive' && previousSelection && item.body === previousSelection.body && item.face === previousSelection.face) {
            this.holdSamePerformance();
            return true;
        }
        if (cue.mode !== 'additive') this.clearAdditiveClip();
        const files = motionAssetUrls(item, this.config, this.indexByPack);
        if (cue.mode !== 'file' && this.idolId === 'nasr' && !item.face && item.body) {
            const idle = await this.ensureFamily('idle', { play: !firstFrame, skipFace: true });
            if (!isCurrent() || generation !== this.performanceGeneration) return false;
            if (firstFrame && idle >= 0) this.prepareStageFirstFrame(idle);
            return idle >= 0;
        }
        if (cue.mode === 'additive') {
            if (files.length !== 1 || files[0].kind !== 'body' || files[0].guessed) return false;
            await this.importMotionEntries(files.map(file => ({ ...file, label: item.label, additive: Boolean(item.additive) })));
            if (generation !== this.performanceGeneration || !isCurrent()) return false;
            const source = this.actions.get(files[0].id)?.clip;
            if (!source) return false;
            return this.playAdditiveClip(source, files[0].id);
        }
        if (cue.mode === 'file' ? (!files.length || files.some(file => file.guessed)) : (files.length !== 2 || files.some(file => file.guessed))) return false;
        await this.importMotionEntries(files.map(file => ({ ...file, label: item.label })));
        if (generation !== this.performanceGeneration || !isCurrent()) return false;
        this.performanceClips ||= new Map();
        const clips = files.map(file => {
            const cacheKey = `${file.id}:${file.kind}`;
            if (!this.performanceClips.has(cacheKey)) {
                const source = this.actions.get(file.id)?.clip;
                if (!source) return null;
                const tracks = source.tracks.filter(track => /\.morphTargetInfluences\[/.test(track.name) === (file.kind === 'face'));
                if (!tracks.length) return null;
                const clip = new THREE.AnimationClip(cacheKey, source.duration, tracks.map(track => track.clone()));
                this.performanceClips.set(cacheKey, { id: file.id, kind: file.kind, clip });
            }
            return this.performanceClips.get(cacheKey);
        });
        if (clips.some(clip => !clip)) return false;
        const played = this.playPlaylistIndex(-1, {
            item,
            clips,
            // A newly revealed actor must show the selected action directly;
            // the canvas is kept hidden until its first frame is rendered.
            fade: firstFrame ? 0 : MOTION_FADE.standing,
        });
        if (played && firstFrame) this.prepareCurrentFirstFrame();
        if (played) {
            this.performanceKey = key;
            this.performanceSelection = { body: item.body || '', face: item.face || '' };
        }
        return played;
    }

    playAdditiveClip(source, clipId = '') {
        const mixer = this.ensureMixer();
        // These are head gestures over an independent body+face performance.
        // Full-body and facial tracks from a baked VMD must not dilute the base.
        if (!mixer || !source || !this.performanceKey?.startsWith('mixed:')) return false;
        this.clearAdditiveClip();
        this.performanceClips ||= new Map();
        const cacheKey = `${clipId}:head-additive`;
        if (!this.performanceClips.has(cacheKey)) {
            const tracks = source.tracks.filter(track => {
                if (!track.name.endsWith('.quaternion')) return false;
                const boneName = /^\.bones\[([^\]]+)\]\.quaternion$/u.exec(track.name)?.[1]
                    || track.name.slice(0, -'.quaternion'.length);
                return /(?:head|neck|頭|首)$/iu.test(boneName);
            });
            if (!tracks.length) return false;
            const clip = new THREE.AnimationClip(cacheKey, source.duration, tracks.map(track => track.clone()));
            THREE.AnimationUtils.makeClipAdditive(clip, 0);
            this.performanceClips.set(cacheKey, { clip });
        }
        const clip = this.performanceClips.get(cacheKey).clip;
        const action = mixer.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = false;
        action.blendMode = THREE.AdditiveAnimationBlendMode;
        action.enabled = true;
        action.setEffectiveTimeScale(1);
        action.setEffectiveWeight(1);
        this.additiveAction = action;
        mixer.timeScale = 1;
        action.play();
        const finish = event => {
            if (event.action !== action) return;
            // AnimationMixer is still iterating active actions here. stop()
            // swaps that array and can skip the body's sample for this frame.
            this.pendingAdditiveFinish = action;
        };
        this.additiveFinishedHandler = finish;
        mixer.addEventListener('finished', finish);
        mixer.update(0);
        return true;
    }

    playIdleAdditiveClip(source, clipId = '') {
        const mixer = this.ensureMixer();
        if (!mixer || !source) return false;
        this.clearAdditiveClip();
        this.performanceClips ||= new Map();
        const cacheKey = `${clipId}:idle-additive`;
        if (!this.performanceClips.has(cacheKey)) {
            const tracks = source.tracks.filter(track => !/\.morphTargetInfluences\[/.test(track.name));
            if (!tracks.length) return false;
            const clip = new THREE.AnimationClip(cacheKey, source.duration, tracks.map(track => track.clone()));
            THREE.AnimationUtils.makeClipAdditive(clip, 0);
            this.performanceClips.set(cacheKey, { clip });
        }
        const clip = this.performanceClips.get(cacheKey).clip;
        const action = mixer.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        action.blendMode = THREE.AdditiveAnimationBlendMode;
        action.enabled = true;
        action.setEffectiveTimeScale(1);
        action.setEffectiveWeight(1);
        this.additiveAction = action;
        this.additiveClipId = clipId;
        mixer.timeScale = 1;
        action.play();
        mixer.update(0);
        return true;
    }

    holdSamePerformance() {
        // A repeated cue keeps the held pose. A one-shot nod still ends, but
        // the looping breath must stay, or start if the pose is already held.
        if (this.additiveFinishedHandler) this.clearAdditiveClip();
        if (!this.basePerformanceFinished || !this.autoIdleAdditiveOnHold || this.additiveAction) return;
        this.playRandomIdleAdditiveOnHold(this.playGeneration).catch(error => {
            console.warn('[LivePortrait] idle additive hold failed', error);
        });
    }

    async playRandomIdleAdditiveOnHold(generation = this.playGeneration) {
        if (!this.autoIdleAdditiveOnHold || this.paused || !this.basePerformanceFinished || generation !== this.playGeneration) return false;
        const candidates = this.idleAdditiveItems();
        if (!candidates.length) return false;
        const item = candidates[Math.floor(Math.random() * candidates.length)];
        const files = motionAssetUrls(item, this.config, this.indexByPack);
        if (files.length !== 1 || files[0].kind !== 'body' || files[0].guessed) return false;
        await this.importMotionEntries(files.map(file => ({ ...file, label: item.label, additive: true })));
        if (this.paused || !this.basePerformanceFinished || generation !== this.playGeneration) return false;
        const source = this.actions.get(files[0].id)?.clip;
        return this.playIdleAdditiveClip(source, files[0].id);
    }

    clearAdditiveClip() {
        const mixer = this.model ? this.ensureMixer() : null;
        if (mixer && this.additiveFinishedHandler) mixer.removeEventListener('finished', this.additiveFinishedHandler);
        this.additiveFinishedHandler = null;
        this.pendingAdditiveFinish = null;
        this.additiveAction?.stop();
        this.additiveAction = null;
        this.additiveClipId = '';
        if (mixer && this.basePerformanceFinished) mixer.timeScale = 0;
    }

    async preloadCues(speakers, slideType = 'dialogue') {
        const unique = [...new Set((Array.isArray(speakers) ? speakers : []).map(value => String(value || '').trim()).filter(Boolean))];
        let complete = this.autoIdleAdditiveOnHold ? await this.preloadIdleAdditives() : true;
        for (const speaker of unique) complete = await this.preloadCue(speaker, slideType) && complete;
        return complete;
    }

    async preloadIdleAdditives() {
        if (!this.autoIdleAdditiveOnHold || !this.ready) return true;
        let complete = true;
        for (const item of this.idleAdditiveItems()) {
            const files = motionAssetUrls(item, this.config, this.indexByPack);
            if (files.length !== 1 || files[0].kind !== 'body' || files[0].guessed) {
                complete = false;
                continue;
            }
            await this.importMotionEntries(files.map(file => ({ ...file, label: item.label, additive: true })));
            complete = this.actions.has(files[0].id) && complete;
        }
        return complete;
    }

    async preloadCue(speaker, slideType = 'dialogue') {
        if (!this.ready) return false;
        let cue = parsePortraitCue(speaker, slideType, this.idolId || LIVE_PORTRAIT_IDOL_ID);
        if (!cue) return false;
        if (cue.mode === 'keep') cue = parsePortraitCue('藤田琴音(待机)');
        const catalog = this.catalogItems({ anyCharacter: cue.mode === 'file' || Boolean(cue.faceFile) }).filter(item => motionAvailability(item, this.indexByPack).ready);
        const selected = this.plannedPerformances?.get(speaker);
        const items = selected ? [selected] : portraitPerformanceCandidates(cue, catalog, this.idolId || LIVE_PORTRAIT_IDOL_ID);
        if (!items.length) return false;
        let complete = true;
        for (const item of items) {
            const files = motionAssetUrls(item, this.config, this.indexByPack);
            if (cue.mode === 'additive') {
                if (files.length !== 1 || files[0].kind !== 'body' || files[0].guessed) {
                    complete = false;
                    continue;
                }
            } else if (cue.mode === 'file'
                ? (!files.length || files.some(file => file.guessed))
                : ((files.length !== 2 && !(this.idolId === 'nasr' && files.length === 1 && !item.face)) || files.some(file => file.guessed))) {
                complete = false;
                continue;
            }
            await this.importMotionEntries(files.map(file => ({ ...file, label: item.label, additive: Boolean(item.additive) })));
            complete = files.every(file => this.actions.has(file.id)) && complete;
        }
        return complete;
    }

    async importMotionEntries(entries) {
        const loader = new MMDLoader(this.resources?.manager(THREE));
        for (const entry of entries) {
            if (this.actions.has(entry.id)) continue;
            try {
                const target = this.animationTarget || this.model;
                const clip = await this.loadMotionClip(loader, entry.url, target);
                rebaseHairAnimationTracks(clip, this.hairRestRebase);
                clip.name = entry.id;
                const { kind } = classifyClipTracks(clip.tracks.map(track => track.name));
                this.actions.set(entry.id, {
                    id: entry.id,
                    label: entry.label || entry.id,
                    clip,
                    kind,
                    additive: Boolean(entry.additive),
                });
            } catch (error) {
                if (this.resources) throw error;
                console.warn('[LivePortrait] motion failed', entry.id, error);
            }
        }
        this.playlist = sortPlaylistByCatalog(filterPreferredSitItems(buildPlaylist([...this.actions.values()]
            .filter(entry => !entry.additive)
            .map(({ id, label, kind }) => ({ id, label, kind })))));
    }

    captureRestPose(model) {
        const bones = [];
        const physicsNodes = [];
        model?.traverse?.(child => {
            if (child.isSkinnedMesh && child.skeleton?.bones) bones.push(...child.skeleton.bones);
            // UnityGLTF keeps some skirt and hair drivers as ordinary nodes.
            // They still belong to the secondary-motion hierarchy.
            if (child.name && child.quaternion && !child.isMesh) physicsNodes.push(child);
        });
        if (model?.skeleton?.bones?.length) bones.push(...model.skeleton.bones);
        const restNodes = [...new Set([...bones, ...physicsNodes])];
        this.restPose = restNodes.map(bone => ({
            bone,
            position: bone.position.clone(),
            quaternion: bone.quaternion.clone(),
            scale: bone.scale.clone(),
        }));
    }

    async loadMotionClip(loader, url, target) {
        if (this.modelFormat !== 'glb') {
            return new Promise((resolve, reject) => loader.loadAnimation(url, target, resolve, undefined, reject));
        }
        return new Promise((resolve, reject) => loader.loadVMD(url, vmd => {
            const bones = target?.skeleton?.bones || [];
            const dictionary = target?.userData?.glbMorphTarget?.morphTargetDictionary
                || target?.morphTargetDictionary || {};
            for (const motion of vmd.motions || []) motion.boneName = resolveVmdBoneName(motion.boneName, bones);
            const morphKeys = Object.keys(dictionary);
            for (const morph of vmd.morphs || []) {
                const raw = String(morph.morphName || '').trim();
                const aliases = [raw, raw.replace(/^b_mouth\./i, '')];
                const matched = morphKeys.find(name => aliases.some(alias => normalizedBoneKey(alias) === normalizedBoneKey(name)));
                if (matched) morph.morphName = matched;
            }
            const clip = loader.animationBuilder.build(vmd, target);
            const morphBinding = bindGlbMorphTracks(clip, dictionary, this.model);
            if (morphBinding.boundTracks === 0) {
                clip.tracks = clip.tracks.filter(track => !/^\.morphTargetInfluences\[/.test(track.name));
            }
            const boneMap = new Map(bones.map(bone => [bone.name, bone]));
            const rest = new Map((this.restPose || []).map(entry => [entry.bone, entry.quaternion.clone()]));
            const restPositions = new Map((this.restPose || []).map(entry => [entry.bone, entry.position]));
            const quaternionTracks = new Map();
            for (const track of clip.tracks) {
                const match = /^\.bones\[([^\]]+)\]\.quaternion$/.exec(track.name);
                if (match && boneMap.has(match[1])) quaternionTracks.set(match[1], track);
            }
            const depth = bone => {
                let value = 0;
                for (let parent = bone.parent; parent && parent !== this.model; parent = parent.parent) value++;
                return value;
            };
            const ordered = [...boneMap.values()].sort((a, b) => depth(a) - depth(b));
            const identity = new THREE.Quaternion();
            const frameCount = Math.max(0, ...[...quaternionTracks.values()].map(track => Math.floor(track.values.length / 4)));
            for (let frame = 0; frame < frameCount; frame++) {
                const deltaWorld = new Map();
                const restWorld = new Map();
                const animationWorld = new Map();
                for (const bone of ordered) {
                    const parent = boneMap.get(bone.parent?.name);
                    const parentDelta = parent ? deltaWorld.get(parent) || identity : identity;
                    const parentRest = parent ? restWorld.get(parent) || identity : identity;
                    const track = quaternionTracks.get(bone.name);
                    const offset = track && frame * 4 + 3 < track.values.length
                        ? new THREE.Quaternion(track.values[frame * 4], track.values[frame * 4 + 1], track.values[frame * 4 + 2], track.values[frame * 4 + 3]).normalize()
                        : identity;
                    const bind = rest.get(bone) || bone.quaternion.clone();
                    const currentDelta = parentDelta.clone().multiply(offset).normalize();
                    const currentRest = parentRest.clone().multiply(bind).normalize();
                    const currentAnimation = currentDelta.clone().multiply(currentRest).normalize();
                    deltaWorld.set(bone, currentDelta);
                    restWorld.set(bone, currentRest);
                    animationWorld.set(bone, currentAnimation);
                    if (track) {
                        const local = parent
                            ? (animationWorld.get(parent) || identity).clone().invert().multiply(currentAnimation).normalize()
                            : currentAnimation;
                        track.values[frame * 4] = local.x;
                        track.values[frame * 4 + 1] = local.y;
                        track.values[frame * 4 + 2] = local.z;
                        track.values[frame * 4 + 3] = local.w;
                    }
                }
            }
            for (const track of clip.tracks) {
                const match = /^\.bones\[([^\]]+)\]\.position$/.exec(track.name);
                if (!match || track.values.length % 3 !== 0 || !boneMap.has(match[1])) continue;
                const bone = boneMap.get(match[1]);
                // MMDAnimationBuilder adds the current pose to every VMD
                // position key. Remove that sampled base, then use the loaded
                // model's rest pose so importing during an entry/held pose
                // cannot bake its displacement into later performances.
                const sampledBase = bone.position;
                const bind = restPositions.get(bone) || sampledBase;
                for (let i = 0; i < track.values.length; i += 3) {
                    track.values[i] = bind.x + (track.values[i] - sampledBase.x) / LIVE_PORTRAIT_GLB_SCALE;
                    track.values[i + 1] = bind.y + (track.values[i + 1] - sampledBase.y) / LIVE_PORTRAIT_GLB_SCALE;
                    track.values[i + 2] = bind.z + (track.values[i + 2] - sampledBase.z) / LIVE_PORTRAIT_GLB_SCALE;
                }
                track.name = `${match[1]}.position`;
            }
            clip.tracks.forEach(track => {
                const match = /^\.bones\[([^\]]+)\](\..+)$/.exec(track.name);
                if (match) track.name = `${match[1]}${match[2]}`;
            });
            resolve(clip);
        }, undefined, reject));
    }

    playPlaylistIndex(index, options = {}) {
        const item = options.item || this.playlist[index];
        if (!item || !this.model) return false;
        const fromItem = this.playlistIndex >= 0 ? this.playlist[this.playlistIndex] : null;
        let ids = playlistClipIds(item);
        if (options.skipFace) ids = ids.filter(id => this.actions.get(id)?.kind === 'body' || id === item.body);
        const sourceClips = options.clips || ids.map(id => {
            const source = this.actions.get(id)?.clip;
            const kind = this.actions.get(id)?.kind || '';
            return {
                id,
                clip: source,
                kind,
            };
        });
        const clips = sourceClips.filter(entry => entry.clip);
        if (!clips.length) return false;
        const mixer = this.ensureMixer();
        if (!mixer) return false;
        this.clearAdditiveClip();
        this.basePerformanceFinished = false;
        mixer.timeScale = 1;
        const requestedFade = options.fade ?? (this.liveActions.length ? fadeDurationForTransition(fromItem, item) : 0);
        // One-shot poses may last only one frame. The mixer freezes when the
        // longest clip finishes, so both channel fades must finish by then.
        const performanceDuration = Math.max(0, ...clips.map(({ clip }) => clip.duration));
        const bodyFade = Math.min(Math.max(0, requestedFade), performanceDuration);
        // Walking, running, and motions marked as loops keep playing until the
        // next cue. Other poses hold their last frame.
        const loop = portraitMotionLoops(item);
        this.clearFinishedHandler(mixer);
        const nextActions = clips.map(({ clip }) => mixer.clipAction(clip));
        const keep = new Set(nextActions);
        const outgoing = this.liveActions.filter(action => !keep.has(action));
        for (const action of outgoing) {
            action.enabled = true;
            if (bodyFade > 0) {
                action.fadeOut(bodyFade);
                if (!this.fadingActions.includes(action)) this.fadingActions.push(action);
            } else action.stop();
        }
        for (const { clip, kind } of clips) {
            const action = mixer.clipAction(clip);
            const fade = fadeDurationForClip(kind, bodyFade);
            action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
            action.clampWhenFinished = !loop;
            action.enabled = true;
            if (!this.liveActions.includes(action) || options.restart) action.reset();
            action.setEffectiveWeight(1);
            action.play();
            if (bodyFade > 0 && fade > 0 && !this.liveActions.includes(action)) action.fadeIn(fade);
        }
        if (this.modelFormat === 'glb') this.ensureMixer()?.update(0);
        else this.helper.update(0);
        this.liveActions = nextActions;
        this.playlistIndex = index;
        this.playGeneration += 1;
        if (!loop) this.attachClipFinished(mixer, clips.map(entry => entry.clip), item, this.playGeneration);
        return true;
    }

    prepareCurrentFirstFrame({ render = true } = {}) {
        const mixer = this.ensureMixer();
        if (!mixer) return false;
        mixer.timeScale = 1;
        if (this.modelFormat === 'glb') mixer.setTime(0);
        else this.helper.update(0);
        this.model?.updateMatrixWorld(true);
        if (this.secondaryMotionBound) {
            // Reset in-thread first so the bones show the seeded pose at once,
            // then re-seed the worker's simulation from that same pose.
            this.secondaryMotion.reset();
            this.model?.updateMatrixWorld(true);
            this.physicsProxy?.reset();
        }
        if (render) {
            this.resize();
            // The first visible cue can be an enter/exit motion with root
            // travel. Reframing from that pose offsets every later close-up.
            // Keep the stable camera established when the model was loaded.
            if (!this.cameraFrameReady) this.frameVnCamera();
            this.renderFrame();
        }
        return true;
    }

    prepareStageFirstFrame(index) {
        const played = this.playPlaylistIndex(index, { fade: 0, restart: true });
        if (!played) return false;
        return this.prepareCurrentFirstFrame();
    }

    clearFinishedHandler(mixer) {
        if (mixer && this.finishedHandler) mixer.removeEventListener('finished', this.finishedHandler);
        this.finishedHandler = null;
        this.pendingFinish = null;
    }

    attachClipFinished(mixer, clips, item, generation) {
        if (!mixer || !clips.length) return;
        const longest = clips.reduce((left, right) => (right.duration > left.duration ? right : left));
        const handler = event => {
            if (this.playGeneration !== generation || event.action.getClip() !== longest) return;
            this.clearFinishedHandler(mixer);
            this.pendingFinish = { action: event.action, generation };
        };
        this.finishedHandler = handler;
        mixer.addEventListener('finished', handler);
    }

    flushPendingAnimationFinishes() {
        // Run after mixer/helper.update(), before secondary motion and drawing.
        // Both the body and face must have contributed their final sample first.
        const pending = this.pendingFinish;
        this.pendingFinish = null;
        const baseFinished = pending?.generation === this.playGeneration
            && this.liveActions.includes(pending.action);
        const additiveFinished = this.pendingAdditiveFinish;
        this.pendingAdditiveFinish = null;
        const currentAdditiveFinished = additiveFinished && additiveFinished === this.additiveAction;
        if (baseFinished) {
            this.basePerformanceFinished = true;
            if (!this.talkLevelDriven) this.talking = false;
            this.settleInactiveActions();
        }
        if (currentAdditiveFinished) this.clearAdditiveClip();
        if (!(baseFinished || currentAdditiveFinished) || !this.basePerformanceFinished) return;
        const mixer = this.ensureMixer();
        if (mixer) mixer.timeScale = this.additiveAction ? 1 : 0;
        if (this.autoIdleAdditiveOnHold && !this.additiveAction) {
            this.playRandomIdleAdditiveOnHold(this.playGeneration).catch(error => {
                console.warn('[LivePortrait] idle additive hold failed', error);
            });
        }
    }

    ensureMixer() {
        if (!this.model) return null;
        if (this.modelFormat === 'glb') {
            if (!this.animationMixer) this.animationMixer = new THREE.AnimationMixer(this.model);
            return this.animationMixer;
        }
        const target = this.animationTarget || this.model;
        if (!target) return null;
        if (!this.helper.objects.get(target)) this.helper.add(target, { physics: false });
        const objects = this.helper.objects.get(target);
        if (!objects.mixer) objects.mixer = new THREE.AnimationMixer(target);
        return objects.mixer;
    }

    setAttentionTarget(targetId, vector, duration = 0) {
        if (!targetId || targetId === 'camera' || targetId === 'none') this.attention.clearTarget();
        else this.attention.setTarget(targetId, vector, duration);
    }

    updateAttention(delta) { this.attention.update(delta); }

    async setTalking(talking) {
        this.talking = Boolean(talking);
        if (!this.talking) {
            this.talkPhase = 0;
            this.talkLevel = 0;
            this.talkLevelDriven = false;
            this.talkSpeechActive = false;
            this.talkProfileHint = '';
            this.endTalkMorphTakeover();
            this.restoreTalkOverlay();
        }
    }

    setTalkLevel(level = 0, { active = true, profileHint = '', isTalk = true } = {}) {
        this.talkLevel = Math.min(1, Math.max(0, Number(level) || 0));
        this.talkLevelDriven = Boolean(active);
        this.talkSpeechActive = Boolean(active && isTalk);
        this.talkProfileHint = String(profileHint || '');
        this.talking = Boolean(active);
        if (!active) {
            this.talkLevel = 0;
            this.talkSpeechActive = false;
            this.talkProfileHint = '';
            this.talkPhase = 0;
            this.endTalkMorphTakeover();
            this.restoreTalkOverlay();
        }
    }

    show() {
        this.resume();
    }

    hide() {
        this.pause();
    }

    pause() {
        this.cancelPerformance();
        this.clearAdditiveClip();
        this.setTalkLevel(0, { active: false });
        this.paused = true;
        this.stopLoop();
        this.releasePresentationBuffers();
    }

    setCrowdBudget({ count = 1, focused = true } = {}) {
        this.crowdBudget = portraitCrowdBudget({
            count,
            focused,
            devicePixelRatio: globalThis.devicePixelRatio || 1,
        });
        if (!this.paused) this.applyCrowdRendering();
    }

    setPerformanceMonitoring(enabled = true) {
        this.performanceMonitor.enabled = Boolean(enabled);
        this.performanceMonitor.bucket = createPerformanceBucket();
        if (this.renderer?.info) {
            this.renderer.info.autoReset = !this.performanceMonitor.enabled;
            if (this.performanceMonitor.enabled) this.renderer.info.reset();
        }
    }

    getPerformanceSnapshot(meta = {}) {
        const monitor = this.performanceMonitor;
        if (monitor.model !== this.model) {
            monitor.model = this.model;
            monitor.modelStats = collectModelComplexity(this.model);
        }
        const render = this.renderer?.info?.render || {};
        const memory = this.renderer?.info?.memory || {};
        const budget = this.crowdBudget || portraitCrowdBudget({ devicePixelRatio: globalThis.devicePixelRatio || 1 });
        return {
            idolId: String(meta.idolId || this.canvas?.dataset?.idol || ''),
            costume: String(meta.costume || this.canvas?.dataset?.costume || ''),
            present: meta.present === true,
            ready: Boolean(this.ready),
            paused: Boolean(this.paused),
            modelFormat: this.modelFormat || '',
            modelKey: this.modelKey || '',
            model: monitor.modelStats || collectModelComplexity(null),
            renderer: {
                calls: Number(render.calls) || 0,
                triangles: Number(render.triangles) || 0,
                points: Number(render.points) || 0,
                lines: Number(render.lines) || 0,
                geometries: Number(memory.geometries) || 0,
                textures: Number(memory.textures) || 0,
                pixelRatio: Number(this.renderer?.getPixelRatio?.()) || 0,
                width: Number(this.renderer?.domElement?.width) || 0,
                height: Number(this.renderer?.domElement?.height) || 0,
            },
            textureBudget: {
                model: this.textureBudget || null,
                scene: this.stageScene?.textureBudget || null,
            },
            budget: {
                pixelRatio: Number(budget.pixelRatio) || 0,
                shadowMap: Number(budget.shadowMap) || 0,
                taa: budget.taa !== false,
                outline: budget.outline !== false,
                drawStride: Number(budget.drawStride) || 1,
                updateStride: Number(budget.updateStride) || 1,
            },
            physics: this.secondaryMotionBound && this.physicsRuntime()
                ? {
                    worker: Boolean(this.physicsProxy?.ready),
                    solveMs: Number(this.physicsProxy?.lastSolveMs) || 0,
                    fixedSteps: Number(this.physicsRuntime().fixedSteps) || 0,
                    staticCollisionHits: Number(this.physicsRuntime().staticCollisionHits) || 0,
                    chainCollisionHits: Number(this.physicsRuntime().chainCollisionHits) || 0,
                    outputBones: Number(this.physicsRuntime().lastOutputBones) || 0,
                }
                : null,
            frame: snapshotPerformanceBucket(monitor.bucket),
        };
    }

    getResourceSnapshot(meta = {}) {
        return {
            label: meta.label || this.canvas?.dataset?.idol || '偶像渲染器',
            kind: meta.kind || '角色',
            present: meta.present === true,
            memory: estimateRendererResources({
                renderer: this.renderer,
                roots: [this.scene],
                postPass: this.postPass,
                lookPass: this.lookPass,
                modelTextureBytes: this.gpuTexturesReleased ? 0 : this.textureBudget?.estimatedBytesAfter || 0,
                sceneTextureBytes: Number(meta.sceneTextureBytes) || this.stageScene?.textureBudget?.estimatedBytesAfter || 0,
                plateTextureBytes: this.gpuTexturesReleased ? 0 : estimateImageTextureBytes(this.plateTexture?.image),
                three: THREE,
            }),
        };
    }

    recordPerformanceFrame(sample) {
        if (!this.performanceMonitor.enabled) return;
        recordPerformanceSample(this.performanceMonitor.bucket, sample);
    }

    applyCrowdRendering() {
        const budget = this.crowdBudget || portraitCrowdBudget({ devicePixelRatio: globalThis.devicePixelRatio || 1 });
        if (this.renderer && this.renderer.getPixelRatio() !== budget.pixelRatio) {
            this.renderer.setPixelRatio(budget.pixelRatio);
            if (this.canvas) this.canvas.width = 0;
            this.resize();
        }
        this.crowdShadowMap = budget.shadowMap;
        if (this.outlineEffect) this.outlineEffect.enabled = budget.outline;
        this.syncPictureOptions();
    }

    syncPictureOptions({ render = false } = {}) {
        const budget = this.crowdBudget || portraitCrowdBudget({ devicePixelRatio: globalThis.devicePixelRatio || 1 });
        const level = aaLevel(livePicture.aa);
        const allow = budget.taa !== false;
        this.postPass?.setQuality({
            taa: allow && level.taa,
            fxaa: allow && level.fxaa,
            renderScale: level.renderScale,
            renderPixelBudget: level.renderPixelBudget,
        });
        this.lookPass?.setPlateSharpen(livePicture.plateSharpen);
        if (render && !this.paused && this.renderer) this.renderFrame();
    }

    releasePresentationBuffers() {
        const shadow = this.characterShadowLight?.shadow;
        if (shadow?.map) {
            shadow.map.dispose();
            shadow.map = null;
        }
        if (!this.renderer) return;
        this.renderer.setSize(1, 1, false);
        this.postPass?.setSize(1, 1);
        this.lookPass?.setSize(1, 1);
    }

    getRetainedResourceTargets() {
        const targets = collectPostTargets(this.postPass, this.lookPass);
        if (this.characterShadowLight?.shadow?.map?.isWebGLRenderTarget) targets.add(this.characterShadowLight.shadow.map);
        return targets;
    }

    releaseModelGpuTextures() {
        const textures = collectSceneTextures(this.model);
        this.gakumasTextures.forEach(entry => { if (entry.texture?.isTexture) textures.add(entry.texture); });
        Object.values(this.gakumasFallbacks).forEach(texture => { if (texture?.isTexture) textures.add(texture); });
        if (this.plateTexture?.isTexture) textures.add(this.plateTexture);
        textures.forEach(texture => texture.dispose());
        this.gpuTexturesReleased = true;
    }

    setPresentationActive(active) {
        // Keep the renderer and pose warm briefly, then release large GPU allocations.
        if (active) {
            clearTimeout(this.presentationReleaseTimer);
            this.presentationReleaseTimer = 0;
            clearTimeout(this.gpuTextureReleaseTimer);
            this.gpuTextureReleaseTimer = 0;
            this.gpuTexturesReleased = false;
            this.resume();
            if (!this.paused) this.renderFrame();
            return;
        }
        if (!this.paused) {
            this.paused = true;
            this.stopLoop();
        }
        clearTimeout(this.presentationReleaseTimer);
        clearTimeout(this.gpuTextureReleaseTimer);
        this.presentationReleaseTimer = setTimeout(() => {
            this.presentationReleaseTimer = 0;
            if (this.paused) this.releasePresentationBuffers();
        }, PRESENTATION_BUFFER_RELEASE_DELAY_MS);
        this.gpuTextureReleaseTimer = setTimeout(() => {
            this.gpuTextureReleaseTimer = 0;
            if (this.paused) this.releaseModelGpuTextures();
        }, GPU_TEXTURE_RELEASE_DELAY_MS);
    }

    settleInactiveActions() {
        const retained = [];
        for (const action of this.fadingActions) {
            if (this.liveActions.includes(action)) retained.push(action);
            else action.stop();
        }
        this.fadingActions = retained;
    }

    resume() {
        if (!this.ready) return;
        this.paused = false;
        this.clock.getDelta();
        this.applyCrowdRendering();
        this.startLoop();
        this.resize();
        // Resuming a canvas happens on every Beat flip. Reframing here would
        // measure the current animation/secondary-motion pose and make the
        // same shot drift vertically between dialogue lines.
        if (!this.cameraFrameReady) this.frameVnCamera();
    }

    async prewarm({ frames = 2 } = {}) {
        if (!this.ready || !this.canvas) return false;
        if (this.prewarmPromise) return this.prewarmPromise;
        this.prewarmPromise = (async () => {
            const wasPaused = this.paused;
            const wasHidden = this.canvas.hidden;
            const oldVisibility = this.canvas.style.visibility;
            this.canvas.hidden = false;
            this.canvas.style.visibility = 'hidden';
            if (wasPaused) this.resume();
            else this.renderFrame();
            const count = Math.max(1, Number(frames) || 1);
            for (let index = 0; index < count; index++) {
                await new Promise(resolve => requestAnimationFrame(resolve));
            }
            if (wasPaused) this.pause();
            this.canvas.hidden = wasHidden;
            this.canvas.style.visibility = oldVisibility;
            return true;
        })().finally(() => {
            this.prewarmPromise = null;
        });
        return this.prewarmPromise;
    }

    startLoop() {
        if (this.frameId) return;
        const tick = () => {
            if (this.paused) {
                this.frameId = 0;
                return;
            }
            this.frameId = requestAnimationFrame(tick);
            const monitor = this.performanceMonitor.enabled;
            const frameStarted = monitor ? globalThis.performance.now() : 0;
            const delta = Math.min(this.clock.getDelta(), 0.05);
            const stride = this.crowdBudget?.drawStride || 1;
            const updateStride = this.crowdBudget?.updateStride || 1;
            this.crowdSerial = (this.crowdSerial + 1) >>> 0;
            const drawThisFrame = stride <= 1 || this.crowdSerial % stride === 1;
            const updateThisFrame = updateStride <= 1 || this.crowdSerial % updateStride === 1;
            this.physicsDebt = Math.min(0.1, (this.physicsDebt || 0) + delta);
            // Background actors in a group draw every other frame. Skipping the
            // skeleton update keeps physics from sampling a half-applied pose.
            if (!drawThisFrame) {
                this.recordPerformanceFrame({ now: monitor ? globalThis.performance.now() : 0, skipped: true });
                return;
            }
            // Background actors keep their last animated pose on some draw
            // frames. This avoids paying for full skeleton and secondary-motion
            // simulation for every off-focus idol while the speaker stays fluid.
            if (!updateThisFrame) {
                const renderStarted = monitor ? globalThis.performance.now() : 0;
                this.renderFrame();
                const now = monitor ? globalThis.performance.now() : 0;
                this.recordPerformanceFrame({ now, totalMs: monitor ? now - frameStarted : 0, updateMs: 0, renderMs: monitor ? now - renderStarted : 0, skipped: true });
                return;
            }
            const step = Math.min(this.physicsDebt, 0.05);
            this.physicsDebt = 0;
            const updateStarted = monitor ? globalThis.performance.now() : 0;
            const phases = {};
            if (this.model) {
                const animationStarted = monitor ? globalThis.performance.now() : 0;
                if (this.physicsProxy?.ready) this.physicsProxy.restoreBeforeAnimation();
                else this.secondaryMotion?.restoreBeforeAnimation?.();
                if (this.talkTakeoverActive) {
                    this.restoreTalkBaseMouth();
                    this.talkBasePreparedForFrame = true;
                }
                if (this.modelFormat === 'glb') this.animationMixer?.update(step);
                else this.helper.update(step);
                this.flushPendingAnimationFinishes();
                // Keep root-motion sampling current without walking every bone
                // and mesh. SecondaryMotion refreshes the individual spring
                // paths it reads, while the renderer handles the full tree.
                this.model.updateWorldMatrix?.(true, false);
                if (monitor) phases.animationMs = globalThis.performance.now() - animationStarted;
                const secondaryStarted = monitor ? globalThis.performance.now() : 0;
                if (this.secondaryMotionBound) {
                    const backgroundPhysics = updateStride > 1;
                    const physicsOptions = backgroundPhysics
                        ? { maxFixedSteps: 1, dropRemainder: true }
                        : undefined;
                    // With a worker the solve happens off-thread; this only
                    // posts the pose and applies the newest finished result.
                    if (!this.physicsProxy?.update(step, physicsOptions)) {
                        this.secondaryMotion.update(step, physicsOptions);
                    }
                }
                if (monitor) phases.secondaryMotionMs = globalThis.performance.now() - secondaryStarted;
                const facialStarted = monitor ? globalThis.performance.now() : 0;
                this.facialEffects.update();
                if (monitor) phases.facialMs = globalThis.performance.now() - facialStarted;
                const attentionStarted = monitor ? globalThis.performance.now() : 0;
                this.updateAttention(step);
                this.updateTalkingMorph(step);
                this.harvestFades();
                if (monitor) phases.attentionMs = globalThis.performance.now() - attentionStarted;
            }
            const updateMs = monitor ? globalThis.performance.now() - updateStarted : 0;
            const renderStarted = monitor ? globalThis.performance.now() : 0;
            this.renderFrame();
            const now = monitor ? globalThis.performance.now() : 0;
            this.recordPerformanceFrame({ now, totalMs: monitor ? now - frameStarted : 0, updateMs, renderMs: monitor ? now - renderStarted : 0, phases });
        };
        this.frameId = requestAnimationFrame(tick);
    }

    sampledTaaMotion() {
        const target = this.animationTarget || this.model;
        if (!target) {
            this.taaMotionTarget = null;
            this.taaPreviousPositions = [];
            return 0;
        }
        if (target !== this.taaMotionTarget) {
            this.taaMotionTarget = target;
            this.taaPreviousPositions = [];
        }
        const bones = target.skeleton?.bones || [];
        const byName = new Map(bones.map(bone => [bone.name, bone]));
        const current = ['Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'LeftShoulder', 'RightShoulder']
            .map(name => byName.get(name))
            .filter(Boolean)
            .map(bone => {
                const position = bone.getWorldPosition(new THREE.Vector3());
                return [position.x, position.y, position.z];
            });
        const motion = motionFromPositions(current, this.taaPreviousPositions, 18);
        this.taaPreviousPositions = current;
        return motion;
    }

    taaMotionHint() {
        const mixer = this.animationMixer || this.helper?.objects?.get(this.animationTarget || this.model)?.mixer;
        const sampledMotion = this.sampledTaaMotion();
        if (this.stageCameraAnimation) return 0.72;
        if (mixer?.timeScale && (this.liveActions.length || this.additiveAction)) return Math.max(0.22, sampledMotion);
        if (this.fadingActions.length) return 0.2;
        if (this.talking || this.talkLevelDriven) return Math.max(0.12, sampledMotion);
        return sampledMotion;
    }

    renderFrame() {
        this.resize();
        if (this.performanceMonitor.enabled && this.renderer?.info) {
            // Three resets renderer.info after each renderer.render() by
            // default. A portrait frame contains several passes, so keep one
            // accumulator for the whole frame while diagnostics are enabled.
            this.renderer.info.autoReset = false;
            this.renderer.info.reset();
        }
        if (this.postPass?.active) this.postPass.setMotionHint(this.taaMotionHint());
        const draw = () => {
            this.camera.updateMatrixWorld();
            this.syncDepthOfField();
            this.updateGakumasUniforms();
            this.drawPortrait();
            this.afterRender?.();
        };
        if (this.stageScene && this.sceneFreeLook) this.sceneFreeLook.withCamera(this.camera, draw);
        else draw();
    }

    setCameraLens(lens = {}) {
        const focal = Number(lens?.focal);
        const dof = lens?.dof?.aperture ? lens.dof : null;
        this.cameraLens = { focal: focal > 0 ? focal : 0, dof };
        this.applyStoredFocal();
        this.syncDepthOfField();
    }

    applyStoredFocal() {
        if (this.cameraLens?.focal > 0) applyCameraFocal(this.camera, this.cameraLens.focal);
    }

    syncDepthOfField() {
        const dof = this.cameraLens?.dof;
        if (!this.postPass?.setDepthOfField) return;
        if (!dof?.aperture) {
            this.postPass.setDepthOfField(null);
            return;
        }
        let focus = Number(dof.focus);
        if (!(focus > 0) && this.camera && this.model) {
            const head = this.model.getObjectByName?.('Head') || this.model;
            this.focusPoint ||= new THREE.Vector3();
            focus = this.camera.position.distanceTo(head.getWorldPosition(this.focusPoint));
        }
        this.postPass.setDepthOfField(focus > 0 ? { aperture: dof.aperture, focus } : null);
    }

    setActorPose(pose) {
        if (!this.model) return false;
        const applied = applyActorPose(this.model, pose || null);
        if (applied) this.attention.adoptBase();
        return applied;
    }

    setStageScene(stage, shot = 'medium', position = 'center', cameraOptions = {}) {
        const previous = this.stageScene;
        if (previous && previous !== stage) {
            previous.scene.add(previous.root);
            if (previous.sky) previous.scene.add(previous.sky);
        }
        this.stageScene = stage || null;
        if (this.stageCameraAnimation) cancelAnimationFrame(this.stageCameraAnimation);
        this.stageCameraAnimation = 0;
        if (!stage) {
            if (previous && this.vnCameraState && this.camera) {
                const saved = this.vnCameraState;
                this.camera.position.fromArray(saved.position);
                this.camera.up.set(0, 1, 0);
                this.camera.lookAt(new THREE.Vector3().fromArray(saved.target));
                this.camera.fov = saved.fov;this.camera.near = saved.near;this.camera.far = saved.far;
                this.applyStoredFocal();
                this.camera.updateProjectionMatrix();
                this.postPass?.apply(null);
                this.syncPictureOptions();
                if (this.postPass) this.postPass.resetHistory = true;
            }
            this.stageSceneViewKey = '';
            return;
        }
        if (!this.scene || !this.camera) return;
        this.setStagePlate(null);
        this.setShotFrame({ scale: 1, shiftX: 0, originY: .5 });
        stage.applyBeatLayout(shot, position, cameraOptions);
        this.scene.add(stage.root);
        if (stage.sky) this.scene.add(stage.sky);
        const duration = Number(cameraOptions?.duration) > 0 ? Number(cameraOptions.duration) * 1000 : 0;
        const applyCamera = progress => {
            const view = stage.cameraView(stage.layoutId, this.sceneModelFrame, progress);
            if (!view) return;
            this.camera.position.fromArray(view.position);
            this.camera.up.fromArray(view.up);
            this.camera.lookAt(new THREE.Vector3().fromArray(view.target));
            this.camera.fov = view.fov; this.camera.near = view.near; this.camera.far = view.far;
            applyCameraPose(this.camera, cameraOptions?.pose);
            applyCameraFocal(this.camera, cameraOptions?.focal || this.cameraLens?.focal);
            stage.ensureCameraRange(this.camera);
            this.camera.updateProjectionMatrix();
        };
        applyCamera(duration ? 0 : 1);
        if (duration) {
            const started = performance.now();
            const tick = now => {
                if (this.stageScene !== stage) return;
                const progress = Math.min(1, (now - started) / duration);
                applyCamera(progress);
                if (progress < 1) this.stageCameraAnimation = requestAnimationFrame(tick);
                else this.stageCameraAnimation = 0;
            };
            this.stageCameraAnimation = requestAnimationFrame(tick);
        }
        const key = [
            stage.url,
            shot,
            position,
            cameraOptions?.preset || '',
            cameraOptions?.motion || '',
            cameraOptions?.duration || '',
            cameraOptions?.ease || '',
        ].join('|');
        if (this.postPass && key !== this.stageSceneViewKey) this.postPass.apply(stage.post);
        this.stageSceneViewKey = key;
        this.applyCrowdRendering();
    }

    setStagePlate(image, position = 'center') {
        const next = image && image.width && image.height ? image : null;
        const panX = backgroundPanAmount(position);
        const changed = next !== this.plateImage || panX !== this.platePan.x;
        this.plateImage = next;
        this.platePan.x = panX;
        this.platePan.y = 0.5;
        if (!next) {
            this.plateTexture?.dispose();
            this.plateTexture = null;
            this.syncOutlineWeight();
            if (changed && this.postPass) this.postPass.resetHistory = true;
            return;
        }
        if (!this.plateTexture) {
            this.plateTexture = new THREE.Texture(next);
            this.plateTexture.colorSpace = THREE.SRGBColorSpace;
            this.plateTexture.flipY = false;
            this.plateTexture.generateMipmaps = false;
            this.plateTexture.minFilter = THREE.LinearFilter;
            this.plateTexture.magFilter = THREE.LinearFilter;
            this.plateTexture.needsUpdate = true;
        } else if (this.plateTexture.image !== next) {
            this.plateTexture.image = next;
            this.plateTexture.needsUpdate = true;
        }
        if (this.plateMaterial) this.plateMaterial.uniforms.gkPlate.value = this.plateTexture;
        this.syncOutlineWeight();
        if (changed && this.postPass) this.postPass.resetHistory = true;
    }

    syncOutlineWeight() {
        // The 2D plate sharpens opaque edges, and the portrait camera sits closer,
        // so the same view-space stroke reads heavier than it does in a 3D scene.
        const thickness = this.plateTexture ? 0.0032 : 0.004;
        this.outline.thickness = thickness;
        this.model?.traverse(child => {
            if (!child.isMesh) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const item of materials) {
                if (item?.userData?.outlineParameters) item.userData.outlineParameters.thickness = thickness;
            }
        });
    }

    setShotFrame({ scale = 1, shiftX = 0, originY } = {}) {
        const nextScale = Number.isFinite(scale) ? scale : 1;
        const nextShift = Number.isFinite(shiftX) ? shiftX : 0;
        const nextOrigin = Number.isFinite(originY) ? originY : this.shotFrame.originY;
        const changed = nextScale !== this.shotFrame.scale || nextShift !== this.shotFrame.shiftX || nextOrigin !== this.shotFrame.originY;
        this.shotFrame.scale = nextScale;
        this.shotFrame.shiftX = nextShift;
        this.shotFrame.originY = nextOrigin;
        if (changed && this.postPass) this.postPass.resetHistory = true;
        this.camera?.updateProjectionMatrix();
    }

    applyShotProjection() {
        const scale = this.shotFrame?.scale || 1;
        const shiftX = this.shotFrame?.shiftX || 0;
        if (!this.camera || (scale === 1 && shiftX === 0)) return;
        const originX = ((this.shotFrame.originX ?? 0.5) - 0.5) * 2;
        const originY = (0.5 - (this.shotFrame.originY ?? 0.62)) * 2;
        this.shotMatrix.set(
            scale, 0, 0, originX * (1 - scale) + shiftX,
            0, scale, 0, originY * (1 - scale),
            0, 0, 1, 0,
            0, 0, 0, 1,
        );
        this.camera.projectionMatrix.premultiply(this.shotMatrix);
        this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    }

    syncStagePlateCover() {
        const image = this.plateTexture?.image;
        const width = this.renderer?.domElement?.width || image?.width || 1;
        const height = this.renderer?.domElement?.height || image?.height || 1;
        const shotScale = this.shotFrame?.scale || 1;
        const cover = zoomPlateCover(
            stagePlateCover(width, height, image?.width || 1, image?.height || 1, this.platePan.x, this.platePan.y),
            shotScale * (backgroundDepthBlur(shotScale) ? 1.08 : 1),
            0.5,
            this.shotFrame?.originY ?? 0.5,
        );
        this.plateCover.set(cover.scaleX, cover.scaleY, cover.offsetX, cover.offsetY);
        return this.plateCover;
    }

    drawStagePlate() {
        if (!this.plateTexture || !this.plateScene || !this.renderer) return false;
        this.syncStagePlateCover();
        this.renderer.render(this.plateScene, this.plateCamera);
        return true;
    }

    drawPortrait() {
        const drawCharacter = () => this.hairCoverStage.renderFrame(
            this.renderer,
            this.outlineEffect,
            this.scene,
            this.camera,
            this.gakumasPasses.hairCover,
        );
        if (this.stageScene && this.postPass?.active && this.lookPass?.enabled) {
            if (this.outlineEffect) this.outlineEffect.autoClear = true;
            const source = this.postPass.render(drawCharacter, this.camera, { present: false, velocityRoot: this.scene });
            this.lookPass.presentTexture(source);
            return;
        }
        if (this.plateTexture && this.postPass?.active && this.lookPass?.enabled) {
            const draw = () => {
                const drewPlate = this.drawStagePlate();
                if (this.outlineEffect) this.outlineEffect.autoClear = !drewPlate;
                drawCharacter();
            };
            const source = this.postPass.render(draw, this.camera, { present: false, velocityRoot: this.scene });
            this.lookPass.presentTexture(source, { texture: this.plateTexture, cover: this.plateCover });
            return;
        }
        if (this.outlineEffect) this.outlineEffect.autoClear = true;
        if (this.lookPass?.enabled) this.lookPass.render(drawCharacter);
        else drawCharacter();
    }

    stopLoop() {
        if (this.frameId) cancelAnimationFrame(this.frameId);
        this.frameId = 0;
    }

    harvestFades() {
        if (!this.fadingActions.length) return;
        const next = [];
        for (const action of this.fadingActions) {
            if (this.liveActions.includes(action)) continue;
            if (action.enabled && action.getEffectiveWeight() > 0.01) next.push(action);
            else action.stop();
        }
        this.fadingActions = next;
    }

    frameVnCamera() {
        if (!this.model || !this.camera) return;
        const box = new THREE.Box3().setFromObject(this.model);
        if (box.isEmpty()) return;
        const size = box.getSize(new THREE.Vector3());
        const height = Math.max(size.y, 1);
        const center = box.getCenter(new THREE.Vector3());
        const framing = this.cameraFrame || { distanceFactor: 1.72, targetY: 0.52 };
        const target = new THREE.Vector3(center.x, box.min.y + height * framing.targetY, center.z);
        this.characterCenter.copy(target);
        this.characterShadowFit.center.copy(center);
        this.characterShadowFit.radius = Math.max(size.length() * 0.55, 4);
        const distance = height * framing.distanceFactor;
        this.camera.fov = 36;
        this.camera.position.set(target.x + height * 0.06, target.y + height * 0.02, target.z + distance);
        this.camera.near = Math.max(0.05, height / 100);
        this.camera.far = Math.max(height * 80, distance * 4);
        this.camera.lookAt(target);
        this.camera.updateProjectionMatrix();
        this.cameraFrameReady = true;
        this.vnCameraState = { position: this.camera.position.toArray(), target: target.toArray(),
                               fov: this.camera.fov, near: this.camera.near, far: this.camera.far };
        this.applyStoredFocal();
        this.applyKeyLight(GAKUMAS_LOOK.keyAzimuth, GAKUMAS_LOOK.keyElevation);
        this.updateGakumasUniforms();
    }

    applyKeyLight(azimuth, elevation) {
        if (!this.keyLight) return;
        const azimuthRad = THREE.MathUtils.degToRad(azimuth);
        const elevationRad = THREE.MathUtils.degToRad(elevation);
        const direction = new THREE.Vector3(
            Math.sin(azimuthRad) * Math.cos(elevationRad),
            Math.sin(elevationRad),
            Math.cos(azimuthRad) * Math.cos(elevationRad),
        );
        this.keyLight.target.position.copy(this.characterCenter);
        this.keyLight.position.copy(this.characterCenter).addScaledVector(direction, 20);
        this.keyPointLight.position.copy(this.keyLight.position);
        this.keyLight.target.updateMatrixWorld();
        this.keyLight.updateMatrixWorld();
    }

    resize() {
        if (!this.canvas || !this.renderer || !this.camera) return;
        const width = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 0;
        const height = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 0;
        if (!width || !height) return;
        const pixelRatio = this.renderer.getPixelRatio();
        if (this.canvas.width !== Math.floor(width * pixelRatio) || this.canvas.height !== Math.floor(height * pixelRatio)) {
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
    }

    createModelLoader(idol, textures) {
        const byName = new Map();
        for (const tex of textures) {
            const name = String(tex.name || '').replace(/\\/g, '/').toLowerCase();
            if (!name || !tex.url) continue;
            const file = name.split('/').pop();
            byName.set(name, tex.url);
            byName.set(file, tex.url);
            if (idol.textureDir) byName.set(`${String(idol.textureDir).replace(/\\/g, '/').toLowerCase()}/${file}`, tex.url);
        }
        const resolveTextureUrl = resource => {
            const raw = String(resource || '');
            if (!raw || raw.startsWith('data:')) return raw;
            let path = raw;
            try { path = decodeURIComponent(new URL(raw, window.location.href).pathname); } catch { /* keep */ }
            const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
            const file = normalized.split('/').pop();
            if (byName.has(normalized)) return byName.get(normalized);
            if (byName.has(file)) return byName.get(file);
            for (const [key, url] of byName.entries()) {
                if (normalized.endsWith(`/${key}`)) return url;
            }
            return raw.replace(/\\/g, '/');
        };
        const format = detectLivePortraitFormat(idol);
        const manager = new THREE.LoadingManager();
        // GLB base-color images are normally embedded. Rewriting their URLs
        // with the supplemental PMX texture folder can silently replace the
        // authored hair and eye maps, so only PMX uses the URL modifier.
        if (this.resources) manager.setURLModifier(value => this.resources.resolve(format !== 'glb' ? resolveTextureUrl(value) : value));
        else if (format !== 'glb') manager.setURLModifier(resolveTextureUrl);
        const loader = format === 'glb' ? new GLTFLoader(manager) : new MMDLoader(manager);
        if (format !== 'glb') loader._extractExtension = () => 'pmx';
        return { loader, resolveTextureUrl };
    }

    waitForModelTextures(model, timeoutMs = 8000) {
        const textures = new Set();
        model?.traverse(child => {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.filter(Boolean).forEach(material => {
                for (const key of ['map', 'matcap', 'gradientMap']) {
                    if (material[key]) textures.add(material[key]);
                }
            });
        });
        if (!textures.size) return Promise.resolve();
        return Promise.race([
            Promise.all([...textures].map(texture => new Promise(resolve => {
                if (texture.image?.complete || texture.image?.data || texture.isCompressedTexture) {
                    resolve();
                    return;
                }
                if (Array.isArray(texture.readyCallbacks)) {
                    texture.readyCallbacks.push(() => resolve());
                    return;
                }
                const image = texture.image;
                if (image && typeof image.addEventListener === 'function') {
                    image.addEventListener('load', () => resolve(), { once: true });
                    image.addEventListener('error', () => resolve(), { once: true });
                    return;
                }
                resolve();
            }))),
            new Promise(resolve => setTimeout(resolve, timeoutMs)),
        ]);
    }

    async loadGakumasTextures(files) {
        const unique = new Map();
        for (const file of files) {
            const name = file.name || '';
            const descriptor = textureDescriptor(name);
            if (!GAKUMAS_TEXTURE_KINDS.includes(descriptor.kind)) continue;
            unique.set(`${file.url || ''}:${name}`, { ...descriptor, url: file.url, name });
        }
        const entries = [];
        for (const entry of unique.values()) {
            if (GAKUMAS_ACTIVE_TEXTURE_KINDS.includes(entry.kind) && entry.url) {
                try {
                    entry.texture = await new THREE.TextureLoader(this.resources?.manager(THREE)).loadAsync(entry.url);
                    entry.texture.colorSpace = textureUsesColorSpace(entry.kind) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
                    // RampAdd uses a Unity-authored vertex ID, not the GLB's
                    // flipped mesh UV. Restore the PNG's bottom-to-top axis.
                    entry.texture.flipY = entry.kind === 'rampAdd';
                    entry.texture.userData.sourceName = entry.name;
                    if (entry.kind === 'ramp' || entry.kind === 'rampAdd') {
                        entry.texture.generateMipmaps = false;
                        entry.texture.minFilter = THREE.LinearFilter;
                        entry.texture.magFilter = THREE.LinearFilter;
                        entry.texture.wrapS = THREE.ClampToEdgeWrapping;
                        entry.texture.wrapT = THREE.ClampToEdgeWrapping;
                    }
                    entry.texture.needsUpdate = true;
                } catch (error) {
                    if (this.resources) throw error;
                    console.warn('[LivePortrait] Gakumas texture failed', entry.name, error);
                }
            }
            entries.push(entry);
        }
        this.gakumasTextures.forEach(entry => entry.texture?.dispose());
        this.gakumasTextures = entries;
    }

    gakumasFallback(kind) {
        if (!this.gakumasFallbacks[kind]) {
            const pixel = kind === 'def' ? [128, 0, 0, 0] : [255, 255, 255, 0];
            const texture = new THREE.DataTexture(new Uint8Array(pixel), 1, 1, THREE.RGBAFormat);
            texture.needsUpdate = true;
            this.gakumasFallbacks[kind] = texture;
        }
        return this.gakumasFallbacks[kind];
    }

    createGakumasUniforms() {
        return {
            gkShadeMap: { value: this.gakumasFallback('shade') },
            gkDefMap: { value: this.gakumasFallback('def') },
            gkRampMap: { value: this.gakumasFallback('ramp') },
            gkHighlightMap: { value: this.gakumasFallback('highlight') },
            gkRampAddMap: { value: this.gakumasFallback('rampAdd') },
            gkHasShade: { value: 0 },
            gkHasRamp: { value: 0 },
            gkHasHighlight: { value: 0 },
            gkHasRampAdd: { value: 0 },
            gkRampAddColor: { value: new THREE.Color(0xffffff) },
            gkLightDirection: { value: new THREE.Vector3(0.3, 0.6, 0.7) },
            gkLightColor: { value: new THREE.Color(0xffffff) },
            gkLightStrength: { value: GAKUMAS_LOOK.key },
            gkMainLightWorld: { value: 0 },
            gkWorldToScene: { value: new THREE.Matrix4() },
            gkAddLightCount: { value: 0 },
            gkAddLightPosition: { value: Array.from({ length: ACTOR_ADDITIONAL_LIGHTS }, () => new THREE.Vector4()) },
            gkAddLightDirection: { value: Array.from({ length: ACTOR_ADDITIONAL_LIGHTS }, () => new THREE.Vector4(0, -1, 0, 1)) },
            gkAddLightColor: { value: Array.from({ length: ACTOR_ADDITIONAL_LIGHTS }, () => new THREE.Vector3()) },
            gkAddLightParams: { value: Array.from({ length: ACTOR_ADDITIONAL_LIGHTS }, () => new THREE.Vector4(0, 0, 1, -1)) },
            gkAddLightScale: { value: 0 },
            gkAddLightSpecularScale: { value: 1 },
            gkMatCapOffset: { value: 0.3 },
            gkShadeApply: { value: 1 },
            gkEyeHighlightColor: { value: new THREE.Color(0xffffff) },
            gkEyeReflectionColor: { value: new THREE.Color(0xffffff) },
            gkShadowStrength: { value: this.shadowStrength },
            gkHeadRight: { value: new THREE.Vector3(1, 0, 0) },
            gkRimDirection: { value: new THREE.Vector3(...GAKUMAS_LOOK.rimView) },
            gkRimColor: { value: new THREE.Color(0xffffff) },
            gkRimStrength: { value: 1 },
            gkRimPower: { value: GAKUMAS_LOOK.rimPower },
            gkRimAlbedo: { value: GAKUMAS_LOOK.rimAlbedo },
            gkDebugView: { value: 0 },
            gkCharacterShadowMap: { value: null },
            gkCharacterShadowMatrix: { value: new THREE.Matrix4() },
            gkCharacterShadowEnabled: { value: 0 },
            gkCharacterShadowReceive: { value: 1 },
            gkCharacterShadowContact: { value: 0.001 },
            gkCharacterShadowSize: { value: 4096 },
            gkHairFadeParam: { value: new THREE.Vector4(0.15, 4.0, 0.3, 2.0) },
            ...createActorRoomUniforms(),
            ...createGakumasLookUniformValues(),
        };
    }

    applyGakumasMaterials() {
        if (!this.model) return;
        this.hairCoverStage.dispose();
        this.facialEffects.dispose();
        this.gakumasUniforms.clear();
        this.model.traverse(child => {
            if (!child.isMesh) return;
            let hasCharacterShadowCaster = false;
            child.userData.gakumasShadowMaterialMask = [];
            this.applyOutline(child.material, child);
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material, materialIndex) => {
                // PMX materials arrive as MMDToonMaterial. GLB exports use
                // MeshStandardMaterial, but the actor shader is built on the
                // standard Three.js lighting chunks and serves both sources.
                if (!material || (this.modelFormat !== 'glb' && !material.isMMDToonMaterial)) return;
                if (this.modelFormat === 'glb' && !material.map && material.userData.gakumasEmbeddedBaseMap) {
                    material.map = material.userData.gakumasEmbeddedBaseMap;
                    material.needsUpdate = true;
                }
                if (material.map && 'colorSpace' in material.map && THREE.SRGBColorSpace) {
                    setTextureColorSpace(material.map, THREE.SRGBColorSpace);
                }
                const selection = selectMaterialTextures(material, this.gakumasTextures);
                material.userData.gakumasSelection = selection;
                const uniforms = material.userData.gakumasUniforms || this.createGakumasUniforms();
                material.userData.gakumasUniforms = uniforms;
                for (const kind of GAKUMAS_ACTIVE_TEXTURE_KINDS) {
                    const uniformName = `gk${kind[0].toUpperCase()}${kind.slice(1)}Map`;
                    uniforms[uniformName].value = selection.bindings[kind]?.texture || this.gakumasFallback(kind);
                }
                uniforms.gkHasShade.value = selection.bindings.shade?.texture ? 1 : 0;
                uniforms.gkHasRamp.value = selection.bindings.ramp?.texture ? 1 : 0;
                uniforms.gkHasHighlight.value = selection.bindings.highlight?.texture ? 1 : 0;
                uniforms.gkRampAddMap.value = selection.bindings.rampAdd?.texture || this.gakumasFallback('rampAdd');
                uniforms.gkRampAddColor.value.setRGB(...selection.rampAddColor);
                this.gakumasUniforms.add(uniforms);
                const role = selection.descriptor.role;
                const actorPass = classifyActorPass(material.name, selection.descriptor.name);
                child.userData.gakumasShadowMaterialMask[materialIndex] = shouldCastCharacterShadow(actorPass);
                uniforms.gkCharacterShadowReceive.value = shouldReceiveCharacterShadow(actorPass) ? 1 : 0;
                const rampAddAllowed = ['body', 'bodyAccessory', 'clothing', 'face'].includes(role);
                uniforms.gkHasRampAdd.value = selection.bindings.rampAdd?.texture && rampAddAllowed ? 1 : 0;
                const baseBlending = material.userData.gakumasBaseBlending ?? material.blending;
                material.userData.gakumasBaseBlending = baseBlending;
                const hairTextureName = material.userData?.MMD?.mapFileName || selection.descriptor.name;
                const isEyeLayer = material.name.toLowerCase() === 'm_eye' || actorPass === 'eye';
                material.userData.gakumasAlphaLayer = false;
                const isMainHair = actorPass === 'hair' && !/hirco/i.test(`${material.name || ''} ${hairTextureName || ''}`);
                material.userData.gakumasOutlineAlphaExcluded = !isEyeLayer && !isMainHair && /(?:_alp|_alpha)(?:\.|_|$)/i.test(hairTextureName);
                material.userData.gakumasOutlineUseTangent = isMainHair;
                material.userData.gakumasOutlineExcluded = /^(?:m_ebs|m_eyelash)$/i.test(material.name.trim());
                material.userData.gakumasEyeLayer = isEyeLayer;
                material.userData.gakumasActorPass = actorPass;
                const shadowCaster = shouldCastCharacterShadow(actorPass);
                material.receiveShadow = false;
                hasCharacterShadowCaster ||= shadowCaster;
                material.lights = true;
                material.defaultAttributeValues = {
                    ...(material.defaultAttributeValues || {}),
                    gakumasVertexColor: [0, 0, 0, 0],
                };
                const baseDefines = { ...(material.defines || {}) };
                delete baseDefines.GK_HAIR_COVER;
                material.defines = {
                    ...baseDefines,
                    GK_HAIR: role === 'hair' || actorPass === 'hairHighlight',
                    GK_HAIR_HIGHLIGHT_PASS: actorPass === 'hairHighlight',
                    GK_FACE: role === 'face',
                    GK_EYE: role === 'eye' || role === 'eyeHighlight',
                    GK_EYE_HIGHLIGHT: material.name.toLowerCase() === 'm_ehl' || actorPass === 'eyeHighlight',
                };
                material.userData.gakumasBaseTransparent ??= material.transparent;
                material.transparent = material.userData.gakumasBaseTransparent;
                material.blending = baseBlending;
                material.premultipliedAlpha = false;
                material.depthTest = material.userData.gakumasBaseDepthTest ?? material.depthTest;
                material.renderOrder = material.userData.gakumasBaseRenderOrder ?? material.renderOrder;
                material.depthWrite = actorPass !== 'eye' && actorPass !== 'eyeHighlight';
                if (isEyeLayer) {
                    material.depthTest = false;
                    material.renderOrder = 30;
                }
                if (this.modelFormat === 'glb' && actorPass === 'hairHighlight') {
                    material.transparent = true;
                    material.blending = THREE.AdditiveBlending;
                    material.depthWrite = false;
                    material.renderOrder = 18;
                    material.opacity = 0.55;
                    // Draw the GLB hir_sph layer in HairCover's post pass so
                    // it follows the PMX m_hir+ ordering and stencil rules.
                    material.userData.gakumasPostHighlightOnly = true;
                }
                material.depthTest = true;
                material.alphaTest = actorPass === 'eye' || actorPass === 'eyeHighlight' ? 0 : 0.33;
                material.side = THREE.FrontSide;
                material.colorWrite = true;
                if (isEyeLayer) {
                    material.transparent = true;
                    material.depthTest = false;
                    material.depthWrite = false;
                    material.renderOrder = material.name.toLowerCase() === 'm_ehl' ? 32 : 30;
                    material.alphaTest = 0.01;
                }
                if (material.name.toLowerCase() === 'm_ehl' || actorPass === 'eyeHighlight') {
                    material.transparent = true;
                    material.blending = THREE.NormalBlending;
                    material.depthTest = false;
                    material.depthWrite = false;
                    material.renderOrder = 32;
                    material.opacity = 1;
                    material.alphaTest = 0.01;
                }
                this.applyStencil(material, actorStencilState(material.name, actorPass));
                material.onBeforeCompile = shader => injectActorShader(shader, uniforms);
                material.customProgramCacheKey = () => `gakumas-v2:gakumas:${role}:face-layer-off-v1`;
                material.needsUpdate = true;
                material.visible = material.userData.gakumasPostHighlightOnly !== true;
                this.hairCoverStage.add(child, material, materialIndex, uniforms, hairTextureName);
                if (actorPass === 'hairHighlight') {
                    const highlightSource = this.modelFormat === 'glb'
                        ? this.createGlbHairHighlightOverlay(material)
                        : material;
                    this.hairCoverStage.addHighlight(child, highlightSource, materialIndex);
                }
            });
            child.castShadow = hasCharacterShadowCaster;
            child.receiveShadow = false;
        });
        this.updateGakumasUniforms();
    }

    createGlbHairHighlightOverlay(source) {
        // GLB hir_sph is a separate MeshStandardMaterial. Clone it for the
        // post-scene pass so the actor shader remains lit while the source is
        // hidden from the ordinary render list.
        const overlay = source.clone();
        overlay.name = `${source.name || 'm_hir+'}:GLBOverlay`;
        overlay.onBeforeCompile = source.onBeforeCompile;
        overlay.customProgramCacheKey = () => 'gakumas-glb-hair-highlight-actor-v4';
        overlay.defines = { ...(source.defines || {}) };
        overlay.toneMapped = true;
        overlay.transparent = true;
        overlay.blending = THREE.NormalBlending;
        overlay.depthTest = true;
        overlay.depthWrite = false;
        overlay.opacity = 1;
        overlay.alphaTest = 0.01;
        overlay.side = THREE.FrontSide;
        overlay.needsUpdate = true;
        overlay.userData = {
            ...source.userData,
            gakumasPostHighlightOnly: true,
            gakumasOwnedHighlightOverlay: true,
            gakumasActorPass: 'hairHighlight',
        };
        overlay.stencilWrite = false;
        overlay.stencilFunc = THREE.AlwaysStencilFunc;
        overlay.stencilRef = 0;
        overlay.stencilFuncMask = 0xff;
        overlay.stencilWriteMask = 0;
        return overlay;
    }

    applyStencil(material, state) {
        material.stencilWrite = state.write;
        material.stencilFunc = THREE[state.func] ?? THREE.AlwaysStencilFunc;
        material.stencilRef = state.ref;
        material.stencilFuncMask = state.readMask;
        material.stencilWriteMask = state.writeMask;
        material.stencilFail = THREE[state.fail] ?? THREE.KeepStencilOp;
        material.stencilZFail = THREE[state.zFail] ?? THREE.KeepStencilOp;
        material.stencilZPass = THREE[state.zPass] ?? THREE.KeepStencilOp;
    }

    updateGakumasUniforms() {
        if (!this.gakumasUniforms.size || !this.keyLight || !this.camera) return;
        const direction = this.gakumasLightDirection.copy(matcapKeyDirection(GAKUMAS_LOOK.keyAzimuth, GAKUMAS_LOOK.keyElevation));
        const axis = this.gakumasHeadBone || this.model;
        // The renderer refreshes the complete scene hierarchy immediately
        // before the draw. Uniform setup only needs the selected head/model
        // path, so update that path without walking every mesh and helper node.
        axis?.updateWorldMatrix?.(true, false);
        this.hairCoverStage.update(axis, this.gakumasPasses.hairCoverMinimum);
        if (axis) this.gakumasHeadRight.setFromMatrixColumn(axis.matrixWorld, 0).normalize();
        const shadowLight = this.characterShadowLight;
        const characterShadow = placeCharacterShadowLight(shadowLight, this.camera, this.characterShadowFit, this.crowdShadowMap || this.crowdBudget?.shadowMap || 4096);
        const roomSample = actorEnvironmentSample(this.stageScene, actorScenePoint(this.model, this.stageScene));
        this.gakumasUniforms.forEach(uniforms => {
            uniforms.gkLightDirection.value.copy(direction);
            uniforms.gkLightColor.value.copy(this.keyLight.color);
            uniforms.gkLightStrength.value = this.keyLight.intensity;
            uniforms.gkRimColor.value.copy(this.rimLight.color);
            uniforms.gkRimStrength.value = this.rimLight.intensity;
            uniforms.gkShadowStrength.value = this.shadowStrength;
            uniforms.gkHeadRight.value.copy(this.gakumasHeadRight);
            uniforms.gkCharacterShadowEnabled.value = this.gakumasPasses.characterShadow && shadowLight?.shadow.map ? 1 : 0;
            uniforms.gkCharacterShadowMap.value = shadowLight?.shadow.map?.texture || null;
            if (shadowLight) uniforms.gkCharacterShadowMatrix.value.copy(shadowLight.shadow.matrix);
            uniforms.gkCharacterShadowContact.value = characterShadow?.contact || 0.001;
            // Texel size of the allocated map, which three keeps until it is disposed.
            uniforms.gkCharacterShadowSize.value = shadowLight?.shadow.map?.width || shadowLight?.shadow.mapSize.x || 4096;
            applyGakumasLookUniforms(uniforms);
            applySceneActorUniforms(uniforms, this.stageScene, roomSample);
        });
    }

    applyOutline(material, mesh) {
        const materials = Array.isArray(material) ? material : [material];
        materials.filter(Boolean).forEach(item => {
            if (!item.userData.mmdOutlineParameters && item.userData.outlineParameters) {
                const source = item.userData.outlineParameters;
                item.userData.mmdOutlineParameters = {
                    visible: source.visible,
                    thickness: source.thickness,
                    color: Array.isArray(source.color) ? source.color.slice(0, 3) : undefined,
                    alpha: source.alpha,
                };
            }
            item.userData.gakumasVertexColorEnabled = hasGakumasVertexColorAttribute(mesh);
            const name = `${mesh?.name || ''} ${item.name || ''}`.toLowerCase();
            const excluded = /(?:eye|eyeball|iris|pupil|eyelid|socket|眼球|眼白|瞳孔|眼眶|眼睑|mouth|oral|lip|lipline|teeth|tooth|tongue|口腔|嘴|嘴巴|口|牙|舌|hirco[_-]?col)/i.test(name);
            item.userData.outlineParameters = {
                visible: !excluded,
                thickness: this.outline.thickness,
                color: [0, 0, 0],
                alpha: this.outline.alpha,
                keepAlive: true,
            };
        });
    }

    dispose() {
        livePictureRuntimes.delete(this);
        clearTimeout(this.presentationReleaseTimer);
        this.presentationReleaseTimer = 0;
        clearTimeout(this.gpuTextureReleaseTimer);
        this.gpuTextureReleaseTimer = 0;
        this.pause();
        this.physicsProxy?.dispose();
        this.physicsProxy = null;
        const mixer = this.model ? this.ensureMixer() : null;
        this.clearAdditiveClip();
        this.clearFinishedHandler(mixer);
        this.disposeProps();
        this.hairCoverStage.dispose();
        this.gakumasTextures.forEach(entry => entry.texture?.dispose());
        this.gakumasTextures = [];
        Object.values(this.gakumasFallbacks).forEach(texture => texture.dispose());
        this.gakumasFallbacks = {};
        this.gakumasUniforms.clear();
        if (this.animationTarget && this.scene) {
            if (this.modelFormat !== 'glb') this.helper.remove(this.animationTarget);
            this.scene.remove(this.model);
        }
        this.disposeRenderer();
        this.model = null;
        this.animationTarget = null;
        this.modelFormat = '';
        this.animationMixer = null;
        this.cameraFrameReady = false;
        this.ready = false;
        this.actions.clear();
        this.playlist = [];
        if (singleton === this) singleton = null;
    }
}

