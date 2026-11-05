export function classifyActorPass(materialName, textureName) {
    const value = `${materialName || ''} ${textureName || ''}`.toLowerCase();
    if (/hir\+|_sph(?:\.|_|$)/.test(value)) return 'hairHighlight';
    if (/ehl|eye|eyeball|iris|pupil|眼|瞳/.test(value)) return 'eye';
    if (/ebs|brow|eyebrow|fce_lyr|face.?detail|眉/.test(value)) return 'faceDetail';
    if (/hir|hair|髪|头发|发/.test(value)) return 'hair';
    if (/mouth|oral|teeth|tooth|tongue|inner|inside|口腔|牙|舌/.test(value)) return 'internal';
    if (/cloth|dress|skirt|shirt|sleeve|jacket|衣|服|裙|袖|外套/.test(value)) return 'clothing';
    if (/bdy|body|身体/.test(value)) return 'body';
    if (/fce|face|head|脸|面部/.test(value)) return 'face';
    return 'body';
}

export const CHARACTER_SHADOW_MAP_SIZE = 4096;

export function shouldCastCharacterShadow(role) {
    // Official character ShadowDepth omits the face, eyes, brows, highlight
    // cards and the inner mouth. Hair, body and clothing write the map, so
    // bangs and skirt details land on the surfaces behind them.
    return role === 'hair' || role === 'body' || role === 'clothing' || role === 'bodyAccessory';
}

export function shouldReceiveCharacterShadow(role) {
    // The face does not cast, so the neck shade stays in the texture. Face,
    // eyes, hair, body and clothing still sample the same map.
    // Brows stay on the lit face color. Receiving the bang shadow turns the
    // lines that show through the hair nearly black.
    return ['face', 'eye', 'hair', 'body', 'clothing', 'bodyAccessory'].includes(role);
}

export function characterShadowFrustum(radius, mapSize = CHARACTER_SHADOW_MAP_SIZE) {
    const extent = Math.max(Number(radius) || 0, 0.5);
    const distance = extent + 1;
    const near = 0.05;
    const far = distance + extent + 0.5;
    const size = Math.max(256, Math.round(Number(mapSize) || CHARACTER_SHADOW_MAP_SIZE));
    const texel = (extent * 2) / size;
    return {
        mapSize: size,
        distance,
        extent,
        near,
        far,
        contact: (texel * 2) / Math.max(far - near, 0.001),
    };
}

// Camera looks down its local -Z. Column 2 of matrixWorld is that axis in world space.
export function characterShadowViewBasis(matrixElements) {
    const e = matrixElements;
    if (!e || e.length < 11) return { forward: [0, 0, -1], up: [0, 1, 0] };
    let fx = -e[8];
    let fy = -e[9];
    let fz = -e[10];
    const fl = Math.hypot(fx, fy, fz);
    if (fl > 1e-8) {
        fx /= fl;
        fy /= fl;
        fz /= fl;
    } else {
        fx = 0;
        fy = 0;
        fz = -1;
    }
    let ux = e[4];
    let uy = e[5];
    let uz = e[6];
    const ul = Math.hypot(ux, uy, uz);
    if (ul > 1e-8) {
        ux /= ul;
        uy /= ul;
        uz /= ul;
    } else {
        ux = 0;
        uy = 1;
        uz = 0;
    }
    if (Math.abs(fx * ux + fy * uy + fz * uz) > 0.98) {
        ux = 0;
        uy = 1;
        uz = 0;
    }
    return { forward: [fx, fy, fz], up: [ux, uy, uz] };
}

// Direction is the camera forward, not camera-to-body-center. A face closeup
// looks at the head while the bounds center stays at the torso; aiming there
// tilts the light down, and the tilt grows as the camera moves in.
export function characterShadowLightOffset(viewDirection, target, distance) {
    const length = Math.hypot(viewDirection?.[0] || 0, viewDirection?.[1] || 0, viewDirection?.[2] || 0);
    const nx = length > 1e-8 ? viewDirection[0] / length : 0;
    const ny = length > 1e-8 ? viewDirection[1] / length : 0;
    const nz = length > 1e-8 ? viewDirection[2] / length : -1;
    return {
        direction: [nx, ny, nz],
        position: [
            target[0] - nx * distance,
            target[1] - ny * distance,
            target[2] - nz * distance,
        ],
    };
}

export function placeCharacterShadowLight(light, camera, fit, mapSize = CHARACTER_SHADOW_MAP_SIZE) {
    const target = fit?.center;
    if (!light?.shadow?.camera || !camera?.position || !target) return null;
    if (typeof camera.updateMatrixWorld === 'function') camera.updateMatrixWorld();
    const frustum = characterShadowFrustum(fit.radius, mapSize);
    const basis = characterShadowViewBasis(camera.matrixWorld?.elements);
    const placement = characterShadowLightOffset(
        basis.forward,
        [target.x, target.y, target.z],
        frustum.distance,
    );
    light.target.position.set(target.x, target.y, target.z);
    light.position.set(placement.position[0], placement.position[1], placement.position[2]);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
    const shadowCamera = light.shadow.camera;
    shadowCamera.up.set(basis.up[0], basis.up[1], basis.up[2]);
    shadowCamera.left = -frustum.extent;
    shadowCamera.right = frustum.extent;
    shadowCamera.top = frustum.extent;
    shadowCamera.bottom = -frustum.extent;
    shadowCamera.near = frustum.near;
    shadowCamera.far = frustum.far;
    shadowCamera.updateProjectionMatrix();
    if (light.shadow.mapSize.x !== frustum.mapSize || light.shadow.mapSize.y !== frustum.mapSize) {
        light.shadow.mapSize.set(frustum.mapSize, frustum.mapSize);
    }
    light.shadow.bias = 0;
    light.shadow.normalBias = 0;
    light.shadow.radius = 0;
    light.shadow.updateMatrices(light);
    return { ...frustum, direction: placement.direction };
}

export function isHairCoverSourceMaterial(materialName, textureName) {
    const material = `${materialName || ''}`.toLowerCase().trim();
    const texture = `${textureName || ''}`.toLowerCase();
    const isHairTexture = /(?:^|[_-])hir_col_alp(?:\.|_|$)/.test(texture);
    if (material) return material === 'm_hir' && isHairTexture;
    return isHairTexture;
}

export function actorStencilState(materialName, actorPass) {
    const name = `${materialName || ''}`.toLowerCase();
    if (actorPass === 'eye' || actorPass === 'eyeHighlight') return { write: true, func: 'EqualStencilFunc', ref: 68, readMask: 108, writeMask: 108, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'KeepStencilOp' };
    if (name.includes('ebs')) return { write: true, func: 'AlwaysStencilFunc', ref: 68, readMask: 108, writeMask: 108, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'ReplaceStencilOp' };
    if (name.includes('fcp')) return { write: true, func: 'AlwaysStencilFunc', ref: 72, readMask: 108, writeMask: 108, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'ReplaceStencilOp' };
    if (actorPass === 'face' || actorPass === 'faceDetail') return { write: true, func: 'AlwaysStencilFunc', ref: 64, readMask: 108, writeMask: 108, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'ReplaceStencilOp' };
    if (actorPass === 'hair') return { write: true, func: 'GreaterEqualStencilFunc', ref: 64, readMask: 108, writeMask: 96, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'ReplaceStencilOp' };
    return { write: false, func: 'AlwaysStencilFunc', ref: 0, readMask: 0xff, writeMask: 0, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'KeepStencilOp' };
}
