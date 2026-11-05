// Runs the unchanged secondary-motion solver against a mirror of the model's
// skeleton. The main thread sends the animated local transforms each frame and
// receives the solved rotations of the spring and driver bones back.
//
// Loaded by secondary-motion-worker.js. It is a plain module so tests can drive
// it directly, without a Worker.
import { Bone, Object3D, Quaternion, Scene, Vector3 } from './vendor/three/build/three.module.js';
import { QUARTZ_HAIR, SecondaryMotion } from './gakumas-secondary-motion.js?v=20261102-krnh-sleeve-gravity-v1';
import { NODE_STRIDE, OUTPUT_STRIDE, writeNodeTransforms } from './secondary-motion-snapshot.js?v=20261106-physics-worker-v1';

export function buildMirror({ parents, kinds, names, local }) {
    const scene = new Scene();
    const nodes = new Array(parents.length);
    for (let index = 0; index < parents.length; index += 1) {
        // The solver tells bones from other nodes by `isBone`, so the mirror
        // keeps that distinction and nothing else about the original types.
        const node = kinds[index] ? new Bone() : new Object3D();
        node.name = names[index];
        nodes[index] = node;
        (parents[index] < 0 ? scene : nodes[parents[index]]).add(node);
    }
    writeNodeTransforms(nodes, local);
    scene.updateMatrixWorld(true);
    return { scene, nodes };
}

function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

export class SecondaryMotionHost {
    constructor() {
        this.dispose();
    }

    dispose() {
        this.motion = null;
        this.mirror = null;
        this.outputIndex = new Int32Array(0);
        this.outputPosition = new Uint8Array(0);
    }

    handle(message) {
        switch (message?.type) {
            case 'bind': return this.bind(message);
            case 'update': return this.update(message);
            case 'reset': return this.reset(message);
            case 'dispose': this.dispose(); return null;
            default: return null;
        }
    }

    bind({ epoch, table, worldScale, tree, rest }) {
        this.dispose();
        const mirror = buildMirror(tree);
        const restPose = Array.from(rest.index, (nodeIndex, k) => {
            const o = k * NODE_STRIDE;
            const values = rest.local;
            return {
                bone: mirror.nodes[nodeIndex],
                position: new Vector3(values[o], values[o + 1], values[o + 2]),
                quaternion: new Quaternion(values[o + 3], values[o + 4], values[o + 5], values[o + 6]),
                scale: new Vector3(values[o + 7], values[o + 8], values[o + 9]),
            };
        });
        const motion = new SecondaryMotion(table);
        motion.worldScale = worldScale;
        motion.bind(restPose);
        this.mirror = mirror;
        this.motion = motion;

        // Everything the solver writes: spring bones, Quartz driver targets
        // and skirt follow targets. Only the hair driver moves a bone's
        // position (hairShifted); every other write is a rotation.
        const nodeIndex = new Map(mirror.nodes.map((node, index) => [node, index]));
        const outputs = new Map();
        const add = (bone, withPosition) => {
            const index = nodeIndex.get(bone);
            if (index !== undefined) outputs.set(index, Boolean(outputs.get(index)) || withPosition);
        };
        for (const item of motion.springs) add(item.entry.bone, false);
        for (const binding of motion.bindings) add(binding.target.bone, binding.driver?.className === QUARTZ_HAIR);
        for (const binding of motion.skirtRootFollowBindings) add(binding.target.bone, false);
        this.outputIndex = Int32Array.from(outputs.keys());
        this.outputPosition = Uint8Array.from(outputs.values(), flag => (flag ? 1 : 0));

        const output = this.readOutput();
        return {
            reply: {
                type: 'bound',
                epoch,
                missing: [...motion.missing],
                springs: motion.springs.length,
                outputIndex: this.outputIndex.slice(),
                outputPosition: this.outputPosition.slice(),
                output,
                runtime: { ...motion.runtime },
            },
            transfer: [output.buffer],
        };
    }

    #sync(local) {
        writeNodeTransforms(this.mirror.nodes, local);
        // On the page the render loop refreshes every world matrix between
        // frames. The mirror has no renderer, so do the same here.
        this.mirror.scene.updateMatrixWorld(true);
    }

    update({ epoch, seq, step, options, local }) {
        if (!this.motion) throw new Error('physics worker received update before bind');
        this.#sync(local);
        const started = now();
        this.motion.update(step, options);
        const solveMs = now() - started;
        const output = this.readOutput();
        // The input buffer goes back so the proxy can reuse it next frame.
        return {
            reply: { type: 'result', epoch, seq, output, local, solveMs, runtime: { ...this.motion.runtime } },
            transfer: [output.buffer, local.buffer],
        };
    }

    reset({ epoch, seq, local }) {
        if (!this.motion) throw new Error('physics worker received reset before bind');
        this.#sync(local);
        this.motion.reset();
        const output = this.readOutput();
        return {
            reply: { type: 'result', epoch, seq, output, local, solveMs: 0, runtime: { ...this.motion.runtime }, reset: true },
            transfer: [output.buffer, local.buffer],
        };
    }

    readOutput() {
        const output = new Float64Array(this.outputIndex.length * OUTPUT_STRIDE);
        const nodes = this.mirror.nodes;
        for (let k = 0; k < this.outputIndex.length; k += 1) {
            const node = nodes[this.outputIndex[k]];
            const q = node.quaternion;
            const p = node.position;
            const o = k * OUTPUT_STRIDE;
            output[o] = q.x; output[o + 1] = q.y; output[o + 2] = q.z; output[o + 3] = q.w;
            output[o + 4] = p.x; output[o + 5] = p.y; output[o + 6] = p.z;
        }
        return output;
    }
}
