import * as THREE from './vendor/three/build/three.module.js';
import { haltonSequence } from './gakumas-scene-core.js?v=20261112-single-renderer-v1';
import { clampTaaMotion, mergeTaaMotion, decayTaaMotion } from './gakumas-taa-motion.js?v=20261027-motion-aware-taa-v1';
import { createVelocityMaterial, rememberSceneMotion, renderSceneVelocity } from './gakumas-taa-velocity.js?v=20261027-velocity-reprojection-v1';
import { GRADE_GLSL } from './gakumas-color-grade.js?v=20261112-single-renderer-v1';

// 3D scenes defer their own resolved volume grade until this HDR composite.
// Direct rendering and unsupported HDR targets retain material grading.
// Bloom strengths are visual calibration, not recovered Unity shader constants.
const BLOOM_HDR_SCALE = 0.35;
const BLOOM_DISPLAY_SCALE = 0.15;
const DIFFUSION_DISPLAY_SCALE = 0.35;
const PARAFFIN_DISPLAY_SCALE = 0.2;

const POST_VERTEX = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const EXTRACT_FRAGMENT = `
uniform sampler2D gkSource;
uniform float gkThreshold;
uniform vec3 gkBloomColor;
varying vec2 vUv;
void main() {
    vec3 color = max(texture2D(gkSource, vUv).rgb, vec3(0.0));
    float brightness = max(max(color.r, color.g), color.b);
    // Extract excess energy with a soft knee. A binary luma gate made bright
    // edges pop and discarded saturated highlights before their channels mixed.
    float knee = max(gkThreshold * 0.5, 1e-4);
    float soft = clamp(brightness - gkThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    float weight = max(brightness - gkThreshold, soft) / max(brightness, 1e-4);
    gl_FragColor = vec4(color * weight * gkBloomColor, 1.0);
}
`;

const BLUR_FRAGMENT = `
uniform sampler2D gkSource;
uniform vec2 gkBlurTexel;
varying vec2 vUv;
void main() {
    vec3 color = texture2D(gkSource, vUv).rgb * 0.227027;
    color += texture2D(gkSource, vUv + gkBlurTexel).rgb * 0.1945946;
    color += texture2D(gkSource, vUv - gkBlurTexel).rgb * 0.1945946;
    color += texture2D(gkSource, vUv + gkBlurTexel * 2.0).rgb * 0.1216216;
    color += texture2D(gkSource, vUv - gkBlurTexel * 2.0).rgb * 0.1216216;
    color += texture2D(gkSource, vUv + gkBlurTexel * 3.0).rgb * 0.0702703;
    color += texture2D(gkSource, vUv - gkBlurTexel * 3.0).rgb * 0.0702703;
    gl_FragColor = vec4(color, 1.0);
}
`;

const DOWNSAMPLE_FRAGMENT = `
uniform sampler2D gkSource;
uniform vec2 gkTexel;
varying vec2 vUv;
void main() {
    vec3 color = texture2D(gkSource, vUv + gkTexel * vec2(-0.5, -0.5)).rgb;
    color += texture2D(gkSource, vUv + gkTexel * vec2(0.5, -0.5)).rgb;
    color += texture2D(gkSource, vUv + gkTexel * vec2(-0.5, 0.5)).rgb;
    color += texture2D(gkSource, vUv + gkTexel * vec2(0.5, 0.5)).rgb;
    gl_FragColor = vec4(color * 0.25, 1.0);
}
`;

const UPSAMPLE_FRAGMENT = `
uniform sampler2D gkSource;
uniform sampler2D gkLow;
uniform vec2 gkTexel;
uniform float gkScatter;
varying vec2 vUv;
void main() {
    vec3 low = texture2D(gkLow, vUv).rgb * 4.0;
    low += texture2D(gkLow, vUv + vec2(gkTexel.x, 0.0)).rgb * 2.0;
    low += texture2D(gkLow, vUv - vec2(gkTexel.x, 0.0)).rgb * 2.0;
    low += texture2D(gkLow, vUv + vec2(0.0, gkTexel.y)).rgb * 2.0;
    low += texture2D(gkLow, vUv - vec2(0.0, gkTexel.y)).rgb * 2.0;
    low += texture2D(gkLow, vUv + gkTexel).rgb;
    low += texture2D(gkLow, vUv - gkTexel).rgb;
    low += texture2D(gkLow, vUv + gkTexel * vec2(1.0, -1.0)).rgb;
    low += texture2D(gkLow, vUv + gkTexel * vec2(-1.0, 1.0)).rgb;
    gl_FragColor = vec4(mix(texture2D(gkSource, vUv).rgb, low / 16.0, gkScatter), 1.0);
}
`;

const DOF_FRAGMENT = `
uniform sampler2D gkSource;
uniform sampler2D gkDepth;
uniform vec2 gkTexel;
uniform float gkNear;
uniform float gkFar;
uniform float gkFocus;
uniform float gkRadius;
varying vec2 vUv;
float viewDistance(float depth) {
    float viewZ = (gkNear * gkFar) / ((gkFar - gkNear) * depth - gkFar);
    return -viewZ;
}
void main() {
    vec4 center = texture2D(gkSource, vUv);
    float dist = viewDistance(texture2D(gkDepth, vUv).r);
    float coc = clamp(abs(dist - gkFocus) / max(gkFocus * 0.35, 0.2), 0.0, 1.0);
    vec2 radius = gkTexel * (coc * gkRadius);
    vec3 color = center.rgb;
    color += texture2D(gkSource, vUv + radius * vec2(1.0, 0.0)).rgb;
    color += texture2D(gkSource, vUv + radius * vec2(-1.0, 0.0)).rgb;
    color += texture2D(gkSource, vUv + radius * vec2(0.0, 1.0)).rgb;
    color += texture2D(gkSource, vUv + radius * vec2(0.0, -1.0)).rgb;
    color += texture2D(gkSource, vUv + radius * vec2(0.707, 0.707)).rgb;
    color += texture2D(gkSource, vUv + radius * vec2(-0.707, 0.707)).rgb;
    color += texture2D(gkSource, vUv + radius * vec2(0.707, -0.707)).rgb;
    color += texture2D(gkSource, vUv + radius * vec2(-0.707, -0.707)).rgb;
    vec2 farRadius = radius * 1.8;
    color += texture2D(gkSource, vUv + farRadius * vec2(1.0, 0.0)).rgb;
    color += texture2D(gkSource, vUv + farRadius * vec2(-1.0, 0.0)).rgb;
    color += texture2D(gkSource, vUv + farRadius * vec2(0.0, 1.0)).rgb;
    color += texture2D(gkSource, vUv + farRadius * vec2(0.0, -1.0)).rgb;
    gl_FragColor = vec4(color / 13.0, center.a);
}
`;

