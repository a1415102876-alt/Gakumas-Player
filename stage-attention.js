import { MathUtils, Quaternion, Vector3 } from './vendor/three/build/three.module.js';

const POSITION_X = Object.freeze({ left: -1, center: 0, right: 1 });

export class StageAttentionController {
    constructor() {
        this.model = null;
        this.baseQuaternion = new Quaternion();
        this.target = null;
        this.current = { x: 0, y: 0 };
        this.duration = 0;
        this.neutralTarget = { x: 0, y: 0 };
        this.yawAxis = new Vector3(0, 1, 0);
        this.pitchAxis = new Vector3(1, 0, 0);
        this.offsetQuaternion = new Quaternion();
        this.pitchQuaternion = new Quaternion();
        this.held = false;
    }

    static resolveTarget(actorId, targetId, positions = {}) {
        if (!targetId || targetId === 'none' || targetId === 'camera' || targetId === 'auto') return { x: 0, y: 0 };
        const actor = POSITION_X[positions[actorId]] ?? 0;
        const target = POSITION_X[positions[targetId]] ?? 0;
        return { x: Math.sign(target - actor), y: 0 };
    }

    bind(model) {
        this.model = model || null;
        this.baseQuaternion.copy(this.model?.quaternion || new Quaternion());
        this.current = { x: 0, y: 0 };
        this.target = null;
    }

    adoptBase() {
        if (this.model) this.baseQuaternion.copy(this.model.quaternion);
    }

    hold(held = true) {
        this.held = Boolean(held);
    }

    lookYawDegrees() {
        return this.current.x * 26;
    }

    setTarget(id, vector, duration = 0) {
        this.target = id && vector ? { x: Number(vector.x) || 0, y: Number(vector.y) || 0 } : null;
        this.duration = Math.max(0, Number(duration) || 720);
    }

    clearTarget() {
        this.target = null;
        this.duration = 0;
    }

    update(delta = 1 / 60) {
        if (!this.model || this.held) return;
        const target = this.target || this.neutralTarget;
        const amount = this.duration > 0 ? Math.min(1, (Number(delta) || 0) / (this.duration / 1000)) : 1 - Math.pow(0.001, Math.min(Math.max(Number(delta) || 0, 0), 0.2) * 8);
        this.current.x = MathUtils.lerp(this.current.x, target.x, amount);
        this.current.y = MathUtils.lerp(this.current.y, target.y, amount);
        this.offsetQuaternion.setFromAxisAngle(this.yawAxis, MathUtils.degToRad(this.current.x * 26));
        this.pitchQuaternion.setFromAxisAngle(this.pitchAxis, MathUtils.degToRad(-this.current.y * 8));
        this.offsetQuaternion.multiply(this.pitchQuaternion);
        this.model.quaternion.copy(this.baseQuaternion).multiply(this.offsetQuaternion);
    }
}

