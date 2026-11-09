// The game samples its character shadow map with four hardware-comparison taps
// at +-half a texel (GPA: cb0 holds +-1/8192 for a 4096 map), each bilinearly
// filtered. Bilinear taps one texel apart share texels, so the average of the
// four collapses exactly into a 3x3 footprint whose per-axis weights are
// (1 - a, 1, a) / 2, with a the fractional texel position. Nine fetches give
// the same result as sixteen. Three's shadow map is an RGBA-packed depth
// target without hardware comparison, so each texel is compared by hand.
const SHADOW_FILTER = `
float gkCharacterShadowTap(vec2 uv, float depth, float bias) {
    return (depth - unpackRGBAToDepth(texture2D(gkCharacterShadowMap, uv))) > bias ? 0.0 : 1.0;
}
float gkCharacterShadowRow(vec2 uv, float depth, float bias, vec3 wx, float texel) {
    return wx.x * gkCharacterShadowTap(uv, depth, bias)
        + wx.y * gkCharacterShadowTap(uv + vec2(texel, 0.0), depth, bias)
        + wx.z * gkCharacterShadowTap(uv + vec2(texel * 2.0, 0.0), depth, bias);
}
float gkCharacterShadowLit(vec3 proj, float bias) {
    float texel = 1.0 / max(gkCharacterShadowSize, 1.0);
    vec2 coord = proj.xy * gkCharacterShadowSize - 1.0;
    vec2 cell = floor(coord);
    vec2 f = coord - cell;
    vec2 uv = (cell + 0.5) * texel;
    vec3 wx = vec3(1.0 - f.x, 1.0, f.x) * 0.5;
    vec3 wy = vec3(1.0 - f.y, 1.0, f.y) * 0.5;
    return wy.x * gkCharacterShadowRow(uv, proj.z, bias, wx, texel)
        + wy.y * gkCharacterShadowRow(uv + vec2(0.0, texel), proj.z, bias, wx, texel)
        + wy.z * gkCharacterShadowRow(uv + vec2(0.0, texel * 2.0), proj.z, bias, wx, texel);
}
`;