const TAA_FRAGMENT = `
uniform sampler2D gkCurrent;
uniform sampler2D gkHistory;
uniform sampler2D gkDepth;
uniform sampler2D gkVelocity;
uniform vec2 gkTexel;
uniform vec2 gkJitter;
uniform float gkInfluence;
uniform float gkVarianceScale;
uniform float gkHasHistory;
uniform float gkKeepAlpha;
uniform float gkStill;
uniform float gkMotion;
uniform float gkObjectMotion;
uniform float gkHasVelocity;
uniform float gkVelocityNeighborhood;
uniform mat4 gkInvViewProj;
uniform mat4 gkPrevViewProj;
varying vec2 vUv;

float gkBestDepth;
vec2 gkBestOffset;
vec3 gkBoxMin;
vec3 gkBoxMax;
vec3 gkMoment1;
vec3 gkMoment2;

vec3 gkRgbToYCoCg(vec3 color) {
    return vec3(
        dot(color, vec3(0.25, 0.5, 0.25)),
        dot(color, vec3(0.5, 0.0, -0.5)),
        dot(color, vec3(-0.25, 0.5, -0.25))
    );
}

vec3 gkYCoCgToRgb(vec3 color) {
    return vec3(color.x + color.y - color.z, color.x + color.z, color.x - color.y - color.z);
}

const vec3 GK_REC709 = vec3(0.212673, 0.715152, 0.072175);

float gkLumaCompress(float value) {
    return max(value, 0.0) / (1.0 + max(value, 0.0));
}

vec4 gkVelocityAt(vec2 uv) {
    return texture2D(gkVelocity, clamp(uv, 0.0, 1.0));
}

vec4 gkChooseVelocity(vec4 best, vec4 candidate) {
    float bestScore = best.a > 0.5 ? dot(best.xy, best.xy) : -1.0;
    float candidateScore = candidate.a > 0.5 ? dot(candidate.xy, candidate.xy) : -1.0;
    return candidateScore > bestScore ? candidate : best;
}

vec4 gkBestVelocity(vec2 uv) {
    vec2 radius = gkTexel * gkVelocityNeighborhood;
    vec4 best = gkVelocityAt(uv);
    best = gkChooseVelocity(best, gkVelocityAt(uv + vec2(-radius.x, 0.0)));
    best = gkChooseVelocity(best, gkVelocityAt(uv + vec2(radius.x, 0.0)));
    best = gkChooseVelocity(best, gkVelocityAt(uv + vec2(0.0, -radius.y)));
    best = gkChooseVelocity(best, gkVelocityAt(uv + vec2(0.0, radius.y)));
    best = gkChooseVelocity(best, gkVelocityAt(uv + vec2(-radius.x, -radius.y)));
    best = gkChooseVelocity(best, gkVelocityAt(uv + vec2(radius.x, -radius.y)));
    best = gkChooseVelocity(best, gkVelocityAt(uv + vec2(-radius.x, radius.y)));
    best = gkChooseVelocity(best, gkVelocityAt(uv + vec2(radius.x, radius.y)));
    return best;
}

void gkConsiderColor(vec2 uv, vec2 offset) {
    vec3 color = gkRgbToYCoCg(texture2D(gkCurrent, uv + gkTexel * offset).rgb);
    gkBoxMin = min(gkBoxMin, color);
    gkBoxMax = max(gkBoxMax, color);
    gkMoment1 += color;
    gkMoment2 += color * color;
}

void gkConsiderDepth(vec2 uv, vec2 offset) {
    float depth = texture2D(gkDepth, uv + gkTexel * offset).r;
    if (depth < gkBestDepth) {
        gkBestDepth = depth;
        gkBestOffset = offset;
    }
}

void main() {
    // The color target was rendered with a subpixel jitter. Read it back on the
    // stable pixel grid so the history is not a smear of shifted frames.
    vec2 sampleUv = clamp(vUv + gkJitter, gkTexel, vec2(1.0) - gkTexel);
    vec3 center = gkRgbToYCoCg(texture2D(gkCurrent, sampleUv).rgb);
    gkBoxMin = center;
    gkBoxMax = center;
    gkMoment1 = center;
    gkMoment2 = center * center;
    gkBestDepth = 1.0;
    gkBestOffset = vec2(0.0);
    gkConsiderColor(sampleUv, vec2(0.0, -1.0));
    gkConsiderColor(sampleUv, vec2(-1.0, 0.0));
    gkConsiderColor(sampleUv, vec2(1.0, 0.0));
    gkConsiderColor(sampleUv, vec2(0.0, 1.0));
    gkConsiderColor(sampleUv, vec2(-1.0, -1.0));
    gkConsiderColor(sampleUv, vec2(1.0, -1.0));
    gkConsiderColor(sampleUv, vec2(-1.0, 1.0));
    gkConsiderColor(sampleUv, vec2(1.0, 1.0));
    gkConsiderDepth(sampleUv, vec2(0.0, 0.0));
    gkConsiderDepth(sampleUv, vec2(0.0, -1.0));
    gkConsiderDepth(sampleUv, vec2(-1.0, 0.0));
    gkConsiderDepth(sampleUv, vec2(1.0, 0.0));
    gkConsiderDepth(sampleUv, vec2(0.0, 1.0));
    gkConsiderDepth(sampleUv, vec2(-1.0, -1.0));
    gkConsiderDepth(sampleUv, vec2(1.0, -1.0));
    gkConsiderDepth(sampleUv, vec2(-1.0, 1.0));
    gkConsiderDepth(sampleUv, vec2(1.0, 1.0));

    vec3 mean = gkMoment1 / 9.0;
    vec3 deviation = sqrt(abs(gkMoment2 / 9.0 - mean * mean));
    gkBoxMin = max(gkBoxMin, mean - gkVarianceScale * deviation);
    gkBoxMax = min(gkBoxMax, mean + gkVarianceScale * deviation);

    vec2 depthUv = sampleUv + gkTexel * gkBestOffset;
    vec3 ndc = vec3(depthUv * 2.0 - 1.0, gkBestDepth * 2.0 - 1.0);
    vec4 world = gkInvViewProj * vec4(ndc, 1.0);
    world /= world.w;
    vec4 previous = gkPrevViewProj * vec4(world.xyz, 1.0);
    vec2 cameraHistoryUv = gkStill > 0.5 ? vUv : previous.xy / previous.w * 0.5 + 0.5;
    // The velocity pass uses the same unjittered current/previous view-proj
    // matrices as the game path. Dilating the neighborhood preserves a moving
    // edge when the exact center pixel has no coverage, matching the game's
    // strongest-vector gather before history reprojection.
    vec4 velocitySample = gkBestVelocity(vUv);
    float hasVelocity = step(0.5, velocitySample.a) * gkHasVelocity;
    vec2 motionHistoryUv = vUv - velocitySample.xy;
    vec2 historyUv = mix(cameraHistoryUv, motionHistoryUv, hasVelocity);
    float inside = step(0.0, historyUv.x) * step(historyUv.x, 1.0) * step(0.0, historyUv.y) * step(historyUv.y, 1.0);
    vec3 rawHistory = gkRgbToYCoCg(texture2D(gkHistory, clamp(historyUv, 0.0, 1.0)).rgb);
    vec3 history = clamp(rawHistory, gkBoxMin, gkBoxMax);
    // Portrait characters have no motion vectors. A 90% history smear blurs the
    // face, and snapping only the coverage makes the silhouette crawl.
    float clipDistance = length(rawHistory - history);
    float rejectSpan = gkKeepAlpha > 0.5 ? smoothstep(0.02, 0.10, clipDistance) : smoothstep(0.04, 0.18, clipDistance);
    // Keep the scalar hint as a conservative fallback for passes that have no
    // velocity coverage, while the per-pixel vector handles skinned motion.
    float velocityReject = hasVelocity * smoothstep(0.015, 0.12, length(velocitySample.xy));
    float reject = max(max(max(gkMotion, gkObjectMotion * 0.85), velocityReject * 0.45), rejectSpan);
    float influence = mix(1.0, mix(gkInfluence, 1.0, reject), inside * gkHasHistory);
    vec3 historyRgb = max(gkYCoCgToRgb(history), vec3(0.0));
    vec3 centerRgb = max(gkYCoCgToRgb(center), vec3(0.0));
    float currentLuma = gkLumaCompress(dot(centerRgb, GK_REC709));
    float historyLuma = gkLumaCompress(dot(historyRgb, GK_REC709));
    float lumaRatio = currentLuma / max(historyLuma, 1e-4);
    vec3 lumaAdjustedHistory = historyRgb * clamp(lumaRatio, 0.5, 2.0);
    vec3 resolved = mix(lumaAdjustedHistory, centerRgb, influence);
    float currentAlpha = texture2D(gkCurrent, sampleUv).a;
    float historyAlpha = texture2D(gkHistory, clamp(historyUv, 0.0, 1.0)).a;
    float alpha = gkKeepAlpha > 0.5 ? mix(historyAlpha, currentAlpha, influence) : 1.0;
    gl_FragColor = vec4(max(resolved, vec3(0.0)), alpha);
}
`;

