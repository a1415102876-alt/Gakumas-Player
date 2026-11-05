// Coarse scene-activity data for 3D blocking. Coordinates match scene.json
// layouts: glTF metres, Y up, Unity X already negated. Postprocess volumes
// are not collision. Drafts are shared by geometry family; time-of-day
// variants only differ by sky and lighting.

export const ACTIVITY_FORMAT = 'gakumas-scene-activity';

const TIME_SUFFIX = /-(morning|noon|evening|night|day|sunset|sunrise)$/i;

export function sceneFamilyId(sceneId, declaredFamily = '') {
    const declared = String(declaredFamily || '').trim();
    if (declared) return declared;
    return String(sceneId || '').replace(TIME_SUFFIX, '');
}

export function timeOfDay(sceneId) {
    const match = String(sceneId || '').match(TIME_SUFFIX);
    return match ? match[1].toLowerCase() : '';
}

function finite(value) {
    return Number.isFinite(Number(value));
}

function round(value, digits = 2) {
    const scale = 10 ** digits;
    return Math.round(Number(value) * scale) / scale;
}

function round3(point) {
    return point.map(value => round(value, 3));
}

function slug(value) {
    const text = String(value || 'obstacle')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/^-|-$/g, '');
    return text || 'obstacle';
}

function uniqueId(base, used) {
    let id = base || 'obstacle';
    let index = 2;
    while (used.has(id)) {
        id = `${base}-${index}`;
        index += 1;
    }
    used.add(id);
    return id;
}

function extent(mesh) {
    return [
        mesh.max[0] - mesh.min[0],
        mesh.max[1] - mesh.min[1],
        mesh.max[2] - mesh.min[2],
    ];
}

function areaXZ(mesh) {
    const [sx, , sz] = extent(mesh);
    return Math.abs(sx * sz);
}

function volume(mesh) {
    const [sx, sy, sz] = extent(mesh);
    return Math.abs(sx * sy * sz);
}

function meshCenter(mesh) {
    return [
        (mesh.min[0] + mesh.max[0]) / 2,
        (mesh.min[1] + mesh.max[1]) / 2,
        (mesh.min[2] + mesh.max[2]) / 2,
    ];
}

function keywordKind(name) {
    const text = String(name || '').toLowerCase();
    const kinds = [
        ['door', /door|tobira|ドア|扉/],
        ['desk', /desk|table|podium|tsukue|机|教卓|テーブル/],
        ['chair', /chair|stool|isu|椅|チェア/],
        ['window', /window|mado|窓/],
        ['stage', /stage|舞台/],
        ['bed', /bed|ベッド|布団/],
        ['mirror', /mirror|鏡/],
    ];
    return kinds.find(([, pattern]) => pattern.test(text))?.[0] || '';
}

const ANCHOR_ACTIONS = {
    door: ['enter', 'exit', 'door'],
    desk: ['stand', 'talk'],
    chair: ['sit', 'stand'],
    window: ['stand', 'talk'],
    stage: ['stand', 'perform'],
    bed: ['sit', 'stand'],
    mirror: ['stand', 'talk'],
    center: ['stand', 'talk'],
    stand: ['stand', 'talk'],
};

function rectPolygon(minX, minZ, maxX, maxZ) {
    return [
        [round(minX), round(minZ)],
        [round(maxX), round(minZ)],
        [round(maxX), round(maxZ)],
        [round(minX), round(maxZ)],
    ];
}

function pointInPolygon(x, z, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0];
        const zi = polygon[i][1];
        const xj = polygon[j][0];
        const zj = polygon[j][1];
        const hit = ((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-9) + xi);
        if (hit) inside = !inside;
    }
    return inside;
}

function distanceToSegment(x, z, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq <= 1e-9) return Math.hypot(x - ax, z - az);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq));
    return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

function distanceToPolygon(x, z, polygon) {
    let best = Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const next = polygon[(i + 1) % polygon.length];
        best = Math.min(best, distanceToSegment(x, z, polygon[i][0], polygon[i][1], next[0], next[1]));
    }
    return best;
}