export function injectActorShader(shader, uniforms) {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `
uniform mat4 gkCharacterShadowMatrix;
varying vec4 gkCharacterShadowCoord;
varying vec3 gkActorWorldPosition;
attribute vec4 gakumasVertexColor;
varying float gkRampAddId;
varying float gkRimMask;
${shader.vertexShader}`;
    // worldpos_vertex only declares worldPosition when USE_SHADOWMAP / USE_ENVMAP
    // etc. are set. VN live portrait keeps shadowMap off, so that identifier
    // never exists. Always compute our own clip-independent world position.
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vec4 gkWorldPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
gkWorldPosition = batchingMatrix * gkWorldPosition;
#endif
#ifdef USE_INSTANCING
gkWorldPosition = instanceMatrix * gkWorldPosition;
#endif
gkWorldPosition = modelMatrix * gkWorldPosition;
gkActorWorldPosition = gkWorldPosition.xyz;
gkCharacterShadowCoord = gkCharacterShadowMatrix * gkWorldPosition;`);
    shader.fragmentShader = `
#undef USE_MATCAP
uniform sampler2D gkShadeMap;
uniform sampler2D gkDefMap;
uniform sampler2D gkRampMap;
uniform sampler2D gkHighlightMap;
uniform sampler2D gkRampAddMap;
uniform float gkHasShade;
uniform float gkHasRamp;
uniform float gkHasHighlight;
uniform float gkHasRampAdd;
uniform vec3 gkRampAddColor;
uniform vec3 gkLightDirection;
uniform vec3 gkLightColor;
uniform float gkLightStrength;
uniform float gkMainLightWorld;
uniform float gkLightTermOffset;
uniform float gkShadowFloor;
uniform float gkShadowStrength;
uniform float gkSkinSaturation;
uniform float gkSkinLift;
uniform vec3 gkShadeMultiply;
uniform vec3 gkSpecSky;
uniform vec3 gkSpecFloor;
uniform vec3 gkSpecHorizon;
uniform float gkSpecStrength;
uniform vec3 gkHeadRight;
uniform vec3 gkRimDirection;
uniform vec3 gkRimColor;
uniform float gkRimStrength;
uniform float gkRimPower;
uniform float gkRimAlbedo;
uniform int gkDebugView;
uniform sampler2D gkCharacterShadowMap;
uniform float gkCharacterShadowEnabled;
uniform float gkCharacterShadowReceive;
uniform float gkCharacterShadowContact;
uniform float gkCharacterShadowSize;
uniform mat4 gkWorldToScene;
uniform int gkAddLightCount;
uniform vec4 gkAddLightPosition[8];
uniform vec4 gkAddLightDirection[8];
uniform vec3 gkAddLightColor[8];
uniform vec4 gkAddLightParams[8];
uniform float gkAddLightScale;
uniform float gkAddLightSpecularScale;
uniform float gkMatCapOffset;
uniform float gkShadeApply;
uniform vec3 gkEyeHighlightColor;
uniform vec3 gkEyeReflectionColor;
uniform vec3 gkActorSH[9];
uniform float gkGiScale;
uniform vec4 gkProbeOcclusion;
uniform float gkProbeShadowChannel;
uniform sampler2D gkActorProbeMap;
uniform float gkHasActorProbe;
uniform vec4 gkActorProbeInfo;
uniform vec3 gkActorProbePosition;
uniform vec3 gkActorProbeBoxMin;
uniform vec3 gkActorProbeBoxMax;
uniform float gkActorProbeBoxProjection;
uniform vec3 gkActorProbeTint;
vec3 gkActorSampleProbe(vec3 dir, float mip) {
    vec3 d = normalize(vec3(-dir.x, dir.y, dir.z));
    float u = atan(d.z, d.x) / 6.28318530718;
    float v = acos(clamp(d.y, -1.0, 1.0)) / 3.14159265359;
    float levels = gkActorProbeInfo.x;
    float halfTexel = 0.5 / gkActorProbeInfo.y;
    v = clamp(v, halfTexel, 1.0 - halfTexel);
    float lo = floor(mip);
    float hi = min(lo + 1.0, levels - 1.0);
    vec4 a = texture2D(gkActorProbeMap, vec2(u, (lo + v) / levels));
    vec4 b = texture2D(gkActorProbeMap, vec2(u, (hi + v) / levels));
    return mix(a.rgb * a.a, b.rgb * b.a, mip - lo) * gkActorProbeInfo.z;
}
vec3 gkActorBoxProject(vec3 dir, vec3 position) {
    if (gkActorProbeBoxProjection < 0.5) return dir;
    vec3 tMax = (gkActorProbeBoxMax - position) / dir;
    vec3 tMin = (gkActorProbeBoxMin - position) / dir;
    vec3 t = vec3(dir.x > 0.0 ? tMax.x : tMin.x, dir.y > 0.0 ? tMax.y : tMin.y, dir.z > 0.0 ? tMax.z : tMin.z);
    t = mix(t, vec3(1e6), step(abs(dir), vec3(1e-5)));
    return position + dir * min(min(t.x, t.y), t.z) - gkActorProbePosition;
}
#ifdef GK_HAIR_COVER_PASS
uniform vec3 gkHairHeadForward;
uniform vec3 gkHairHeadUp;
uniform vec4 gkHairFadeParameters;
uniform float gkHairMinimumCoverage;
#endif
varying vec4 gkCharacterShadowCoord;
varying vec3 gkActorWorldPosition;
varying float gkRampAddId;
varying float gkRimMask;
${shader.fragmentShader}`;
    // The filter needs unpackRGBAToDepth, so it goes right after three's packing
    // chunk. Without that chunk it follows the declarations above.
    shader.fragmentShader = shader.fragmentShader.includes('#include <packing>')
        ? shader.fragmentShader.replace('#include <packing>', `#include <packing>\n${SHADOW_FILTER}`)
        : shader.fragmentShader.replace('varying float gkRimMask;', `varying float gkRimMask;\n${SHADOW_FILTER}`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 gkVertexHigh = floor(gakumasVertexColor * 15.9375 + 0.03125);
vec4 gkVertexLow = gakumasVertexColor * 255.0 - gkVertexHigh * 16.0;
gkRampAddId = gkVertexLow.y / 15.0;
gkRimMask = gkVertexHigh.w / 15.0;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
#ifdef GK_HAIR_COVER_PASS
float gkHairFadeMask = 0.0;
#ifdef USE_MAP
gkHairFadeMask = texture2D(map, vMapUv).a;
#endif
vec3 gkHairViewWorld = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
float gkHairFadeX = clamp((gkHairFadeParameters.x - dot(gkHairHeadForward, gkHairViewWorld)) * gkHairFadeParameters.y, 0.0, 1.0);
float gkHairFadeZ = clamp((abs(dot(gkHairHeadUp, gkHairViewWorld)) - gkHairFadeParameters.z) * gkHairFadeParameters.w, 0.0, 1.0);
float gkHairFade = max(max(gkHairFadeX, gkHairFadeZ), gkHairMinimumCoverage);
diffuseColor.a = mix(1.0, gkHairFade, gkHairFadeMask) * opacity;
#endif
#ifdef GK_EYE_HIGHLIGHT
// The exported m_ehl image is an RGB glow atlas with an opaque black
// background. Unity's material used the shader mask to discard that black;
// reconstruct the same mask here because the PNG alpha is fully opaque.
float gkEyeHighlightMask = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
diffuseColor.a *= smoothstep(0.015, 0.08, gkEyeHighlightMask);
#endif
#include <alphatest_fragment>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
#include <lights_fragment_end>
vec2 gkUv = vec2(0.5);
#ifdef USE_MAP
gkUv = vMapUv;
#endif
vec3 gkBase = diffuseColor.rgb;
vec4 gkShade = texture2D(gkShadeMap, gkUv);
gkShade = mix(vec4(gkBase, 0.0), gkShade, gkHasShade);
vec4 gkDef = texture2D(gkDefMap, gkUv);
vec3 gkNormalWS = inverseTransformDirection(normalize(normal), viewMatrix);
vec3 gkViewWS = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
vec3 gkCameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
vec3 gkViewSide = normalize(cross(gkViewWS, gkCameraUp));
vec3 gkViewUp = normalize(cross(gkViewSide, gkViewWS));
vec3 gkMatNormal = vec3(dot(gkNormalWS, gkViewSide), dot(gkNormalWS, gkViewUp), dot(gkNormalWS, gkViewWS));
vec3 gkLight = normalize(gkLightDirection);
vec3 gkSceneNormal = normalize(mat3(gkWorldToScene) * gkNormalWS);
vec3 gkScenePos = (gkWorldToScene * vec4(gkActorWorldPosition, 1.0)).xyz;
vec3 gkSceneView = normalize(mat3(gkWorldToScene) * gkViewWS);
vec3 gkShadeNormal = gkMainLightWorld > 0.5 ? gkSceneNormal : gkMatNormal;
float gkOffset = gkDef.r * 2.0 - 1.0;
vec4 gkRampAddSample = vec4(0.0);
vec3 gkRampAddTint = vec3(0.0);
if (gkHasRampAdd > 0.5) {
    vec2 gkRampAddUv = vec2(clamp(gkOffset + gkMatNormal.z, 0.0, 1.0), clamp(gkRampAddId, 0.0, 1.0));
    gkRampAddSample = texture2D(gkRampAddMap, gkRampAddUv);
    gkRampAddTint = gkRampAddSample.rgb * gkRampAddColor;
    vec3 gkRampAdd = gkRampAddTint * (1.0 - gkRampAddSample.a);
    gkBase += gkRampAdd;
    gkShade.rgb += gkRampAdd;
}
float gkLighting = clamp(dot(gkShadeNormal, gkLight) * 0.5 + 0.5 + (gkOffset - gkLightTermOffset) * 0.5, 0.0, 1.0);
float gkMetallic = gkDef.b;
#ifdef GK_FACE
vec3 gkReflectedWS = reflect(gkNormalWS, normalize(gkHeadRight));
vec3 gkReflectedMat = vec3(dot(gkReflectedWS, gkViewSide), dot(gkReflectedWS, gkViewUp), dot(gkReflectedWS, gkViewWS));
float gkFaceLight = clamp((dot(gkReflectedMat, gkLight) + gkOffset) * 0.5 + 0.5, 0.0, 1.0);
if (gkMainLightWorld < 0.5) gkLighting = mix(gkLighting, max(gkLighting, gkFaceLight), gkDef.b);
gkMetallic = 0.0;
#endif
float gkShadow = 1.0;
if (gkCharacterShadowEnabled > 0.5 && gkCharacterShadowReceive > 0.5) {
    vec3 gkShadowProj = gkCharacterShadowCoord.xyz / max(gkCharacterShadowCoord.w, 0.0001);
    if (all(greaterThanEqual(gkShadowProj.xy, vec2(0.0))) && all(lessThanEqual(gkShadowProj.xy, vec2(1.0))) && gkShadowProj.z <= 1.0) {
        // Filtered like the game's four comparison taps. The curve below is the
        // game's own and only does anything on a filtered (non 0/1) value.
        gkShadow = gkCharacterShadowLit(gkShadowProj, gkCharacterShadowContact);
        gkShadow = clamp(gkShadow * ((4.0 * gkShadow - 6.0) * gkShadow + 3.0), 0.0, 1.0);
    }
}
float gkShadowForLighting = mix(1.0, gkShadow, clamp(gkShadowStrength, 0.0, 1.0));
gkLighting = min(gkLighting, gkShadowForLighting);
gkLighting = max(gkLighting, gkShadowFloor);
float gkSpecMask = min(gkDef.a, gkShadowForLighting);
#ifdef GK_HAIR
#ifdef GK_HAIR_COVER_PASS
// HairCover exists to apply the view-dependent alpha. Do not run the regular
// hair highlight/specular branch in this redraw; m_hir+ owns that layer.
gkSpecMask = 0.0;
#else
float gkHairProp = step(0.75001, gkUv.x) * step(0.75001, gkUv.y);
float gkHairHighlight = smoothstep(0.35, 0.65, pow(clamp(gkMatNormal.z, 0.0, 1.0), 4.0));
gkHairHighlight *= gkSpecMask * gkHasHighlight * (1.0 - gkHairProp);
gkBase = mix(gkBase, texture2D(gkHighlightMap, gkUv).rgb, gkHairHighlight);
gkSpecMask *= gkHairProp;
#endif
#endif
vec4 gkRamp = texture2D(gkRampMap, vec2(gkLighting, 0.5));
float gkFallbackShade = 1.0 - smoothstep(0.35, 0.65, gkLighting);
gkRamp = mix(vec4(vec3(1.0 - 0.3 * gkFallbackShade), gkFallbackShade), gkRamp, gkHasRamp);
float gkSkinMask = gkShade.a;
#ifdef GK_HAIR
gkSkinMask = 0.0;
#endif
#ifdef GK_EYE
gkSkinMask = 0.0;
#endif
vec3 gkShadeTint = gkShade.rgb * gkShadeMultiply;
vec3 gkSkinRamp = mix(gkRamp.rgb, gkRamp.rgb * gkShadeMultiply, gkRamp.a);
vec3 gkNonSkin = mix(gkBase, gkShadeTint, gkRamp.a);
vec3 gkSkin = gkBase * gkSkinRamp;
gkSkin = min(gkSkin + vec3(gkSkinLift * gkLighting), vec3(1.0));
vec3 gkActorColor = mix(gkNonSkin, gkSkin, gkSkinMask);
#ifdef GK_EYE_HIGHLIGHT
gkActorColor *= gkEyeHighlightColor;
#endif
float gkSat = mix(1.0, gkSkinSaturation, gkSkinMask);
float gkLum = dot(gkActorColor, vec3(0.2126, 0.7152, 0.0722));
gkActorColor = mix(vec3(gkLum), gkActorColor, gkSat);
reflectedLight.directDiffuse = gkActorColor * gkLightColor * gkLightStrength;
vec3 gkSky = gkActorSH[0] - gkActorSH[6];
gkSky += gkActorSH[3] * gkSceneNormal.x + gkActorSH[1] * gkSceneNormal.y + gkActorSH[2] * gkSceneNormal.z;
gkSky += gkActorSH[4] * (gkSceneNormal.x * gkSceneNormal.y) + gkActorSH[5] * (gkSceneNormal.y * gkSceneNormal.z) + gkActorSH[6] * (3.0 * gkSceneNormal.z * gkSceneNormal.z) + gkActorSH[7] * (gkSceneNormal.z * gkSceneNormal.x);
gkSky += gkActorSH[8] * (gkSceneNormal.x * gkSceneNormal.x - gkSceneNormal.y * gkSceneNormal.y);
reflectedLight.indirectDiffuse = max(gkSky, vec3(0.0)) * gkGiScale * gkActorColor;
reflectedLight.directSpecular = vec3(0.0);
reflectedLight.indirectSpecular = vec3(0.0);
totalEmissiveRadiance = vec3(0.0);
vec3 gkSpecView = gkMainLightWorld > 0.5 ? normalize(mat3(gkWorldToScene) * gkViewWS) : vec3(0.0, 0.0, 1.0);
vec3 gkHalfVector = gkLight + gkSpecView;
vec3 gkHalf = gkHalfVector / max(length(gkHalfVector), 0.0001);
float gkRoughness = max(1.0 - gkDef.g, 0.08);
float gkAlphaSquared = pow(gkRoughness, 4.0);
float gkNoH = max(dot(gkShadeNormal, gkHalf), 0.0);
float gkNoL = max(dot(gkShadeNormal, gkLight), 0.0);
float gkNoV = max(dot(gkShadeNormal, gkSpecView), 0.001);
float gkDenom = gkNoH * gkNoH * (gkAlphaSquared - 1.0) + 1.0;
float gkDistribution = gkAlphaSquared / max(3.14159265 * gkDenom * gkDenom, 0.00001);
float gkVisibilityFactor = pow(gkRoughness + 1.0, 2.0) / 8.0;
float gkVisibility = gkNoV / (gkNoV * (1.0 - gkVisibilityFactor) + gkVisibilityFactor);
gkVisibility *= gkNoL / max(gkNoL * (1.0 - gkVisibilityFactor) + gkVisibilityFactor, 0.001);
vec3 gkFresnelBase = mix(vec3(0.04), gkBase, gkMetallic);
vec3 gkFresnel = gkFresnelBase + (1.0 - gkFresnelBase) * pow(1.0 - max(dot(gkHalf, gkSpecView), 0.0), 5.0);
reflectedLight.directSpecular = gkFresnel * gkDistribution * gkVisibility / (4.0 * gkNoV) * gkSpecMask * gkLightColor * gkLightStrength;
vec3 gkReflectWS = reflect(-gkViewWS, gkNormalWS);
float gkEnvY = clamp(gkReflectWS.y * 0.5 + 0.5, 0.0, 1.0);
vec3 gkEnv = mix(gkSpecFloor, gkSpecSky, gkEnvY);
gkEnv += gkSpecHorizon * pow(clamp(1.0 - abs(gkReflectWS.y), 0.0, 1.0), 4.0);
bool gkInsideActorProbe = gkHasActorProbe > 0.5
    && gkScenePos.x > gkActorProbeBoxMin.x && gkScenePos.y > gkActorProbeBoxMin.y && gkScenePos.z > gkActorProbeBoxMin.z
    && gkScenePos.x < gkActorProbeBoxMax.x && gkScenePos.y < gkActorProbeBoxMax.y && gkScenePos.z < gkActorProbeBoxMax.z;
if (gkInsideActorProbe) {
    float gkProbeMip = gkRoughness * (1.7 - 0.7 * gkRoughness) * 6.0;
    gkEnv = gkActorSampleProbe(gkActorBoxProject(reflect(-gkSceneView, gkSceneNormal), gkScenePos), min(gkProbeMip, gkActorProbeInfo.x - 1.0)) * gkActorProbeTint;
}
vec3 gkEnvFresnel = gkFresnelBase + (1.0 - gkFresnelBase) * pow(1.0 - max(gkMatNormal.z, 0.0), 5.0);
reflectedLight.indirectSpecular = gkEnvFresnel * gkEnv * gkSpecMask * gkSpecStrength;
#ifdef GK_EYE
reflectedLight.indirectSpecular *= gkEyeReflectionColor;
#endif
if (gkHasRampAdd > 0.5) {
    reflectedLight.directSpecular = mix(reflectedLight.directSpecular, reflectedLight.directSpecular * gkRampAddTint, gkRampAddSample.a);
    reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, reflectedLight.indirectSpecular * gkRampAddTint, gkRampAddSample.a);
}
vec3 gkAdditional = vec3(0.0);
if (gkAddLightCount > 0 && gkAddLightScale > 0.0) {
    vec3 gkLit = reflectedLight.directDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular;
    for (int i = 0; i < 8; i++) {
        if (i >= gkAddLightCount) break;
        vec4 gkLp = gkAddLightPosition[i];
        vec4 gkParams = gkAddLightParams[i];
        vec3 gkAddL;
        float gkAttenuation = 1.0;
        if (gkLp.w < 0.5) {
            gkAddL = -gkAddLightDirection[i].xyz;
        } else {
            vec3 gkToLight = gkLp.xyz - gkScenePos;
            float gkDistanceSqr = max(dot(gkToLight, gkToLight), 0.0001);
            gkAddL = gkToLight * inversesqrt(gkDistanceSqr);
            float gkRange = inversesqrt(max(gkParams.x, 0.0001));
            float gkDist = sqrt(gkDistanceSqr);
            float gkT = clamp(gkDist / gkRange, 0.0, 1.0);
            float gkEdge = clamp((gkT - 0.35) / 0.65, 0.0, 1.0);
            gkEdge = gkEdge * gkEdge * (3.0 - 2.0 * gkEdge);
            gkAttenuation = 1.0 - gkEdge;
            if (gkLp.w > 1.5) {
                float gkCone = clamp(dot(gkAddLightDirection[i].xyz, -gkAddL) * gkParams.y + gkParams.z, 0.0, 1.0);
                gkAttenuation *= gkCone * gkCone;
            }
        }
        if (gkParams.w > -0.5) {
            int gkAddChannel = int(gkParams.w + 0.5);
            float gkAddMask = gkAddChannel == 0 ? gkProbeOcclusion.r : gkAddChannel == 1 ? gkProbeOcclusion.g : gkAddChannel == 2 ? gkProbeOcclusion.b : gkProbeOcclusion.a;
            gkAttenuation *= clamp(gkAddMask, 0.0, 1.0);
        }
        float gkRadiance = max(dot(gkSceneNormal, gkAddL), 0.0);
        gkRadiance = (gkRadiance * 0.5 + 0.5) * 2.356194;
        gkRadiance = smoothstep(gkMatCapOffset - 0.000488, gkMatCapOffset + 0.001464, gkRadiance);
        gkRadiance = clamp(gkRadiance + gkShadeApply, 0.0, 1.0) * gkAttenuation;
        vec3 gkAddHalf = normalize(gkAddL + gkSceneView);
        float gkAddNoH = max(dot(gkSceneNormal, gkAddHalf), 0.0);
        float gkAddNoL = max(dot(gkSceneNormal, gkAddL), 0.0);
        float gkAddNoV = max(dot(gkSceneNormal, gkSceneView), 0.001);
        float gkAddDenom = gkAddNoH * gkAddNoH * (gkAlphaSquared - 1.0) + 1.0;
        float gkAddDistribution = gkAlphaSquared / max(3.14159265 * gkAddDenom * gkAddDenom, 0.00001);
        float gkAddVisibility = gkAddNoV / (gkAddNoV * (1.0 - gkVisibilityFactor) + gkVisibilityFactor);
        gkAddVisibility *= gkAddNoL / max(gkAddNoL * (1.0 - gkVisibilityFactor) + gkVisibilityFactor, 0.001);
        vec3 gkAddSpecular = gkFresnelBase * gkAddDistribution * gkAddVisibility / (4.0 * gkAddNoV) * gkSpecMask * gkAddLightSpecularScale;
        gkAdditional += gkRadiance * gkAddLightColor[i] * (gkLit + gkAddSpecular);
    }
}
reflectedLight.directDiffuse += gkAdditional * gkAddLightScale;
vec3 gkRimDir = gkRimDirection / max(length(gkRimDirection), 0.0001);
float gkRim = pow(max(1.0 - dot(normalize(normal), gkRimDir), 0.0), max(gkRimPower, 0.0));
gkRim = min(gkRim, 1.0) * min(gkDef.r * gkDef.r, 1.0) * gkRimMask;
vec3 gkRimLit = mix(vec3(1.0), gkActorColor, clamp(gkRimAlbedo, 0.0, 1.0)) * gkRimColor * gkRimStrength * gkRim;
reflectedLight.directDiffuse += gkRimLit;
if (gkDebugView > 0) {
    vec3 gkDebugColor = diffuseColor.rgb;
    if (gkDebugView == 2) gkDebugColor = gkShade.rgb;
    if (gkDebugView == 3) gkDebugColor = gkDef.rgb;
    if (gkDebugView == 4) gkDebugColor = gkRamp.rgb;
    if (gkDebugView == 5) gkDebugColor = vec3(gkSkinMask);
    if (gkDebugView == 6) gkDebugColor = vec3(gkLighting);
    if (gkDebugView == 7) gkDebugColor = vec3(gkShadow);
    reflectedLight.directDiffuse = gkDebugColor;
    reflectedLight.indirectDiffuse = vec3(0.0);
    reflectedLight.directSpecular = vec3(0.0);
}
`);
}
