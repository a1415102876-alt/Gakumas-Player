import { Euler, MathUtils } from './vendor/three/build/three.module.js';

// The presentation camera remains owned by Beat. Only the synchronous draw
// uses this view, so animation/camera scripts can continue behind free look.
export class SceneFreeLook {
    constructor(onChange = () => {}) {
        this.onChange = onChange;
        this.enabled = false;
        this.sceneKey = '';
        this.camera = null;
        this.pose = null;
    }
    get available() { return Boolean(this.sceneKey && this.camera); }
    setTarget(sceneKey, camera) {
        if (sceneKey !== this.sceneKey || !camera) { this.enabled = false; this.pose = null; }
        this.sceneKey = sceneKey || '';
        this.camera = camera || null;
        this.onChange();
    }
    setEnabled(enabled) {
        this.enabled = Boolean(enabled && this.available);
        if (this.enabled) this.capture();
        else this.pose = null;
        this.onChange();
        return this.enabled;
    }
    capture() {
        const camera = this.camera;
        this.pose = { position:camera.position.clone(), rotation:new Euler().setFromQuaternion(camera.quaternion, 'YXZ'), fov:camera.fov };
    }
    recenter() {
        if (!this.enabled || !this.available) return;
        this.capture(); this.onChange();
    }
    readPose() {
        if (!this.pose) return null;
        return {
            x: this.pose.position.x,
            y: this.pose.position.y,
            z: this.pose.position.z,
            yaw: MathUtils.radToDeg(this.pose.rotation.y),
            pitch: MathUtils.radToDeg(this.pose.rotation.x),
        };
    }
    applyPose(next = {}) {
        if (!this.enabled || !this.pose) return false;
        for (const axis of ['x', 'y', 'z']) {
            const value = Number(next[axis]);
            if (Number.isFinite(value)) this.pose.position[axis] = value;
        }
        if (Number.isFinite(Number(next.yaw))) {
            this.pose.rotation.y = MathUtils.euclideanModulo(MathUtils.degToRad(Number(next.yaw)) + Math.PI, Math.PI * 2) - Math.PI;
        }
        if (Number.isFinite(Number(next.pitch))) {
            this.pose.rotation.x = MathUtils.clamp(MathUtils.degToRad(Number(next.pitch)), -MathUtils.degToRad(80), MathUtils.degToRad(80));
        }
        this.onChange();
        return true;
    }
    drag(dx, dy, width, height) {
        if (!this.enabled || !this.pose || ![dx, dy, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
        const rotation = this.pose.rotation;
        rotation.y = MathUtils.euclideanModulo(rotation.y + dx / width * Math.PI + Math.PI, Math.PI * 2) - Math.PI;
        rotation.x = MathUtils.clamp(rotation.x + dy / height * Math.PI, -MathUtils.degToRad(80), MathUtils.degToRad(80));
        this.onChange();
    }
    withCamera(camera, draw) {
        if (!this.enabled || !this.pose) return draw();
        const position = camera.position.clone(), quaternion = camera.quaternion.clone(), fov = camera.fov;
        try {
            camera.position.copy(this.pose.position);
            camera.quaternion.setFromEuler(this.pose.rotation);
            camera.fov = this.pose.fov;
            camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
            return draw();
        } finally {
            camera.position.copy(position); camera.quaternion.copy(quaternion); camera.fov = fov;
            camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        }
    }
}

export function cameraPoseFromObject(camera) {
    if (!camera?.position || !camera?.quaternion) return null;
    const rotation = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    return {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        yaw: MathUtils.radToDeg(rotation.y),
        pitch: MathUtils.radToDeg(rotation.x),
    };
}

export function actorPoseFromObject(object) {
    if (!object?.position || !object?.rotation) return null;
    return {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
        yaw: MathUtils.radToDeg(object.rotation.y),
    };
}

export function applyActorPose(object, pose) {
    if (!object?.position || !object?.rotation) return false;
    if (!pose) {
        object.position.set(0, 0, 0);
        object.rotation.set(0, 0, 0);
        object.updateMatrixWorld?.(true);
        return true;
    }
    const x = Number(pose.x);
    const y = Number(pose.y);
    const z = Number(pose.z);
    const yaw = Number(pose.yaw);
    if (![x, y, z, yaw].every(Number.isFinite)) return false;
    object.position.set(x, y, z);
    object.rotation.set(0, MathUtils.degToRad(yaw), 0);
    object.updateMatrixWorld?.(true);
    return true;
}

const FULL_FRAME_SENSOR_HEIGHT = 24;

export function focalLengthToFov(focal) {
    const mm = Number(focal);
    if (!Number.isFinite(mm) || mm <= 0) return null;
    return MathUtils.radToDeg(2 * Math.atan((FULL_FRAME_SENSOR_HEIGHT * 0.5) / mm));
}

export function applyCameraFocal(camera, focal) {
    const fov = focalLengthToFov(focal);
    if (!camera || fov == null) return false;
    camera.fov = fov;
    camera.updateProjectionMatrix?.();
    return true;
}

export function applyCameraPose(camera, pose) {
    const x = Number(pose?.x);
    const y = Number(pose?.y);
    const z = Number(pose?.z);
    const yaw = Number(pose?.yaw);
    const pitch = Number(pose?.pitch);
    if (!camera || ![x, y, z, yaw, pitch].every(Number.isFinite)) return false;
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.quaternion.setFromEuler(new Euler(
        MathUtils.degToRad(MathUtils.clamp(pitch, -80, 80)),
        MathUtils.degToRad(yaw),
        0,
        'YXZ',
    ));
    camera.updateMatrixWorld(true);
    return true;
}

export class LookDrag {
    start(id, x, y) {
        if (this.pointer) return false;
        this.pointer = { id, x, y, moved:false };
        return true;
    }
    move(id, x, y) {
        const pointer = this.pointer;
        if (!pointer || pointer.id !== id) return null;
        const dx = x - pointer.x, dy = y - pointer.y;
        if (!pointer.moved && Math.hypot(dx, dy) < 4) return null;
        pointer.x = x; pointer.y = y; pointer.moved = true;
        return [dx, dy];
    }
    end(id) { if (this.pointer?.id === id) this.cancel(); }
    cancel() { this.pointer = null; }
}
