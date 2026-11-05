// Hand-calibrated layouts live in frontend code so cached/R2 scene sidecars
// receive the same placement. Coordinates are source glTF metres, not stage units.
const COUNCILROOM_LAYOUT = {
    id: 'calibrated-councilroom',
    label: '学生会室 · 校准站位 / 通用中景',
    calibratedPlacement: {
        recordId: 'd8ce8929-f1df-4d95-8dd9-109984b00694',
        sourceScene: 'env_3d_adv_councilroom-00-00-noon',
        capturedAt: '2026-10-25T19:02:56.126Z',
        cameraSource: 'generic-medium',
    },
    actors: [{
        name: 'default',
        position: [-0.510161765174266, 0, -3.3639036242001246],
        forward: [-0.5299191174128671, 0, -0.8480481878999376],
        up: [0, 1, 0],
    }],
};

const DANCEROOM_LAYOUT = {
    id: 'calibrated-lesson-danceroom',
    label: '舞蹈室 · 校准站位 / 通用中景',
    calibratedPlacement: {
        recordId: '6a240c57-8d34-4c24-b9d2-aeaa661237d1',
        sourceScene: 'env_3d_lesson_danceroom-00-00-noon',
        capturedAt: '2026-10-25T19:23:08.646Z',
        cameraSource: 'generic-medium',
    },
    actors: [{
        name: 'default',
        position: [3.6299999999999994, 0, 0.6],
        forward: [1, 0, 6.123233995736766e-17],
        up: [0, 1, 0],
    }],
};

function withOriginalRelativeCamera(placement, base) {
    const actor = placement.actors[0];
    const oldActor = base.actors[0];
    const yaw = Math.atan2(actor.forward[0], actor.forward[2]) - Math.atan2(oldActor.forward[0], oldActor.forward[2]);
    const rotate = ([x, y, z]) => [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
    const move = point => rotate(point.map((v, i) => v - oldActor.position[i])).map((v, i) => v + actor.position[i]);
    // Keep the original generic framing and height adaptation. Rebase its
    // scene-space camera too, so lighting-volume selection follows the actor.
    const camera = structuredClone(base.camera);
    camera.position = move(camera.position);
    camera.forward = rotate(camera.forward);
    camera.up = [0, 1, 0];
    if (camera.target) camera.target = move(camera.target);
    delete camera.quaternion;
    return { ...structuredClone(placement), camera, genericShot: structuredClone(base.genericShot) };
}

const BEAT_STATION_OFFSETS = Object.freeze({ left: -0.8, center: 0, right: 0.8 });

/**
 * Build a Beat-only layout from a calibrated center pose. The captured actor
 * position remains the center station; the three Beat positions are small
 * lateral offsets in that actor's local frame. Each shot keeps the matching
 * exported generic camera, rebased to the selected station.
 */
export function calibratedBeatLayout(sidecar, layoutId, shot = 'medium', position = 'center') {
    const calibrated = sidecar?.layouts?.[layoutId];
    if (!calibrated?.actors?.[0]) return null;
    const key = ['medium', 'close', 'reaction'].includes(String(shot || '').trim()) ? String(shot).trim() : 'medium';
    const base = sidecar.layouts?.[`generic-${key}`] || sidecar.layouts?.['generic-medium'];
    if (!base?.actors?.[0]) return null;
    const anchor = calibrated.actors[0];
    const offset = BEAT_STATION_OFFSETS[String(position || '').trim().toLowerCase()] ?? 0;
    const lateral = [anchor.forward[2] * offset, 0, -anchor.forward[0] * offset];
    const actor = {
        ...structuredClone(anchor),
        position: anchor.position.map((value, index) => value + lateral[index]),
    };
    const layout = withOriginalRelativeCamera({
        ...structuredClone(calibrated),
        id: `${layoutId}-beat-${key}-${String(position || 'center').trim().toLowerCase()}`,
        actors: [actor],
    }, base);
    layout.beatStation = String(position || 'center').trim().toLowerCase();
    layout.beatShot = key;
    return layout;
}

function calibratedSceneLayout(sceneId) {
    if (sceneId === DANCEROOM_LAYOUT.calibratedPlacement.sourceScene) return DANCEROOM_LAYOUT;
    return /^env_3d_adv_councilroom-00-(?:00-(?:noon|evening|night)|01-(?:noon|evening))$/.test(String(sceneId || ''))
        ? COUNCILROOM_LAYOUT : null;
}

export function calibratedSceneLayoutId(sceneId) {
    return calibratedSceneLayout(sceneId)?.id || '';
}

export function withScenePlacementOverrides(sidecar) {
    const layout = calibratedSceneLayout(sidecar?.scene);
    if (!layout) return sidecar;
    const cameraSource = layout.calibratedPlacement.cameraSource;
    const base = cameraSource && sidecar.layouts?.[cameraSource];
    if (cameraSource && !base) return sidecar;
    const resolved = base ? withOriginalRelativeCamera(layout, base) : structuredClone(layout);
    return {
        ...sidecar,
        // Retain original layouts so older exported Stage records still restore.
        layouts: { ...sidecar.layouts, [layout.id]: resolved },
    };
}

export function defaultSceneLayoutId(sidecar, requestedLayout) {
    const calibrated = calibratedSceneLayoutId(sidecar?.scene);
    if ((!requestedLayout || requestedLayout === 'generic-medium') && sidecar?.layouts?.[calibrated]) return calibrated;
    return requestedLayout || Object.keys(sidecar?.layouts || {})[0];
}
