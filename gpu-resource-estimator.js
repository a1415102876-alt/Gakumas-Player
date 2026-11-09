const POST_TARGET_NAMES = [
    'target', 'color', 'msaa', 'history', 'velocityTarget', 'bloomA', 'bloomB',
    'softA', 'softB', 'dofTarget', 'spaceA', 'spaceB', 'spaceFull',
];

function textureBytesPerPixel(texture, three) {
    const channels = texture?.format === three.RGBAFormat ? 4
        : texture?.format === three.RGBFormat ? 3
            : texture?.format === three.RGFormat ? 2
                : texture?.format === three.RedFormat ? 1 : 4;
    const channelBytes = texture?.type === three.FloatType ? 4
        : texture?.type === three.HalfFloatType || texture?.type === three.UnsignedShortType || texture?.type === three.ShortType ? 2
            : texture?.type === three.UnsignedIntType || texture?.type === three.IntType || texture?.type === three.UnsignedInt248Type ? 4
                : 1;
    return channels * channelBytes;
}

function estimateTargetMemoryBytes(target, three) {
    if (!target) return 0;
    const width = Math.max(0, Number(target.width) || 0);
    const height = Math.max(0, Number(target.height) || 0);
    if (!width || !height) return 0;
    const pixels = width * height * (target.isWebGLCubeRenderTarget ? 6 : 1);
    const colorBytes = pixels * textureBytesPerPixel(target.texture, three);
    const depthBytes = target.depthTexture
        ? pixels * textureBytesPerPixel(target.depthTexture, three)
        : target.depthBuffer ? pixels * 4 : 0;
    const samples = Math.max(0, Number(target.samples) || 0);
    const multisampleBytes = samples
        ? pixels * samples * (textureBytesPerPixel(target.texture, three) + (target.depthBuffer ? 4 : 0))
        : 0;
    return colorBytes + depthBytes + multisampleBytes;
}

function postTargets(pass) {
    const targets = new Set();
    if (!pass) return targets;
    for (const key of POST_TARGET_NAMES) {
        const value = pass[key];
        if (Array.isArray(value)) value.forEach(target => target?.isWebGLRenderTarget && targets.add(target));
        else if (value?.isWebGLRenderTarget) targets.add(value);
    }
    return targets;
}

function geometryBytes(roots) {
    const geometries = new Set();
    const arrays = new Set();
    for (const root of roots || []) {
        root?.traverse?.(object => {
            if (object.geometry) geometries.add(object.geometry);
        });
    }
    const addArray = value => {
        const array = value?.array || value?.data?.array;
        if (ArrayBuffer.isView(array)) arrays.add(array);
    };
    for (const geometry of geometries) {
        for (const attribute of Object.values(geometry.attributes || {})) addArray(attribute);
        for (const attributes of Object.values(geometry.morphAttributes || {})) attributes.forEach(addArray);
        addArray(geometry.index);
    }
    return [...arrays].reduce((total, array) => total + array.byteLength, 0);
}

function shadowTargets(roots) {
    const targets = new Set();
    for (const root of roots || []) {
        root?.traverse?.(object => {
            const target = object.shadow?.map;
            if (target?.isWebGLRenderTarget) targets.add(target);
        });
    }
    return targets;
}

export function estimateRendererResources({
    renderer,
    roots = [],
    postPass = null,
    lookPass = null,
    modelTextureBytes = 0,
    sceneTextureBytes = 0,
    plateTextureBytes = 0,
    three,
} = {}) {
    const targets = postTargets(postPass);
    for (const target of postTargets(lookPass)) targets.add(target);
    const shadows = shadowTargets(roots);
    const renderTargetBytes = [...targets].reduce((total, target) => total + estimateTargetMemoryBytes(target, three), 0);
    const shadowMapBytes = [...shadows].reduce((total, target) => total + estimateTargetMemoryBytes(target, three), 0);
    const canvas = renderer?.domElement;
    const canvasBytes = Math.max(0, Number(canvas?.width) || 0) * Math.max(0, Number(canvas?.height) || 0) * 4;
    const geometryMemoryBytes = geometryBytes(roots);
    const pictureTextureBytes = Math.max(0, Number(plateTextureBytes) || 0);
    const textureBytes = Math.max(0, Number(modelTextureBytes) || 0)
        + Math.max(0, Number(sceneTextureBytes) || 0)
        + pictureTextureBytes;
    const estimatedBytes = textureBytes + renderTargetBytes + shadowMapBytes + geometryMemoryBytes + canvasBytes;
    return {
        modelTextureBytes: Math.max(0, Number(modelTextureBytes) || 0),
        sceneTextureBytes: Math.max(0, Number(sceneTextureBytes) || 0),
        plateTextureBytes: pictureTextureBytes,
        textureBytes,
        renderTargetBytes,
        shadowMapBytes,
        geometryBytes: geometryMemoryBytes,
        canvasBytes,
        estimatedBytes,
        rendererTextureCount: Number(renderer?.info?.memory?.textures) || 0,
        rendererGeometryCount: Number(renderer?.info?.memory?.geometries) || 0,
        canvasWidth: Number(canvas?.width) || 0,
        canvasHeight: Number(canvas?.height) || 0,
    };
}

export function estimateImageTextureBytes(image) {
    const width = Number(image?.naturalWidth || image?.videoWidth || image?.width) || 0;
    const height = Number(image?.naturalHeight || image?.videoHeight || image?.height) || 0;
    return width * height * 4;
}

export function collectPostTargets(pass, lookPass = null) {
    const targets = postTargets(pass);
    for (const target of postTargets(lookPass)) targets.add(target);
    return targets;
}