const AO_FRAGMENT = `
uniform sampler2D gkDepth;
uniform vec2 gkTexel;
uniform vec2 gkCamera;
varying vec2 vUv;
float gkViewDistance(float depth) {
    float viewZ = (gkCamera.x * gkCamera.y) / ((gkCamera.y - gkCamera.x) * depth - gkCamera.y);
    return -viewZ;
}
float gkOccAt(vec2 uv, float center) {
    float delta = center - gkViewDistance(texture2D(gkDepth, uv).r);
    float weight = clamp(delta / 0.12, 0.0, 1.0);
    return weight * (1.0 - smoothstep(0.22, 0.7, delta));
}
void main() {
    float depth = texture2D(gkDepth, vUv).r;
    float occ = 0.0;
    if (depth < 0.999) {
        float center = gkViewDistance(depth);
        vec2 radius = gkTexel * 14.0;
        occ += gkOccAt(vUv + radius * vec2(1.0, 0.2), center);
        occ += gkOccAt(vUv + radius * vec2(-0.8, 0.6), center);
        occ += gkOccAt(vUv + radius * vec2(0.2, -1.0), center);
        occ += gkOccAt(vUv + radius * vec2(-0.4, -0.7), center);
        occ += gkOccAt(vUv + radius * vec2(0.9, 0.8), center);
        occ += gkOccAt(vUv + radius * vec2(-1.0, -0.3), center);
        occ += gkOccAt(vUv + radius * vec2(0.5, 0.9), center);
        occ += gkOccAt(vUv + radius * vec2(-0.6, 0.4), center);
        occ *= 0.125;
    }
    gl_FragColor = vec4(occ, 0.0, 0.0, 1.0);
}
`;

const SPACE_FRAGMENT = `
uniform sampler2D gkSource;
uniform sampler2D gkDepth;
uniform sampler2D gkAo;
uniform sampler2D gkVelocity;
uniform vec2 gkTexel;
uniform vec2 gkCamera;
uniform mat4 gkProj;
uniform mat4 gkInvProj;
uniform vec3 gkContactView;
uniform vec3 gkViewUp;
uniform float gkHasVelocity;
varying vec2 vUv;
vec3 gkViewAt(vec2 uv) {
    float depth = texture2D(gkDepth, uv).r;
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = gkInvProj * clip;
    return view.xyz / max(view.w, 1e-4);
}
vec3 gkViewNormal(vec2 uv) {
    vec3 position = gkViewAt(uv);
    vec3 dx = gkViewAt(uv + vec2(gkTexel.x, 0.0)) - position;
    vec3 dy = gkViewAt(uv + vec2(0.0, gkTexel.y)) - position;
    if (length(dx) > 0.35 || length(dy) > 0.35) return vec3(0.0);
    vec3 normal = normalize(cross(dx, dy));
    if (normal.z < 0.0) normal = -normal;
    return normal;
}
void main() {
    vec2 velocity = gkHasVelocity > 0.5 ? texture2D(gkVelocity, vUv).xy : vec2(0.0);
    velocity = clamp(velocity, vec2(-0.04), vec2(0.04)) * 0.35;
    vec3 color = texture2D(gkSource, vUv).rgb * 0.4;
    color += texture2D(gkSource, clamp(vUv + velocity * 0.35, 0.0, 1.0)).rgb * 0.2;
    color += texture2D(gkSource, clamp(vUv - velocity * 0.35, 0.0, 1.0)).rgb * 0.2;
    color += texture2D(gkSource, clamp(vUv + velocity, 0.0, 1.0)).rgb * 0.1;
    color += texture2D(gkSource, clamp(vUv - velocity, 0.0, 1.0)).rgb * 0.1;
    vec3 position = gkViewAt(vUv);
    float depth = texture2D(gkDepth, vUv).r;
    if (depth < 0.999) {
        vec3 normal = gkViewNormal(vUv);
        if (dot(normal, normal) > 0.5) {
            // World up, not screen up. A chest or shoulder can point up on
            // screen while still facing the camera, and that must stay matte.
            float up = dot(normal, gkViewUp);
            float floorWeight = smoothstep(0.88, 0.97, up);
            vec2 reach = gkTexel * 10.0;
            float agree = step(0.88, dot(gkViewNormal(vUv + vec2(reach.x, 0.0)), gkViewUp));
            agree += step(0.88, dot(gkViewNormal(vUv - vec2(reach.x, 0.0)), gkViewUp));
            agree += step(0.88, dot(gkViewNormal(vUv + vec2(0.0, reach.y)), gkViewUp));
            agree += step(0.88, dot(gkViewNormal(vUv - vec2(0.0, reach.y)), gkViewUp));
            floorWeight *= smoothstep(2.5, 3.5, agree);
            vec3 reflected = reflect(normalize(position), normal);
            vec3 reflection = vec3(0.0);
            float reflectedWeight = 0.0;
            for (int gkReflectStep = 1; gkReflectStep <= 8; gkReflectStep++) {
                vec3 samplePos = position + reflected * (float(gkReflectStep) * 0.18);
                vec4 clip = gkProj * vec4(samplePos, 1.0);
                if (clip.w < 1e-4) break;
                vec2 sampleUv = clip.xy / clip.w * 0.5 + 0.5;
                if (sampleUv.x < 0.0 || sampleUv.y < 0.0 || sampleUv.x > 1.0 || sampleUv.y > 1.0) break;
                vec3 scenePos = gkViewAt(sampleUv);
                float gap = length(samplePos) - length(scenePos);
                if (gap > 0.03 && gap < 0.45) {
                    reflection = texture2D(gkSource, sampleUv).rgb;
                    reflectedWeight = floorWeight;
                    break;
                }
            }
            color += reflection * reflectedWeight * 0.22;
        }
    }
    gl_FragColor = vec4(max(color, vec3(0.0)), texture2D(gkSource, vUv).a);
}
`;

const COPY_FRAGMENT = `
uniform sampler2D gkSource;
varying vec2 vUv;
void main() {
    gl_FragColor = texture2D(gkSource, vUv);
}
`;

const COMPOSITE_FRAGMENT = `
${GRADE_GLSL}
uniform float gkApplyGrade;
uniform float gkKeepAlpha;
uniform sampler2D gkSource;
uniform sampler2D gkBloomMap;
uniform sampler2D gkSoftMap;
uniform float gkBloomIntensity;
uniform float gkDiffusionBlend;
uniform float gkDiffusionThreshold;
uniform float gkDiffusionPower;
uniform float gkChroma;
uniform vec4 gkFlare0;
uniform vec4 gkFlare1;
uniform vec3 gkFlare0A;
uniform vec3 gkFlare0B;
uniform vec3 gkFlare1A;
uniform vec3 gkFlare1B;
uniform float gkFlareWeight;
uniform float gkFlareScale;
uniform vec3 gkVignetteColor;
uniform vec4 gkVignette;
uniform float gkVignetteWeight;
uniform float gkStarWeight;
varying vec2 vUv;

vec3 gkFlare(vec2 uv, vec4 flare, vec3 inner, vec3 outer) {
    vec2 size = max(flare.zw, vec2(1e-3));
    float radius = length((uv - flare.xy) / size);
    float weight = exp(-radius * radius * 2.0);
    return mix(outer, inner, weight) * weight;
}

void main() {
    // URP-style radial aberration: intensity is scaled by distance squared,
    // keeping the subject clean while leaving a restrained fringe at the edge.
    vec2 radial = vUv - 0.5;
    vec2 shift = radial * dot(radial, radial) * gkChroma;
    vec4 source = texture2D(gkSource, vUv);
    vec3 color = vec3(
        texture2D(gkSource, clamp(vUv + shift, 0.0, 1.0)).r,
        source.g,
        texture2D(gkSource, clamp(vUv - shift, 0.0, 1.0)).b
    );
    vec3 soft = texture2D(gkSoftMap, vUv).rgb;
    float contrast = abs(dot(color - soft, vec3(0.2126, 0.7152, 0.0722)));
    float response = pow(clamp(contrast / max(gkDiffusionThreshold, 1e-4), 0.0, 1.0), max(gkDiffusionPower, 1e-3));
    color = mix(color, soft, gkDiffusionBlend * (1.0 - response));
    vec3 bloom = texture2D(gkBloomMap, vUv).rgb;
    color += bloom * gkBloomIntensity;
    if (gkStarWeight > 0.0) {
        vec2 streak = vec2(0.02, 0.004);
        vec2 cross = vec2(-streak.y, streak.x);
        vec3 star = texture2D(gkBloomMap, clamp(vUv + streak, 0.0, 1.0)).rgb;
        star += texture2D(gkBloomMap, clamp(vUv - streak, 0.0, 1.0)).rgb;
        star += texture2D(gkBloomMap, clamp(vUv + streak * 2.2, 0.0, 1.0)).rgb;
        star += texture2D(gkBloomMap, clamp(vUv - streak * 2.2, 0.0, 1.0)).rgb;
        star += texture2D(gkBloomMap, clamp(vUv + cross * 1.6, 0.0, 1.0)).rgb;
        star += texture2D(gkBloomMap, clamp(vUv - cross * 1.6, 0.0, 1.0)).rgb;
        color += star * gkStarWeight * gkBloomIntensity;
    }
    if (gkFlareWeight > 0.0) {
        color += gkFlareScale * gkFlare(vUv, gkFlare0, gkFlare0A, gkFlare0B);
        color += gkFlareScale * gkFlare(vUv, gkFlare1, gkFlare1A, gkFlare1B);
    }
    vec2 delta = abs(vUv - gkVignette.xy) * gkVignette.z;
    float vignette = pow(clamp(1.0 - length(delta), 0.0, 1.0), max(gkVignette.w, 1e-3));
    color = mix(color, mix(gkVignetteColor, color, vignette), gkVignetteWeight);
    // Preserve portrait/plate coverage when handing this texture to LookPass.
    // Grade straight colour, then return to premultiplied canvas coverage.
    float alpha = gkKeepAlpha > 0.5 ? source.a : 1.0;
    if (gkApplyGrade > 0.5) color = gkGradeColor(color / max(alpha, 1e-4)) * alpha;
    else color *= step(1e-4, alpha);
    gl_FragColor = linearToOutputTexel(vec4(max(color, vec3(0.0)), alpha));
}
`;

