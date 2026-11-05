// Main-thread side of the secondary-motion worker.
//
// The solver (gakumas-secondary-motion.js) is unchanged and runs inside a
// worker against a mirror of the skeleton. Each frame this proxy:
//   1. remembers the animated pose of the bones the solver writes,
//   2. sends the whole animated skeleton to the worker, if it is idle,
//   3. writes the newest solved rotations onto the real bones.
// Hair and skirt therefore trail the body by about one worker round trip, but
// the render loop never waits for physics, so a slow solver no longer drags the
// frame rate down or snowballs into catch-up steps.
import {
    NODE_STRIDE,
    OUTPUT_STRIDE,
    readNodeTransforms,
    snapshotNodeTree,
} from './secondary-motion-snapshot.js?v=20261106-physics-worker-v1';

const BIND_TIMEOUT_MS = 20000;
// The solver clamps one update to 0.1 s; carrying more would only slow time.
const MAX_PENDING_STEP = 0.1;

/**
 * Default policy: use the worker when the browser has one and enough cores to
 * run it beside the render thread. `?physics=sync` or
 * `globalThis.__HATSU_PHYSICS_WORKER = false` forces the original in-thread path.
 */
export function physicsWorkerSupported(env = globalThis) {
    if (typeof env?.Worker !== 'function') return false;
    if (env.__HATSU_PHYSICS_WORKER === false) return false;
    try {
        const mode = new URLSearchParams(env.location?.search || '').get('physics');
        if (mode === 'sync') return false;
        if (mode === 'worker') return true;
    } catch { /* no location: fall through to the core-count rule */ }
    const cores = Number(env.navigator?.hardwareConcurrency);
    return !(Number.isFinite(cores) && cores > 0 && cores < 4);
}

