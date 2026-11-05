export function decodeGakumasVertexColor(vertexColor) {
    const high = vertexColor.map(value => Math.floor(value * 15.9375 + 0.03125));
    const low = vertexColor.map((value, index) => value * 255 - high[index] * 16);
    const scale = 1 / 15;
    return {
        outlineColor: [high[0] * scale, low[0] * scale, high[1] * scale],
        outlineWidth: low[2] * scale,
        outlineOffset: high[2] * scale,
        rampAddId: low[1] * scale,
        rimMask: high[3] * scale,
    };
}

export function hasGakumasVertexColorAttribute(mesh) {
    const attribute = mesh?.geometry?.getAttribute?.('gakumasVertexColor');
    const extraUvCount = mesh?.geometry?.userData?.MMD?.additionalUvNum ?? 0;
    const position = mesh?.geometry?.getAttribute?.('position');
    const packed = extraUvCount >= 3 || mesh?.geometry?.userData?.gakumasPackedVertexColor === true;
    return packed && attribute?.itemSize === 4 && attribute.count > 0 && attribute.count === position?.count;
}
