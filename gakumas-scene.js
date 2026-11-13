import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyRootTransform, beatUsesStageDefaultPlacement, decalUv, layoutCameraView, linearColor, pickLayoutActor, reflectionProbeBox, resolveBeatSceneCameraOptions, resolveVolumeStack, retreatCameraView, sceneEffectProfile, sceneFogWithOverride, sceneLayoutOptions, scenePost, sceneSphereFog, sceneDepthFog, sceneCloudLayers, sceneActorLight, sceneLightData, sceneRootTransform, selectReflectionProbe, shCoefficients, validateSceneSidecar } from './gakumas-scene-core.js?v=20261112-single-renderer-v1';
import { calibratedBeatLayout, defaultSceneLayoutId, withScenePlacementOverrides } from './scene-placement-overrides.js?v=20261027-calibrated-beat-v1';
import { activityForScene, checkAnchorPlan, nearestSafePoint, pathIsClear, validateActivity } from './scene-activity.js?v=20261028-block-boxes-v1';
import { createSceneEffects } from './gakumas-scene-effects.js?v=20261028-hot-spring-v1';

import { RIVERBED_NOON, WATER_GLSL, loadRiverbedShaderData, waterUniforms, createRiverbedClouds } from './gakumas-scene-riverbed.js?v=20261112-single-renderer-v1';

import { GRADE_GLSL } from './gakumas-color-grade.js?v=20261112-single-renderer-v1';

const ACTIVITY_MANIFEST_URL = new URL('./scene-activity-manifest.json', import.meta.url).href;

function zoomCameraView(view, zoom = 1) {
    const factor = Number(zoom);
    if (!view || !Number.isFinite(factor) || factor <= 0 || factor === 1) return view;
    const amount = Math.min(1.4, Math.max(0.55, factor));
    const position = view.position.map((value, index) => view.target[index] - (view.target[index] - value) * amount);
    return { ...view, position };
}


const MAX_SCENE_LIGHTS = 16;

// All lighting happens in glTF scene space (metres), where the sidecar lights,
// probes and SH live; gkWorldToScene undoes the layout root transform.
const ENV_VERTEX = `
uniform mat3 gkMapTransform;
uniform vec4 gkLightmapST;
uniform mat4 gkWorldToScene;
varying vec2 vGkUv;
varying vec2 vGkLightmapUv;
varying vec3 vGkNormal;
varying vec3 vGkPosition;
varying vec3 vGkCamera;
varying float vGkViewDepth;
uniform float gkSceneScale;
varying float vGkVertexAlpha;
#ifdef GK_WATER
varying vec4 vGkWaterColor;
#endif
#if defined(GK_VERTEX_ALPHA) || defined(GK_WATER_VERTEX_COLOR)
attribute vec4 _vertexcolor;
#endif
void main() {
#ifdef GK_WATER
#ifdef GK_WATER_VERTEX_COLOR
    vGkWaterColor = _vertexcolor;
#else
    vGkWaterColor = vec4(1.0);
#endif
#endif
    vGkUv = (gkMapTransform * vec3(uv, 1.0)).xy;
#ifdef GK_VERTEX_ALPHA
    vGkVertexAlpha = _vertexcolor.a;
#else
    vGkVertexAlpha = 1.0;
#endif
#ifdef USE_UV1
    vGkLightmapUv = uv1 * gkLightmapST.xy + gkLightmapST.zw;
#else
    vGkLightmapUv = uv * gkLightmapST.xy + gkLightmapST.zw;
#endif
    mat4 toScene = gkWorldToScene * modelMatrix;
    vGkPosition = (toScene * vec4(position, 1.0)).xyz;
    vGkNormal = mat3(toScene) * normal;
    vGkCamera = (gkWorldToScene * vec4(cameraPosition, 1.0)).xyz;
    vGkViewDepth = -(modelViewMatrix * vec4(position, 1.0)).z / max(gkSceneScale, 1e-6);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Panoramic skybox sample; also the default reflection for pixels outside
// every reflection probe box. gkSkyInfo = (rgbm range, rotation, exposure, max lod).
const SKY_GLSL = `
uniform sampler2D gkSkyMap;
uniform vec4 gkSkyInfo;
uniform vec3 gkSkyTint;
vec3 gkSampleSky(vec3 direction, float lod) {
    vec3 d = normalize(direction);
    vec3 u = vec3(-d.x, d.y, d.z);
    float c = cos(gkSkyInfo.y);
    float s = sin(gkSkyInfo.y);
    vec3 r = vec3(c * u.x + s * u.z, u.y, -s * u.x + c * u.z);
    vec2 uv = vec2(0.5 - atan(r.z, r.x) / 6.28318530718, acos(clamp(r.y, -1.0, 1.0)) / 3.14159265359);
    vec4 rgbm = textureLod(gkSkyMap, uv, min(lod, gkSkyInfo.w));
    return rgbm.rgb * rgbm.a * gkSkyInfo.x * gkSkyTint * gkSkyInfo.z;
}
`;

const ENV_FRAGMENT = `
#define GK_MAX_LIGHTS ${MAX_SCENE_LIGHTS}
uniform sampler2D gkMap;
uniform float gkHasMap;
uniform vec4 gkBaseColor;
uniform sampler2D gkNormalMap;
uniform float gkHasNormalMap;
uniform float gkBumpScale;
uniform sampler2D gkDefMap;
uniform float gkHasDefMap;
uniform vec4 gkDefValue;
uniform float gkUseDef;
uniform vec2 gkSurface;
uniform vec3 gkEmissionColor;
uniform float gkEmissionAlbedoScale;
uniform float gkUnlit;
uniform float gkPremultiply;
uniform float gkVegetation;
uniform vec3 gkSSSColor;
varying float vGkVertexAlpha;
uniform sampler2D gkLightmap;
uniform float gkUseLightmap;
uniform float gkLightmapRange;
uniform vec3 gkLightmapTint;
uniform sampler2D gkShadowMask;
uniform vec4 gkProbeOcclusion;
uniform float gkHasShadowMask;
uniform vec3 gkSH[9];
uniform vec3 gkEmission;
uniform float gkAlphaCutoff;
uniform int gkLightCount;
uniform vec4 gkLightPosition[GK_MAX_LIGHTS];
uniform vec4 gkLightDirection[GK_MAX_LIGHTS];
uniform vec3 gkLightColor[GK_MAX_LIGHTS];
uniform vec4 gkLightParams[GK_MAX_LIGHTS];
uniform sampler2D gkProbeMap;
uniform float gkHasProbe;
uniform vec4 gkProbeInfo;
uniform vec3 gkProbePosition;
uniform vec3 gkProbeBoxMin;
uniform vec3 gkProbeBoxMax;
uniform float gkProbeBoxProjection;
uniform float gkDirectScale;
uniform float gkSpecularScale;
varying vec2 vGkUv;
varying vec2 vGkLightmapUv;
varying vec3 vGkNormal;
varying vec3 vGkPosition;
varying vec3 vGkCamera;
uniform float gkHasSky;
uniform float gkSkyReflection;
uniform vec4 gkFogSphere;
uniform vec4 gkFogColor;
uniform float gkFogDensity;
uniform float gkDepthFogDensity;
uniform vec4 gkDepthFogColor;
uniform float gkSceneScale;
varying float vGkViewDepth;
${GRADE_GLSL}
${SKY_GLSL}
${WATER_GLSL}