function sameList(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

export class SecondaryMotionProxy {
    constructor({ createWorker, onFail } = {}) {
        if (typeof createWorker !== 'function') throw new TypeError('createWorker is required');
        this.createWorker = createWorker;
        this.onFail = onFail || null;
        this.worker = null;
        this.ready = false;
        this.failed = false;
        this.epoch = 0;
        this.seq = 0;
        this.nodes = [];
        this.outputBones = [];
        this.outputPosition = new Uint8Array(0);
        this.refreshRoots = [];
        this.animationPose = null;
        this.latest = null;
        this.spare = null;
        this.inflight = 0;
        this.pendingStep = 0;
        this.bindWaiter = null;
        this.runtime = {};
        this.lastSolveMs = 0;
        this.stats = { posted: 0, applied: 0, skipped: 0, discarded: 0 };
    }

    /**
     * Resolves true once the worker holds an identical binding. `expect` is the
     * in-thread solver's result for the same model; any difference means the
     * mirror would simulate something else, so the caller keeps the original.
     */
    async bind({ restPose, table, worldScale = 1, expect = null } = {}) {
        this.#teardown();
        this.failed = false;
        let root = restPose?.[0]?.bone;
        while (root?.parent && !root.parent.isScene && root.parent.type !== 'Scene') root = root.parent;
        if (!root) return false;

        const tree = snapshotNodeTree(root);
        const nodeIndex = new Map(tree.nodes.map((node, index) => [node, index]));
        const restIndex = new Int32Array(restPose.length);
        const restLocal = new Float64Array(restPose.length * NODE_STRIDE);
        for (let k = 0; k < restPose.length; k += 1) {
            const entry = restPose[k];
            const index = nodeIndex.get(entry.bone);
            // A bone outside the model tree cannot be mirrored faithfully.
            if (index === undefined) return false;
            restIndex[k] = index;
            const o = k * NODE_STRIDE;
            const p = entry.position, q = entry.quaternion, s = entry.scale || { x: 1, y: 1, z: 1 };
            restLocal[o] = p.x; restLocal[o + 1] = p.y; restLocal[o + 2] = p.z;
            restLocal[o + 3] = q.x; restLocal[o + 4] = q.y; restLocal[o + 5] = q.z; restLocal[o + 6] = q.w;
            restLocal[o + 7] = s.x; restLocal[o + 8] = s.y; restLocal[o + 9] = s.z;
        }
        const local = readNodeTransforms(tree.nodes);
        this.nodes = tree.nodes;
        this.expect = expect;

        try {
            this.worker = this.createWorker();
            this.worker.onmessage = event => this.#onMessage(event.data);
            this.worker.onerror = event => this.#fail(event?.message || 'worker error');
            this.worker.onmessageerror = () => this.#fail('worker message could not be decoded');
            this.worker.postMessage({
                type: 'bind',
                epoch: this.epoch,
                table,
                worldScale,
                tree: { parents: tree.parents, kinds: tree.kinds, names: tree.names, local },
                rest: { index: restIndex, local: restLocal },
            }, [local.buffer, restLocal.buffer]);
        } catch (error) {
            this.#fail(error);
            return false;
        }
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.#fail('physics worker bind timed out');
            }, BIND_TIMEOUT_MS);
            this.bindWaiter = ok => { clearTimeout(timer); resolve(ok); };
        });
    }

    #onMessage(message) {
        switch (message?.type) {
            case 'bound': this.#onBound(message); break;
            case 'result': this.#onResult(message); break;
            case 'error': this.#fail(message.message); break;
            default: break;
        }
    }

    #onBound(message) {
        if (message.epoch !== this.epoch) return;
        const expect = this.expect;
        if (expect && (message.springs !== expect.springs || !sameList(message.missing, expect.missing || []))) {
            this.#fail(`mirror bound differently (springs ${message.springs}/${expect.springs}, missing ${message.missing.length}/${(expect.missing || []).length})`);
            return;
        }
        this.outputBones = Array.from(message.outputIndex, index => this.nodes[index]);
        this.outputPosition = message.outputPosition;
        const members = new Set(this.outputBones);
        // Same rule as writePose(): refresh each branch once, from its top.
        this.refreshRoots = this.outputBones.filter(bone => !members.has(bone.parent));
        // Allocated on the first capture. Until then there is no animated pose
        // to restore, and an all-zero buffer would write a zero quaternion.
        this.animationPose = null;
        this.runtime = { ...message.runtime };
        this.ready = true;
        this.bindWaiter?.(true);
        this.bindWaiter = null;
    }

    #onResult(message) {
        this.inflight = Math.max(0, this.inflight - 1);
        if (message.local?.length === this.nodes.length * NODE_STRIDE) this.spare = message.local;
        if (message.epoch !== this.epoch) {
            this.stats.discarded += 1;
            return;
        }
        this.latest = message.output;
        this.runtime = message.runtime || this.runtime;
        this.lastSolveMs = message.solveMs || 0;
    }

    #fail(reason) {
        if (this.failed) return;
        this.failed = true;
        this.ready = false;
        this.#teardown();
        this.bindWaiter?.(false);
        this.bindWaiter = null;
        this.onFail?.(reason instanceof Error ? reason.message : String(reason));
    }

    #teardown() {
        const worker = this.worker;
        this.worker = null;
        this.ready = false;
        this.epoch += 1;
        this.latest = null;
        this.animationPose = null;
        this.inflight = 0;
        this.pendingStep = 0;
        this.spare = null;
        if (worker) {
            worker.onmessage = null;
            worker.onerror = null;
            try { worker.postMessage({ type: 'dispose' }); } catch { /* already gone */ }
            try { worker.terminate(); } catch { /* already gone */ }
        }
    }

    #captureOutputs() {
        const bones = this.outputBones;
        const pose = this.animationPose ||= new Float64Array(bones.length * OUTPUT_STRIDE);
        for (let k = 0; k < bones.length; k += 1) {
            const q = bones[k].quaternion;
            const p = bones[k].position;
            const o = k * OUTPUT_STRIDE;
            pose[o] = q.x; pose[o + 1] = q.y; pose[o + 2] = q.z; pose[o + 3] = q.w;
            pose[o + 4] = p.x; pose[o + 5] = p.y; pose[o + 6] = p.z;
        }
    }

    #writeOutputs(values, positions) {
        const bones = this.outputBones;
        for (let k = 0; k < bones.length; k += 1) {
            const o = k * OUTPUT_STRIDE;
            bones[k].quaternion.set(values[o], values[o + 1], values[o + 2], values[o + 3]);
            if (positions[k]) bones[k].position.set(values[o + 4], values[o + 5], values[o + 6]);
        }
        for (const bone of this.refreshRoots) bone.updateMatrixWorld(true);
    }

    /** Put the bones the solver writes back to their animated pose, before the mixer runs. */
    restoreBeforeAnimation() {
        if (!this.ready || !this.animationPose) return;
        this.#writeOutputs(this.animationPose, this.outputPosition);
    }

    update(step, options) {
        if (!this.ready) return false;
        this.pendingStep = Math.min(MAX_PENDING_STEP, this.pendingStep + Math.max(0, Number(step) || 0));
        this.#captureOutputs();
        // One request in flight. If the worker is still busy, keep the time
        // for the next request instead of queueing frames it cannot catch up on.
        if (this.inflight === 0) {
            const local = this.spare || new Float64Array(this.nodes.length * NODE_STRIDE);
            this.spare = null;
            readNodeTransforms(this.nodes, local);
            this.#post({
                type: 'update',
                epoch: this.epoch,
                seq: this.seq += 1,
                step: this.pendingStep,
                options,
                local,
            });
            this.pendingStep = 0;
            this.stats.posted += 1;
        } else {
            this.stats.skipped += 1;
        }
        if (this.latest) {
            this.#writeOutputs(this.latest, this.outputPosition);
            this.stats.applied += 1;
        }
        return true;
    }

    /**
     * Re-seed the simulation from the current pose. The caller resets the
     * in-thread solver first, so the bones already show the reset pose and
     * nothing stale is drawn while the worker catches up.
     */
    reset() {
        if (!this.ready) return false;
        this.epoch += 1;
        this.latest = null;
        this.#captureOutputs();
        this.pendingStep = 0;
        const local = readNodeTransforms(this.nodes);
        this.#post({ type: 'reset', epoch: this.epoch, seq: this.seq += 1, local });
        return true;
    }

    #post(message) {
        this.inflight += 1;
        try {
            this.worker.postMessage(message, [message.local.buffer]);
        } catch (error) {
            this.#fail(error);
        }
    }

    dispose() {
        this.#teardown();
        this.bindWaiter?.(false);
        this.bindWaiter = null;
        this.nodes = [];
        this.outputBones = [];
        this.refreshRoots = [];
    }
}
