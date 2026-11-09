import * as THREE from './vendor/three/build/three.module.js';
import { actorEnvironmentSample } from './gakumas-scene-core.js?v=20261109-actor-light-v3';

export { actorEnvironmentSample };

const actorScenePosition = new THREE.Vector3();

export function actorScenePoint(object, stage) {
    const matrix = stage?.shared?.gkWorldToScene?.value;
    if (!object?.getWorldPosition || !matrix?.isMatrix4) return null;
    object.updateWorldMatrix?.(true, false);
    object.getWorldPosition(actorScenePosition).applyMatrix4(matrix);
    return [actorScenePosition.x, actorScenePosition.y, actorScenePosition.z];
}

export function createActorRoomUniforms() {
    return {
        gkActorSH: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) },
        gkGiScale: { value: 0 },
        gkProbeOcclusion: { value: new THREE.Vector4(1, 1, 1, 1) },
        gkProbeShadowChannel: { value: -1 },
        gkActorProbeMap: { value: null },
        gkHasActorProbe: { value: 0 },
        gkActorProbeInfo: { value: new THREE.Vector4(1, 1, 1, 0) },
        gkActorProbePosition: { value: new THREE.Vector3() },
        gkActorProbeBoxMin: { value: new THREE.Vector3() },
        gkActorProbeBoxMax: { value: new THREE.Vector3() },
        gkActorProbeBoxProjection: { value: 0 },
        gkActorProbeTint: { value: new THREE.Vector3(1, 1, 1) },
    };
}

export const GAKUMAS_LOOK = Object.freeze({
    key: 0.9,
    hemi: 0,
    rim: 0.42,
    shadow: 0.82,
    // View-space key. Azimuth -60 keeps a visible shade on a front-facing character;
    // the sample vector (0.34, 0.57, 0.74) sits too close to the camera axis.
    keyAzimuth: -60,
    keyElevation: 35,
    shadowAzimuth: -60,
    shadowElevation: 16,
    keyColor: '#ffffff',
    sceneLightTint: 0.4,
    sceneShadeTint: 0.45,
    rimColor: '#ffb197',
    // View-space rim from the captured actor parameters: xyz direction, w power.
    // Alpha 1 tints the rim by the ramped albedo. The MMD preset still uses rim/rimColor above.
    rimView: [-0.4, -0.26, 0.87],
    rimPower: 10,
    rimAlbedo: 1,
    skinSaturation: 1.12,
    skinLift: 0.055,
    lightTermOffset: 0.16,
    shadowFloor: 0.22,
    specStrength: 0.38,
    shadeMultiply: [1, 1, 1],
    specSky: [0.72, 0.74, 0.78],
    specFloor: [0.16, 0.14, 0.13],
    specHorizon: [0.55, 0.42, 0.34],
    contrast: 1,
    saturation: 1.1,
    warmth: [1.03, 0.995, 0.96],
    bloom: 0.2,
    bloomKnee: 0.72,
    bloomRadius: 1,
});

function cloneLookBloom(look = GAKUMAS_LOOK) {
    return {
        intensity: look.bloom,
        knee: look.bloomKnee,
        radius: look.bloomRadius,
    };
}

export function matcapKeyDirection(azimuth = GAKUMAS_LOOK.keyAzimuth, elevation = GAKUMAS_LOOK.keyElevation) {
    const az = Number(azimuth);
    const el = Number(elevation);
    const azimuthRad = az * Math.PI / 180;
    const elevationRad = el * Math.PI / 180;
    return new THREE.Vector3(
        Math.sin(azimuthRad) * Math.cos(elevationRad),
        Math.sin(elevationRad),
        Math.cos(azimuthRad) * Math.cos(elevationRad),
    ).normalize();
}

export const ACTOR_ADDITIONAL_LIGHTS = 8;

