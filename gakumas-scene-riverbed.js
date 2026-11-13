import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const RIVERBED_NOON = 'env_3d_adv_riverbed-00-00-noon';
const DATA_URL = new URL('./scene-shader-data/riverbed-noon/shader-data.json', import.meta.url);

// Forward pass of Environment/SimpleWaterFlow. These are raw imported
// channels, not UnpackNormal: main = GBA * 2 - .75, sub = RG. The shader
// deliberately bends only along the tangent and uses vertex colour for phase.
export const WATER_GLSL = `
#ifdef GK_WATER
uniform sampler2D gkWaterNoise;
uniform sampler2D gkWaterMain;
uniform sampler2D gkWaterSub;
uniform float gkWaterTime;
uniform vec3 gkWaterEdge;
uniform vec4 gkWaterWaveUV;
uniform vec4 gkWaterScroll;
uniform vec2 gkWaterSubDirection;
uniform vec4 gkWaterFluctuation;
uniform vec4 gkWaterBump;
uniform float gkWaterEdgeSensitivity;
uniform float gkWaterCullLength;
varying vec4 vGkWaterColor;

vec4 gkWaterSample(sampler2D map, vec2 uv) {
    // Mesh UVs were flipped by the GLB exporter; restore Unity UVs first,
    // then flip only the final sample coordinate into the PNG convention.
    return texture2D(map, vec2(uv.x, 1.0 - uv.y));
}

void gkWaterSurface(inout vec3 base, inout vec3 n, vec3 v,
                    inout float smoothness, out vec3 emission) {
    vec2 uv = vec2(vGkUv.x, 1.0 - vGkUv.y);
    float edge = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), gkWaterEdgeSensitivity);
    base = clamp(0.5 * mix(base, gkWaterEdge, edge) + edge, 0.0, 1.0);
    vec2 phase = clamp((vGkWaterColor.xz - 0.5) / 128.0, 0.0, 1.0) + 1.0;
    float timeX = gkWaterTime / 20.0;
    float mainTime = phase.x * gkWaterScroll.x * timeX * 0.01;
    vec2 fluctuation = gkWaterFluctuation.xy * 0.01;
    float noiseTime = fract(timeX * 0.01);
    float noise = (gkWaterSample(gkWaterNoise, (uv * 0.5 + noiseTime) * 0.1).r
                 + gkWaterSample(gkWaterNoise, (uv + noiseTime) * 0.1).r) * 0.25;
    float mainPhase = fract(mainTime) + fluctuation.x * noise;
    float mainWarp = mainTime * noise * fluctuation.x;
    vec2 mainScroll = mainPhase + fract(mainWarp * vec2(0.01, 0.5));
    float directionNoise = gkWaterSample(gkWaterNoise,
        uv * 0.5 + fract(timeX + gkWaterTime * 0.01) * 0.25).r * 0.5;
    mainScroll += directionNoise * gkWaterScroll.z * gkWaterFluctuation.x;
    mainScroll *= gkWaterScroll.zw;
    vec3 mainWave = gkWaterSample(gkWaterMain,
        fract(uv * gkWaterWaveUV.xy + mainScroll)).gba * 2.0 - 0.75;
    vec2 mainBump = mainWave.xy * gkWaterBump.x;
    float subTime = fract(timeX * 0.01 * gkWaterScroll.y);
    float subPhase = subTime + fluctuation.y * noise
                   + subTime * noise * fluctuation.y * 0.01;
    vec2 subScroll = subPhase * gkWaterSubDirection;
    vec2 subUV = subScroll + subScroll.yx * gkWaterFluctuation.z * gkWaterFluctuation.w + uv;
    float subWarp = directionNoise * gkWaterSubDirection.x * gkWaterScroll.y * 0.1;
    subUV += subWarp * gkWaterFluctuation.z;
    subUV = subUV * gkWaterWaveUV.zw
          + gkWaterTime * 0.1 * gkWaterFluctuation.z * subScroll
          + subWarp * gkWaterFluctuation.z;
    vec2 subBump = gkWaterSample(gkWaterSub, subUV).rg * gkWaterBump.y;
    vec2 bend = clamp((mainBump + subBump * phase.y) * gkWaterBump.z * 0.5 + vec2(0.0, 1.0), 0.0, 1.0);
    vec3 q0 = dFdx(vGkPosition), q1 = dFdy(vGkPosition);
    vec2 st0 = dFdx(vGkUv), st1 = dFdy(vGkUv);
    vec3 tangent = cross(q1, n) * st0.x + cross(n, q0) * st1.x;
    // A river spans hundreds of metres in just one UV tile. Its screen-space
    // derivatives can be tiny; a lighting-sized epsilon would flatten ripples.
    tangent /= max(length(tangent), 1e-20);
    n = normalize(n * bend.y + tangent * bend.x);
    smoothness = clamp(v.z * gkWaterBump.w, 0.0, 1.0);
    float height = mainWave.z * gkWaterBump.x + subBump.x + 1.0;
    float distanceFade = clamp(length(vGkPosition - vGkCamera) / gkWaterCullLength, 0.0, 1.0);
    emission = clamp(height * (gkEmissionColor + distanceFade * 0.75), 0.0, 1.0);
}
#endif
`;

