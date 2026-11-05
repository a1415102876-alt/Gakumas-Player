import * as THREE from './vendor/three/build/three.module.js';

const WATER_VERTEX = `
uniform float uTime;
uniform float uWaveAmplitude;
uniform float uWaveSpeed;
uniform float uWaveScale;
varying vec2 vUv;
varying vec3 vPosition;
void main() {
    vUv = uv;
    vec3 displaced = position;
    float phase = (position.x + position.z) * uWaveScale + uTime * uWaveSpeed;
    displaced.y += sin(phase) * uWaveAmplitude;
    displaced.y += cos((position.x - position.z) * uWaveScale * 1.37 + uTime * uWaveSpeed * 0.73) * uWaveAmplitude * 0.45;
    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WATER_FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
varying vec3 vPosition;
void main() {
    float ripple = 0.5 + 0.5 * sin((vUv.x * 13.0 + vUv.y * 9.0) + uTime * 0.45);
    float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(0.0, 0.18, vUv.y)
        * smoothstep(0.0, 0.18, 1.0 - vUv.x) * smoothstep(0.0, 0.18, 1.0 - vUv.y);
    vec3 color = uColor * (0.86 + ripple * 0.12);
    gl_FragColor = vec4(color, uOpacity * mix(0.78, 1.0, edge));
}
`;

function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function makeSteamTexture() {
    const size = 32;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (x + 0.5) / size * 2 - 1;
            const dy = (y + 0.5) / size * 2 - 1;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const alpha = Math.max(0, Math.min(1, 1 - distance)) ** 1.7;
            const index = (y * size + x) * 4;
            data[index] = 225;
            data[index + 1] = 243;
            data[index + 2] = 248;
            data[index + 3] = Math.round(alpha * 255);
        }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    if ('colorSpace' in texture) texture.colorSpace = THREE.NoColorSpace;
    else texture.encoding = THREE.LinearEncoding;
    return texture;
}

function createWater(profile) {
    const water = profile.water || {};
    const size = Array.isArray(water.size) ? water.size : [6, 4];
    const width = Math.max(0.5, finite(size[0], 6));
    const depth = Math.max(0.5, finite(size[1], 4));
    const segments = Math.min(32, Math.max(4, Math.ceil(Math.max(width, depth) / 0.25)));
    const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const wave = water.wave || {};
    const color = Array.isArray(water.color) ? water.color : [0.12, 0.68, 0.72];
    const material = new THREE.ShaderMaterial({
        name: 'gakumas-hot-spring-water-material',
        uniforms: {
            uColor: { value: new THREE.Color(...color.map(channel => finite(channel, 0.5))) },
            uOpacity: { value: Math.min(0.9, Math.max(0.05, finite(water.opacity, 0.56))) },
            uTime: { value: 0 },
            uWaveAmplitude: { value: Math.max(0, finite(wave.amplitude, 0.018)) },
            uWaveSpeed: { value: Math.max(0, finite(wave.speed, 0.08)) },
            uWaveScale: { value: Math.max(0.05, finite(wave.scale, 0.72)) },
        },
        vertexShader: WATER_VERTEX,
        fragmentShader: WATER_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'gakumas-hot-spring-water';
    mesh.position.set(...(Array.isArray(water.center) ? water.center : [0, 0, 0]));
    mesh.position.y = finite(water.y, mesh.position.y);
    mesh.renderOrder = 2;
    return { mesh, segments };
}

function createSteam(profile) {
    const texture = makeSteamTexture();
    const group = new THREE.Group();
    group.name = 'gakumas-hot-spring-steam';
    const entries = [];
    for (const [index, patch] of (profile.steam || []).slice(0, 3).entries()) {
        const material = new THREE.SpriteMaterial({
            name: `gakumas-hot-spring-steam-material-${index}`,
            map: texture,
            color: 0xe1f3f8,
            transparent: true,
            opacity: Math.min(0.35, Math.max(0, finite(patch.opacity, 0.1))),
            depthWrite: false,
            depthTest: true,
            sizeAttenuation: true,
            toneMapped: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.name = `gakumas-hot-spring-steam-${index + 1}`;
        const position = Array.isArray(patch.position) ? patch.position : [0, 0.2, 0];
        const size = Array.isArray(patch.size) ? patch.size : [1.6, 1.1];
        const drift = Array.isArray(patch.drift) ? patch.drift : [0.02, 0.015];
        sprite.position.set(...position);
        sprite.scale.set(Math.max(0.2, finite(size[0], 1.6)), Math.max(0.2, finite(size[1], 1.1)), 1);
        sprite.renderOrder = 3;
        group.add(sprite);
        entries.push({ sprite, base: sprite.position.clone(), drift: [finite(drift[0], 0.02), finite(drift[1], 0.015)] });
    }
    return { group, texture, entries };
}

export function createSceneEffects(parent, profile) {
    const root = new THREE.Group();
    root.name = 'gakumas-hot-spring-effects';
    const water = createWater(profile || {});
    const steam = createSteam(profile || {});
    root.add(water.mesh, steam.group);
    parent.add(root);
    const update = time => {
        const now = finite(time, 0);
        water.mesh.material.uniforms.uTime.value = now;
        steam.entries.forEach(({ sprite, base, drift }) => {
            sprite.position.x = base.x + Math.sin(now * 0.17) * drift[0];
            sprite.position.y = base.y + Math.sin(now * 0.23 + base.x) * drift[1];
            sprite.position.z = base.z + Math.cos(now * 0.13) * drift[0] * 0.35;
        });
    };
    water.mesh.onBeforeRender = () => update((typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000);
    const dispose = () => {
        if (!root.parent) return;
        root.traverse(object => {
            object.geometry?.dispose?.();
            object.material?.dispose?.();
        });
        steam.texture.dispose();
        root.removeFromParent();
    };
    return {
        root,
        update,
        dispose,
        stats: {
            waterMeshes: 1,
            steamLayers: steam.entries.length,
            waterSegments: [water.segments, water.segments],
        },
    };
}