// The game writes HDR color (its character shader clamps at 1000, not 1), and
// every later pass reads it back unclamped. These targets used to be 8-bit, so
// highlights clipped before bloom, and the TAA history kept linear values in an
// 8-bit buffer where darks have coarse steps. Half float fixes both. It needs
// float render targets, which WebGL2 exposes through one of two extensions.
//   ?hdr=off  or  globalThis.__HATSU_HDR_POST = false   keeps the 8-bit chain.
export function hdrPostSupported(renderer, env = globalThis) {
    if (env?.__HATSU_HDR_POST === false) return false;
    try {
        if (new URLSearchParams(env?.location?.search || '').get('hdr') === 'off') return false;
    } catch { /* no location: use the capability test alone */ }
    const extensions = renderer?.extensions;
    if (!renderer?.capabilities?.isWebGL2 || typeof extensions?.has !== 'function') return false;
    return extensions.has('EXT_color_buffer_float') || extensions.has('EXT_color_buffer_half_float');
}

function makeTarget(width, height, { depth = false, stencil = depth, samples = 0, type = THREE.UnsignedByteType, nearest = false } = {}) {
    const filter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    const target = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: depth,
        stencilBuffer: stencil,
        samples,
        type,
        magFilter: filter,
        minFilter: filter,
        generateMipmaps: false,
    });
    target.texture.generateMipmaps = false;
    target.texture.minFilter = filter;
    target.texture.magFilter = filter;
    if (nearest && 'colorSpace' in target.texture && THREE.LinearSRGBColorSpace) {
        target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    }
    return target;
}

function shader(fragment, uniforms) {
    return new THREE.ShaderMaterial({
        uniforms,
        vertexShader: POST_VERTEX,
        fragmentShader: fragment,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
    });
}

const FXAA_FRAGMENT = `
uniform sampler2D gkSource;
uniform vec2 gkTexel;
varying vec2 vUv;
const vec3 GK_LUMA = vec3(0.299, 0.587, 0.114);
void main() {
    vec4 center = texture2D(gkSource, vUv);
    vec3 rgbM = center.rgb;
    vec3 rgbNW = texture2D(gkSource, vUv + vec2(-1.0, -1.0) * gkTexel).rgb;
    vec3 rgbNE = texture2D(gkSource, vUv + vec2(1.0, -1.0) * gkTexel).rgb;
    vec3 rgbSW = texture2D(gkSource, vUv + vec2(-1.0, 1.0) * gkTexel).rgb;
    vec3 rgbSE = texture2D(gkSource, vUv + vec2(1.0, 1.0) * gkTexel).rgb;
    float lumaM = dot(rgbM, GK_LUMA);
    float lumaNW = dot(rgbNW, GK_LUMA);
    float lumaNE = dot(rgbNE, GK_LUMA);
    float lumaSW = dot(rgbSW, GK_LUMA);
    float lumaSE = dot(rgbSE, GK_LUMA);
    float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
    if (lumaMax - lumaMin < max(0.0833, lumaMax * 0.125)) {
        gl_FragColor = center;
        return;
    }
    vec2 dir = vec2(-((lumaNW + lumaNE) - (lumaSW + lumaSE)), (lumaNW + lumaSW) - (lumaNE + lumaSE));
    float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.0625, 0.0078125);
    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * gkTexel;
    vec3 rgbA = 0.5 * (
        texture2D(gkSource, vUv + dir * (0.333333 - 0.5)).rgb +
        texture2D(gkSource, vUv + dir * (0.666667 - 0.5)).rgb
    );
    vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture2D(gkSource, vUv + dir * -0.5).rgb +
        texture2D(gkSource, vUv + dir * 0.5).rgb
    );
    float lumaB = dot(rgbB, GK_LUMA);
    gl_FragColor = vec4(lumaB < lumaMin || lumaB > lumaMax ? rgbA : rgbB, center.a);
}
`;

const MODULES = ['bloom', 'diffusion', 'paraffin', 'chromatic', 'vignette'];

// Motion blur is a picture preference, not a scene-volume module. Scene apply()
// must not clear it when it reloads bloom and diffusion.
let captureMotionBlur = false;

export function setCaptureMotionBlur(enabled) {
    captureMotionBlur = enabled === true;
}

export function disposePostTargets(targets) {
    for (const value of Object.values(targets || {})) {
        for (const target of [value].flat()) target?.dispose?.();
    }
    for (const name of Object.keys(targets || {})) delete targets[name];
}