// VL SphereFog: density (1 - r^2) integrated along the view ray inside the
// sphere, normalised so a full diameter is 1; the result is lerped toward
// amount * colour by min(amount, maxAmount).
vec4 gkSphereFog() {
    if (gkFogDensity <= 0.0) return vec4(0.0);
    vec3 toPixel = vGkPosition - vGkCamera;
    float len = max(length(toPixel), 1e-5);
    vec3 rd = toPixel / len;
    float dist = len / gkFogSphere.w;
    vec3 oc = (vGkCamera - gkFogSphere.xyz) / gkFogSphere.w;
    float b = dot(rd, oc);
    float c = dot(oc, oc) - 1.0;
    float disc = b * b - c;
    if (disc < 0.0) return vec4(0.0);
    float s = sqrt(disc);
    float t0 = -s - b;
    float t1 = s - b;
    if (t1 < 0.0 || dist < t0) return vec4(0.0);
    t0 = max(t0, 0.0);
    t1 = min(dist, t1);
    float f0 = t0 * t0 * t0 / 3.0 + b * t0 * t0 + c * t0;
    float f1 = t1 * t1 * t1 / 3.0 + b * t1 * t1 + c * t1;
    float amount = (f0 - f1) * 0.75 * gkFogDensity;
    float weight = clamp(min(amount, gkFogColor.w), 0.0, 1.0);
    return vec4(amount * gkFogColor.rgb, weight);
}

vec3 gkApplyFog(vec3 color) {
    vec4 fog = gkSphereFog();
    if (gkDepthFogDensity > 0.0) {
        // Original forward pass: exponential eye depth (not radial distance),
        // with an uncapped colour contribution and a capped blend weight.
        float amount = max(1.0 - exp(-max(vGkViewDepth, 0.0) * gkDepthFogDensity), 0.0);
        fog += vec4(amount * gkDepthFogColor.rgb, min(amount, gkDepthFogColor.a));
    }
    return mix(color, fog.rgb, clamp(fog.a, 0.0, 1.0));
}

vec3 gkShadeSH9(vec3 n) {
    vec3 c = gkSH[0] - gkSH[6];
    c += gkSH[3] * n.x + gkSH[1] * n.y + gkSH[2] * n.z;
    c += gkSH[4] * (n.x * n.y) + gkSH[5] * (n.y * n.z) + gkSH[6] * (3.0 * n.z * n.z) + gkSH[7] * (n.z * n.x);
    c += gkSH[8] * (n.x * n.x - n.y * n.y);
    return max(c, vec3(0.0));
}

// Unity normal maps keep +Y along +V of the Unity UV; the export flips V, so
// the bitangent is the negative of dP/dv here.
vec3 gkPerturbNormal(vec3 n, vec3 mapN) {
    vec3 q0 = dFdx(vGkPosition);
    vec3 q1 = dFdy(vGkPosition);
    vec2 st0 = dFdx(vGkUv);
    vec2 st1 = dFdy(vGkUv);
    vec3 q1perp = cross(q1, n);
    vec3 q0perp = cross(n, q0);
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max(dot(T, T), dot(B, B));
    float scale = det == 0.0 ? 0.0 : inversesqrt(det);
    return normalize(T * (mapN.x * scale) - B * (mapN.y * scale) + n * mapN.z);
}

vec3 gkSampleProbe(vec3 dir, float mip) {
    vec3 d = normalize(vec3(-dir.x, dir.y, dir.z));
    float u = atan(d.z, d.x) / 6.28318530718;
    float v = acos(clamp(d.y, -1.0, 1.0)) / 3.14159265359;
    float levels = gkProbeInfo.x;
    float halfTexel = 0.5 / gkProbeInfo.y;
    v = clamp(v, halfTexel, 1.0 - halfTexel);
    float lo = floor(mip);
    float hi = min(lo + 1.0, levels - 1.0);
    vec4 a = texture2D(gkProbeMap, vec2(u, (lo + v) / levels));
    vec4 b = texture2D(gkProbeMap, vec2(u, (hi + v) / levels));
    vec3 ca = a.rgb * a.a;
    vec3 cb = b.rgb * b.a;
    return mix(ca, cb, mip - lo) * gkProbeInfo.z;
}

vec3 gkBoxProject(vec3 dir, vec3 position) {
    if (gkProbeBoxProjection < 0.5) return dir;
    vec3 tMax = (gkProbeBoxMax - position) / dir;
    vec3 tMin = (gkProbeBoxMin - position) / dir;
    vec3 t = vec3(dir.x > 0.0 ? tMax.x : tMin.x, dir.y > 0.0 ? tMax.y : tMin.y, dir.z > 0.0 ? tMax.z : tMin.z);
    t = mix(t, vec3(1e6), step(abs(dir), vec3(1e-5)));
    float hit = min(min(t.x, t.y), t.z);
    return position + dir * hit - gkProbePosition;
}