// Copies the active scene volume onto one character material. Additional
// lights stay off when the volume scale is 0, which is how the exported
// scenes gate them. Without a scene, eye tints return to white and the
// caller-supplied key light is left alone.
export function applySceneActorUniforms(uniforms, stage, sample = null, sceneLightTint = GAKUMAS_LOOK.sceneLightTint) {
    if (!uniforms) return uniforms;
    const actor = stage?.actorLight || null;
    const entries = (stage?.sceneLightEntries || []).slice(0, ACTOR_ADDITIONAL_LIGHTS);
    if (uniforms.gkAddLightCount) uniforms.gkAddLightCount.value = entries.length;
    if (uniforms.gkAddLightScale) uniforms.gkAddLightScale.value = actor?.additiveScale || 0;
    if (uniforms.gkAddLightSpecularScale) uniforms.gkAddLightSpecularScale.value = actor?.additiveSpecularScale ?? 1;
    if (uniforms.gkMatCapOffset) uniforms.gkMatCapOffset.value = actor?.matCapOffset ?? 0.3;
    if (uniforms.gkLightTermOffset && actor?.matCapOffset != null) uniforms.gkLightTermOffset.value = actor.matCapOffset;
    if (uniforms.gkShadeMultiply && actor?.shadeMultiply) {
        const tint = GAKUMAS_LOOK.sceneShadeTint;
        uniforms.gkShadeMultiply.value.setRGB(...actor.shadeMultiply.map(value => 1 - tint + tint * value));
    }
    if (uniforms.gkRimDirection && actor?.rimAngle) uniforms.gkRimDirection.value.copy(matcapKeyDirection(...actor.rimAngle));
    if (uniforms.gkRimColor && actor?.rimColor) uniforms.gkRimColor.value.setRGB(...actor.rimColor);
    if (uniforms.gkRimPower && actor?.rimPower != null) uniforms.gkRimPower.value = actor.rimPower;
    if (uniforms.gkRimAlbedo && actor?.rimBaseColorRatio != null) uniforms.gkRimAlbedo.value = actor.rimBaseColorRatio;
    if (uniforms.gkShadeApply) uniforms.gkShadeApply.value = actor?.shadeApply ?? 1;
    if (uniforms.gkMainLightWorld) uniforms.gkMainLightWorld.value = actor && actor.mainLightSpace > 0.5 ? 1 : 0;
    if (uniforms.gkWorldToScene && stage?.shared?.gkWorldToScene) uniforms.gkWorldToScene.value.copy(stage.shared.gkWorldToScene.value);
    entries.forEach((light, index) => {
        uniforms.gkAddLightPosition.value[index].fromArray(light.position);
        const [x, y, z] = light.direction;
        const length = Math.hypot(x, y, z) || 1;
        uniforms.gkAddLightDirection.value[index].set(x / length, y / length, z / length, light.specular);
        uniforms.gkAddLightColor.value[index].fromArray(light.color);
        uniforms.gkAddLightParams.value[index].fromArray(light.params);
    });
    const highlight = actor?.eyeHighlightColor || [1, 1, 1];
    const reflection = actor?.eyeReflectionColor || [1, 1, 1];
    if (uniforms.gkEyeHighlightColor) uniforms.gkEyeHighlightColor.value.setRGB(highlight[0], highlight[1], highlight[2]);
    if (uniforms.gkEyeReflectionColor) uniforms.gkEyeReflectionColor.value.setRGB(reflection[0], reflection[1], reflection[2]);
    if (actor?.hasMainLight && uniforms.gkLightDirection && uniforms.gkLightColor) {
        uniforms.gkLightDirection.value.copy(matcapKeyDirection(actor.azimuth, actor.elevation));
        const tint = Number.isFinite(sceneLightTint) ? THREE.MathUtils.clamp(sceneLightTint, 0, 1) : GAKUMAS_LOOK.sceneLightTint;
        const color = uniforms.gkLightColor.value;
        color.setRGB(color.r * (1 - tint + tint * actor.color[0]), color.g * (1 - tint + tint * actor.color[1]), color.b * (1 - tint + tint * actor.color[2]));
    }
    bindActorRoom(uniforms, stage, sample);
    return uniforms;
}