export class GakumasPostPass {
    // `targets` is a plain object several passes on one renderer hand to each
    // other. Each view (an actor, the background) keeps its own pass, with its
    // own settings and TAA history, while the large scratch targets a frame is
    // built in exist once per WebGL context. Whoever made the object releases
    // it with disposePostTargets().
    constructor(renderer, { keepAlpha = false, renderScale = 1.35, renderPixelBudget = 2500000, targets = null } = {}) {
        this.renderer = renderer;
        this.sharedTargets = targets;
        // Where the finished frame goes: the canvas, or a scratch target when a
        // stage draws a view only to warm it up.
        this.presentTarget = null;
        // Blend the finished frame over what the canvas already holds, the way
        // stacked transparent canvases composite.
        this.layered = false;
        this.enabled = false;
        this.modules = { bloom: false, diffusion: false, paraffin: false, chromatic: false, vignette: false, taa: false, fxaa: false };
        // The game resolves TAA from a higher-resolution render target than a
        // low-DPI browser canvas. Keep a modest supersample on DPR 1 screens,
        // but cap the target by a pixel budget so a full-size desktop view does
        // not unexpectedly multiply GPU cost.
        this.renderScale = Math.max(1, Math.min(Number(renderScale) || 1, 1.6));
        this.renderPixelBudget = Math.max(1, Number(renderPixelBudget) || 2500000);
        this.activeRenderScale = 1;
        this.taaTouched = false;
        this.settings = null;
        this.frame = 0;
        this.resetHistory = true;
        this.historyIndex = 0;
        this.motionHint = 0;
        this.motionDecay = 0.72;
        this.jitterMatrix = new THREE.Matrix4();
        this.jitterUv = new THREE.Vector2();
        this.stableCamera = null;
        this.lastPosition = new THREE.Vector3();
        this.lastQuaternion = new THREE.Quaternion();
        this.currentViewProj = new THREE.Matrix4();
        this.currentInvViewProj = new THREE.Matrix4();
        this.previousViewProj = new THREE.Matrix4();
        this.velocityCurrentViewProj = new THREE.Matrix4();
        this.velocityMemory = new WeakMap();
        this.velocityFrame = false;
        this.velocityDisabled = false;
        // Eyes clip to the socket with the stencil buffer, so the character is
        // drawn here. A multisample resolve allocates the paired depth buffer
        // as unsized DEPTH_STENCIL, which this WebGL path rejects.
        this.samples = 0;
        this.hdr = hdrPostSupported(renderer);
        const colorType = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
        const pool = targets || {};
        const take = (name, create) => (pool[name] ||= create());
        this.color = take('color', () => makeTarget(1, 1, { depth: true, type: colorType }));
        // Three writes linear values into any render target. 8-bit stores them in
        // an sRGB buffer to keep dark steps fine; half float is linear already.
        if ('colorSpace' in this.color.texture) {
            this.color.texture.colorSpace = this.hdr ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
        }
        this.msaa = null;
        this.depth = take('depth', () => {
            const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedInt248Type);
            depth.format = THREE.DepthStencilFormat;
            depth.magFilter = THREE.NearestFilter;
            depth.minFilter = THREE.NearestFilter;
            return depth;
        });
        this.color.depthTexture = this.depth;
        this.history = [makeTarget(1, 1, { type: colorType }), makeTarget(1, 1, { type: colorType })];
        // A shared stage keeps the completed raw result of each actor here
        // until all camera-specific layers have been composed.
        this.layerTarget = makeTarget(1, 1, { type: colorType });
        if ('colorSpace' in this.layerTarget.texture && this.color.texture.colorSpace) this.layerTarget.texture.colorSpace = this.color.texture.colorSpace;
        this.velocity = createVelocityMaterial();
        this.velocityTarget = take('velocityTarget', () => makeTarget(1, 1, { type: THREE.HalfFloatType, nearest: true }));
        if ('colorSpace' in this.velocityTarget.texture && THREE.NoColorSpace) {
            this.velocityTarget.texture.colorSpace = THREE.NoColorSpace;
        }
        // Bloom, diffusion, depth of field and the capture-space pass all carry
        // scene color, so they follow it. spaceA/B hold ambient occlusion only.
        this.bloomA = take('bloomA', () => makeTarget(1, 1, { type: colorType }));
        this.bloomB = take('bloomB', () => makeTarget(1, 1, { type: colorType }));
        // Small mip levels replace the old wide, sparsely sampled blur. The
        // existing half-size pair is reused for the largest level.
        this.bloomPyramid = take('bloomPyramid', () => Array.from({ length: 7 }, () => makeTarget(1, 1, { type: colorType })));
        this.softA = take('softA', () => makeTarget(1, 1, { type: colorType }));
        this.softB = take('softB', () => makeTarget(1, 1, { type: colorType }));
        this.dofTarget = take('dofTarget', () => makeTarget(1, 1, { type: colorType }));
        this.spaceA = take('spaceA', () => makeTarget(1, 1));
        this.spaceB = take('spaceB', () => makeTarget(1, 1));
        this.spaceFull = take('spaceFull', () => makeTarget(1, 1, { type: colorType }));
        if ('colorSpace' in this.spaceA.texture && THREE.NoColorSpace) {
            this.spaceA.texture.colorSpace = THREE.NoColorSpace;
            this.spaceB.texture.colorSpace = THREE.NoColorSpace;
        }
        this.contactWorld = new THREE.Vector3(0.25, 0.9, 0.3).normalize();
        this.contactView = new THREE.Vector3();
        this.viewUp = new THREE.Vector3(0, 1, 0);
        this.depthOfField = null;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.copyMaterial = shader(COPY_FRAGMENT, {
            gkSource: { value: null },
        });
        this.extractMaterial = shader(EXTRACT_FRAGMENT, {
            gkSource: { value: this.color.texture },
            gkThreshold: { value: 1 },
            gkBloomColor: { value: new THREE.Color(1, 1, 1) },
        });
        this.blurMaterial = shader(BLUR_FRAGMENT, {
            gkSource: { value: null },
            gkBlurTexel: { value: new THREE.Vector2() },
        });
        this.downsampleMaterial = shader(DOWNSAMPLE_FRAGMENT, {
            gkSource: { value: null },
            gkTexel: { value: new THREE.Vector2() },
        });
        this.upsampleMaterial = shader(UPSAMPLE_FRAGMENT, {
            gkSource: { value: null },
            gkLow: { value: null },
            gkTexel: { value: new THREE.Vector2() },
            gkScatter: { value: 0.65 },
        });
        this.fxaaMaterial = shader(FXAA_FRAGMENT, {
            gkSource: { value: this.color.texture },
            gkTexel: { value: new THREE.Vector2() },
        });
        this.dofMaterial = shader(DOF_FRAGMENT, {
            gkSource: { value: null },
            gkDepth: { value: this.depth },
            gkTexel: { value: new THREE.Vector2() },
            gkNear: { value: 0.1 },
            gkFar: { value: 1000 },
            gkFocus: { value: 1 },
            gkRadius: { value: 0 },
        });
        this.taaMaterial = shader(TAA_FRAGMENT, {
            gkCurrent: { value: this.color.texture },
            gkHistory: { value: this.history[0].texture },
            gkDepth: { value: this.depth },
            gkVelocity: { value: this.velocityTarget.texture },
            gkTexel: { value: new THREE.Vector2() },
            gkJitter: { value: this.jitterUv },
            gkInfluence: { value: 0.1 },
            gkVarianceScale: { value: 0.55 },
            gkHasHistory: { value: 0 },
            gkKeepAlpha: { value: keepAlpha ? 1 : 0 },
            gkStill: { value: 0 },
            gkMotion: { value: 0 },
            gkObjectMotion: { value: 0 },
            gkHasVelocity: { value: 0 },
            // The game gathers a 3x3 neighborhood and keeps the strongest
            // motion vector so silhouettes do not lose history coverage.
            gkVelocityNeighborhood: { value: 1 },
            gkInvViewProj: { value: this.currentInvViewProj },
            gkPrevViewProj: { value: this.previousViewProj },
        });
        this.compositeMaterial = shader(COMPOSITE_FRAGMENT, {
            gkApplyGrade: { value: 0 },
            gkDeferGrade: { value: 0 },
            gkKeepAlpha: { value: keepAlpha ? 1 : 0 },
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
            gkSource: { value: this.color.texture },
            gkBloomMap: { value: this.bloomA.texture },
            gkSoftMap: { value: this.softA.texture },
            gkBloomIntensity: { value: 0 },
            gkDiffusionBlend: { value: 0 },
            gkDiffusionThreshold: { value: 0.5 },
            gkDiffusionPower: { value: 1 },
            gkChroma: { value: 0 },
            gkFlare0: { value: new THREE.Vector4() },
            gkFlare1: { value: new THREE.Vector4() },
            gkFlare0A: { value: new THREE.Color() },
            gkFlare0B: { value: new THREE.Color() },
            gkFlare1A: { value: new THREE.Color() },
            gkFlare1B: { value: new THREE.Color() },
            gkFlareWeight: { value: 0 },
            gkFlareScale: { value: PARAFFIN_DISPLAY_SCALE },
            gkVignetteColor: { value: new THREE.Color() },
            gkVignette: { value: new THREE.Vector4(0.5, 0.5, 0, 0.2) },
            gkVignetteWeight: { value: 0 },
            gkStarWeight: { value: 0 },
        });
        this.aoMaterial = shader(AO_FRAGMENT, {
            gkDepth: { value: this.depth },
            gkTexel: { value: new THREE.Vector2() },
            gkCamera: { value: new THREE.Vector2(0.1, 1000) },
        });
        this.spaceMaterial = shader(SPACE_FRAGMENT, {
            gkSource: { value: this.color.texture },
            gkDepth: { value: this.depth },
            gkAo: { value: this.spaceB.texture },
            gkVelocity: { value: this.velocityTarget.texture },
            gkTexel: { value: new THREE.Vector2() },
            gkCamera: { value: new THREE.Vector2(0.1, 1000) },
            gkProj: { value: new THREE.Matrix4() },
            gkInvProj: { value: new THREE.Matrix4() },
            gkContactView: { value: new THREE.Vector3(0, 1, 0) },
            gkViewUp: { value: new THREE.Vector3(0, 1, 0) },
            gkHasVelocity: { value: 0 },
        });
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial);
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
        this.size = new THREE.Vector2();
    }

    get active() {
        return this.enabled && (this.modules.taa || this.modules.fxaa || this.usesSceneHDR || MODULES.some(name => this.modules[name]));
    }

    get usesSceneHDR() {
        return this.enabled && this.hdr && !!this.settings?.grading;
    }

    apply(settings) {
        this.settings = settings;
        const keepTaa = this.modules.taa;
        for (const name of MODULES) this.modules[name] = !!settings?.[name]?.enabled;
        this.modules.taa = settings ? (this.taaTouched ? keepTaa : true) : false;
        this.resetHistory = true;
        this.motionHint = 0;
        this.velocityMemory = new WeakMap();
        this.velocityFrame = false;
        this.velocityDisabled = false;
        this.sync();
    }

    setQuality(quality = {}) {
        const taa = !!quality.taa;
        const fxaa = !!quality.fxaa && !taa;
        const renderScale = Math.max(1, Math.min(Number(quality.renderScale) || 1, 1.6));
        const renderPixelBudget = Math.max(1, Number(quality.renderPixelBudget) || this.renderPixelBudget);
        const same = this.modules.taa === taa
            && this.modules.fxaa === fxaa
            && this.renderScale === renderScale
            && this.renderPixelBudget === renderPixelBudget;
        if (same) return;
        const scaleChanged = this.renderScale !== renderScale || this.renderPixelBudget !== renderPixelBudget;
        this.renderScale = renderScale;
        this.renderPixelBudget = renderPixelBudget;
        this.modules.fxaa = fxaa;
        if (this.modules.taa !== taa) {
            this.modules.taa = taa;
            this.resetHistory = true;
        }
        this.taaTouched = true;
        if (scaleChanged) this.color.setSize(1, 1);
    }

    setModule(name, enabled) {
        if (name === 'taa') {
            this.modules.taa = !!enabled;
            this.taaTouched = true;
            this.resetHistory = true;
            return;
        }
        if (!MODULES.includes(name)) return;
        this.modules[name] = !!enabled;
        this.sync();
    }

    setDepthOfField(dof) {
        const aperture = Number(dof?.aperture);
        const focus = Number(dof?.focus);
        if (!(aperture > 0) || !(focus > 0)) {
            this.depthOfField = null;
            return;
        }
        this.depthOfField = {
            aperture: Math.min(22, Math.max(1.2, aperture)),
            focus,
        };
    }

    setMotionHint(value, { reset = false } = {}) {
        this.motionHint = mergeTaaMotion(this.motionHint, value);
        if (reset) this.resetHistory = true;
        return this.motionHint;
    }

    sync() {
        const settings = this.settings || {};
        const bloom = settings.bloom || {};
        const diffusion = settings.diffusion || {};
        const flares = settings.paraffin?.flares || [{}, {}];
        const uniforms = this.compositeMaterial.uniforms;
        const extract = this.extractMaterial.uniforms;
        extract.gkThreshold.value = Number.isFinite(bloom.threshold) ? bloom.threshold : 1;
        extract.gkBloomColor.value.setRGB(...(bloom.color || [1, 1, 1]));
        uniforms.gkBloomIntensity.value = this.modules.bloom ? (bloom.intensity || 0) * (this.usesSceneHDR ? BLOOM_HDR_SCALE : BLOOM_DISPLAY_SCALE) : 0;
        uniforms.gkStarWeight.value = this.modules.bloom && settings.starStreak?.enabled ? 0.09 : 0;
        uniforms.gkDiffusionBlend.value = this.modules.diffusion ? (diffusion.blend || 0) * DIFFUSION_DISPLAY_SCALE : 0;
        uniforms.gkDiffusionThreshold.value = diffusion.contrastThreshold ?? 0.5;
        uniforms.gkDiffusionPower.value = Math.max(diffusion.contrastPower || 1, 1e-3);
        // Volume intensity is the URP spectral amount. Used raw it splits the
        // frame by tens of pixels, so keep only the edge fringe.
        uniforms.gkChroma.value = this.modules.chromatic ? (settings.chromatic?.intensity || 0) * 0.05 : 0;
        const grade = settings.grading;
        uniforms.gkApplyGrade.value = this.usesSceneHDR ? 1 : 0;
        if (grade) {
            uniforms.gkExposure.value = grade.exposure;
            uniforms.gkContrast.value = grade.contrast;
            uniforms.gkSaturation.value = grade.saturation;
            uniforms.gkColorFilter.value.fromArray(grade.colorFilter);
            uniforms.gkTone.value.set(grade.tone.linearStart, grade.tone.linearLength, grade.tone.contrast, grade.tone.black);
            uniforms.gkToneEnabled.value = grade.tone.enabled ? 1 : 0;
            uniforms.gkShadows.value.fromArray(grade.shadows);
            uniforms.gkMidtones.value.fromArray(grade.midtones);
            uniforms.gkHighlights.value.fromArray(grade.highlights);
            uniforms.gkSmhLimits.value.fromArray(grade.smhLimits);
        }
        this.writeFlare(0, flares[0]);
        this.writeFlare(1, flares[1]);
        uniforms.gkFlareWeight.value = this.modules.paraffin ? 1 : 0;
        const vignette = settings.vignette || {};
        uniforms.gkVignetteColor.value.setRGB(...(vignette.color || [0, 0, 0]));
        uniforms.gkVignette.value.set(vignette.center?.[0] ?? 0.5, vignette.center?.[1] ?? 0.5, vignette.intensity || 0, Math.max(vignette.smoothness || 0.2, 1e-3));
        uniforms.gkVignetteWeight.value = this.modules.vignette ? 1 : 0;
        this.bloomRadius = this.modules.bloom ? (bloom.diffusion || 0) * 2 : 0;
        this.softRadius = this.modules.diffusion ? Math.max(0, diffusion.diffusion || 0) * 6 : 0;
    }

    writeFlare(index, flare = {}) {
        const uniforms = this.compositeMaterial.uniforms;
        const box = index === 0 ? uniforms.gkFlare0 : uniforms.gkFlare1;
        const inner = index === 0 ? uniforms.gkFlare0A : uniforms.gkFlare1A;
        const outer = index === 0 ? uniforms.gkFlare0B : uniforms.gkFlare1B;
        box.value.set(flare.center?.[0] || 0, flare.center?.[1] || 0, flare.size?.[0] || 0, flare.size?.[1] || 0);
        inner.value.setRGB(...(flare.color0 || [0, 0, 0]));
        outer.value.setRGB(...(flare.color1 || [0, 0, 0]));
    }

    setSize(width, height) {
        const pixelRatio = this.renderer.getPixelRatio();
        const basePixels = Math.max(1, width * height * pixelRatio * pixelRatio);
        const budgetScale = Math.sqrt(this.renderPixelBudget / basePixels);
        const scale = this.modules.taa ? Math.min(this.renderScale, Math.max(1, budgetScale)) : 1;
        this.activeRenderScale = scale;
        const w = Math.max(1, Math.floor(width * pixelRatio * scale));
        const h = Math.max(1, Math.floor(height * pixelRatio * scale));
        // Another pass may already have sized the shared targets; this pass's
        // own history still has to follow.
        const sized = this.color.width === w && this.color.height === h;
        const historySized = this.history.every(target => target.width === w && target.height === h);
        if (sized && historySized) return;
        this.color.setSize(w, h);
        this.msaa?.setSize(w, h);
        for (const target of this.history) target.setSize(w, h);
        this.layerTarget.setSize(w, h);
        this.velocityTarget.setSize(w, h);
        const hw = Math.max(1, Math.floor(w / 2));
        const hh = Math.max(1, Math.floor(h / 2));
        for (const target of [this.bloomA, this.bloomB, this.softA, this.softB, this.spaceA, this.spaceB]) target.setSize(hw, hh);
        this.bloomPyramid.forEach((target, index) => {
            const level = index < 4 ? index + 2 : index - 2;
            target.setSize(Math.max(1, w >> level), Math.max(1, h >> level));
        });
        this.dofTarget.setSize(w, h);
        this.spaceFull.setSize(w, h);
        this.resetHistory = true;
        this.motionHint = 0;
        this.velocityMemory = new WeakMap();
        this.velocityFrame = false;
    }

    applyJitter(viewCamera) {
        const index = (this.frame % 8) + 1;
        this.jitterUv.set((haltonSequence(index, 2) - 0.5) / this.color.width, (haltonSequence(index, 3) - 0.5) / this.color.height);
        viewCamera.updateMatrixWorld();
        viewCamera.updateProjectionMatrix();
        this.jitterMatrix.makeTranslation(this.jitterUv.x * 2, this.jitterUv.y * 2, 0);
        viewCamera.projectionMatrix.premultiply(this.jitterMatrix);
        viewCamera.projectionMatrixInverse.copy(viewCamera.projectionMatrix).invert();
    }

    clearJitter(viewCamera) {
        viewCamera.updateProjectionMatrix();
    }

    prepareStableCamera(viewCamera) {
        viewCamera.updateMatrixWorld();
        if (!this.stableCamera || this.stableCamera.type !== viewCamera.type) {
            this.stableCamera = viewCamera.clone();
        } else {
            this.stableCamera.copy(viewCamera);
        }
        this.stableCamera.userData = { ...(this.stableCamera.userData || {}), gkTaaStableCamera: null };
        this.stableCamera.updateMatrixWorld(true);
        return this.stableCamera;
    }

    renderVelocityFrame(root, stableCamera) {
        this.velocityFrame = false;
        if (this.velocityDisabled || !root || !stableCamera || !this.velocityTarget) return;
        if (this.resetHistory) this.velocityMemory = new WeakMap();
        this.velocityCurrentViewProj.multiplyMatrices(stableCamera.projectionMatrix, stableCamera.matrixWorldInverse);
        try {
            renderSceneVelocity(this.renderer, root, this.velocity, this.velocityTarget, stableCamera, {
                currentViewProj: this.velocityCurrentViewProj,
                previousViewProj: this.previousViewProj,
                memory: this.velocityMemory,
            });
            rememberSceneMotion(root, this.velocityMemory);
            this.velocityFrame = true;
        } catch (error) {
            // Some WebGL1/driver combinations cannot attach a half-float color
            // target. Keep the old scalar-motion TAA path instead of blanking
            // the scene when the optional velocity pass is unavailable.
            this.velocityDisabled = true;
            this.velocityMemory = new WeakMap();
            console.warn('[GakumasPostPass] velocity buffer disabled', error);
        }
    }

    resolveHistory(viewCamera) {
        this.currentViewProj.multiplyMatrices(viewCamera.projectionMatrix, viewCamera.matrixWorldInverse);
        this.currentInvViewProj.copy(this.currentViewProj).invert();
        const read = this.history[this.historyIndex];
        const write = this.history[1 - this.historyIndex];
        const uniforms = this.taaMaterial.uniforms;
        uniforms.gkHistory.value = read.texture;
        uniforms.gkVelocity.value = this.velocityFrame
            ? this.velocityTarget.texture
            : this.velocity.fallbackTexture;
        uniforms.gkHasVelocity.value = this.velocityFrame ? 1 : 0;
        uniforms.gkTexel.value.set(1 / this.color.width, 1 / this.color.height);
        const portrait = uniforms.gkKeepAlpha.value > 0.5;
        uniforms.gkInfluence.value = portrait ? 0.42 : 0.1;
            // GPA captured cb1[12].z = 0.9 for the game's 3x3 variance clip.
            // Keep the same range for transparent portraits; velocity rejection
            // handles their moving silhouettes instead of narrowing the clip.
            uniforms.gkVarianceScale.value = 0.9;
        uniforms.gkHasHistory.value = this.resetHistory ? 0 : 1;
        const movedPixels = this.lastPosition.distanceTo(viewCamera.position) * this.color.height * 0.15
            + this.lastQuaternion.angleTo(viewCamera.quaternion) * (this.color.height / Math.max(viewCamera.fov, 1));
        const objectMotion = clampTaaMotion(this.motionHint);
        const still = movedPixels < 0.25 && objectMotion < 0.05;
        uniforms.gkStill.value = still ? 1 : 0;
        uniforms.gkMotion.value = Math.min(1, movedPixels / 6);
        uniforms.gkObjectMotion.value = objectMotion;
        this.lastPosition.copy(viewCamera.position);
        this.lastQuaternion.copy(viewCamera.quaternion);
        this.blit(this.taaMaterial, write);
        this.historyIndex = 1 - this.historyIndex;
        this.clearJitter(viewCamera);
        viewCamera.updateMatrixWorld();
        this.previousViewProj.multiplyMatrices(viewCamera.projectionMatrix, viewCamera.matrixWorldInverse);
        this.resetHistory = false;
        this.motionHint = decayTaaMotion(this.motionHint, this.motionDecay);
        this.frame += 1;
        return write;
    }

    blit(material, target) {
        this.mesh.material = material;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);
    }

    blur(source, radius, ping, pong) {
        const texel = this.blurMaterial.uniforms.gkBlurTexel.value;
        texel.set(radius / ping.width, 0);
        this.blurMaterial.uniforms.gkSource.value = source.texture;
        this.blit(this.blurMaterial, ping);
        texel.set(0, radius / pong.height);
        this.blurMaterial.uniforms.gkSource.value = ping.texture;
        this.blit(this.blurMaterial, pong);
        return pong;
    }

    renderBloom(source) {
        this.extractMaterial.uniforms.gkSource.value = source;
        this.blit(this.extractMaterial, this.bloomA);
        const count = Math.max(1, Math.min(5, Math.round(this.bloomRadius / 2) - 1));
        const levels = [this.bloomA, ...this.bloomPyramid.slice(0, count - 1)];
        const down = this.downsampleMaterial.uniforms;
        for (let index = 1; index < levels.length; index += 1) {
            const previous = levels[index - 1];
            down.gkSource.value = previous.texture;
            down.gkTexel.value.set(1 / previous.width, 1 / previous.height);
            this.blit(this.downsampleMaterial, levels[index]);
        }
        let low = levels[levels.length - 1];
        const up = this.upsampleMaterial.uniforms;
        for (let index = levels.length - 2; index >= 0; index -= 1) {
            const target = index === 0 ? this.bloomB : this.bloomPyramid[3 + index];
            up.gkSource.value = levels[index].texture;
            up.gkLow.value = low.texture;
            up.gkTexel.value.set(1 / low.width, 1 / low.height);
            this.blit(this.upsampleMaterial, target);
            low = target;
        }
        return low.texture;
    }

    applyCaptureSpace(source, viewCamera) {
        const near = Math.max(viewCamera.near || 0.1, 1e-4);
        const far = Math.max(viewCamera.far || 1000, near + 0.01);
        const camera = this.aoMaterial.uniforms.gkCamera.value;
        camera.set(near, far);
        this.spaceMaterial.uniforms.gkCamera.value.copy(camera);
        const uniforms = this.spaceMaterial.uniforms;
        uniforms.gkSource.value = source;
        uniforms.gkDepth.value = this.depth;
        uniforms.gkVelocity.value = this.velocityFrame ? this.velocityTarget.texture : this.velocity.fallbackTexture;
        uniforms.gkHasVelocity.value = captureMotionBlur && this.velocityFrame ? 1 : 0;
        uniforms.gkTexel.value.set(1 / this.color.width, 1 / this.color.height);
        uniforms.gkProj.value.copy(viewCamera.projectionMatrix);
        uniforms.gkInvProj.value.copy(viewCamera.projectionMatrixInverse);
        this.contactView.copy(this.contactWorld).transformDirection(viewCamera.matrixWorldInverse);
        uniforms.gkContactView.value.copy(this.contactView);
        this.viewUp.set(0, 1, 0).transformDirection(viewCamera.matrixWorldInverse).normalize();
        uniforms.gkViewUp.value.copy(this.viewUp);
        this.blit(this.spaceMaterial, this.spaceFull);
        return this.spaceFull.texture;
    }

    // Apply the stage-wide color effects once after the camera-specific actor
    // layers and background have been composited.
    renderCaptured(source, target) {
        // `renderCaptured` is the explicit stage-composition entry point. A
        // few callers pass an omitted target while they only need the resolved
        // texture; keep that form useful by writing to this pass's reusable
        // layer target instead of handing an undefined render target to
        // WebGLRenderer.
        target ||= this.layerTarget;
        this.compositeMaterial.uniforms.gkSource.value = source;
        this.compositeMaterial.uniforms.gkApplyGrade.value = this.usesSceneHDR ? 1 : 0;
        if (this.modules.bloom) this.compositeMaterial.uniforms.gkBloomMap.value = this.renderBloom(source);
        if (this.modules.diffusion && this.softRadius > 0) {
            const soft = this.blur({ texture: source }, this.softRadius * this.color.height / 1080, this.softA, this.softB);
            this.compositeMaterial.uniforms.gkSoftMap.value = soft.texture;
        }
        this.blit(this.compositeMaterial, target);
        return target.texture;
    }

    // Render one camera view without presenting it. Shared stages call this
    // for each actor and hand the returned texture to their LookPass, which
    // performs source-over onto the already drawn background/layers.
    renderLayer(draw, viewCamera, { velocityRoot = null, composite = true } = {}) {
        return this.render(draw, viewCamera, {
            present: false,
            composite,
            velocityRoot,
        });
    }

    render(draw, viewCamera, { present = true, composite = true, captureOutput = false, velocityRoot = null } = {}) {
        this.renderer.getSize(this.size);
        this.setSize(this.size.x, this.size.y);
        const useTaa = this.modules.taa && !!viewCamera;
        const autoClear = this.renderer.autoClear;
        this.renderer.autoClear = true;
        const previousStableCamera = viewCamera?.userData?.gkTaaStableCamera;
        if (useTaa) {
            const stableCamera = this.prepareStableCamera(viewCamera);
            viewCamera.userData.gkTaaStableCamera = stableCamera;
            this.applyJitter(viewCamera);
        }
        this.renderer.setRenderTarget(this.msaa || this.color);
        this.renderer.clear(true, true, true);
        let source = this.color.texture;
        try {
            draw();
            if (this.msaa) {
                this.copyMaterial.uniforms.gkSource.value = this.msaa.texture;
                this.blit(this.copyMaterial, this.color);
            }
            if (useTaa) {
                const stableCamera = viewCamera.userData?.gkTaaStableCamera || this.stableCamera;
                this.renderVelocityFrame(velocityRoot, stableCamera);
            } else {
                this.velocityFrame = false;
            }
            if (viewCamera) source = this.applyCaptureSpace(this.color.texture, viewCamera);
            if (useTaa) this.taaMaterial.uniforms.gkCurrent.value = source;
            const resolved = useTaa ? this.resolveHistory(viewCamera) : null;
            this.taaMaterial.uniforms.gkCurrent.value = this.color.texture;
            if (useTaa) this.clearJitter(viewCamera);
            source = resolved ? resolved.texture : source;
            if (this.modules.fxaa && !useTaa) {
                const fxaa = this.fxaaMaterial.uniforms;
                fxaa.gkSource.value = source;
                fxaa.gkTexel.value.set(1 / this.color.width, 1 / this.color.height);
                this.blit(this.fxaaMaterial, this.history[0]);
                source = this.history[0].texture;
            }
            if (this.depthOfField && viewCamera) {
                const radius = Math.min(22, Math.max(2, 72 / this.depthOfField.aperture));
                const uniforms = this.dofMaterial.uniforms;
                uniforms.gkSource.value = source;
                uniforms.gkDepth.value = this.depth;
                uniforms.gkTexel.value.set(1 / this.color.width, 1 / this.color.height);
                uniforms.gkNear.value = Math.max(viewCamera.near || 0.1, 1e-4);
                uniforms.gkFar.value = Math.max(viewCamera.far || 1000, uniforms.gkNear.value + 0.01);
                uniforms.gkFocus.value = this.depthOfField.focus;
                uniforms.gkRadius.value = radius;
                this.blit(this.dofMaterial, this.dofTarget);
                source = this.dofTarget.texture;
            }
            // A caller presenting via LookPass still needs the scene effects.
            // Shared-stage group layers retain the camera-specific TAA/depth
            // result, then the stage applies bloom/grade once to the combined
            // image. The target is view-owned so the next actor may reuse the
            // shared scratch buffers safely.
            if (!composite && !present) {
                if (captureOutput) {
                    this.blit(this.copyMaterial, this.layerTarget);
                    return this.layerTarget.texture;
                }
                return source;
            }
            this.compositeMaterial.uniforms.gkSource.value = source;
            this.compositeMaterial.uniforms.gkApplyGrade.value = this.usesSceneHDR ? 1 : 0;
            if (this.modules.bloom) {
                this.compositeMaterial.uniforms.gkBloomMap.value = this.renderBloom(source);
            }
            if (this.modules.diffusion && this.softRadius > 0) {
                const soft = this.blur({ texture: source }, this.softRadius * this.color.height / 1080, this.softA, this.softB);
                this.compositeMaterial.uniforms.gkSoftMap.value = soft.texture;
            }
            if (!present) {
                // Reuse the idle history buffer: no extra full-size HDR target.
                const target = useTaa ? this.history[1 - this.historyIndex]
                    : source === this.history[0].texture ? this.history[1] : this.history[0];
                this.blit(this.compositeMaterial, target);
                return target.texture;
            }
            this.renderer.autoClear = false;
            this.presentComposite();
        } finally {
            if (useTaa) this.clearJitter(viewCamera);
            if (viewCamera?.userData) viewCamera.userData.gkTaaStableCamera = previousStableCamera || null;
            this.renderer.setRenderTarget(null);
            this.renderer.autoClear = autoClear;
        }
    }

    presentComposite() {
        const material = this.compositeMaterial;
        if (!this.layered) {
            this.blit(material, this.presentTarget);
            return;
        }
        // Premultiplied source-over. Only for this draw: the same material also
        // composites into history targets, where it must overwrite.
        material.transparent = true;
        material.blending = THREE.CustomBlending;
        material.blendSrc = THREE.OneFactor;
        material.blendDst = THREE.OneMinusSrcAlphaFactor;
        try {
            this.blit(material, this.presentTarget);
        } finally {
            material.transparent = false;
            material.blending = THREE.NormalBlending;
        }
    }

    // Give back this view's history while it is off camera. setSize() notices
    // and rebuilds it on the next frame.
    releaseHistory() {
        for (const target of this.history) target.setSize(1, 1);
        this.resetHistory = true;
    }

    dispose() {
        for (const target of this.history) target.dispose();
        this.layerTarget?.dispose();
        if (!this.sharedTargets) {
            for (const target of [this.color, this.msaa, this.bloomA, this.bloomB, ...this.bloomPyramid, this.softA, this.softB, this.dofTarget, this.spaceA, this.spaceB, this.spaceFull]) if (target) target.dispose();
            this.velocityTarget?.dispose();
            this.depth.dispose();
        }
        this.velocity?.dispose();
        this.copyMaterial.dispose();
        this.extractMaterial.dispose();
        this.blurMaterial.dispose();
        this.downsampleMaterial.dispose();
        this.upsampleMaterial.dispose();
        this.dofMaterial.dispose();
        this.fxaaMaterial.dispose();
        this.aoMaterial.dispose();
        this.spaceMaterial.dispose();
        this.taaMaterial.dispose();
        this.compositeMaterial.dispose();
        this.mesh.geometry.dispose();
        this.stableCamera = null;
    }
}