void main() {
    vec4 base = gkBaseColor;
    if (gkHasMap > 0.5) base *= texture2D(gkMap, vGkUv);
    if (base.a < gkAlphaCutoff) discard;
    if (gkUnlit > 0.5) {
        gl_FragColor = linearToOutputTexel(vec4(gkGrade(gkApplyFog(base.rgb * gkEmissionColor)), base.a));
        return;
    }

    // Environment/Default: DefMap (white when unbound) x _DefValue =
    // metallic, emission mask, occlusion, smoothness.
    float metallic = gkSurface.x;
    float smoothness = gkSurface.y;
    float occlusion = 1.0;
    float emissionMask = 0.0;
    vec4 def = vec4(0.0);
    if (gkUseDef > 0.5) {
        def = (gkHasDefMap > 0.5 ? texture2D(gkDefMap, vGkUv) : vec4(1.0)) * gkDefValue;
        metallic = clamp(def.r, 0.0, 1.0);
        smoothness = clamp(def.a, 0.0, 1.0);
        emissionMask = max(def.g - 0.02, 0.0);
        occlusion = def.b;
    }
    // Environment/Vegetation: no metal or emission; G masks translucency and
    // vertex colour alpha darkens the canopy interior.
    float translucencyMask = 0.0;
    if (gkVegetation > 0.5) {
        metallic = 0.0;
        emissionMask = 0.0;
        occlusion *= vGkVertexAlpha;
        translucencyMask = def.g * occlusion;
    }

    vec3 n = normalize(vGkNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    if (gkHasNormalMap > 0.5) {
        vec3 mapN = texture2D(gkNormalMap, vGkUv).xyz * 2.0 - 1.0;
        mapN.xy *= gkBumpScale;
        n = gkPerturbNormal(n, mapN);
    }
    vec3 v = normalize(vGkCamera - vGkPosition);
    vec3 waterEmission = vec3(0.0);
#ifdef GK_WATER
    gkWaterSurface(base.rgb, n, v, smoothness, waterEmission);
#endif
    float nv = clamp(dot(n, v), 1e-4, 1.0);

    // URP BRDFData (metallic workflow).
    float oneMinusReflectivity = 0.96 * (1.0 - metallic);
    vec3 diffuse = base.rgb * oneMinusReflectivity;
    if (gkPremultiply > 0.5) diffuse *= base.a;
    vec3 specular = mix(vec3(0.04), base.rgb, metallic);
    float perceptualRoughness = 1.0 - smoothness;
    float roughness = max(perceptualRoughness * perceptualRoughness, 0.0078125);
    float roughness2 = roughness * roughness;
    float normalization = roughness * 4.0 + 2.0;

    vec4 mask = vec4(1.0);
    if (gkUseLightmap > 0.5 && gkHasShadowMask > 0.5) mask = texture2D(gkShadowMask, vGkLightmapUv);
    else if (gkUseLightmap < 0.5) mask = gkProbeOcclusion;

    vec3 direct = vec3(0.0);
    for (int i = 0; i < GK_MAX_LIGHTS; i++) {
        if (i >= gkLightCount) break;
        vec4 lp = gkLightPosition[i];
        vec4 params = gkLightParams[i];
        vec3 l;
        float attenuation = 1.0;
        if (lp.w < 0.5) {
            l = -gkLightDirection[i].xyz;
        } else {
            vec3 toLight = lp.xyz - vGkPosition;
            float distanceSqr = max(dot(toLight, toLight), 1e-4);
            l = toLight * inversesqrt(distanceSqr);
            float lightRange = inversesqrt(max(params.x, 0.0001));
            float lightDistance = sqrt(distanceSqr);
            float lightT = clamp(lightDistance / lightRange, 0.0, 1.0);
            float lightEdge = clamp((lightT - 0.35) / 0.65, 0.0, 1.0);
            lightEdge = lightEdge * lightEdge * (3.0 - 2.0 * lightEdge);
            attenuation = (1.0 - lightEdge) * 0.08;
            if (lp.w > 1.5) {
                float cone = clamp(dot(gkLightDirection[i].xyz, -l) * params.y + params.z, 0.0, 1.0);
                attenuation *= cone * cone;
            }
        }
        if (params.w > -0.5) {
            int channel = int(params.w + 0.5);
            float shadow = channel == 0 ? mask.r : channel == 1 ? mask.g : channel == 2 ? mask.b : mask.a;
            attenuation *= shadow;
        }
        float nl = clamp(dot(n, l), 0.0, 1.0);
        if (nl <= 0.0 || attenuation <= 0.0) continue;
        vec3 h = normalize(l + v);
        float nh = clamp(dot(n, h), 0.0, 1.0);
        float lh = clamp(dot(l, h), 0.0, 1.0);
        float d = nh * nh * (roughness2 - 1.0) + 1.00001;
        float specularTerm = roughness2 / ((d * d) * max(0.1, lh * lh) * normalization);
        direct += min((diffuse + specular * specularTerm * gkLightDirection[i].w * gkSpecularScale) * gkLightColor[i] * (attenuation * nl), vec3(100.0));
    }

    // GI and reflections both carry the VLLightmapVolume tint; occlusion uses
    // the game's coloured form diffuse + ao * (1 - diffuse) on baked GI.
    vec3 bakedGI;
    if (gkUseLightmap > 0.5) {
        vec4 rgbm = texture2D(gkLightmap, vGkLightmapUv);
        bakedGI = rgbm.rgb * rgbm.a * gkLightmapRange;
    } else {
        bakedGI = gkShadeSH9(n);
    }
    bakedGI *= gkLightmapTint;
    // Forward+ probes have zero blend distance: a pixel either lies inside the
    // box or falls back to the skybox reflection.
    vec3 indirectSpecular = vec3(0.0);
    float mip = perceptualRoughness * (1.7 - 0.7 * perceptualRoughness) * 6.0;
    bool insideProbe = gkHasProbe > 0.5
        && all(greaterThan(vGkPosition, gkProbeBoxMin)) && all(lessThan(vGkPosition, gkProbeBoxMax));
    if (insideProbe) {
        vec3 r = gkBoxProject(reflect(-v, n), vGkPosition);
        indirectSpecular = gkSampleProbe(r, min(mip, gkProbeInfo.x - 1.0));
    } else if (gkHasSky > 0.5) {
        indirectSpecular = gkSampleSky(reflect(-v, n), mip * gkSkyInfo.w / 6.0) * gkSkyReflection;
    }
    indirectSpecular *= gkLightmapTint;
    float surfaceReduction = 1.0 / (roughness2 + 1.0);
    float grazing = clamp(smoothness + (1.0 - oneMinusReflectivity), 0.0, 1.0);
    float fresnel = pow(1.0 - nv, 4.0);
    vec3 indirect = bakedGI * diffuse * (diffuse + occlusion * (1.0 - diffuse))
        + surfaceReduction * indirectSpecular * mix(specular, vec3(grazing), fresnel) * occlusion * gkSpecularScale;
    vec3 emission = emissionMask * gkEmissionColor * mix(vec3(1.0), base.rgb, gkEmissionAlbedoScale);
    // Vegetation translucency: SH on the geometric normal plus the main light,
    // boosted when the view faces into the light (vertex term pow 8 + 0.15).
    if (translucencyMask > 0.0) {
        vec3 transmitted = gkShadeSH9(normalize(vGkNormal));
        for (int i = 0; i < GK_MAX_LIGHTS; i++) {
            if (i >= gkLightCount) break;
            if (gkLightPosition[i].w > 0.5) continue;
            float back = pow(clamp(dot(gkLightDirection[i].xyz, v), 0.0, 1.0), 8.0) + 0.15;
            transmitted += gkLightColor[i] * back * gkDirectScale;
            break;
        }
        emission += gkSSSColor * base.rgb * transmitted * translucencyMask;
    }

    vec3 color = gkApplyFog(indirect + direct * gkDirectScale + emission + waterEmission + base.rgb * gkEmission);
    // Premultiplied transparents scale the whole result, reflections included.
    if (gkPremultiply > 0.5) color *= base.a;
    gl_FragColor = linearToOutputTexel(vec4(gkGrade(color), base.a));
}
`;

const SKY_VERTEX = `
uniform mat3 gkSceneFromWorld;
varying vec3 vGkDirection;
void main() {
    vGkDirection = gkSceneFromWorld * (mat3(modelMatrix) * position);
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
}
`;

const SKY_FRAGMENT = `
varying vec3 vGkDirection;
${GRADE_GLSL}
${SKY_GLSL}
void main() {
    gl_FragColor = linearToOutputTexel(vec4(gkGrade(gkSampleSky(vGkDirection, 0.0)), 1.0));
}
`;

const DECAL_FRAGMENT = `
uniform sampler2D gkMap;
uniform vec4 gkBaseColor;
uniform float gkMultiply;
uniform vec3 gkDecalLight;
varying vec2 vGkUv;
${GRADE_GLSL}
void main() {
    vec4 texel = texture2D(gkMap, vGkUv) * gkBaseColor;
    if (gkMultiply > 0.5) {
        gl_FragColor = vec4(mix(vec3(1.0), texel.rgb, texel.a), 1.0);
        return;
    }
    gl_FragColor = linearToOutputTexel(vec4(gkGrade(texel.rgb * gkDecalLight), texel.a));
}
`;

const DECAL_VERTEX = `
varying vec2 vGkUv;
void main() {
    vGkUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function markSceneMaterial(material) {
    material.toneMapped = false;
    material.userData.gakumasOutlineExcluded = true;
    material.userData.outlineParameters = { visible: false, keepAlive: true };
    return material;
}

function resolveUrl(base, relative) {
    return new URL(relative, new URL(base, window.location.href)).href;
}

function loadTexture(loader, url, { mipmaps = true } = {}) {
    return loader.loadAsync(url).then(texture => {
        texture.flipY = false;
        if ('colorSpace' in texture) texture.colorSpace = THREE.NoColorSpace ?? '';
        else texture.encoding = THREE.LinearEncoding;
        texture.generateMipmaps = mipmaps;
        texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
        texture.needsUpdate = true;
        return texture;
    });
}

export class GakumasSceneStage {
    constructor({ scene, scale = 1, resources = null }) {
        this.scene = scene;
        this.scale = scale;
        this.resources = resources;
        this.root = new THREE.Group();
        this.root.name = 'gakumas-scene';
        this.root.visible = false;
        this.scene.add(this.root);
        this.sidecar = null;
        this.url = '';
        this.layoutId = '';
        this.textures = [];
        this.gltf = null;
        this.effects = null;
        this.sky = null;
        this.riverbedAssets = null;
        this.clouds = null;
        this.cloudSettings = null;
        this.farDistance = 0;
        this.grade = null;
        this.actorLight = null;
        this.sceneLightEntries = [];
        this.shared = {
            gkDeferGrade: { value: 0 },
            gkSceneFromWorld: { value: new THREE.Matrix3() },
            gkExposure: { value: 1 },
            gkContrast: { value: 1 },
            gkSaturation: { value: 1 },
            gkColorFilter: { value: new THREE.Vector3(1, 1, 1) },
            gkTone: { value: new THREE.Vector4(0.22, 0.4, 1, 1.33) },
            gkToneEnabled: { value: 0 },
            gkShadows: { value: new THREE.Vector3(1, 1, 1) },
            gkMidtones: { value: new THREE.Vector3(1, 1, 1) },
            gkHighlights: { value: new THREE.Vector3(1, 1, 1) },
            gkSmhLimits: { value: new THREE.Vector4(0, 0.3, 0.55, 1) },
            gkLightmapTint: { value: new THREE.Vector3(1, 1, 1) },
            gkWorldToScene: { value: new THREE.Matrix4() },
            gkLightCount: { value: 0 },
            gkLightPosition: { value: Array.from({ length: MAX_SCENE_LIGHTS }, () => new THREE.Vector4()) },
            gkLightDirection: { value: Array.from({ length: MAX_SCENE_LIGHTS }, () => new THREE.Vector4(0, -1, 0, 1)) },
            gkLightColor: { value: Array.from({ length: MAX_SCENE_LIGHTS }, () => new THREE.Vector3()) },
            gkLightParams: { value: Array.from({ length: MAX_SCENE_LIGHTS }, () => new THREE.Vector4(0, 0, 1, -1)) },
            gkDirectScale: { value: 1 },
            gkSpecularScale: { value: 1 },
            gkSkyMap: { value: null },
            gkSkyInfo: { value: new THREE.Vector4(1, 0, 1, 0) },
            gkSkyTint: { value: new THREE.Vector3(1, 1, 1) },
            gkHasSky: { value: 0 },
            gkSkyReflection: { value: 1 },
            gkFogSphere: { value: new THREE.Vector4(0, 0, 0, 1) },
            gkFogColor: { value: new THREE.Vector4(0, 0, 0, 1) },
            gkFogDensity: { value: 0 },
            gkDepthFogDensity: { value: 0 },
            gkDepthFogColor: { value: new THREE.Vector4(0, 0, 0, 0) },
            gkSceneScale: { value: 1 },
            gkWaterTime: { value: 0 },
        };
        this.probes = [];
        this.activityManifest = null;
        this.activityManifestPromise = null;
        this.activity = null;
        this.activityError = null;
        this.beatCamera = null;
        this.loadGeneration = 0;
        this.ready = false;
    }

    get loaded() {
        return this.ready === true;
    }

    layoutOptions() {
        return sceneLayoutOptions(this.sidecar);
    }

    async loadActivityManifest() {
        if (this.activityManifest) return this.activityManifest;
        if (this.activityManifestPromise) return this.activityManifestPromise;
        this.activityManifestPromise = (async () => {
            const response = this.resources ? await this.resources.fetch(ACTIVITY_MANIFEST_URL) : await fetch(ACTIVITY_MANIFEST_URL, { cache: 'no-store' });
            if (!response.ok) throw new Error('活动区域清单读取失败（' + response.status + '）');
            const manifest = await response.json();
            if (manifest?.format !== 'gakumas-scene-activity' || !manifest?.scenes || !manifest?.families) throw new Error('活动区域清单格式无效');
            this.activityManifest = manifest;
            return manifest;
        })().catch(error => {
            this.activityError = error;
            console.warn('[GakumasSceneStage] activity manifest unavailable', error);
            return null;
        });
        return this.activityManifestPromise;
    }

    activityForScene() {
        return this.activity;
    }

    resolveActivityAnchor(anchorId) {
        const anchor = this.activity?.anchors?.find(item => item.id === anchorId);
        if (!anchor) return null;
        const position = this.safeActivityPoint(anchor.position, Math.min(0.2, this.activity?.clearance || 0.35));
        return { ...anchor, position, adjusted: position.some((value, index) => Math.abs(value - anchor.position[index]) > 1e-3) };
    }

    checkActivityPlan(plan = {}) {
        const result = checkAnchorPlan(this.activity, plan);
        if (!result.ok) return result;
        const anchor = this.resolveActivityAnchor(result.anchor.id);
        return anchor ? { ...result, anchor } : { ok: false, reason: '锚点无法落在安全区域' };
    }

    canTraverseActivity(from, to, radius = this.activity?.clearance || 0.35) {
        return Boolean(this.activity && pathIsClear(this.activity, from, to, radius));
    }

    safeActivityPoint(point, radius = this.activity?.clearance || 0.35) {
        return this.activity ? nearestSafePoint(this.activity, point, radius) : point;
    }
    async load(url, { layout, isCurrent: ownerCurrent = () => true } = {}) {
        this.unload();
        const generation = ++this.loadGeneration;
        const isCurrent = () => generation === this.loadGeneration && ownerCurrent();
        const response = this.resources ? await this.resources.fetch(url) : await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`场景清单读取失败（${response.status}）`);
        const sidecar = withScenePlacementOverrides(await response.json());
        if (!isCurrent()) return null;
        const errors = validateSceneSidecar(sidecar);
        if (errors.length) throw new Error(errors.join('；'));
        const activityManifest = await this.loadActivityManifest();
        if (!isCurrent()) return null;
        this.activity = activityForScene(activityManifest, sidecar.scene);
        if (this.activity) {
            const activityErrors = validateActivity(this.activity);
            if (activityErrors.length) {
                console.warn('[GakumasSceneStage] invalid activity data', sidecar.scene, activityErrors);
                this.activity = null;
            }
        }
        const textureLoader = new THREE.TextureLoader(this.resources?.manager(THREE));
        const lightmaps = await Promise.all(sidecar.lightmapSettings.lightmaps.map(async entry => {
            if (!entry.colorFile) return null;
            const [texture, shadowMask] = await Promise.all([
                loadTexture(textureLoader, resolveUrl(url, entry.colorFile)),
                entry.shadowMaskFile ? loadTexture(textureLoader, resolveUrl(url, entry.shadowMaskFile)) : null,
            ]);
            return { texture, shadowMask, range: entry.rgbmRange || 1 };
        }));
        const probes = await Promise.all((sidecar.reflectionProbes || []).map(async probe => {
            if (!probe.atlas?.file) return null;
            const texture = await loadTexture(textureLoader, resolveUrl(url, probe.atlas.file), { mipmaps: false });
            texture.wrapS = THREE.RepeatWrapping;
            return { probe, texture, box: reflectionProbeBox(probe) };
        }));
        const skyEntry = sidecar.environment?.sky?.textures?._MainTex;
        const [gltf, skyTexture] = await Promise.all([
            new GLTFLoader(this.resources?.manager(THREE)).loadAsync(resolveUrl(url, sidecar.glb)),
            skyEntry?.file ? loadTexture(textureLoader, resolveUrl(url, skyEntry.file)) : Promise.resolve(null),
        ]);
        const owned = [
            ...lightmaps.flatMap(entry => (entry ? [entry.texture, entry.shadowMask] : [])),
            ...probes.map(entry => entry?.texture),
            skyTexture,
        ].filter(Boolean);
        if (!isCurrent()) {
            owned.forEach(texture => texture.dispose());
            return null;
        }
        this.sidecar = sidecar;
        this.url = url;
        this.gltf = gltf;
        this.textures.push(...owned);
        this.probes = probes;
        this.applyLights(sidecar.lights);
        let riverbedAssets;
        try {
            riverbedAssets = await loadRiverbedShaderData(sidecar.scene, this.resources, isCurrent);
        } catch (error) {
            if (this.gltf === gltf) this.unload();
            throw error;
        }
        if (!isCurrent()) {
            riverbedAssets?.dispose();
            if (this.gltf === gltf) this.unload();
            return null;
        }
        this.riverbedAssets = riverbedAssets;
        const stats = await this.buildEnvironment(gltf, lightmaps, isCurrent);
        if (!isCurrent()) {
            if (this.gltf === gltf) this.unload();
            return null;
        }
        stats.decals = await this.buildDecals(gltf, isCurrent);
        if (!isCurrent()) {
            if (this.gltf === gltf) this.unload();
            return null;
        }
        const effectProfile = sceneEffectProfile(this.sidecar.scene, this.sidecar.effects);
        this.effects = effectProfile ? createSceneEffects(gltf.scene, effectProfile) : null;
        stats.effects = this.effects?.stats || null;
        stats.lights = this.shared.gkLightCount.value;
        stats.probes = probes.filter(Boolean).length;
        stats.activityFamily = this.activity?.family || null;
        stats.activityStatus = this.activity?.status || null;
        if (skyTexture) this.buildSky(skyTexture, skyEntry, sidecar.environment.sky);
        if (this.riverbedAssets) {
            this.clouds = createRiverbedClouds(this.riverbedAssets, this.shared, GRADE_GLSL);
            this.scene.add(this.clouds.group);
        }
        stats.cloudLayers = this.riverbedAssets?.data.clouds.layers.length || 0;
        const box = new THREE.Box3().setFromObject(gltf.scene);
        this.farDistance = box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length() * this.scale * 1.2;
        this.root.visible = true;
        this.applyLayout(defaultSceneLayoutId(sidecar, layout));
        this.ready = true;
        return stats;
    }

    async buildEnvironment(gltf, lightmaps, isCurrent = () => true) {
        const stats = { meshes: 0, lightmapped: 0, probeLit: 0, water: 0 };
        const replaced = new Map();
        const meshes = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse(object => {
            if (object.isMesh) meshes.push(object);
        });
        const defMaps = new Map();
        for (const object of meshes) {
            const index = object.material.userData?.unity?.textures?._DefMap?.texture;
            if (index == null || defMaps.has(index)) continue;
            defMaps.set(index, await gltf.parser.getDependency('texture', index));
            if (!isCurrent()) return stats;
        }
        const center = new THREE.Vector3();
        const bounds = new THREE.Box3();
        for (const object of meshes) {
            const info = object.userData?.unity || object.parent?.userData?.unity || {};
            const source = object.material;
            const lightmap = info.lightmapIndex >= 0 ? lightmaps[info.lightmapIndex] : null;
            if (!object.geometry.attributes.normal) object.geometry.computeVertexNormals();
            bounds.setFromObject(object).getCenter(center);
            const probe = this.probes[selectReflectionProbe(this.sidecar.reflectionProbes, center.toArray())] || null;
            const defMap = defMaps.get(source.userData?.unity?.textures?._DefMap?.texture) || null;
            object.material = this.environmentMaterial(source, info, lightmap, { probe, defMap, geometry: object.geometry });
            if (this.riverbedAssets && source.userData?.unity?.shader === 'Environment/SimpleWaterFlow') {
                object.onBeforeRender = () => { this.shared.gkWaterTime.value = performance.now() / 1000; };
                stats.water += 1;
            }
            replaced.set(source.uuid, source);
            object.castShadow = false;
            object.receiveShadow = false;
            object.frustumCulled = true;
            stats.meshes += 1;
            if (lightmap) stats.lightmapped += 1;
            else stats.probeLit += 1;
        }
        // The GLTF fallback materials are no longer referenced; their textures are reused.
        replaced.forEach(material => material.dispose());
        this.root.add(gltf.scene);
        return stats;
    }

    attachTo(scene = this.scene) {
        scene.add(this.root);
        if (this.sky) scene.add(this.sky);
        if (this.clouds) scene.add(this.clouds.group);
    }

    environmentMaterial(source, info, lightmap, { probe = null, defMap = null, geometry = null } = {}) {
        const unity = source.userData?.unity || {};
        const map = source.map || null;
        map?.updateMatrix();
        const floats = unity.floats || {};
        const shader = unity.shader || '';
        const usesDef = /^Environment\/(Default|Vegetation)$/.test(shader);
        const vegetation = shader === 'Environment/Vegetation';
        const water = shader === 'Environment/SimpleWaterFlow' && this.riverbedAssets;
        const defValue = unity.colors?._DefValue || [1, 1, 1, 1];
        const emissionColor = linearColor(unity.colors?._EmissionColor || [0, 0, 0]);
        const normalMap = source.normalMap || null;
        const atlas = probe?.probe.atlas;
        const sh = shCoefficients(info.lightProbe) || shCoefficients(this.sidecar.environment?.ambientProbe) || Array.from({ length: 9 }, (_, i) => (i === 0 ? [1, 1, 1] : [0, 0, 0]));
        const isMonitor = shader === 'Environment/CanvasMonitor';
        const emission = isMonitor ? emissionColor : [0, 0, 0];
        const so = info.lightmapScaleOffset || [1, 1, 0, 0];
        // Unity Blend [_SrcBlend] [_DstBlend]: 10 = OneMinusSrcAlpha; SrcBlend 1 = premultiplied.
        const blended = floats._DstBlend === 10;
        const premultiply = blended && floats._SrcBlend === 1;
        const material = new THREE.ShaderMaterial({
            name: `${source.name}-env`,
            uniforms: {
                ...this.shared,
                ...(water ? waterUniforms(this.riverbedAssets, linearColor) : {}),
                gkMap: { value: map },
                gkHasMap: { value: map ? 1 : 0 },
                gkMapTransform: { value: map ? map.matrix.clone() : new THREE.Matrix3() },
                gkBaseColor: { value: new THREE.Vector4(source.color.r, source.color.g, source.color.b, source.opacity) },
                gkLightmap: { value: lightmap?.texture || null },
                gkUseLightmap: { value: lightmap ? 1 : 0 },
                gkLightmapRange: { value: lightmap?.range || 1 },
                gkLightmapST: { value: new THREE.Vector4(so[0], so[1], so[2], so[3]) },
                gkSH: { value: sh.map(rgb => new THREE.Vector3(rgb[0], rgb[1], rgb[2])) },
                gkEmission: { value: new THREE.Vector3(...emission) },
                gkAlphaCutoff: { value: source.alphaTest || 0 },
                gkNormalMap: { value: normalMap },
                gkHasNormalMap: { value: normalMap ? 1 : 0 },
                gkBumpScale: { value: floats._BumpScale ?? 1 },
                gkDefMap: { value: defMap },
                gkHasDefMap: { value: defMap ? 1 : 0 },
                gkDefValue: { value: new THREE.Vector4(...defValue) },
                gkUseDef: { value: usesDef ? 1 : 0 },
                gkSurface: { value: new THREE.Vector2(floats._Metallic ?? 0, floats._Smoothness ?? 0.5) },
                gkEmissionColor: { value: new THREE.Vector3(...emissionColor) },
                gkEmissionAlbedoScale: { value: floats._EmissionAlbedoScale ?? 0 },
                gkUnlit: { value: shader === 'Environment/Emission' ? 1 : 0 },
                gkPremultiply: { value: premultiply ? 1 : 0 },
                gkVegetation: { value: vegetation ? 1 : 0 },
                gkSSSColor: { value: new THREE.Vector3(...(vegetation ? linearColor(unity.colors?._SSSColor || [0, 0, 0]) : [0, 0, 0])) },
                gkShadowMask: { value: lightmap?.shadowMask || null },
                gkHasShadowMask: { value: lightmap?.shadowMask ? 1 : 0 },
                gkProbeOcclusion: { value: new THREE.Vector4(...(info.probeOcclusion?.length === 4 ? info.probeOcclusion : [1, 1, 1, 1])) },
                gkProbeMap: { value: probe?.texture || null },
                gkHasProbe: { value: probe ? 1 : 0 },
                gkProbeInfo: { value: new THREE.Vector4(atlas?.levels || 1, atlas?.levelHeight || 1, (atlas?.rgbmRange || 1) * (probe?.probe.intensity ?? 1) * (this.sidecar.environment?.reflectionIntensity ?? 1), 0) },
                gkProbePosition: { value: new THREE.Vector3(...(probe?.probe.position || [0, 0, 0])) },
                gkProbeBoxMin: { value: new THREE.Vector3(...(probe?.box.min || [0, 0, 0])) },
                gkProbeBoxMax: { value: new THREE.Vector3(...(probe?.box.max || [0, 0, 0])) },
                gkProbeBoxProjection: { value: probe?.probe.boxProjection ? 1 : 0 },
            },
            defines: {
                ...(vegetation && geometry?.attributes._vertexcolor ? { GK_VERTEX_ALPHA: '' } : {}),
                ...(water ? { GK_WATER: '', ...(geometry?.attributes._vertexcolor ? { GK_WATER_VERTEX_COLOR: '' } : {}) } : {}),
            },
            vertexShader: ENV_VERTEX,
            fragmentShader: ENV_FRAGMENT,
            side: source.side,
            transparent: source.transparent || blended,
            depthWrite: blended ? floats._ZWrite === 1 : source.depthWrite,
        });
        if (blended) {
            material.blending = THREE.CustomBlending;
            material.blendSrc = premultiply ? THREE.OneFactor : THREE.SrcAlphaFactor;
            material.blendDst = THREE.OneMinusSrcAlphaFactor;
            material.blendSrcAlpha = THREE.OneFactor;
            material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
        }
        return markSceneMaterial(material);
    }

    async buildDecals(gltf, isCurrent = () => true) {
        const group = new THREE.Group();
        group.name = 'gakumas-scene-decals';
        let count = 0;
        for (const decal of this.sidecar.decals || []) {
            if (!decal.enabled || decal.material == null) continue;
            const source = await gltf.parser.getDependency('material', decal.material);
            if (!isCurrent()) return count;
            const map = source?.map;
            if (!map) continue;
            const geometry = new THREE.PlaneGeometry(1, 1);
            const position = geometry.attributes.position;
            const uv = geometry.attributes.uv;
            for (let i = 0; i < position.count; i++) {
                const [u, v] = decalUv(position.getX(i), position.getY(i), decal.uvScale, decal.uvBias);
                uv.setXY(i, u, v);
            }
            const multiply = /Occlusion/.test(source.userData?.unity?.shader || '');
            const material = markSceneMaterial(new THREE.ShaderMaterial({
                name: `${source.name}-decal`,
                uniforms: {
                    ...this.shared,
                    gkMap: { value: map },
                    gkBaseColor: { value: new THREE.Vector4(source.color.r * decal.color[0], source.color.g * decal.color[1], source.color.b * decal.color[2], source.opacity * decal.color[3] * (decal.fadeFactor ?? 1)) },
                    gkMultiply: { value: multiply ? 1 : 0 },
                    gkDecalLight: { value: new THREE.Vector3(1, 1, 1) },
                },
                vertexShader: DECAL_VERTEX,
                fragmentShader: DECAL_FRAGMENT,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -4,
                blending: multiply ? THREE.MultiplyBlending : THREE.NormalBlending,
                premultipliedAlpha: multiply,
            }));
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = decal.path.split('/').pop();
            const holder = new THREE.Object3D();
            holder.matrixAutoUpdate = false;
            holder.matrix.fromArray(decal.matrix);
            mesh.position.fromArray(decal.offset);
            mesh.scale.set(decal.size[0], decal.size[1], 1);
            mesh.renderOrder = 1;
            holder.add(mesh);
            group.add(holder);
            source.dispose();
            count += 1;
        }
        gltf.scene.add(group);
        return count;
    }

    buildSky(texture, entry, sky) {
        const tint = linearColor(sky.colors?._Tint || [1, 1, 1]);
        const width = texture.image?.width || 1;
        const shared = this.shared;
        shared.gkSkyMap.value = texture;
        shared.gkSkyInfo.value.set(entry.rgbmRange || 1, THREE.MathUtils.degToRad(sky.floats?._Rotation || 0), sky.floats?._Exposure ?? 1, Math.max(0, Math.floor(Math.log2(width)) - 3));
        shared.gkSkyTint.value.set(...tint);
        shared.gkHasSky.value = 1;
        shared.gkSkyReflection.value = this.sidecar?.environment?.reflectionIntensity ?? 1;
        const material = markSceneMaterial(new THREE.ShaderMaterial({
            name: 'gakumas-scene-sky',
            uniforms: { ...shared },
            vertexShader: SKY_VERTEX,
            fragmentShader: SKY_FRAGMENT,
            side: THREE.BackSide,
            depthWrite: false,
        }));
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
        mesh.name = 'gakumas-scene-sky';
        mesh.frustumCulled = false;
        mesh.renderOrder = -1000;
        mesh.onBeforeRender = (_renderer, _scene, camera) => {
            if (this.clouds && this.cloudSettings) this.clouds.update(camera, this.root, performance.now() / 1000, this.cloudSettings);
            mesh.position.copy(camera.position);
            mesh.scale.setScalar((camera.near + camera.far) * 0.5);
            mesh.updateMatrixWorld();
        };
        this.sky = mesh;
        this.scene.add(mesh);
    }

    applyBeatLayout(shot = 'medium', position = 'center', cameraOptions = {}) {
        cameraOptions = resolveBeatSceneCameraOptions(this.sidecar?.scene, shot, cameraOptions);
        const requestedLayout = String(cameraOptions?.layout || '').trim();
        const calibratedBeat = requestedLayout
            ? calibratedBeatLayout(this.sidecar, requestedLayout, shot, position)
            : null;
        if (calibratedBeat) {
            this.sidecar.layouts[calibratedBeat.id] = calibratedBeat;
            this.beatCamera = {
                layoutId: calibratedBeat.id,
                zoom: Number(cameraOptions.zoom) > 0 ? Number(cameraOptions.zoom) : 1,
                backoffMeters: Number(cameraOptions.backoffMeters) || 0,
            };
            return this.applyLayout(calibratedBeat.id);
        }
        if (requestedLayout && this.sidecar?.layouts?.[requestedLayout]) {
            this.beatCamera = {
                layoutId: requestedLayout,
                zoom: Number(cameraOptions.zoom) > 0 ? Number(cameraOptions.zoom) : 1,
                backoffMeters: Number(cameraOptions.backoffMeters) || 0,
            };
            return this.applyLayout(requestedLayout);
        }
        const key = ['medium', 'close', 'reaction'].includes(shot) ? shot : 'medium';
        const base = this.sidecar?.layouts?.['generic-' + key];
        if (!base) return null;
        const source = base.actors[0];
        const offset = ({ left: -0.8, center: 0, right: 0.8 })[position] || 0;
        const shift = [source.forward[2] * offset, 0, -source.forward[0] * offset];
        const rawPosition = source.position.map((v, i) => v + shift[i]);
        const keepStageDefault = beatUsesStageDefaultPlacement(this.sidecar?.scene)
            || beatUsesStageDefaultPlacement(this.activity?.sceneId);
        const safePosition = keepStageDefault
            ? rawPosition
            : this.safeActivityPoint(rawPosition, Math.min(0.2, this.activity?.clearance || 0.35));
        const safeShift = safePosition.map((v, i) => v - source.position[i]);
        this.sidecar.layouts['beat-focus'] = {
            ...base,
            actors: [{ ...source, position: safePosition }],
            camera: { ...base.camera, position: base.camera.position.map((v, i) => v + safeShift[i]) },
        };
        // Stage-default maps keep their captured actor station, so their
        // framing must be applied as a view transform rather than by swapping
        // to an activity camera zone. Use the same shared shot values as the
        // 2D plate and generic 3D layouts.
        const framingZoom = ({ wide: 1.16, medium: 1, close: .82, reaction: .72 }[shot] || 1);
        const hasCameraFraming = shot === 'wide'
            || (keepStageDefault && framingZoom !== 1)
            || Number(cameraOptions.zoom) > 0
            || Boolean(cameraOptions.layout);
        const cameraState = hasCameraFraming ? {
            // Keep the camera's source-space offset paired with the actor's
            // safe station. Activity camera zones are authored around the
            // generic layout, so they follow this same displacement.
            layoutId: 'beat-focus',
            stationShift: [...safeShift],
            stationPosition: [...safePosition],
            zoom: Number(cameraOptions.zoom) > 0 ? Number(cameraOptions.zoom) : framingZoom,
            backoffMeters: Number(cameraOptions.backoffMeters) || 0,
        } : null;
        // The captured classroom/dance-room station must remain unchanged, but
        // An explicit Beat camera still needs a layout id so cameraView() can
        // apply the shared framing zoom instead of dropping back to level medium.
        if (keepStageDefault && cameraState) cameraState.layoutId = 'beat-focus';
        this.beatCamera = cameraState;
        return this.applyLayout('beat-focus');
    }

    applyLayout(layoutId) {
        const layout = this.sidecar?.layouts?.[layoutId];
        if (!layout) return null;
        this.layoutId = layoutId;
        const actor = pickLayoutActor(layout);
        const transform = sceneRootTransform(actor, this.scale);
        this.root.rotation.set(0, transform.rotationY, 0);
        this.root.scale.setScalar(transform.scale);
        this.root.position.fromArray(transform.position);
        this.root.updateMatrixWorld(true);
        this.shared.gkSceneScale.value = transform.scale;
        this.shared.gkSceneFromWorld.value.setFromMatrix4(new THREE.Matrix4().makeRotationY(-transform.rotationY));
        this.shared.gkWorldToScene.value.copy(this.root.matrixWorld).invert();
        const { stack, volumes, activeComponents } = resolveVolumeStack(this.sidecar.volumes, layout.camera?.position || actor?.position || [0, 0, 0]);
        const fog = sceneFogWithOverride(sceneSphereFog(stack), sceneEffectProfile(this.sidecar.scene, this.sidecar.effects)?.fogOverride);
        // Roll out the missing shader features on the audited noon riverbed.
        // Other maps keep their existing appearance until their inputs are checked.
        const depthFog = this.sidecar.scene === RIVERBED_NOON ? sceneDepthFog(stack, activeComponents, this.riverbedAssets?.data.depthFog) : null;
        this.cloudSettings = sceneCloudLayers(stack, activeComponents);
        this.post = scenePost(stack, activeComponents, this.sidecar.scene);
        this.grade = { ...this.post.grading, fog, depthFog, volumes };
        this.actorLight = sceneActorLight(stack);
        this.applyGrade(this.grade);
        this.transform = transform;
        return { layout, transform, view: this.cameraView(layoutId) };
    }

    withPostProcessing(post, draw) {
        const uniform = this.shared.gkDeferGrade;
        const previous = uniform.value;
        // Only defer while drawing into the matching HDR pass. Restore even if
        // drawing fails, so warmups and direct renders never lose scene grading.
        uniform.value = post?.usesSceneHDR && post.settings?.sceneId === this.sidecar?.scene ? 1 : 0;
        try { return draw(); }
        finally { uniform.value = previous; }
    }

    applyLights(lights) {
        const { count, entries } = sceneLightData(lights, MAX_SCENE_LIGHTS);
        const uniforms = this.shared;
        this.sceneLightEntries = entries;
        uniforms.gkLightCount.value = count;
        entries.forEach((light, index) => {
            uniforms.gkLightPosition.value[index].fromArray(light.position);
            const [x, y, z] = light.direction;
            const length = Math.hypot(x, y, z) || 1;
            uniforms.gkLightDirection.value[index].set(x / length, y / length, z / length, light.specular);
            uniforms.gkLightColor.value[index].fromArray(light.color);
            uniforms.gkLightParams.value[index].fromArray(light.params);
        });
        return entries;
    }

    applyGrade(grade) {
        this.shared.gkExposure.value = grade.exposure;
        this.shared.gkContrast.value = grade.contrast;
        this.shared.gkSaturation.value = grade.saturation;
        this.shared.gkColorFilter.value.set(...grade.colorFilter);
        this.shared.gkTone.value.set(grade.tone.linearStart, grade.tone.linearLength, grade.tone.contrast, grade.tone.black);
        this.shared.gkToneEnabled.value = grade.tone.enabled ? 1 : 0;
        this.shared.gkShadows.value.set(...grade.shadows);
        this.shared.gkMidtones.value.set(...grade.midtones);
        this.shared.gkHighlights.value.set(...grade.highlights);
        this.shared.gkSmhLimits.value.set(...grade.smhLimits);
        this.shared.gkLightmapTint.value.set(...grade.lightmapTint);
        const depthFog = grade.depthFog;
        this.shared.gkDepthFogDensity.value = depthFog?.enabled ? depthFog.density : 0;
        if (depthFog?.enabled) this.shared.gkDepthFogColor.value.set(...depthFog.color, depthFog.maxAmount);
        const fog = grade.fog;
        this.shared.gkFogDensity.value = fog?.enabled ? fog.density : 0;
        if (fog?.enabled) {
            this.shared.gkFogSphere.value.set(...fog.center, fog.radius);
            this.shared.gkFogColor.value.set(...fog.color, fog.maxAmount);
        }
    }

    cameraView(layoutId = this.layoutId, modelFrame = null, progress = 1) {
        const layout = this.sidecar?.layouts?.[layoutId];
        if (!layout || !this.transform) return null;
        const base = layoutCameraView(layout, this.transform, this.scale * 0.5, modelFrame);
        if (!base || !this.beatCamera) return base;
        if (this.beatCamera.layoutId !== layoutId) return base;
        return retreatCameraView(zoomCameraView(base, this.beatCamera.zoom), this.beatCamera.backoffMeters, this.scale);
    }

    // Scene geometry reaches ~190 m; keep it inside the far plane after
    // frameModel() resets the camera for a new character.
    ensureCameraRange(camera) {
        if (!this.loaded || !this.farDistance || camera.far >= this.farDistance) return false;
        camera.far = this.farDistance;
        camera.updateProjectionMatrix();
        return true;
    }

    unload() {
        this.ready = false;
        this.loadGeneration += 1;
        this.clouds?.group.removeFromParent();
        this.riverbedAssets?.dispose();
        this.riverbedAssets = null;
        this.clouds = null;
        this.cloudSettings = null;
        this.effects?.dispose();
        this.effects = null;
        if (this.gltf) {
            this.gltf.scene.traverse(object => {
                if (!object.isMesh) return;
                object.geometry?.dispose();
                const uniforms = object.material?.uniforms;
                uniforms?.gkMap?.value?.dispose?.();
                uniforms?.gkNormalMap?.value?.dispose?.();
                uniforms?.gkDefMap?.value?.dispose?.();
                object.material?.dispose();
            });
            this.root.remove(this.gltf.scene);
        }
        if (this.sky) {
            this.sky.removeFromParent();
            this.sky.geometry.dispose();
            this.sky.material.dispose();
        }
        this.textures.forEach(texture => texture.dispose());
        this.textures = [];
        this.probes = [];
        this.shared.gkLightCount.value = 0;
        this.actorLight = null;
        this.sceneLightEntries = [];
        this.shared.gkSkyMap.value = null;
        this.shared.gkHasSky.value = 0;
        this.shared.gkFogDensity.value = 0;
        this.shared.gkDepthFogDensity.value = 0;
        this.gltf = null;
        this.sky = null;
        this.sidecar = null;
        this.activity = null;
        this.beatCamera = null;
        this.grade = null;
        this.post = null;
        this.layoutId = '';
        this.farDistance = 0;
        this.root.visible = false;
    }
}
