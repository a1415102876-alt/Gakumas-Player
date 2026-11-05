// Plain-data helpers shared by the main-thread proxy and the physics worker.
// This module imports nothing on purpose: the proxy must be able to snapshot a
// model without loading a second copy of Three.js onto the page.

/** Local transform of one node: px py pz, qx qy qz qw, sx sy sz. */
export const NODE_STRIDE = 10;
/** Solver result for one bone: qx qy qz qw, px py pz. */
export const OUTPUT_STRIDE = 7;

/**
 * Flatten a model's node tree. Parents always come before children and the
 * siblings keep their original order, because the solver picks the first
 * child bone (`firstChildBone`) and the mirror must make the same choice.
 */
export function snapshotNodeTree(root) {
    const nodes = [];
    const parents = [];
    // Every descendant is mirrored, meshes included. The solver's
    // firstChildBone() accepts the first child of any kind, so dropping
    // render-only nodes could change which bone it picks as a tail.
    const visit = (node, parent) => {
        const index = nodes.length;
        nodes.push(node);
        parents.push(parent);
        for (const child of node.children || []) visit(child, index);
    };
    visit(root, -1);
    const kinds = new Uint8Array(nodes.length);
    nodes.forEach((node, index) => { kinds[index] = node.isBone ? 1 : 0; });
    return {
        nodes,
        parents: Int32Array.from(parents),
        kinds,
        names: nodes.map(node => node.name || ''),
    };
}

export function readNodeTransforms(nodes, target = new Float64Array(nodes.length * NODE_STRIDE)) {
    let offset = 0;
    for (const node of nodes) {
        const p = node.position;
        const q = node.quaternion;
        const s = node.scale;
        target[offset] = p.x; target[offset + 1] = p.y; target[offset + 2] = p.z;
        target[offset + 3] = q.x; target[offset + 4] = q.y; target[offset + 5] = q.z; target[offset + 6] = q.w;
        target[offset + 7] = s.x; target[offset + 8] = s.y; target[offset + 9] = s.z;
        offset += NODE_STRIDE;
    }
    return target;
}

export function writeNodeTransforms(nodes, source) {
    let offset = 0;
    for (const node of nodes) {
        node.position.set(source[offset], source[offset + 1], source[offset + 2]);
        node.quaternion.set(source[offset + 3], source[offset + 4], source[offset + 5], source[offset + 6]);
        node.scale.set(source[offset + 7], source[offset + 8], source[offset + 9]);
        offset += NODE_STRIDE;
    }
}