function polygonBounds(polygon) {
    const xs = polygon.map(point => point[0]);
    const zs = polygon.map(point => point[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

function overlapsRect(mesh, rect, margin = 0) {
    return mesh.max[0] >= rect.minX - margin
        && mesh.min[0] <= rect.maxX + margin
        && mesh.max[2] >= rect.minZ - margin
        && mesh.min[2] <= rect.maxZ + margin;
}

function shrinkWalls(floor, meshes) {
    const width = floor.maxX - floor.minX;
    const depth = floor.maxZ - floor.minZ;
    for (const mesh of meshes) {
        const [sx, sy, sz] = extent(mesh);
        if (sy < 1.15) continue;
        const alongZ = sx < 0.6 && sz > depth * 0.45;
        const alongX = sz < 0.6 && sx > width * 0.45;
        if (alongZ && mesh.min[0] <= floor.minX + 0.9) floor.minX = Math.max(floor.minX, mesh.max[0]);
        if (alongZ && mesh.max[0] >= floor.maxX - 0.9) floor.maxX = Math.min(floor.maxX, mesh.min[0]);
        if (alongX && mesh.min[2] <= floor.minZ + 0.9) floor.minZ = Math.max(floor.minZ, mesh.max[2]);
        if (alongX && mesh.max[2] >= floor.maxZ - 0.9) floor.maxZ = Math.min(floor.maxZ, mesh.min[2]);
    }
    return floor;
}

function chooseFloor(meshes) {
    const flat = meshes.filter(mesh => {
        const [sx, , sz] = extent(mesh);
        if (sx * sz < 1.5) return false;
        if (/ceil|roof|lamp|light|sprinkler|air_|sky|window|wall|fence/i.test(mesh.name || '')) return false;
        if (mesh.max[1] > 1.2 || mesh.max[1] < -1) return false;
        return true;
    });
    if (flat.length) {
        const large = flat.filter(mesh => areaXZ(mesh) >= 4);
        const pool = large.length ? large : flat;
        const ground = Math.min(...pool.map(mesh => mesh.max[1]));
        const near = pool.filter(mesh => mesh.max[1] <= ground + 0.3 && mesh.max[1] >= ground - 0.05);
        const used = near.length ? near : pool;
        return {
            source: 'floor-mesh',
            minX: Math.min(...used.map(mesh => mesh.min[0])),
            maxX: Math.max(...used.map(mesh => mesh.max[0])),
            minZ: Math.min(...used.map(mesh => mesh.min[2])),
            maxZ: Math.max(...used.map(mesh => mesh.max[2])),
            height: round(Math.max(...used.map(mesh => mesh.max[1])), 3),
        };
    }
    const bottoms = meshes.map(mesh => mesh.min[1]).sort((a, b) => a - b);
    const height = bottoms[Math.min(bottoms.length - 1, Math.floor(bottoms.length * 0.15))] || 0;
    const footprint = meshes.filter(mesh => mesh.min[1] <= height + 0.8);
    const used = footprint.length ? footprint : meshes;
    return {
        source: 'footprint',
        minX: Math.min(...used.map(mesh => mesh.min[0])),
        maxX: Math.max(...used.map(mesh => mesh.max[0])),
        minZ: Math.min(...used.map(mesh => mesh.min[2])),
        maxZ: Math.max(...used.map(mesh => mesh.max[2])),
        height,
    };
}

function insetRect(floor, padding) {
    let pad = padding;
    let width = floor.maxX - floor.minX - pad * 2;
    let depth = floor.maxZ - floor.minZ - pad * 2;
    if (width < 0.8 || depth < 0.8) {
        pad = Math.max(0, Math.min(padding, (floor.maxX - floor.minX - 0.8) / 2, (floor.maxZ - floor.minZ - 0.8) / 2));
        width = floor.maxX - floor.minX - pad * 2;
        depth = floor.maxZ - floor.minZ - pad * 2;
    }
    if (width <= 0.2 || depth <= 0.2) {
        return {
            minX: floor.minX,
            maxX: floor.maxX,
            minZ: floor.minZ,
            maxZ: floor.maxZ,
            collapsed: true,
        };
    }
    return {
        minX: floor.minX + pad,
        maxX: floor.maxX - pad,
        minZ: floor.minZ + pad,
        maxZ: floor.maxZ - pad,
        collapsed: false,
    };
}

function boxFromMesh(mesh, id, padding) {
    const center = meshCenter(mesh);
    return {
        id,
        shape: 'box',
        name: mesh.name || id,
        center: round3(center),
        size: round3(extent(mesh).map(value => Math.max(0.05, value))),
        padding,
    };
}

function clampToRect(x, z, rect, radius) {
    return [
        Math.min(rect.maxX - radius, Math.max(rect.minX + radius, x)),
        Math.min(rect.maxZ - radius, Math.max(rect.minZ + radius, z)),
    ];
}

// Coarse boxes currently cover authored standing points. Keep the generated
// data, but do not let it move actors or block paths until the boxes are reviewed.
const ACTIVITY_BLOCK_BOXES_ENABLED = false;

function blockingBoxes(activity) {
    return ACTIVITY_BLOCK_BOXES_ENABLED ? (activity?.forbiddenAreas || []) : [];
}

function insideBox(x, z, box, radius = 0) {
    const pad = (box.padding || 0) + radius;
    return Math.abs(x - box.center[0]) <= box.size[0] / 2 + pad
        && Math.abs(z - box.center[2]) <= box.size[2] / 2 + pad;
}

function pushOutOfBoxes(x, z, boxes, radius) {
    let px = x;
    let pz = z;
    for (let pass = 0; pass < 3; pass++) {
        for (const box of boxes) {
            if (!insideBox(px, pz, box, radius)) continue;
            const hx = box.size[0] / 2 + (box.padding || 0) + radius;
            const hz = box.size[2] / 2 + (box.padding || 0) + radius;
            const dx = hx - Math.abs(px - box.center[0]);
            const dz = hz - Math.abs(pz - box.center[2]);
            if (dx < dz) px = box.center[0] + Math.sign(px - box.center[0] || 1) * (hx + 0.01);
            else pz = box.center[2] + Math.sign(pz - box.center[2] || 1) * (hz + 0.01);
        }
    }
    return [px, pz];
}

function layoutCameras(layouts) {
    return Object.entries(layouts || {})
        .filter(([id, layout]) => layout?.camera && (/^(generic-|home-)/.test(id) || id === 'overview'))
        .slice(0, 4)
        .map(([id, layout]) => ({
            id,
            type: 'box',
            center: round3(layout.camera.position),
            size: [2.4, 1.8, 2.4],
            target: 'center',
            shots: [layout.shot || (id.includes('close') ? 'close' : id.includes('reaction') ? 'reaction' : 'medium')],
        }));
}

function anchorFromLayout(id, layout, rect, used) {
    const actor = layout?.actor;
    if (!actor?.position) return null;
    const [x, z] = clampToRect(actor.position[0], actor.position[2], rect, 0.05);
    return {
        id: uniqueId(id === 'generic-medium' ? 'stand' : slug(id), used),
        position: round3([x, rect.height, z]),
        facing: round3(actor.forward || [0, 0, 1]),
        actions: ['stand', 'talk'],
        source: 'layout',
    };
}

export function buildActivityDraft(meshes, options = {}) {
    const sceneId = options.sceneId || 'scene';
    const clearance = Number.isFinite(options.clearance) ? options.clearance : 0.45;
    const usable = (meshes || []).filter(mesh => mesh?.min && mesh?.max && extent(mesh).every(finite));
    const structural = usable.filter(mesh => {
        const [sx, sy, sz] = extent(mesh);
        const maxDim = Math.max(sx, sy, sz);
        return maxDim <= 32 && sx * sz <= 800 && !/sky|skydome|lightprobe|reflectionprobe/i.test(mesh.name || '');
    });
    const sourceMeshes = structural.length ? structural : usable;
    if (!sourceMeshes.length) {
        return {
            sceneId,
            status: 'draft',
            precision: 'empty',
            tier: 'dialogue',
            space: 'scene',
            floorHeight: 0,
            clearance,
            walkableAreas: [{ id: 'main-floor', type: 'floor', polygon: rectPolygon(-0.6, -0.6, 0.6, 0.6), height: 0 }],
            forbiddenAreas: [],
            anchors: [{ id: 'center', position: [0, 0, 0], facing: [0, 0, 1], actions: ['stand', 'talk'], source: 'fallback' }],
            cameraZones: [],
            occluders: [],
            routes: [],
            limits: { unsuitableMotions: ['run', 'jump', 'climb'], clipRisks: [], floorSource: 'empty' },
        };
    }

    const rawFloor = chooseFloor(sourceMeshes);
    const floor = shrinkWalls({ ...rawFloor }, sourceMeshes);
    const shrunkTooFar = (afterMin, afterMax, beforeMin, beforeMax) => {
        const before = beforeMax - beforeMin;
        const after = afterMax - afterMin;
        return after < 1.2 || (before > 2 && after < before * 0.6);
    };
    if (shrunkTooFar(floor.minX, floor.maxX, rawFloor.minX, rawFloor.maxX)) {
        floor.minX = rawFloor.minX;
        floor.maxX = rawFloor.maxX;
    }
    if (shrunkTooFar(floor.minZ, floor.maxZ, rawFloor.minZ, rawFloor.maxZ)) {
        floor.minZ = rawFloor.minZ;
        floor.maxZ = rawFloor.maxZ;
    }
    const rect = insetRect(floor, clearance);
    rect.height = floor.height;
    const polygon = rectPolygon(rect.minX, rect.minZ, rect.maxX, rect.maxZ);
    const walk = {
        minX: Math.min(rect.minX, rect.maxX),
        maxX: Math.max(rect.minX, rect.maxX),
        minZ: Math.min(rect.minZ, rect.maxZ),
        maxZ: Math.max(rect.minZ, rect.maxZ),
    };
    const walkArea = Math.max(0, (walk.maxX - walk.minX) * (walk.maxZ - walk.minZ));
    const used = new Set(['center']);
    const obstacles = sourceMeshes
        .filter(mesh => {
            const [sx, sy, sz] = extent(mesh);
            if (sy < 0.35) return false;
            if (sx * sz > walkArea * 0.55) return false;
            if (!overlapsRect(mesh, walk, 0.15)) return false;
            return mesh.max[1] > floor.height + 0.2 && mesh.min[1] < floor.height + 1.7;
        })
        .sort((a, b) => volume(b) - volume(a))
        .slice(0, 16);

    const forbiddenAreas = obstacles.map(mesh => boxFromMesh(mesh, uniqueId(`block-${slug(mesh.name)}`, used), 0.25));
    const occluders = sourceMeshes
        .filter(mesh => extent(mesh)[1] > 1.15 && overlapsRect(mesh, walk, 0.4) && areaXZ(mesh) < walkArea * 0.7)
        .sort((a, b) => extent(b)[1] - extent(a)[1])
        .slice(0, 8)
        .map(mesh => {
            const box = boxFromMesh(mesh, uniqueId(`occluder-${slug(mesh.name)}`, used), 0);
            delete box.padding;
            return box;
        });

    const center = [(walk.minX + walk.maxX) / 2, floor.height, (walk.minZ + walk.maxZ) / 2];
    const anchors = [{
        id: 'center',
        position: round3(center),
        facing: [0, 0, 1],
        actions: ['stand', 'talk'],
        source: 'walkable-center',
    }];
    for (const [id, layout] of Object.entries(options.layouts || {})) {
        if (!/^(generic-|home-)/.test(id)) continue;
        const anchor = anchorFromLayout(id, layout, { ...walk, height: floor.height }, used);
        if (anchor) anchors.push(anchor);
    }
    const seenKinds = new Set();
    for (const mesh of sourceMeshes) {
        const kind = keywordKind(mesh.name);
        if (!kind || seenKinds.has(kind)) continue;
        if (!overlapsRect(mesh, walk, 0.8)) continue;
        seenKinds.add(kind);
        const [x, z] = clampToRect(meshCenter(mesh)[0], meshCenter(mesh)[2], walk, 0.2);
        anchors.push({
            id: uniqueId(kind, used),
            position: round3([x, floor.height, z]),
            facing: [0, 0, 1],
            actions: ANCHOR_ACTIONS[kind],
            source: 'mesh-name',
        });
    }

    const cameraZones = layoutCameras(options.layouts);
    if (!cameraZones.length) {
        cameraZones.push({
            id: 'conversation-main',
            type: 'box',
            center: round3([center[0], floor.height + 1.45, center[2] + Math.min(2.4, (walk.maxZ - walk.minZ) / 2)]),
            size: [2.4, 1.8, 2.4],
            target: 'center',
            shots: ['medium'],
        });
    }
    cameraZones.push({
        id: 'follow-medium',
        type: 'box',
        center: round3([center[0], floor.height + 1.45, center[2]]),
        size: round3([Math.max(1.5, walk.maxX - walk.minX), 2.2, Math.max(1.5, walk.maxZ - walk.minZ)]),
        target: 'center',
        shots: ['follow-medium'],
    });
    if (Math.min(walk.maxX - walk.minX, walk.maxZ - walk.minZ) > 2.2) {
        cameraZones.push({
            id: 'conversation-duo',
            type: 'box',
            center: round3([walk.minX + (walk.maxX - walk.minX) * 0.72, floor.height + 1.35, center[2]]),
            size: [2.2, 1.6, 2.2],
            target: 'center',
            shots: ['two-shot', 'medium'],
        });
    }

    const draftForSnap = {
        walkableAreas: [{ polygon, height: floor.height }],
        forbiddenAreas,
    };
    for (const anchor of anchors) {
        const safe = nearestSafePoint(draftForSnap, anchor.position, Math.min(0.2, clearance));
        anchor.position = [safe[0], round(floor.height, 3), safe[2]];
    }

    const routes = [];
    for (const anchor of anchors) {
        if (anchor.id === 'center') continue;
        const clear = pathIsClear({
            walkableAreas: [{ polygon, height: floor.height }],
            forbiddenAreas,
        }, center, anchor.position, 0.2);
        routes.push({ from: 'center', to: anchor.id, motion: 'walk', clear });
    }

    const shortSide = Math.min(walk.maxX - walk.minX, walk.maxZ - walk.minZ);
    const unsuitableMotions = ['jump', 'climb'];
    if (shortSide < 3.2 || walkArea < 18) unsuitableMotions.unshift('run');
    const tier = walkArea >= 28 ? 'walkable' : 'dialogue';

    return {
        sceneId,
        status: 'draft',
        precision: 'coarse',
        tier,
        space: 'scene',
        floorHeight: round(floor.height, 3),
        clearance,
        walkableAreas: [{ id: 'main-floor', type: 'floor', polygon, height: round(floor.height, 3) }],
        forbiddenAreas,
        anchors,
        cameraZones,
        occluders,
        routes,
        limits: {
            unsuitableMotions,
            clipRisks: forbiddenAreas.map(box => box.id),
            floorSource: floor.source,
            walkableCollapsed: rect.collapsed,
            narrow: shortSide < 1.5,
        },
    };
}

export function validateActivity(activity) {
    const errors = [];
    if (!activity || typeof activity !== 'object') return ['缺少活动区域'];
    if (!activity.sceneId) errors.push('缺少场景 ID');
    if (!Array.isArray(activity.walkableAreas) || activity.walkableAreas.length < 1) errors.push('缺少可走区域');
    for (const area of activity.walkableAreas || []) {
        if (!Array.isArray(area.polygon) || area.polygon.length < 3) errors.push(`可走区域 ${area.id || ''} 缺少多边形`);
        else if (area.polygon.some(point => !Array.isArray(point) || point.length < 2 || !point.every(finite))) errors.push(`可走区域 ${area.id || ''} 坐标无效`);
    }
    for (const box of [...(activity.forbiddenAreas || []), ...(activity.occluders || []), ...(activity.cameraZones || [])]) {
        if (!Array.isArray(box.center) || box.center.length < 3 || !box.center.every(finite)) errors.push(`区域 ${box.id || ''} 中心无效`);
        if (!Array.isArray(box.size) || box.size.length < 3 || box.size.some(value => !finite(value) || value < 0)) errors.push(`区域 ${box.id || ''} 尺寸无效`);
    }
    const anchorIds = new Set();
    for (const anchor of activity.anchors || []) {
        if (!anchor.id) errors.push('锚点缺少 ID');
        if (anchorIds.has(anchor.id)) errors.push(`锚点重复 ${anchor.id}`);
        anchorIds.add(anchor.id);
        if (!Array.isArray(anchor.position) || anchor.position.length < 3 || !anchor.position.every(finite)) errors.push(`锚点 ${anchor.id || ''} 坐标无效`);
    }
    return errors;
}

export function activityForScene(manifest, sceneId) {
    const ref = manifest?.scenes?.[sceneId];
    const family = manifest?.families?.[ref?.family];
    if (!family?.activity) return null;
    return { ...family.activity, sceneId, family: ref.family, timeOfDay: ref.timeOfDay || '' };
}

export function findAnchor(activity, anchorId) {
    return activity?.anchors?.find(anchor => anchor.id === anchorId) || null;
}

export function checkAnchorPlan(activity, plan = {}) {
    const anchorId = plan.anchor || plan.to;
    const anchor = findAnchor(activity, anchorId);
    if (!anchor) return { ok: false, reason: '锚点不属于当前场景' };
    const action = plan.action || '';
    const movement = action.startsWith('walk-to') || action === 'walk' || plan.motion === 'walk';
    if (!movement && action && Array.isArray(anchor.actions) && anchor.actions.length && !anchor.actions.includes(action)) {
        return { ok: false, reason: '动作不能在该锚点使用' };
    }
    return { ok: true, anchor };
}

export function pointInWalkable(activity, point, radius = 0) {
    const x = point?.[0];
    const z = point?.[2] ?? point?.[1];
    if (!finite(x) || !finite(z)) return false;
    const areas = activity?.walkableAreas || [];
    const inside = areas.some(area => pointInPolygon(x, z, area.polygon) && (radius <= 0 || distanceToPolygon(x, z, area.polygon) + 1e-6 >= radius));
    if (!inside) return false;
    return !blockingBoxes(activity).some(box => insideBox(x, z, box, radius));
}

function segmentHitsRect(x0, z0, x1, z1, minX, minZ, maxX, maxZ) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    let t0 = 0;
    let t1 = 1;
    const clip = (p, q) => {
        if (Math.abs(p) < 1e-9) return q >= 0;
        const t = q / p;
        if (p < 0) {
            if (t > t1) return false;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return false;
            if (t < t1) t1 = t;
        }
        return true;
    };
    return clip(-dx, x0 - minX) && clip(dx, maxX - x0) && clip(-dz, z0 - minZ) && clip(dz, maxZ - z0);
}

export function segmentHitsBox(from, to, box, radius = 0) {
    const pad = (box.padding || 0) + radius;
    const minX = box.center[0] - box.size[0] / 2 - pad;
    const maxX = box.center[0] + box.size[0] / 2 + pad;
    const minZ = box.center[2] - box.size[2] / 2 - pad;
    const maxZ = box.center[2] + box.size[2] / 2 + pad;
    return segmentHitsRect(from[0], from[2], to[0], to[2], minX, minZ, maxX, maxZ);
}

export function pathIsClear(activity, from, to, radius = 0.35) {
    if (!pointInWalkable(activity, from, radius) || !pointInWalkable(activity, to, radius)) return false;
    return !blockingBoxes(activity).some(box => segmentHitsBox(from, to, box, radius));
}

export function nearestSafePoint(activity, point, radius = 0.35) {
    const area = activity?.walkableAreas?.[0];
    if (!area?.polygon?.length) return point;
    const bounds = polygonBounds(area.polygon);
    const inset = {
        minX: bounds.minX + radius,
        maxX: bounds.maxX - radius,
        minZ: bounds.minZ + radius,
        maxZ: bounds.maxZ - radius,
    };
    if (inset.maxX <= inset.minX || inset.maxZ <= inset.minZ) {
        return [round((bounds.minX + bounds.maxX) / 2, 3), point[1], round((bounds.minZ + bounds.maxZ) / 2, 3)];
    }
    let [x, z] = clampToRect(point[0], point[2], inset, 0);
    [x, z] = pushOutOfBoxes(x, z, blockingBoxes(activity), radius);
    [x, z] = clampToRect(x, z, inset, 0);
    if (!pointInWalkable(activity, [x, point[1], z], radius)) {
        x = (bounds.minX + bounds.maxX) / 2;
        z = (bounds.minZ + bounds.maxZ) / 2;
    }
    return [round(x, 3), point[1], round(z, 3)];
}