function bindActorRoom(uniforms, stage, sample) {
    if (uniforms.gkActorSH) {
        for (let index = 0; index < 9; index += 1) {
            const rgb = sample?.sh?.[index] || [0, 0, 0];
            uniforms.gkActorSH.value[index].set(rgb[0] || 0, rgb[1] || 0, rgb[2] || 0);
        }
    }
    if (uniforms.gkGiScale) uniforms.gkGiScale.value = sample?.sh ? (Number(sample.giScale) || 0) : 0;
    const occlusion = sample?.occlusion || [1, 1, 1, 1];
    if (uniforms.gkProbeOcclusion) uniforms.gkProbeOcclusion.value.set(occlusion[0] || 0, occlusion[1] || 0, occlusion[2] || 0, occlusion[3] || 0);
    if (uniforms.gkProbeShadowChannel) uniforms.gkProbeShadowChannel.value = Number.isFinite(sample?.shadowChannel) ? sample.shadowChannel : -1;
    const tint = sample?.tint || [1, 1, 1];
    if (uniforms.gkActorProbeTint) uniforms.gkActorProbeTint.value.set(tint[0] ?? 1, tint[1] ?? 1, tint[2] ?? 1);
    const loaded = sample && sample.probeIndex >= 0 ? stage?.probes?.[sample.probeIndex] : null;
    const atlas = loaded?.probe?.atlas;
    const ready = Boolean(loaded?.texture && atlas);
    if (uniforms.gkHasActorProbe) uniforms.gkHasActorProbe.value = ready ? 1 : 0;
    if (uniforms.gkActorProbeMap) uniforms.gkActorProbeMap.value = ready ? loaded.texture : null;
    if (!ready || !uniforms.gkActorProbeInfo) return;
    const intensity = (atlas.rgbmRange || 1) * (loaded.probe.intensity ?? 1) * (stage?.sidecar?.environment?.reflectionIntensity ?? 1);
    uniforms.gkActorProbeInfo.value.set(atlas.levels || 1, atlas.levelHeight || 1, intensity, 0);
    uniforms.gkActorProbePosition.value.fromArray(loaded.probe.position || [0, 0, 0]);
    uniforms.gkActorProbeBoxMin.value.fromArray(loaded.box?.min || [0, 0, 0]);
    uniforms.gkActorProbeBoxMax.value.fromArray(loaded.box?.max || [0, 0, 0]);
    uniforms.gkActorProbeBoxProjection.value = loaded.probe.boxProjection ? 1 : 0;
}

export function applyGakumasLookUniforms(uniforms, look = GAKUMAS_LOOK) {
    if (!uniforms) return uniforms;
    if (uniforms.gkLightTermOffset) uniforms.gkLightTermOffset.value = look.lightTermOffset;
    if (uniforms.gkShadowFloor) uniforms.gkShadowFloor.value = look.shadowFloor;
    if (uniforms.gkSkinSaturation) uniforms.gkSkinSaturation.value = look.skinSaturation;
    if (uniforms.gkSkinLift) uniforms.gkSkinLift.value = look.skinLift;
    if (uniforms.gkShadeMultiply) uniforms.gkShadeMultiply.value.setRGB(...look.shadeMultiply);
    if (uniforms.gkSpecSky) uniforms.gkSpecSky.value.setRGB(...look.specSky);
    if (uniforms.gkSpecFloor) uniforms.gkSpecFloor.value.setRGB(...look.specFloor);
    if (uniforms.gkSpecHorizon) uniforms.gkSpecHorizon.value.setRGB(...look.specHorizon);
    if (uniforms.gkSpecStrength) uniforms.gkSpecStrength.value = look.specStrength;
    if (uniforms.gkRimPower) uniforms.gkRimPower.value = look.rimPower ?? GAKUMAS_LOOK.rimPower;
    if (uniforms.gkRimAlbedo) uniforms.gkRimAlbedo.value = look.rimAlbedo ?? GAKUMAS_LOOK.rimAlbedo;
    if (uniforms.gkRimDirection && look.rimView) uniforms.gkRimDirection.value.set(look.rimView[0], look.rimView[1], look.rimView[2]);
    return uniforms;
}

export function createGakumasLookUniformValues(look = GAKUMAS_LOOK) {
    return {
        gkLightTermOffset: { value: look.lightTermOffset },
        gkShadowFloor: { value: look.shadowFloor },
        gkSkinSaturation: { value: look.skinSaturation },
        gkSkinLift: { value: look.skinLift },
        gkShadeMultiply: { value: new THREE.Color().setRGB(look.shadeMultiply[0], look.shadeMultiply[1], look.shadeMultiply[2]) },
        gkSpecSky: { value: new THREE.Color().setRGB(look.specSky[0], look.specSky[1], look.specSky[2]) },
        gkSpecFloor: { value: new THREE.Color().setRGB(look.specFloor[0], look.specFloor[1], look.specFloor[2]) },
        gkSpecHorizon: { value: new THREE.Color().setRGB(look.specHorizon[0], look.specHorizon[1], look.specHorizon[2]) },
        gkSpecStrength: { value: look.specStrength },
    };
}

