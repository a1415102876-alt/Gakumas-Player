export const PORTRAIT_TEXTURE_MAX_DIMENSION = 2048;

const MATERIAL_TEXTURE_KEYS = [
    'alphaMap', 'aoMap', 'bumpMap', 'clearcoatMap', 'clearcoatNormalMap',
    'clearcoatRoughnessMap', 'displacementMap', 'emissiveMap', 'envMap',
    'gradientMap', 'iridescenceMap', 'iridescenceThicknessMap', 'lightMap',
    'map', 'matcap', 'metalnessMap', 'normalMap', 'roughnessMap',
    'specularMap', 'specularColorMap', 'specularIntensityMap', 'thicknessMap',
    'transmissionMap',
];

function addUniformTexture(value, textures) {
    if (value?.isTexture) {
        textures.add(value);
    } else if (Array.isArray(value)) {
        value.forEach(item => addUniformTexture(item, textures));
    }
}

export function collectSceneTextures(root) {
    const textures = new Set();
    root?.traverse?.(object => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
            if (!material) continue;
            for (const key of MATERIAL_TEXTURE_KEYS) {
                if (material[key]?.isTexture) textures.add(material[key]);
            }
            for (const uniform of Object.values(material.uniforms || {})) {
                addUniformTexture(uniform?.value, textures);
            }
            for (const uniform of Object.values(material.userData?.gakumasUniforms || {})) {
                addUniformTexture(uniform?.value, textures);
            }
        }
    });
    return textures;
}

function imageDimensions(image) {
    return {
        width: Number(image?.naturalWidth || image?.videoWidth || image?.width) || 0,
        height: Number(image?.naturalHeight || image?.videoHeight || image?.height) || 0,
    };
}

function estimateRgbaMipBytes(width, height) {
    return Math.ceil(width * height * 4 * (4 / 3));
}

export async function downscaleTextureSources(textures, {
    maxDimension = PORTRAIT_TEXTURE_MAX_DIMENSION,
    createBitmap = globalThis.createImageBitmap,
} = {}) {
    const uniqueTextures = new Set([...textures || []].filter(texture => texture?.isTexture));
    const groups = new Map();
    for (const texture of uniqueTextures) {
        if (texture.isCompressedTexture || texture.isDataTexture || texture.isDataArrayTexture || texture.isData3DTexture) continue;
        const image = texture.source?.data ?? texture.image;
        if (!image || typeof image !== 'object' || Array.isArray(image) || ArrayBuffer.isView(image.data)) continue;
        const { width, height } = imageDimensions(image);
        if (!width || !height) continue;
        let group = groups.get(image);
        if (!group) {
            group = { image, width, height, textures: new Set(), sources: new Set() };
            groups.set(image, group);
        }
        group.textures.add(texture);
        if (texture.source) group.sources.add(texture.source);
    }

    const estimateBytes = () => [...uniqueTextures].reduce((total, texture) => {
        const { width, height } = imageDimensions(texture.source?.data ?? texture.image);
        return total + (width && height ? estimateRgbaMipBytes(width, height) : 0);
    }, 0);
    const estimatedBytesBefore = estimateBytes();
    const candidates = [...groups.values()].filter(group => Math.max(group.width, group.height) > maxDimension);
    let resizedSources = 0;
    let failures = 0;

    if (typeof createBitmap === 'function') {
        const results = await Promise.all(candidates.map(async group => {
            const scale = maxDimension / Math.max(group.width, group.height);
            try {
                const bitmap = await createBitmap(group.image, {
                    resizeWidth: Math.max(1, Math.round(group.width * scale)),
                    resizeHeight: Math.max(1, Math.round(group.height * scale)),
                    resizeQuality: 'high',
                });
                if (!bitmap) return false;
                for (const source of group.sources) source.data = bitmap;
                for (const texture of group.textures) {
                    if (!texture.source) texture.image = bitmap;
                    texture.needsUpdate = true;
                }
                return true;
            } catch {
                return false;
            }
        }));
        resizedSources = results.filter(Boolean).length;
        failures = results.length - resizedSources;
    } else {
        failures = candidates.length;
    }

    const estimatedBytesAfter = estimateBytes();
    return {
        maxDimension,
        sourceCount: groups.size,
        resizedSources,
        failures,
        estimatedBytesBefore,
        estimatedBytesAfter,
        estimatedBytesSaved: Math.max(0, estimatedBytesBefore - estimatedBytesAfter),
    };
}
