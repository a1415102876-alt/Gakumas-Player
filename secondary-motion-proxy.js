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

// Optional latency compensation, OFF by default. A worker result describes the pose
// one round trip ago, so a bone shown straight from it trails the body. With a lead
// above 0 the proxy continues each bone along the motion between the last two results:
//   shown = latest + (latest - previous) * min(maxCarry, lead * ahead / span)
// Measured: in a deterministic simulation with known ground truth it cuts the error
// against the in-thread solver by 30-50% and removes stalls, but in a real browser the
// result was inconsistent, and with a large maxCarry it roughly tripled the motion of
// quiet hair. So it stays off until it has been judged by eye; try ?physicslead=0.5.
export const DEFAULT_PHYSICS_LEAD = 0;
// Never run further ahead than this (seconds). Past it the bone holds still.
const MAX_AHEAD = 0.075;
// Never carry a bone further than this many times the motion between the last two
// results. A short step followed by a long wait would otherwise be stretched many
// times over, and the bone swings past where the solver puts it.
const MAX_CARRY = 1;
// A bone that moved more than this between two results snapped (a collision
// push or a reset) rather than swung. Carrying a snap forward would overshoot.
const MAX_STEP_DEGREES = 25;

/**
 * `?physicslead=0.9` or `globalThis.__HATSU_PHYSICS_LEAD = 0.9` overrides the
 * default; 0 turns compensation off and shows the latest result unchanged.
 */
export function physicsLead(env = globalThis) {
    let raw = null;
    try { raw = new URLSearchParams(env?.location?.search || '').get('physicslead'); } catch { /* no location */ }
    if (raw === null || raw === '') raw = env?.__HATSU_PHYSICS_LEAD;
    const value = Number(raw);
    if (raw === null || raw === undefined || raw === '' || !Number.isFinite(value)) return DEFAULT_PHYSICS_LEAD;
    return Math.min(2, Math.max(0, value));
}

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
    constructor({ createWorker, onFail, lead = DEFAULT_PHYSICS_LEAD, maxAhead = MAX_AHEAD, maxCarry = MAX_CARRY, maxStepDegrees = MAX_STEP_DEGREES } = {}) {
        if (typeof createWorker !== 'function') throw new TypeError('createWorker is required');
        this.createWorker = createWorker;
        this.onFail = onFail || null;
        this.lead = Number.isFinite(Number(lead)) ? Math.max(0, Number(lead)) : DEFAULT_PHYSICS_LEAD;
        this.maxAhead = Math.max(0, Number(maxAhead) || 0);
        this.maxCarry = Math.max(0, Number(maxCarry) || 0);
        // |dot| of two unit quaternions is cos(angle / 2).
        this.minDot = Math.cos((Math.min(179, Math.max(0, Number(maxStepDegrees) || 0)) * Math.PI / 180) / 2);
        // Solver time, in seconds: the sum of the steps the page has fed in.
        this.clock = 0;
        this.latestClock = 0;
        this.previous = null;
        this.previousClock = 0;
        this.scratch = null;
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
        // A reset result has no motion history of its own: it is the seed pose.
        this.previous = message.reset ? null : this.latest;
        this.previousClock = this.latestClock;
        this.latest = message.output;
        // The host echoes the clock of the request it answers, so the result is
        // tied to the moment it was solved for even if replies overlap.
        this.latestClock = Number.isFinite(message.clock) ? message.clock : this.clock;
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
        this.previous = null;
        this.scratch = null;
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

    /**
     * The pose to show now. The newest worker result is one round trip old, so
     * each bone is carried forward along its motion between the last two
     * results. A bone that jumped between them (collision push, reset) is shown
     * as solved: carrying a jump forward would overshoot.
     */
    #shown() {
        const latest = this.latest;
        const previous = this.previous;
        if (!previous || this.lead <= 0 || previous.length !== latest.length) return latest;
        const span = this.latestClock - this.previousClock;
        const ahead = Math.min(this.maxAhead, Math.max(0, this.clock - this.latestClock));
        if (!(span > 1e-6) || !(ahead > 0)) return latest;
        const k = Math.min(this.maxCarry, this.lead * ahead / span);
        const out = this.scratch?.length === latest.length ? this.scratch : (this.scratch = new Float64Array(latest.length));
        for (let o = 0; o < latest.length; o += OUTPUT_STRIDE) {
            const dot = latest[o] * previous[o] + latest[o + 1] * previous[o + 1]
                + latest[o + 2] * previous[o + 2] + latest[o + 3] * previous[o + 3];
            if (Math.abs(dot) < this.minDot) {
                for (let j = 0; j < OUTPUT_STRIDE; j += 1) out[o + j] = latest[o + j];
                continue;
            }
            // q and -q are the same rotation: bring the older one onto the same side.
            const side = dot < 0 ? -1 : 1;
            const x = latest[o] + (latest[o] - side * previous[o]) * k;
            const y = latest[o + 1] + (latest[o + 1] - side * previous[o + 1]) * k;
            const z = latest[o + 2] + (latest[o + 2] - side * previous[o + 2]) * k;
            const w = latest[o + 3] + (latest[o + 3] - side * previous[o + 3]) * k;
            const length = Math.hypot(x, y, z, w);
            if (length > 1e-9) {
                out[o] = x / length; out[o + 1] = y / length; out[o + 2] = z / length; out[o + 3] = w / length;
            } else {
                for (let j = 0; j < 4; j += 1) out[o + j] = latest[o + j];
            }
            out[o + 4] = latest[o + 4] + (latest[o + 4] - previous[o + 4]) * k;
            out[o + 5] = latest[o + 5] + (latest[o + 5] - previous[o + 5]) * k;
            out[o + 6] = latest[o + 6] + (latest[o + 6] - previous[o + 6]) * k;
        }
        return out;
    }

    update(step, options) {
        if (!this.ready) return false;
        const advance = Math.max(0, Number(step) || 0);
        this.clock += advance;
        this.pendingStep = Math.min(MAX_PENDING_STEP, this.pendingStep + advance);
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
                clock: this.clock,
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
            this.#writeOutputs(this.#shown(), this.outputPosition);
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
        this.previous = null;
        this.#captureOutputs();
        this.pendingStep = 0;
        const local = readNodeTransforms(this.nodes);
        this.#post({ type: 'reset', epoch: this.epoch, seq: this.seq += 1, clock: this.clock, local });
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