const LOOK_VERTEX = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const LOOK_FRAGMENT = `
uniform sampler2D gkLookMap;
uniform vec2 gkLookTexel;
uniform float gkLookContrast;
uniform float gkLookSaturation;
uniform vec3 gkLookWarmth;
uniform float gkLookBloom;
uniform float gkLookKnee;
uniform float gkLookRadius;
varying vec2 vUv;

uniform sampler2D gkLookPlate;
uniform vec4 gkLookCover;
uniform float gkLookHasPlate;
uniform float gkLookSharpen;

vec2 gkPlateUv(vec2 uv) {
    return vec2(uv.x, 1.0 - uv.y) * gkLookCover.xy + gkLookCover.zw;
}

vec3 gkSample(vec2 uv) {
    vec2 sampleUv = clamp(uv, vec2(0.0), vec2(1.0));
    vec4 source = texture2D(gkLookMap, sampleUv);
    if (gkLookHasPlate < 0.5 || source.a < 0.001) return gkLookHasPlate < 0.5 ? source.rgb : vec3(0.0);
    vec3 plate = texture2D(gkLookPlate, clamp(gkPlateUv(sampleUv), vec2(0.0), vec2(1.0))).rgb;
    return max(source.rgb - plate * (1.0 - source.a), vec3(0.0)) / source.a;
}

void main() {
    vec4 source = texture2D(gkLookMap, vUv);
    vec3 base = gkSample(vUv);
    if (gkLookHasPlate > 0.5 && gkLookSharpen > 0.5 && source.a > 0.82) {
        vec3 soft = (
            gkSample(vUv + vec2(gkLookTexel.x, 0.0)) +
            gkSample(vUv - vec2(gkLookTexel.x, 0.0)) +
            gkSample(vUv + vec2(0.0, gkLookTexel.y)) +
            gkSample(vUv - vec2(0.0, gkLookTexel.y))
        ) * 0.25;
        base = max(base + (base - soft) * 0.45, vec3(0.0));
    }
    vec2 texel = gkLookTexel * max(gkLookRadius, 0.0);
    vec3 bloom = (
        gkSample(vUv + vec2(texel.x, 0.0)) +
        gkSample(vUv - vec2(texel.x, 0.0)) +
        gkSample(vUv + vec2(0.0, texel.y)) +
        gkSample(vUv - vec2(0.0, texel.y))
    ) * 0.25;
    vec3 highlight = max(bloom - vec3(gkLookKnee), vec3(0.0));
    vec2 streak = vec2(texel.x, texel.y * 0.35) * 3.0;
    vec2 cross = vec2(-streak.y, streak.x);
    vec3 star = gkSample(vUv + streak) + gkSample(vUv - streak);
    star += gkSample(vUv + streak * 2.0) + gkSample(vUv - streak * 2.0);
    star += gkSample(vUv + cross) + gkSample(vUv - cross);
    vec3 starHighlight = max(star / 6.0 - vec3(gkLookKnee), vec3(0.0));
    vec3 color = base + highlight * gkLookBloom + starHighlight * gkLookBloom * 0.55;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, gkLookSaturation);
    color = mix(color, (color - 0.5) * gkLookContrast + 0.5, smoothstep(0.14, 0.42, luma));
    color *= gkLookWarmth;
    vec3 graded = max(color, vec3(0.0));
    if (gkLookHasPlate > 0.5) {
        // The canvas is premultiplied. Straight edge color is what blooms into a white fringe.
        vec3 encoded = linearToOutputTexel(vec4(graded, 1.0)).rgb;
        gl_FragColor = vec4(encoded * source.a, source.a);
    } else {
        gl_FragColor = linearToOutputTexel(vec4(graded, source.a));
    }
}
`;