export async function loadRiverbedShaderData(sceneId, resources, isCurrent) {
    if (sceneId !== RIVERBED_NOON) return null;
    const response = resources ? await resources.fetch(DATA_URL.href) : await fetch(DATA_URL);
    if (!response.ok) throw new Error(`河岸 Shader 清单读取失败（${response.status}）`);
    const data = await response.json();
    const manager = resources?.manager(THREE);
    const loader = new THREE.TextureLoader(manager);
    const textures = [];
    let clouds;
    const dispose = () => {
        const geometries = new Set(), materials = new Set();
        clouds?.scene.traverse(object => {
            if (object.geometry) geometries.add(object.geometry);
            for (const material of [object.material].flat().filter(Boolean)) materials.add(material);
        });
        for (const texture of new Set(textures)) texture.dispose();
        geometries.forEach(geometry => geometry.dispose());
        materials.forEach(material => material.dispose());
    };
    try {
        // Settle all loads before disposal so a failed sibling cannot leak
        // textures/geometry that finish after the rejection.
        const tasks = Object.entries(data.water.textures).map(async ([name, entry]) => {
            const texture = await loader.loadAsync(new URL(entry.file, DATA_URL).href);
            textures.push(texture);
            texture.flipY = false;
            texture.colorSpace = THREE.NoColorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.needsUpdate = true;
            return [name, texture];
        });
        tasks.push((async () => {
            clouds = await new GLTFLoader(manager).loadAsync(new URL(data.clouds.file, DATA_URL).href);
            const index = data.clouds.material.textures._Basemap.texture;
            const texture = await clouds.parser.getDependency('texture', index);
            textures.push(texture);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;
            return ['cloudMap', texture];
        })());
        const results = await Promise.allSettled(tasks);
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
        if (!isCurrent()) { dispose(); return null; }
        const maps = Object.fromEntries(results.map(result => result.value));
        return { data, maps, clouds, dispose };
    } catch (error) { dispose(); throw error; }
}

export function waterUniforms(assets, linearColor) {
    const { floats: f, colors: c } = assets.data.water;
    return {
        gkWaterNoise: { value: assets.maps._NoiseMap },
        gkWaterMain: { value: assets.maps._Normalmap },
        gkWaterSub: { value: assets.maps._SubNormalmap },
        gkWaterEdge: { value: new THREE.Vector3(...linearColor(c._EdgeColor)) },
        gkWaterWaveUV: { value: new THREE.Vector4(...c._MainWaveUV.slice(0, 2), ...c._SubWaveUV.slice(0, 2)) },
        gkWaterScroll: { value: new THREE.Vector4(f._MainScrollSpeed, f._SubScrollSpeed, ...c._UVScrollDirection.slice(0, 2)) },
        gkWaterSubDirection: { value: new THREE.Vector2(...c._SubUVScrollDirection.slice(0, 2)) },
        gkWaterFluctuation: { value: new THREE.Vector4(f._MainFluctuationPower, f._SubFluctuationPower, f._SubFluctuationAddDirection, f._SubFluctuationAddDirectionPower) },
        gkWaterBump: { value: new THREE.Vector4(f._MainBumpPower, f._SubBumpPower, f._BumpPower, f._Smoothness) },
        gkWaterEdgeSensitivity: { value: f._EdgeSensitivity },
        gkWaterCullLength: { value: Math.max(f._CullLength, 0.001) },
    };
}

export function createRiverbedClouds(assets, shared, gradeGLSL) {
    const group = assets.clouds.scene;
    const baseColor = new THREE.Vector4(...assets.data.clouds.material.colors._CloudColor);
    const material = new THREE.ShaderMaterial({
        name: 'gakumas-riverbed-cloud',
        uniforms: { ...shared, gkCloudMap: { value: assets.maps.cloudMap }, gkCloudColor: { value: new THREE.Vector4(1, 1, 1, 1) } },
        vertexShader: `varying vec2 vUv;
            void main() {
                vUv = uv;
                vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_Position = vec4(clip.xy, clip.w * 0.9999, clip.w);
            }`,
        fragmentShader: `uniform sampler2D gkCloudMap;
            uniform vec4 gkCloudColor;
            varying vec2 vUv;
            ${gradeGLSL}
            void main() {
                vec4 cloud = texture2D(gkCloudMap, vUv) * gkCloudColor;
                gl_FragColor = linearToOutputTexel(vec4(gkGrade(cloud.rgb), cloud.a));
            }`,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
    });
    const replaced = new Set();
    group.traverse(object => {
        if (!object.isMesh) return;
        replaced.add(object.material);
        object.material = material;
        object.renderOrder = -900;
        object.frustumCulled = false;
        object.userData.gakumasOutlineExcluded = true;
    });
    replaced.forEach(source => source.dispose());
    const layers = assets.data.clouds.layers.map(layer => ({
        mesh: group.getObjectByName(layer.name), speed: THREE.MathUtils.degToRad(layer.rotateSpeed),
    }));
    const update = (camera, root, seconds, settings) => {
        group.position.copy(camera.position);
        group.position.y += settings.offsetY * root.scale.y;
        group.rotation.copy(root.rotation);
        group.scale.copy(root.scale);
        group.visible = settings.enabled;
        material.uniforms.gkCloudColor.value.fromArray(settings.color).multiply(baseColor);
        for (const layer of layers) {
            if (layer.mesh) layer.mesh.rotation.y = -layer.speed * settings.speed * seconds;
        }
        group.updateMatrixWorld(true);
    };
    return { group, update };
}