export class GakumasLookPass {
    constructor(renderer) {
        this.renderer = renderer;
        this.enabled = false;
        this.target = new THREE.WebGLRenderTarget(1, 1, {
            depthBuffer: true,
            stencilBuffer: true,
        });
        // Three compiles actor shaders with Linear output whenever the current
        // target is a regular RT. Store that linear lighting in an sRGB buffer
        // so 8-bit toon shades keep PNG-like darks, then encode once here.
        this.target.texture.generateMipmaps = false;
        this.target.texture.minFilter = THREE.LinearFilter;
        this.target.texture.magFilter = THREE.LinearFilter;
        if ('colorSpace' in this.target.texture && THREE.SRGBColorSpace) {
            this.target.texture.colorSpace = THREE.SRGBColorSpace;
        }
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                gkLookMap: { value: this.target.texture },
                gkLookTexel: { value: new THREE.Vector2(1, 1) },
                gkLookContrast: { value: GAKUMAS_LOOK.contrast },
                gkLookSaturation: { value: GAKUMAS_LOOK.saturation },
                gkLookWarmth: { value: new THREE.Color().setRGB(GAKUMAS_LOOK.warmth[0], GAKUMAS_LOOK.warmth[1], GAKUMAS_LOOK.warmth[2]) },
                gkLookBloom: { value: GAKUMAS_LOOK.bloom },
                gkLookKnee: { value: GAKUMAS_LOOK.bloomKnee },
                gkLookRadius: { value: GAKUMAS_LOOK.bloomRadius },
                gkLookPlate: { value: null },
                gkLookCover: { value: new THREE.Vector4(1, 1, 0, 0) },
                gkLookHasPlate: { value: 0 },
                gkLookSharpen: { value: 1 },
            },
            vertexShader: LOOK_VERTEX,
            fragmentShader: LOOK_FRAGMENT,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        });
        const platePixels = new Uint8Array([255, 255, 255, 255]);
        this.plateDummy = new THREE.DataTexture(platePixels, 1, 1);
        this.plateDummy.needsUpdate = true;
        this.plateDummy.colorSpace = THREE.SRGBColorSpace;
        this.material.uniforms.gkLookPlate.value = this.plateDummy;
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
        this.size = new THREE.Vector2();
        this.bloom = cloneLookBloom();
    }

    setPlateSharpen(enabled) {
        if (!this.material?.uniforms?.gkLookSharpen) return;
        this.material.uniforms.gkLookSharpen.value = enabled ? 1 : 0;
    }

    setBloom({ intensity, knee, radius } = {}) {
        if (Number.isFinite(intensity)) this.bloom.intensity = Math.max(0, intensity);
        if (Number.isFinite(knee)) this.bloom.knee = Math.max(0, Math.min(1, knee));
        if (Number.isFinite(radius)) this.bloom.radius = Math.max(0, radius);
        this.material.uniforms.gkLookBloom.value = this.bloom.intensity;
        this.material.uniforms.gkLookKnee.value = this.bloom.knee;
        this.material.uniforms.gkLookRadius.value = this.bloom.radius;
        return this.bloom;
    }

    setSize(width, height) {
        const pixelRatio = this.renderer.getPixelRatio();
        const w = Math.max(1, Math.floor(width * pixelRatio));
        const h = Math.max(1, Math.floor(height * pixelRatio));
        if (this.target.width === w && this.target.height === h) return;
        this.target.setSize(w, h);
        this.material.uniforms.gkLookTexel.value.set(1 / w, 1 / h);
    }

    begin() {
        this.renderer.getSize(this.size);
        this.setSize(this.size.x, this.size.y);
        this.renderer.setRenderTarget(this.target);
        this.renderer.clear(true, true, true);
    }

    end() {
        const autoClear = this.renderer.autoClear;
        this.renderer.setRenderTarget(null);
        this.renderer.autoClear = false;
        this.renderer.render(this.scene, this.camera);
        this.renderer.autoClear = autoClear;
    }

    render(draw) {
        this.begin();
        try {
            draw();
        } finally {
            this.end();
        }
    }

    presentTexture(texture, plate = null) {
        const width = Math.max(1, texture?.image?.width || 1);
        const height = Math.max(1, texture?.image?.height || 1);
        this.material.uniforms.gkLookTexel.value.set(1 / width, 1 / height);
        const map = this.material.uniforms.gkLookMap;
        const previous = map.value;
        map.value = texture || previous;
        const hasPlate = this.material.uniforms.gkLookHasPlate;
        const plateMap = this.material.uniforms.gkLookPlate;
        const previousHas = hasPlate.value;
        const previousPlate = plateMap.value;
        hasPlate.value = plate?.texture ? 1 : 0;
        if (plate?.texture) plateMap.value = plate.texture;
        if (plate?.cover) this.material.uniforms.gkLookCover.value.copy(plate.cover);
        try {
            this.end();
        } finally {
            map.value = previous;
            hasPlate.value = previousHas;
            plateMap.value = previousPlate;
        }
    }

    dispose() {
        this.target.dispose();
        this.material.dispose();
        this.mesh.geometry.dispose();
        this.plateDummy?.dispose();
    }
}
