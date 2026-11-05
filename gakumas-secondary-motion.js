export const QUARTZ_HAIR = 'ActorAnimationQuartzDriverHairBone';
export const QUARTZ_SKIRT = 'ActorAnimationQuartzDriverSkirtBone';
export const QUARTZ_ROTATION = 'ActorAnimationQuartzDriverRotationBone';
export const QUARTZ_HUMANOID_ARM = 'ActorAnimationQuartzDriverHumanoidArmBone';
export const QUARTZ_HUMANOID_HAND = 'ActorAnimationQuartzDriverHumanoidHandBone';
export const QUARTZ_HUMANOID_UPLEG = 'ActorAnimationQuartzDriverHumanoidUpLegBone';
export const APPLY_SPRING_ANGLE_LIMITS = true;
export const APPLY_SKIRT_QUARTZ_LIMITS = false;
export const APPLY_SKIRT_INNER_OUTER = false;
// FKTN has skirt Quartz drivers, but no corresponding jacket/Poncho driver.
// The jacket is authored as its own DynamicBone network; copying the skirt's
// UpLeg correction into Jacket3 breaks the authored chain continuity.
export const APPLY_JACKET_SKIRT_FOLLOW = false;
export const RECOVERED_PHYSICS_ALGORITHM = 'gakumas-runtime-recovered-v1';
// ActorSwing's ordinary Step uses a fixed 0.01667 second budget. The render
// frame rate controls how often the job is called, not the size of this
// budget. Keep this value in one place so the stage cannot silently fall back
// to render delta time.
export const NATIVE_FIXED_STEP = 1 / 60;
export const NATIVE_STEP_SCALE = 40;
// ActorSwingChain is solved together with fixed-length bone tails. Applying
// the entire ring correction in one pass makes a small radius change turn
// into a large bone rotation, so carry the correction into subsequent frames.
export const CHAIN_SEPARATION_RESPONSE = 0.35;
export const DEFAULT_SECONDARY_TUNING = Object.freeze({
    gravity: 1,
    damping: 1,
    spring: 1,
    stiffness: 1,
    physics: 1,
    rootFollow: 1,
    chainSkirtRadius: 1,
    chainJacketRadius: 1,
    chainGap: 0,
    chainOrder: 'after-collision',
});

export function chainLayerKind(layer) {
    const name = layer?.bones?.[0] || layer?.items?.[0]?.record?.bone || '';
    if (/Skirt/i.test(name)) return 'skirt';
    if (/Jacket/i.test(name)) return 'jacket';
    return 'other';
}

export function chainLayerMinimumDistance(layer, scale = 1, tuning = DEFAULT_SECONDARY_TUNING) {
    const kind = chainLayerKind(layer);
    const radiusScale = kind === 'skirt'
        ? Number(tuning.chainSkirtRadius)
        : kind === 'jacket'
            ? Number(tuning.chainJacketRadius)
            : 1;
    const safeScale = Number.isFinite(Number(scale)) ? Math.max(0, Number(scale)) : 1;
    const safeRadiusScale = Number.isFinite(radiusScale) ? Math.max(0, radiusScale) : 1;
    const gap = Number.isFinite(Number(tuning.chainGap)) ? Math.max(0, Number(tuning.chainGap)) : 0;
    return (2 * Math.max(0, Number(layer?.radius) || 0) * safeRadiusScale + gap) * safeScale;
}

export function nativeChainCollisionRadius(link, firstBone, secondBone, colliderBone, scaleFactor = 1, table = null) {
    const base = Math.max(Number(link?.radiusA) || 0, Number(link?.radiusB) || 0);
    // Around-chain links can connect the last particle on one side of the
    // skirt to the first particle on the other side. Treat the link as
    // belonging to either side for a thigh contact; choosing only the first
    // endpoint would make the right half of a cross-front link miss its own
    // thigh-specific shell scaling.
    const skirtBones = [firstBone, secondBone].filter(name => /Skirt/i.test(name || ''));
    const colliderSide = driverSide(colliderBone);
    const sameSideThigh = skirtBones.some(skirtBone =>
        skirtThighCollider(skirtBone, colliderBone)
        && driverSide(skirtBone) === colliderSide);
    const profileScale = Number(table?.nativeSkirtThighCollisionRadiusScale);
    const scale = sameSideThigh && Number.isFinite(profileScale)
        ? clampAxis(profileScale, 0.5, 2)
        : 1;
    return Math.max(0, base * scale * Math.max(0, Number(scaleFactor) || 0));
}

export function clampAxis(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function scaleAndClampEuler(source, coefficient, min, max) {
    const values = Array.isArray(source) ? source : [0, 0, 0];
    const scale = Array.isArray(coefficient) ? coefficient : [0, 0, 0];
    const low = Array.isArray(min) ? min : [-180, -180, -180];
    const high = Array.isArray(max) ? max : [180, 180, 180];
    return [0, 1, 2].map(index => clampAxis((values[index] || 0) * (scale[index] || 0), low[index] ?? -180, high[index] ?? 180));
}

export function driverSide(boneName) {
    if (/^Right/.test(boneName || '')) return 'right';
    if (/^Left/.test(boneName || '')) return 'left';
    return 'center';
}

const LEG_COLLIDER_NAME = /^(Left|Right)(UpLeg|Leg|Foot|ToeBase)\b/;
const HAIR_BONE_NAME = /Hair/i;

export function shouldUseNativeParticleHairLimit(record, table = null) {
    if (table?.nativeParticleHairLimits !== true || record?.part !== 'hair' || !HAIR_BONE_NAME.test(record?.bone || '')) return false;
    const excluded = table?.nativeParticleHairLimitExcludeBones;
    return !(Array.isArray(excluded) && excluded.includes(record?.bone || ''));
}

export function shouldPreserveHairRestTail(boneName, table = null) {
    if (table?.hairRestTailMode === 'braid-only') {
        const name = boneName || '';
        return /^(?:Left|Right)(?:SideHair|SideBackCHair)/i.test(name) && !/Front/i.test(name);
    }
    if (table?.hairRestTailMode === 'braid-and-back') {
        const name = boneName || '';
        return /(?:SideHair|SideBackCHair|BackHair|BackSideHair|BackUHair)/i.test(name)
            && !/Front/i.test(name);
    }
    return HAIR_BONE_NAME.test(boneName || '');
}

export function gravityScaleForSpring(record, table = null, tuning = DEFAULT_SECONDARY_TUNING) {
    const partGravity = table?.gravityScaleByPart?.[record?.part];
    const base = Number.isFinite(Number(partGravity))
        ? Number(partGravity)
        : Number(tuning.gravity ?? 1) * Number(tuning.physics ?? 1);
    const name = record?.bone || '';
    // The recovered back-hair rest tail already points along world down. Keep
    // its authored sag, but avoid applying the full generic hair gravity a
    // second time to the long rear chains. This is a profile-level correction
    // because the native spring parameters remain shared and untouched.
    const isBackHairGroup = /(?:SideBackCHair|BackSideHair|BackSideCHair|BackUHair)/i.test(name)
        || /(?:^|(?:Center|Left|Right))BackHair/i.test(name);
    const group = /Skirt/i.test(name)
        ? 'skirt'
        : isBackHairGroup && !/Front/i.test(name)
            ? 'backHair'
            : null;
    const groupScale = group ? table?.gravityScaleByBoneGroup?.[group] : null;
    const grouped = base * (groupScale != null && Number.isFinite(Number(groupScale)) ? Number(groupScale) : 1);
    const boneScale = table?.gravityScaleByBone?.[name];
    return grouped * (boneScale != null && Number.isFinite(Number(boneScale)) ? Number(boneScale) : 1);
}

export function pendulumGravityFactor(record, tailRecord = null, table = null) {
    const reference = Number(table?.hairGravityFromPendulum?.reference);
    if (!(reference > 0) || record?.part !== 'hair') return 1;
    const pendulum = Number(tailRecord?.pendulum ?? record?.pendulum);
    if (!Number.isFinite(pendulum)) return 1;
    return clampAxis(pendulum / reference, 0, 1);
}

export function seedsInitialRotationOffset(record, table = null) {
    return !(table?.skipHairInitialRotationOffset === true && record?.part === 'hair');
}

const THIGH_COLLIDER_NAME = /^(Left|Right)(UpLeg|Leg)$/;

export function skirtThighCollider(particleBone, colliderBone) {
    // The skirt hem uses a separate layer-follow correction in the native
    // job, so its dynamic radius is not added to the thigh capsule. The
    // jacket is intentionally allowed to keep its particle thickness here;
    // that is the small outward shell visible around the jacket in-game.
    return /Skirt/i.test(particleBone || '') && THIGH_COLLIDER_NAME.test(colliderBone || '');
}

export function staticParticleRadius(particleBone, particleRadius, scale = 1) {
    // Skirt particles already receive the native thigh-follow correction and
    // their authored radius is not used as an extra shell against the body's
    // static colliders. Keeping it here balloons the hem (including Kotone).
    if (/Skirt/i.test(particleBone || '')) return 0;
    return Math.max(0, Number(particleRadius) || 0) * Math.max(0, Number(scale) || 0);
}

/**
 * Static-collider thickness of the particle at a spring's tail.
 * Skirts can opt into the native tail particle radius because their frill
 * reaches past the spring segment while sitting.
 */
export function springStaticParticleRadius(record, tailRecord, table = null, scale = 1) {
    if (/Skirt/i.test(record?.bone || '') && table?.skirtStaticParticleRadius === 'tail-particle') {
        const tail = Number(tailRecord?.particleRadius);
        const radius = Number.isFinite(tail) && tail >= 0 ? tail : Number(record?.particleRadius) || 0;
        return Math.max(0, radius) * Math.max(0, Number(scale) || 0);
    }
    // ActorAnimationSwingSolver builds a node on the current bone but reads
    // its collisionRadius from the first non-zero child setting. The native
    // hair roots therefore use the child particle radius as well; using the
    // attached root's 0.05 m shell creates a false Head_Face hit and pushes
    // HairSide1/SideHair1 forward in the Stage.
    if (record?.part === 'hair' && tailRecord && tailRecord !== record) {
        const tail = Number(tailRecord.particleRadius);
        if (Number.isFinite(tail) && tail >= 0) return tail * Math.max(0, Number(scale) || 0);
    }
    // ActorAnimationSwingSolver uses the first valid child setting for every
    // dynamic node, not only hair. Exported roots can be broad authoring
    // envelopes (for example 0.05 m on Lilia's bow roots), while the child
    // radius is the actual runtime collision shell (0.012-0.02 m).
    if (tailRecord && tailRecord !== record) {
        const tail = Number(tailRecord.particleRadius);
        if (Number.isFinite(tail) && tail >= 0) return tail * Math.max(0, Number(scale) || 0);
    }
    return staticParticleRadius(record?.bone, record?.particleRadius, scale);
}

/**
 * Return the particle shell for one static collider query.
 *
 * Unity supplies the current node's child collisionRadius to every body
 * collider. Some PMX outfits have a deliberately loose authored hem, so
 * applying that radius to the hips and torso makes the whole skirt balloon
 * forward. A profile can therefore scope the recovered skirt shell to the
 * colliders that were actually observed to protect the legs.
 */
export function springStaticParticleRadiusForCollider(record, tailRecord, colliderRecord, table = null, scale = 1) {
    if (/Skirt/i.test(record?.bone || '') && table?.skirtStaticParticleRadius === 'tail-particle') {
        const particles = table.skirtStaticParticleRadiusParticles;
        const colliders = table.skirtStaticParticleRadiusColliders;
        if ((Array.isArray(particles) && !particles.includes(record?.bone || ''))
            || (Array.isArray(colliders) && !colliders.includes(colliderRecord?.bone || ''))) {
            return 0;
        }
        // A hem can retain its full authored thickness while upper skirt
        // segments keep their existing profile-specific shell scale.
        const authoredScale = Number(table.skirtStaticParticleRadiusScaleByParticle?.[record?.bone]
            ?? table.skirtStaticParticleRadiusScale);
        const radiusScale = Number.isFinite(authoredScale) ? Math.max(0, authoredScale) : 1;
        return springStaticParticleRadius(record, tailRecord, table, scale) * radiusScale;
    }
    const particleRadius = springStaticParticleRadius(record, tailRecord, table, scale);
    const rule = table?.hairStaticCollisionMargin;
    if (rule && record?.part === 'hair') {
        const particles = Array.isArray(rule.particles) ? rule.particles : [];
        const colliders = Array.isArray(rule.colliders) ? rule.colliders : [];
        const particleMatches = !particles.length || particles.includes(record?.bone || '');
        const colliderMatches = !colliders.length || colliders.includes(colliderRecord?.bone || '');
        const margin = Number(rule.meters);
        if (particleMatches && colliderMatches && Number.isFinite(margin) && margin > 0) {
            return particleRadius + margin * Math.max(0, Number(scale) || 0);
        }
    }
    return particleRadius;
}

export function usesRenderedChildCollision(record, table = null) {
    const bones = table?.hairCollisionAtRenderedChild?.bones;
    return Array.isArray(bones) && record?.part === 'hair' && bones.includes(record?.bone || '');
}

export function tailFromRenderedCorrection(origin, tail, renderedBefore, renderedAfter, restLength) {
    const turn = quatFromTo(sub(renderedBefore, origin), sub(renderedAfter, origin));
    return constrainLength(origin, add(origin, quatRotate(turn, sub(tail, origin))), restLength);
}

export function skipsContralateralLegCollider(particleBone, colliderBone) {
    if (!LEG_COLLIDER_NAME.test(colliderBone || '')) return false;
    const particle = driverSide(particleBone);
    const collider = driverSide(colliderBone);
    return particle !== 'center' && collider !== 'center' && particle !== collider;
}

/**
 * A chain capsule can have endpoints on both sides of the body (the front
 * skirt ring is the common case). Skip a leg only when every skirt endpoint
 * is contralateral; one same-side endpoint still gives the segment a valid
 * contact with that leg.
 */
export function skipsContralateralLegChainCollider(firstBone, secondBone, colliderBone) {
    return skipsContralateralLegCollider(firstBone, colliderBone)
        && skipsContralateralLegCollider(secondBone, colliderBone);
}

export function skipsHairSpineCollider(particleBone, colliderBone, table = null) {
    // Default Kotone braid-root rule. Other idols override via
    // table.hairSpineColliderSkip so SideHair1 is not forced onto every model.
    const override = table?.hairSpineColliderSkip;
    if (override && Array.isArray(override.particles) && override.particles.length) {
        const colliders = Array.isArray(override.colliders) && override.colliders.length
            ? override.colliders
            : ['Spine2', 'Spine02', 'Neck'];
        return override.particles.includes(particleBone || '')
            && colliders.includes(colliderBone || '');
    }
    // The recovered game path already carries the native mask for every
    // particle/collider pair. Do not add the old SideHair root exemption on
    // top of that input: it makes the first HairSide segment bypass the
    // authored neck/chest capsules while its children still collide.
    if (table?.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM) return false;
    // Native capture separates the attached braid root from its tail: the
    // SideHair1 node is the anchor, while SideHair2..8 use mask 8, matching
    // the Neck and Spine2 static colliders. Only the root must avoid a
    // projection that would move the whole braid sideways; descendants need
    // the torso collision to be carried toward the front of the body.
    return /^(Left|Right)SideHair1_S$/.test(particleBone || '')
        && /^(Spine2|Spine02|Neck)$/.test(colliderBone || '');
}

export function skipsHairRootFaceCollider(particleBone, colliderBone) {
    // SideHair roots must be constrained by the authored head capsule too.
    // The old root exemption made the first segment bypass Head_Face while
    // SideHair2+ still collided with it, producing a discontinuous chain.
    return false;
}

export function skipsConfiguredHairRootCollider(particleBone, colliderBone, table = null) {
    const configured = table?.hairRootColliderSkip;
    const rules = Array.isArray(configured) ? configured : [configured];
    return rules.some(rule => !!rule
        && Array.isArray(rule.particles) && rule.particles.includes(particleBone || '')
        && Array.isArray(rule.colliders) && rule.colliders.includes(colliderBone || ''));
}

export function skipsConfiguredHairStaticCollider(record, colliderRecord, table = null) {
    const rule = table?.hairStaticColliderSkip;
    if (!rule || record?.part !== 'hair') return false;
    // The HSKI profile keeps the large Spine2 mask-16 collider away from
    // attached side-hair strands. Its 0.3 m radius is a torso volume, not a
    // surface shell for the side-hair tail; allowing the tail through it
    // projects the whole chain outward from the head.
    const colliders = Array.isArray(rule.colliders) ? rule.colliders : [];
    const masks = Array.isArray(rule.masks) ? rule.masks.map(value => Number(value) | 0) : [];
    return (!colliders.length || colliders.includes(colliderRecord?.bone || ''))
        && (!masks.length || masks.includes(Number(colliderRecord?.collisionMask) | 0));
}

export function skipsConfiguredStaticCollisionPair(record, colliderRecord, table = null) {
    const rule = table?.staticCollisionSkipPairs;
    if (!rule || !record?.bone || !colliderRecord?.bone) return false;
    const particles = Array.isArray(rule.particles) ? rule.particles : [];
    const colliders = Array.isArray(rule.colliders) ? rule.colliders : [];
    return (!particles.length || particles.includes(record.bone))
        && (!colliders.length || colliders.includes(colliderRecord.bone));
}

export function hasStaticSpringCollision(record, table = null) {
    const ignoredBones = table?.staticCollisionIgnoreBones;
    if (Array.isArray(ignoredBones) && ignoredBones.includes(record?.bone || '')) return false;
    return (Number(record?.collisionMask) | 0) !== 0;
}

export function skipsLargeSpineSkirtCollider(particleBone, colliderBone, colliderMask) {
    return /Skirt/.test(particleBone || '') && colliderBone === 'Spine2' && (colliderMask | 0) === 16;
}

export function isHairVolumeCollider(record) {
    // A long Spine2 capsule is still a body/chest collider in the native
    // capture. Its size and mask do not turn it into a hair envelope. Only an
    // explicit stage profile may opt into the special inside-volume rule.
    return record?.collisionMode === 'hairVolume';
}

function dynamicRecordMask(record) {
    const direct = Number(record?.collisionMask);
    if (Number.isFinite(direct)) return direct | 0;
    return Number(record?.dynamicCollider?.collisionMask) | 0;
}

function dynamicRecordType(record) {
    const direct = Number(record?.colliderType);
    if (Number.isFinite(direct)) return direct;
    return Number(record?.dynamicCollider?.type) || 0;
}

function dynamicRecordRadius(record) {
    const direct = Number(record?.particleRadius);
    if (Number.isFinite(direct) && direct >= 0) return direct;
    return Number(record?.dynamicCollider?.radiusA) || 0;
}

export function colliderGeometryMoved(current, previous, threshold = 1e-5) {
    if (!Array.isArray(current) || !Array.isArray(previous) || current.length !== previous.length) return false;
    return current.some((collider, index) => {
        const before = previous[index];
        if (!before) return true;
        const points = [collider.start, collider.end, before.start, before.end];
        if (points.some(point => !Array.isArray(point) || point.length < 3)) return false;
        return Math.max(
            vecLength(sub(collider.start, before.start)),
            vecLength(sub(collider.end, before.end)),
        ) > threshold;
    });
}

/**
 * Native dynamic colliders use separate layer masks for the clothing and hair
 * particles. Only the captured hair/jacket path is retained here.
 * Skirt/jacket dynamic pairs are intentionally excluded: the recovered
 * 5573E010 path consumes staticBones, while projecting two live clothing
 * chains would move a parent and then project its descendants again.
 */
export function dynamicParticlePairAllowed(firstRecord, secondRecord) {
    const firstBone = firstRecord?.bone || '';
    const secondBone = secondRecord?.bone || '';
    if (dynamicRecordType(firstRecord) === 4 || dynamicRecordType(secondRecord) === 4) return false;
    if (!masksOverlap(dynamicRecordMask(firstRecord), dynamicRecordMask(secondRecord))) return false;
    const firstHair = /Hair/i.test(firstBone);
    const secondHair = /Hair/i.test(secondBone);
    const firstSkirt = /Skirt/i.test(firstBone);
    const secondSkirt = /Skirt/i.test(secondBone);
    const firstJacket = /Jacket/i.test(firstBone);
    const secondJacket = /Jacket/i.test(secondBone);
    const jacketSkirtPair = (firstJacket && secondSkirt) || (secondJacket && firstSkirt);
    if (jacketSkirtPair) {
        // 5573E010 consumes the captured staticBones list. It does not prove
        // that two dynamic clothing chains are a collision pair. Projecting
        // skirt and jacket particles here makes a parent correction move all
        // descendants, then the next layer projects them again. That is the
        // source of the motion-only jitter and long jumps; their body/leg
        // colliders remain handled by the static collision pass below.
        return false;
    }
    return (firstJacket && secondHair) || (secondJacket && firstHair);
}

export function resolveDynamicParticlePair(first, second, firstRecord, secondRecord, radiusScale = 1, firstPrevious = null, secondPrevious = null, firstRest = null, secondRest = null, skipAllowedCheck = false) {
    if (!skipAllowedCheck && !dynamicParticlePairAllowed(firstRecord, secondRecord)) {
        return { first, second, collided: false };
    }
    const radiusA = Math.max(0, dynamicRecordRadius(firstRecord) * (Number(radiusScale) || 0));
    const radiusB = Math.max(0, dynamicRecordRadius(secondRecord) * (Number(radiusScale) || 0));
    const delta = sub(second, first);
    const distance = vecLength(delta);
    const physicalMinimum = radiusA + radiusB;
    const restDistance = Array.isArray(firstRest) && Array.isArray(secondRest)
        ? vecLength(sub(secondRest, firstRest))
        : Number.NaN;
    // The PMX rest pose can intentionally place neighboring clothing spheres
    // inside their Unity radii. Preserve that authored gap as the contact
    // distance; otherwise the spring target and the pair solver fight forever.
    const minimum = Number.isFinite(restDistance) && restDistance > 1e-8
        ? Math.min(physicalMinimum, restDistance)
        : physicalMinimum;
    if (!(minimum > 1e-8) || distance >= minimum) {
        return { first, second, collided: false };
    }
    if (Array.isArray(firstPrevious) && Array.isArray(secondPrevious)) {
        const firstMotion = sub(first, firstPrevious);
        const secondMotion = sub(second, secondPrevious);
        const relativeMotion = sub(secondMotion, firstMotion);
        // The authored PMX rest pose has a few skirt/jacket particle spheres
        // inside each other. Native swing collision is a contact response for
        // particles moving into one another; resolving those static overlaps
        // every frame fights the spring rest pose and creates visible jitter.
        if (dot(delta, relativeMotion) >= -1e-8) {
            return { first, second, collided: false };
        }
    }
    const direction = distance > 1e-8 ? scale(delta, 1 / distance) : [0, 1, 0];
    const overlap = minimum - distance;
    const firstJacket = /Jacket/i.test(firstRecord?.bone || '');
    const secondJacket = /Jacket/i.test(secondRecord?.bone || '');
    // The jacket layer is the moving obstacle for the hair/skirt layers. A
    // one-sided response avoids the two independently simulated chains
    // exchanging the same correction every frame and reproducing the old
    // shaking feedback. This is the runtime mask pairing, while the exact
    // recovered E3020 mode 2 remains reserved for native endpoint geometry.
    if (firstJacket && !secondJacket) {
        return {
            first: [...first],
            second: add(second, scale(direction, overlap)),
            collided: true,
            distance,
            radiusA,
            radiusB,
            overlap,
        };
    }
    if (secondJacket && !firstJacket) {
        return {
            first: sub(first, scale(direction, overlap)),
            second: [...second],
            collided: true,
            distance,
            radiusA,
            radiusB,
            overlap,
        };
    }
    const total = radiusA + radiusB;
    const firstMove = overlap * (radiusB / total);
    const secondMove = overlap * (radiusA / total);
    return {
        first: sub(first, scale(direction, firstMove)),
        second: add(second, scale(direction, secondMove)),
        collided: true,
        distance,
        radiusA,
        radiusB,
        overlap,
    };
}

export function hairDriverEuler(headEuler, neckEuler, setting) {
    const head = scaleAndClampEuler(headEuler, setting?.headRotateCoefficient, setting?.headRotateLimitMin, setting?.headRotateLimitMax);
    const neck = scaleAndClampEuler(neckEuler, setting?.neckRotateCoefficient, setting?.neckRotateLimitMin, setting?.neckRotateLimitMax);
    return [head[0] + neck[0], head[1] + neck[1], head[2] + neck[2]];
}

export const SKIRT_OUTER_DEADZONE = 8;

export function quatDot4(a, b) {
    return (a?.[0] || 0) * (b?.[0] || 0) + (a?.[1] || 0) * (b?.[1] || 0) + (a?.[2] || 0) * (b?.[2] || 0) + (a?.[3] || 0) * (b?.[3] || 0);
}

export function quatNegate(q) {
    return [-(q?.[0] || 0), -(q?.[1] || 0), -(q?.[2] || 0), -(q?.[3] || 0)];
}

export function quatShortest(q) {
    return (q?.[3] || 0) < 0 ? quatNegate(q) : q;
}

export function relativeQuaternion(rest, current) {
    return quatShortest(quatNormalize(quatMultiply(quatInverse(rest), current)));
}

export function quatSlerp(a, b, t) {
    const amount = clampAxis(t, 0, 1);
    let end = b;
    let cosom = quatDot4(a, b);
    if (cosom < 0) {
        end = quatNegate(b);
        cosom = -cosom;
    }
    if (cosom > 0.9995) {
        return quatNormalize([
            a[0] + (end[0] - a[0]) * amount,
            a[1] + (end[1] - a[1]) * amount,
            a[2] + (end[2] - a[2]) * amount,
            a[3] + (end[3] - a[3]) * amount,
        ]);
    }
    const omega = Math.acos(Math.min(1, cosom));
    const sinom = Math.sin(omega) || 1;
    const scaleA = Math.sin((1 - amount) * omega) / sinom;
    const scaleB = Math.sin(amount * omega) / sinom;
    return [
        a[0] * scaleA + end[0] * scaleB,
        a[1] * scaleA + end[1] * scaleB,
        a[2] * scaleA + end[2] * scaleB,
        a[3] * scaleA + end[3] * scaleB,
    ];
}

export function skirtTwistAxis(setting) {
    const axis = Number.isInteger(setting?.connectionAxis) ? setting.connectionAxis : 0;
    if (axis === 1) return [0, 0, 1];
    if (axis === 2) return [-1, 0, 0];
    return [0, 1, 0];
}

export function swingTwistDecompose(q, axis) {
    const n = normalize(axis);
    const proj = dot([q[0], q[1], q[2]], n);
    const twist = quatShortest(quatNormalize([n[0] * proj, n[1] * proj, n[2] * proj, q[3]]));
    const swing = quatShortest(quatNormalize(quatMultiply(q, quatInverse(twist))));
    return { swing, twist };
}

export function twistAngleDegrees(q, axis) {
    const { twist } = swingTwistDecompose(q, axis);
    const n = normalize(axis);
    return Math.atan2(twist[0] * n[0] + twist[1] * n[1] + twist[2] * n[2], twist[3]) * 360 / Math.PI;
}

// ActorAnimationQuartzDriverHumanoidUpLegBone writes one humanoid upper-leg
// muscle back into a helper bone. The GLB helper bones use their local X axis
// for the captured roll channel; project the source upper-leg delta onto that
// axis before applying the serialized coefficient. Keeping this as a twist
// quaternion avoids turning the hip's flexion/abduction into an unintended
// helper-bone rotation.
export function humanoidUpLegDriverQuaternion(relative, setting = {}) {
    return humanoidQuartzDriverQuaternion(relative, setting);
}

// HumanoidArm, HumanoidHand, and HumanoidUpLeg all write one selected
// humanoid muscle channel into a helper bone. The capture contains the
// channel coefficient and the Stage has no native solver IO for these jobs,
// so this is an explicit stage adaptation rather than a native-parity claim.
export function humanoidQuartzDriverQuaternion(relative, setting = {}) {
    const axisIndex = Number.isInteger(setting?.sourceAxis)
        ? Math.max(0, Math.min(2, setting.sourceAxis))
        : 0;
    const axis = axisIndex === 1 ? [0, 1, 0] : axisIndex === 2 ? [0, 0, 1] : [1, 0, 0];
    const coefficient = Number.isFinite(Number(setting?.coefficient)) ? Number(setting.coefficient) : 0;
    return quatFromAxisAngle(axis, twistAngleDegrees(relative || [0, 0, 0, 1], axis) * coefficient);
}

// Rotation jobs expose the coefficient vector, limits, connection axis, and
// rotation order in the capture. Keep those fields in degrees until the final
// quaternion conversion so a unit mistake cannot silently scale the output.
// The native job itself is not executed by the capture, therefore this helper
// is deliberately labelled as a Stage adaptation in profile provenance.
export function quartzRotationDriverQuaternion(relative, setting = {}) {
    const source = quaternionToEulerDegreesXYZ(relative || [0, 0, 0, 1]);
    const coefficient = Array.isArray(setting?.coefficient) ? setting.coefficient : [0, 0, 0];
    const min = Array.isArray(setting?.limitMin) ? setting.limitMin : [-180, -180, -180];
    const max = Array.isArray(setting?.limitMax) ? setting.limitMax : [180, 180, 180];
    const scaled = source.map((value, index) => clampAxis(
        value * (Number(coefficient[index]) || 0),
        Number(min[index] ?? -180),
        Number(max[index] ?? 180),
    ));
    const axis = Number.isInteger(setting?.connectionAxis) ? setting.connectionAxis : 0;
    const mapped = connectionAxisPermute(scaled[0], scaled[1], scaled[2], axis);
    return setting?.rotationOrder === 1
        ? unityEulerDegreesToQuaternion(mapped)
        : eulerDegreesToQuaternionXYZ(mapped);
}

export function femurAbductionDegrees(q, side) {
    const along = quatRotate(quatShortest(quatNormalize(q || [0, 0, 0, 1])), [0, -1, 0]);
    const lateral = side === 'right' ? -along[0] : along[0];
    return Math.atan2(lateral, Math.hypot(along[1], along[2])) * 180 / Math.PI;
}

export function skirtIsOuter(sourceQuat, setting, side, _wasOuter = true) {
    if (!APPLY_SKIRT_INNER_OUTER) return true;
    return femurAbductionDegrees(sourceQuat, side) > -SKIRT_OUTER_DEADZONE;
}

export function skirtCoefficient(sourceQuat, setting, side, wasOuter = true) {
    return skirtIsOuter(sourceQuat, setting, side, wasOuter) ? setting?.outerCoefficient : setting?.innerCoefficient;
}

function coefficientWeight(coefficient, axis, twist) {
    const scale = Array.isArray(coefficient) ? coefficient : [1, 1, 1];
    if (twist) return scale[axis] ?? 1;
    const others = [0, 1, 2].filter(index => index !== axis);
    return 0.5 * ((scale[others[0]] ?? 1) + (scale[others[1]] ?? 1));
}

export function skirtDriverQuaternion(sourceQuat, setting, side, wasOuter = true) {
    const extra = quatShortest(quatNormalize(sourceQuat || [0, 0, 0, 1]));
    const coeff = skirtCoefficient(extra, setting, side, wasOuter);
    const axis = Number.isInteger(setting?.connectionAxis) ? setting.connectionAxis : 0;
    const twistWeight = coefficientWeight(coeff, axis, true);
    const swingWeight = coefficientWeight(coeff, axis, false);
    if (!APPLY_SKIRT_QUARTZ_LIMITS && Math.abs(twistWeight - 1) < 1e-6 && Math.abs(swingWeight - 1) < 1e-6) return extra;
    const { swing, twist } = swingTwistDecompose(extra, skirtTwistAxis(setting));
    return quatShortest(quatNormalize(quatMultiply(
        quatSlerp([0, 0, 0, 1], swing, swingWeight),
        quatSlerp([0, 0, 0, 1], twist, twistWeight),
    )));
}

function wrapRuntimeDegrees(value) {
    if (value > 180) return value - 360;
    if (value < -180) return value + 360;
    return value;
}

function runtimeLimit(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function quaternionToRuntimeEulerDegrees(q) {
    const x = q?.[0] || 0;
    const y = q?.[1] || 0;
    const z = q?.[2] || 0;
    const negatedW = -(q?.[3] || 0);
    const axisX = (z * y - negatedW * x) * -2;
    const axisXDenom = ((negatedW * negatedW - x * x) - y * y) + z * z;
    const sine = Math.min(1, Math.max(-1, 2 * (negatedW * y + z * x)));
    const axisZ = (y * x - z * negatedW) * -2;
    const axisZDenom = ((negatedW * negatedW + x * x) - y * y) - z * z;
    return [
        -Math.atan2(axisX, axisXDenom) * 180 / Math.PI,
        -Math.asin(sine) * 180 / Math.PI,
        -Math.atan2(axisZ, axisZDenom) * 180 / Math.PI,
    ];
}

function skirtSwingDegrees(euler) {
    const direction = quatRotate(eulerDegreesToQuaternionXYZ(euler), [0, 1, 0]);
    const flexion = 2 * Math.atan2(direction[2], direction[1] + 1) * 180 / Math.PI;
    const abduction = -2 * Math.atan2(direction[0], direction[1] + 1) * 180 / Math.PI;
    return [0, abduction, flexion];
}

function blendSkirtAxis(angle, inner, outer, min, max) {
    const wrapped = wrapRuntimeDegrees(angle || 0);
    let limited = wrapped;
    if (Number.isFinite(max) && !(wrapped < max)) limited = max;
    if (Number.isFinite(min) && !(min < limited)) limited = min;
    // Native 5572EF50 supplies (inner - outer) * limited; Calc adds outer * angle.
    return (outer || 0) * wrapped + ((inner || 0) - (outer || 0)) * limited;
}

function runtimeQuatMul(left, right) {
    const lx = left[0] || 0;
    const ly = left[1] || 0;
    const lz = left[2] || 0;
    const lw = left[3] || 0;
    const rx = right[0] || 0;
    const ry = right[1] || 0;
    const rz = right[2] || 0;
    const rw = right[3] || 0;
    return [
        (lz * ry + lw * rx + lx * rw) - ly * rz,
        (lx * rz + lw * ry + ly * rw) - lz * rx,
        (ly * rx + lw * rz + lz * rw) - lx * ry,
        (-(ly * ry + lx * rx) + lw * rw) - lz * rz,
    ];
}

function skirtOutputMul(twist, swing) {
    const bx = twist[0] || 0;
    const by = twist[1] || 0;
    const bz = twist[2] || 0;
    const bw = twist[3] || 0;
    const cx = swing[0] || 0;
    const cy = swing[1] || 0;
    const cz = swing[2] || 0;
    const cw = swing[3] || 0;
    return [
        (by * cz + bx * cw + bw * cx) - bz * cy,
        (bz * cx + by * cw + bw * cy) - bx * cz,
        (bx * cy + bz * cw + bw * cz) - by * cx,
        (-(by * cy + bx * cx) + bw * cw) - bz * cz,
    ];
}

function skirtCalcQuaternion(twistRad, abductionRad, flexionRad) {
    const sinFlex = Math.sin(-flexionRad * 0.5);
    const sinAbd = Math.sin(abductionRad * 0.5);
    const scale = 2 / (sinFlex * sinFlex + sinAbd * sinAbd + 1);
    const swing = quatFromTo([1, 0, 0], [scale - 1, scale * sinFlex, scale * sinAbd]);
    const halfTwist = -twistRad * 0.5;
    return skirtOutputMul([Math.sin(halfTwist), 0, 0, Math.cos(halfTwist)], swing);
}

function unityCalcQuaternionToPmx(q) {
    return quatNormalize([q[2], q[0], q[1], q[3]]);
}

// UnityGLTF converts a Unity local quaternion to glTF with the component
// scale (1, -1, -1, 1). The same operation converts it back because it is an
// involution. Keep this separate from the historical PMX adapter above: GLB
// drivers must be written in the glTF basis that Three.js actually stores.
export function gltfQuaternionToUnity(q) {
    const value = quatNormalize(q || [0, 0, 0, 1]);
    return quatNormalize([value[0], -value[1], -value[2], value[3]]);
}

export function unityQuaternionToGltf(q) {
    const value = quatNormalize(q || [0, 0, 0, 1]);
    return quatNormalize([value[0], -value[1], -value[2], value[3]]);
}

function eulerXYZUnityMath(euler) {
    const x = quatFromAxisAngle([1, 0, 0], (euler[0] || 0) * 180 / Math.PI);
    const y = quatFromAxisAngle([0, 1, 0], (euler[1] || 0) * 180 / Math.PI);
    const z = quatFromAxisAngle([0, 0, 1], (euler[2] || 0) * 180 / Math.PI);
    // Unity.Mathematics.quaternion.EulerXYZ is qz * qy * qx.
    return quatNormalize(quatMultiply(quatMultiply(z, y), x));
}

function eulerUnityDefault(euler) {
    const x = quatFromAxisAngle([1, 0, 0], (euler[0] || 0) * 180 / Math.PI);
    const y = quatFromAxisAngle([0, 1, 0], (euler[1] || 0) * 180 / Math.PI);
    const z = quatFromAxisAngle([0, 0, 1], (euler[2] || 0) * 180 / Math.PI);
    // UnityEngine.Quaternion.Euler uses its default ZXY order: qy * qx * qz.
    return quatNormalize(quatMultiply(quatMultiply(y, x), z));
}

function nativeSkirtSetting(setting, alreadyConverted = false) {
    const array = (value, fallback) => Array.isArray(value) ? value.map(Number) : [...fallback];
    const innerCoefficient = array(setting?.innerCoefficient, [0, 0, 0]);
    const outerCoefficient = array(setting?.outerCoefficient, [0, 0, 0]);
    const limitMin = array(setting?.limitMin, [-180, -180, -180]);
    const limitMax = array(setting?.limitMax, [180, 180, 180]);
    if (!alreadyConverted) {
        // ActorAnimationSwingSolver.NativeConvertSkirt(). The extracted HSKI
        // profile stores the authored game setting, so GLB applies this once
        // before evaluating the native formula.
        outerCoefficient[2] = -outerCoefficient[2];
        innerCoefficient[2] = -innerCoefficient[2];
        const oldMinZ = limitMin[2];
        limitMin[2] = -limitMax[2];
        limitMax[2] = -oldMinZ;
        const referenceName = setting?.referenceBone?.name || setting?.referenceBone || '';
        if (/Left/i.test(referenceName)) {
            outerCoefficient[1] = -outerCoefficient[1];
            innerCoefficient[1] = -innerCoefficient[1];
            const oldMinY = limitMin[1];
            limitMin[1] = -limitMax[1];
            limitMax[1] = -oldMinY;
        }
    }
    return {
        rotationOrder: Number(setting?.rotationOrder ?? 0),
        innerCoefficient,
        outerCoefficient,
        limitMin,
        limitMax,
    };
}

function nativeSkirtCalculate(initial, current, setting) {
    if (setting.rotationOrder !== 0) return [0, 0, 0, 1];
    // This is a direct port of ActorAnimationSwingSolver.NativeSkirtCalculate.
    const relative = quatNormalize(quatMultiply(current, quatInverse(initial)));
    const euler = quaternionToRuntimeEulerDegrees(relative).map(value => value * Math.PI / 180);
    const rotation = eulerXYZUnityMath(euler);
    const rebuilt = eulerUnityDefault(euler);
    const up = quatRotate(rotation, [0, 1, 0]);
    const bend = 2 * Math.atan2(up[2], 1 + up[1]) * 180 / Math.PI;
    const roll = -2 * Math.atan2(up[0], 1 + up[1]) * 180 / Math.PI;
    const twist = quatMultiply(rebuilt, quatInverse(quatFromTo([0, 1, 0], up)));
    const twistLength = Math.hypot(twist[0], twist[1], twist[2], twist[3]);
    if (twistLength < 1e-12) return [0, 0, 0, 1];
    let angle = 2 * Math.acos(clampAxis(twist[3] / twistLength, -1, 1)) * 180 / Math.PI;
    if (dot(twist.slice(0, 3), up) < 0) angle = -angle;
    const degrees = [wrapRuntimeDegrees(angle), wrapRuntimeDegrees(roll), wrapRuntimeDegrees(bend)];
    const result = degrees.map((value, index) => blendSkirtAxis(
        value,
        setting.innerCoefficient[index],
        setting.outerCoefficient[index],
        setting.limitMin[index],
        setting.limitMax[index],
    ) * Math.PI / 180);
    const pitchTangent = Math.tan(result[1] * 0.5);
    const yawTangent = Math.tan(-result[2] * 0.5);
    const scale = 2 / (pitchTangent * pitchTangent + yawTangent * yawTangent + 1);
    const direction = [scale - 1, scale * yawTangent, scale * pitchTangent];
    return quatNormalize(quatMultiply(
        quatFromAxisAngle([1, 0, 0], -result[0] * 180 / Math.PI),
        quatFromTo([1, 0, 0], direction),
    ));
}

/**
 * Apply Unity's skirt Quartz driver to a GLB reference bone. The inputs and
 * output are Three.js/glTF local quaternions; all intermediate calculations
 * use the Unity basis and the native, converted Quartz setting.
 */
export function nativeSkirtDriverQuaternion(initialGltf, currentGltf, setting, options = {}) {
    const initialUnity = gltfQuaternionToUnity(initialGltf);
    const currentUnity = gltfQuaternionToUnity(currentGltf);
    const extraUnity = nativeSkirtCalculate(initialUnity, currentUnity, nativeSkirtSetting(setting, options.settingsConverted === true));
    return unityQuaternionToGltf(extraUnity);
}

export function skirtReferenceQuaternion(initial, current) {
    const q = quatNormalize(initial || [0, 0, 0, 1]);
    const length2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3] || 1;
    const scale = 1 / length2;
    return quatNormalize(runtimeQuatMul(
        [-q[0] * scale, -q[1] * scale, -q[2] * scale, q[3] * scale],
        quatNormalize(current || [0, 0, 0, 1]),
    ));
}

function quaternionToRuntimeEulerOrder2(q) {
    const x = q?.[0] || 0;
    const y = q?.[1] || 0;
    const z = q?.[2] || 0;
    const negatedW = -(q?.[3] || 0);
    const denomYaw = ((negatedW * negatedW - x * x) - y * y) + z * z;
    const denomRoll = ((negatedW * negatedW - x * x) + y * y) - z * z;
    const sine = Math.min(1, Math.max(-1, (z * y - negatedW * x) * -2));
    return [
        -Math.asin(sine) * 180 / Math.PI,
        -Math.atan2(2 * (negatedW * y + z * x), denomYaw) * 180 / Math.PI,
        -Math.atan2(2 * (negatedW * z + y * x), denomRoll) * 180 / Math.PI,
    ];
}

function hairSwingDegrees(q) {
    const quat = quatNormalize(q || [0, 0, 0, 1]);
    const qx = quat[0];
    const qy = quat[1];
    const qz = quat[2];
    const qw = quat[3];
    const denom = qw * qw + qy * qy || 1;
    return [
        quaternionToRuntimeEulerOrder2(quat)[1],
        2 * Math.atan2(qz * qy + qx * qw, denom) * 180 / Math.PI,
        -2 * Math.atan2(qx * qy - qz * qw, denom) * 180 / Math.PI,
    ];
}

function scaleClampedAxis(angle, coefficient, min, max) {
    const wrapped = wrapRuntimeDegrees(angle || 0);
    let limited = wrapped;
    if (Number.isFinite(max) && !(wrapped < max)) limited = max;
    if (Number.isFinite(min) && !(min < limited)) limited = min;
    return (coefficient || 0) * limited;
}

function hairChannel(swing, coefficient, min, max) {
    const scale = Array.isArray(coefficient) ? coefficient : [0, 0, 0];
    const low = Array.isArray(min) ? min : [-180, -180, -180];
    const high = Array.isArray(max) ? max : [180, 180, 180];
    return [
        scaleClampedAxis(swing[1], scale[0], low[0], high[0]),
        scaleClampedAxis(swing[0], scale[1], low[1], high[1]),
        scaleClampedAxis(swing[2], scale[2], low[2], high[2]),
    ];
}

// 30250: connection-axis byte permutes the three scaled channels. Axis 0 is identity.
export function connectionAxisPermute(x, y, z, axis) {
    let param2 = x;
    const param3 = y;
    const param4 = z;
    const param5 = axis & 0xff;
    let uVar1 = param2;
    let uVar2 = param2;
    let uVar3;
    const byteSub2 = (param5 - 2) & 0xff;
    if ((((param5 > 1) && (uVar3 = param4, uVar1 = param3, byteSub2 > 1)) || (uVar3 = uVar1, param5 !== 2))
        && (param5 !== 4 && (uVar2 = param3, param5 !== 0))
        && param5 !== 5) {
        uVar2 = param4;
    }
    if (((param5 - 3) & 0xfd) !== 0 && (param5 === 1 || (param2 = param4, param5 === 4))) {
        return [uVar3, uVar2, param3];
    }
    return [uVar3, uVar2, param2];
}

function hairComposeRadians(headQuat, neckQuat, setting) {
    const head = hairChannel(hairSwingDegrees(headQuat), setting?.headRotateCoefficient, setting?.headRotateLimitMin, setting?.headRotateLimitMax);
    const neck = hairChannel(hairSwingDegrees(neckQuat), setting?.neckRotateCoefficient, setting?.neckRotateLimitMin, setting?.neckRotateLimitMax);
    return [0, 1, 2].map(index => (head[index] + neck[index]) * Math.PI / 180);
}

export function recoveredHairLocalOffset(headQuat, setting) {
    const channel = hairChannel(
        hairSwingDegrees(headQuat),
        setting?.headTranslateCoefficient,
        setting?.headTranslateLimitMin,
        setting?.headTranslateLimitMax,
    );
    const axis = Number.isInteger(setting?.translateConnectionAxis) ? setting.translateConnectionAxis : 0;
    return connectionAxisPermute(channel[0], channel[1], channel[2], axis);
}

export function recoveredHairDriverQuaternion(headQuat, neckQuat, setting) {
    const summed = hairComposeRadians(headQuat, neckQuat, setting);
    // composeType 0 is 2E2F0, the same swing quaternion the skirt writes.
    // rotationOrder 0 and rotateConnectionAxis 0 do not reorder it, so it enters PMX on the skirt's axis map.
    const composed = skirtCalcQuaternion(summed[0], summed[1], summed[2]);
    return unityCalcQuaternionToPmx(composed);
}

export function skirtDriverSwingSigns(table, boneName) {
    const rule = table?.skirtDriverSwingSigns;
    if (!rule || typeof rule !== 'object') return null;
    const side = driverSide(boneName) === 'left' ? 'Left' : driverSide(boneName) === 'right' ? 'Right' : 'Center';
    const pick = value => {
        const raw = value && typeof value === 'object' ? value[side] : value;
        return Number(raw) < 0 ? -1 : 1;
    };
    return [1, pick(rule.abduction), pick(rule.flexion)];
}

export function recoveredSkirtDriverQuaternion(sourceQuat, setting, swingSigns = null) {
    const relative = quatNormalize(sourceQuat || [0, 0, 0, 1]);
    const measured = skirtSwingDegrees(quaternionToRuntimeEulerDegrees(relative));
    const swing = Array.isArray(swingSigns)
        ? measured.map((value, index) => value * (swingSigns[index] < 0 ? -1 : 1))
        : measured;
    const inner = Array.isArray(setting?.innerCoefficient) ? setting.innerCoefficient : [0, 0, 0];
    const outer = Array.isArray(setting?.outerCoefficient) ? setting.outerCoefficient : [0, 0, 0];
    const min = Array.isArray(setting?.limitMin) ? setting.limitMin : [-180, -180, -180];
    const max = Array.isArray(setting?.limitMax) ? setting.limitMax : [180, 180, 180];
    const blended = [0, 1, 2].map(index => blendSkirtAxis(swing[index], inner[index], outer[index], min[index], max[index]));
    const radians = blended.map(degrees => degrees * Math.PI / 180);
    return unityCalcQuaternionToPmx(skirtCalcQuaternion(radians[0], radians[1], radians[2]));
}

export function composeRestAndQuat(rest, extra) {
    return quatNormalize(quatMultiply(rest, extra));
}

function quatFromAxisAngle(axis, degrees) {
    const half = (degrees * Math.PI) / 360;
    const s = Math.sin(half);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

function quatMultiply(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}

function quatNormalize(q) {
    const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function quatInverse(q) {
    return [-q[0], -q[1], -q[2], q[3]];
}

function unityLocalRotationToThree(q) {
    if (!Array.isArray(q) || q.length < 4) return [0, 0, 0, 1];
    return quatNormalize([-q[0], q[1], -q[2], q[3]]);
}

function readVec3(value) {
    if (Array.isArray(value)) return [value[0] || 0, value[1] || 0, value[2] || 0];
    return [value?.x || 0, value?.y || 0, value?.z || 0];
}

function readQuat(value) {
    if (Array.isArray(value)) return quatNormalize([value[0] || 0, value[1] || 0, value[2] || 0, value[3] ?? 1]);
    return quatNormalize([value?.x || 0, value?.y || 0, value?.z || 0, value?.w ?? 1]);
}

function writeComponents(target, value) {
    if (!target) return;
    if (typeof target.set === 'function' && !Array.isArray(target)) target.set(...value);
    else if (Array.isArray(target)) value.forEach((component, index) => { target[index] = component; });
}

function quatAngleDegrees(a, b) {
    const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
    return 2 * Math.acos(dot) * 180 / Math.PI;
}

function scaleComponents(scale, vector) {
    return [scale[0] * vector[0], scale[1] * vector[1], scale[2] * vector[2]];
}

function unscaleComponents(scale, vector) {
    return [0, 1, 2].map(index => Math.abs(scale[index]) > 1e-8 ? vector[index] / scale[index] : vector[index]);
}

function parentFirstBones(bones) {
    const set = new Set(bones);
    const ordered = [];
    const visited = new Set();
    const visit = bone => {
        if (!bone || visited.has(bone) || !set.has(bone)) return;
        visited.add(bone);
        if (set.has(bone.parent)) visit(bone.parent);
        ordered.push(bone);
    };
    for (const bone of bones) visit(bone);
    return ordered;
}

export function hairRestRotationTargets(table) {
    const targets = new Map();
    if (table?.hairRestRotationRebase !== true) return targets;
    for (const record of table.springs || []) {
        if (record?.part !== 'hair') continue;
        const rotation = record.modelingLocalTx?.rotation || record.unityLocalRotation;
        if (!Array.isArray(rotation) || rotation.length < 4 || !rotation.every(Number.isFinite)) continue;
        targets.set(record.bone, unityLocalRotationToThree(rotation));
    }
    return targets;
}

// One rest-pose rebase. Hair local rotations become the converted Unity
// local rotations. Child joints stay at their current world positions, and
// bones without a Unity rotation keep their world orientation.
export function rebaseHairRestBones(bones, targets) {
    const rotations = targets instanceof Map ? targets : new Map();
    if (!rotations.size) return [];
    const ordered = parentFirstBones((bones || []).filter(bone => bone?.name));
    const oldPos = new Map();
    const oldQuat = new Map();
    const oldScale = new Map();
    for (const bone of ordered) {
        const parentKnown = bone.parent && oldQuat.has(bone.parent);
        const parentPos = parentKnown ? oldPos.get(bone.parent) : [0, 0, 0];
        const parentQuat = parentKnown ? oldQuat.get(bone.parent) : [0, 0, 0, 1];
        const parentScale = parentKnown ? oldScale.get(bone.parent) : [1, 1, 1];
        const localPos = readVec3(bone.position);
        const localQuat = readQuat(bone.quaternion);
        oldPos.set(bone, add(parentPos, quatRotate(parentQuat, scaleComponents(parentScale, localPos))));
        oldQuat.set(bone, quatNormalize(quatMultiply(parentQuat, localQuat)));
        const scaleSource = bone.scale == null || (!Array.isArray(bone.scale) && bone.scale.x === undefined) ? [1, 1, 1] : bone.scale;
        oldScale.set(bone, readVec3(scaleSource));
    }
    const newQuat = new Map();
    const changed = [];
    for (const bone of ordered) {
        const parentKnown = bone.parent && newQuat.has(bone.parent);
        const parentQuat = parentKnown ? newQuat.get(bone.parent) : [0, 0, 0, 1];
        const parentPos = parentKnown ? oldPos.get(bone.parent) : [0, 0, 0];
        const parentScale = parentKnown ? oldScale.get(bone.parent) : [1, 1, 1];
        const target = rotations.get(bone.name);
        const nextQuat = target
            ? quatNormalize(target)
            : quatNormalize(quatMultiply(quatInverse(parentQuat), oldQuat.get(bone)));
        const nextPos = unscaleComponents(parentScale, quatRotate(quatInverse(parentQuat), sub(oldPos.get(bone), parentPos)));
        const previousQuat = readQuat(bone.quaternion);
        if (quatAngleDegrees(previousQuat, nextQuat) > 0.25 || vecLength(sub(readVec3(bone.position), nextPos)) > 1e-4) {
            if (target) changed.push({ name: bone.name, from: previousQuat, to: nextQuat });
            writeComponents(bone.quaternion, nextQuat);
            writeComponents(bone.position, nextPos);
        }
        newQuat.set(bone, quatNormalize(quatMultiply(parentQuat, nextQuat)));
    }
    return changed;
}

function syncRestSnapshot(restPose) {
    for (const entry of restPose || []) {
        const bone = entry?.bone;
        if (!bone || entry.position === bone.position) continue;
        entry.position?.copy?.(bone.position);
        entry.quaternion?.copy?.(bone.quaternion);
        entry.scale?.copy?.(bone.scale);
    }
}

export function applyHairRestRotationRebase(restPose, table) {
    const changed = rebaseHairRestBones((restPose || []).map(entry => entry?.bone).filter(Boolean), hairRestRotationTargets(table));
    syncRestSnapshot(restPose);
    return changed;
}

export function rebaseHairAnimationTracks(clip, changes) {
    const byName = new Map((changes || []).filter(item => item?.name && item.from && item.to).map(item => [item.name, item]));
    if (!byName.size || !clip?.tracks) return 0;
    let count = 0;
    for (const track of clip.tracks) {
        const match = /^\.bones\[(.+)\]\.quaternion$/.exec(track.name || '');
        const change = match && byName.get(match[1]);
        const values = track.values;
        if (!change || !values) continue;
        const swing = quatMultiply(change.to, quatInverse(change.from));
        for (let index = 0; index < values.length; index += 4) {
            const next = quatNormalize(quatMultiply(swing, [values[index], values[index + 1], values[index + 2], values[index + 3]]));
            values[index] = next[0];
            values[index + 1] = next[1];
            values[index + 2] = next[2];
            values[index + 3] = next[3];
        }
        count += 1;
    }
    return count;
}

export function refreshRestInverseBinds(root) {
    if (!root?.updateMatrixWorld) return;
    root.updateMatrixWorld(true);
    const meshes = [];
    if (root.isSkinnedMesh && root.skeleton) meshes.push(root);
    root.traverse?.(child => {
        if (child !== root && child.isSkinnedMesh && child.skeleton) meshes.push(child);
    });
    const seen = new Set();
    for (const mesh of meshes) {
        if (seen.has(mesh.skeleton)) continue;
        seen.add(mesh.skeleton);
        mesh.skeleton.calculateInverses?.();
    }
}

function quatRotate(q, v) {
    const u = [q[0], q[1], q[2]];
    const t = cross(u, v).map(value => value * 2);
    return add(v, add(scale(t, q[3]), cross(u, t)));
}

export function eulerDegreesToQuaternionXYZ(euler) {
    const x = quatFromAxisAngle([1, 0, 0], euler[0] || 0);
    const y = quatFromAxisAngle([0, 1, 0], euler[1] || 0);
    const z = quatFromAxisAngle([0, 0, 1], euler[2] || 0);
    return quatMultiply(quatMultiply(x, y), z);
}

// Unity's Quaternion.Euler uses the ZXY composition order. Keep this next to
// the existing XYZ helper because ActorAnimationSwingSolver's reference
// limit is written with Quaternion.Euler, not with the GLB animation order.
export function unityEulerDegreesToQuaternion(euler) {
    const x = quatFromAxisAngle([1, 0, 0], euler?.[0] || 0);
    const y = quatFromAxisAngle([0, 1, 0], euler?.[1] || 0);
    const z = quatFromAxisAngle([0, 0, 1], euler?.[2] || 0);
    return quatNormalize(quatMultiply(quatMultiply(y, x), z));
}

// ActorAnimationSwingSolver uses this exact conversion when it applies a
// limit. It is intentionally separate from quaternionToEulerDegreesXYZ:
// Unity's native solver uses a different sign/order convention for the first
// two terms, and those differences are visible on asymmetric hair chains.
export function nativeUnityEulerDegrees(q) {
    const [x, y, z, w] = q || [0, 0, 0, 1];
    return [
        Math.asin(clampAxis(2 * (w * x - y * z), -1, 1)) * 180 / Math.PI,
        Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y)) * 180 / Math.PI,
        Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z)) * 180 / Math.PI,
    ];
}

function reflectGlbUnityQuaternion(q) {
    return quatNormalize([q?.[0] || 0, -(q?.[1] || 0), -(q?.[2] || 0), q?.[3] ?? 1]);
}

/**
 * Port ActorAnimationSwingSolver.NativeReferenceLimit.
 *
 * The capture stores rotations in the GLB handedness frame, while the Unity
 * solver converts the target and reference rotations to Unity Euler angles,
 * clamps only the enabled boolean axes against the reference angles, then
 * rebuilds the quaternion with Quaternion.Euler. `convertGlbUnity` keeps this
 * conversion explicit so legacy PMX tables do not silently change behavior.
 */
export function nativeReferenceLimitQuaternion(rotation, reference, minimum = [0, 0, 0], maximum = [0, 0, 0], convertGlbUnity = false) {
    const targetUnity = convertGlbUnity ? reflectGlbUnityQuaternion(rotation) : quatNormalize(rotation || [0, 0, 0, 1]);
    const referenceUnity = convertGlbUnity ? reflectGlbUnityQuaternion(reference) : quatNormalize(reference || [0, 0, 0, 1]);
    const targetEuler = nativeUnityEulerDegrees(targetUnity);
    const referenceEuler = nativeUnityEulerDegrees(referenceUnity);
    for (let axis = 0; axis < 3; axis += 1) {
        if (Number(maximum?.[axis] || 0) !== 0) targetEuler[axis] = Math.min(targetEuler[axis], referenceEuler[axis]);
        if (Number(minimum?.[axis] || 0) !== 0) targetEuler[axis] = Math.max(targetEuler[axis], referenceEuler[axis]);
    }
    const limitedUnity = unityEulerDegreesToQuaternion(targetEuler);
    return convertGlbUnity ? reflectGlbUnityQuaternion(limitedUnity) : limitedUnity;
}

export function hasNativeReferenceLimit(info) {
    return Boolean(info?.bone
        && [...(info.min || []), ...(info.max || [])].some(value => Number(value) !== 0));
}

// Port of ActorAnimationSwingSolver.NativeSwingRotation. Native GLB
// particles are already integrated in the solver frame; this helper only
// reproduces Unity's final parent-local Euler clamp and writeback quaternion.
export function nativeSwingRotation(poseWorld, defaultRotation, parentRotation, axis, direction, limitInfo = null, weight = 1, convertUnityLimitToGlb = false) {
    const pose = quatNormalize(poseWorld || [0, 0, 0, 1]);
    const defaultPose = quatNormalize(defaultRotation || pose);
    const parent = quatNormalize(parentRotation || [0, 0, 0, 1]);
    const restDirection = quatRotate(pose, axis || [0, 1, 0]);
    const target = normalize(direction || restDirection);
    if (vecLength(target) < 1e-8) return defaultPose;
    let solved = quatNormalize(quatMultiply(quatFromTo(restDirection, target), pose));
    if (limitInfo?.useLimit) {
        const local = quatMultiply(quatInverse(parent), solved);
        // GLB stores Unity local rotations as [x, -y, -z, w]. Convert into
        // Unity space before ToUnityEuler, then convert the limited result
        // back to GLB before composing with the GLB parent.
        const unityLocal = convertUnityLimitToGlb
            ? quatNormalize([local[0], -local[1], -local[2], local[3]])
            : local;
        const angles = nativeUnityEulerDegrees(unityLocal);
        angles[0] = clampAxis(angles[0], limitInfo.axisX?.[0] ?? -180, limitInfo.axisX?.[1] ?? 180);
        angles[1] = clampAxis(angles[1], limitInfo.axisY?.[0] ?? -180, limitInfo.axisY?.[1] ?? 180);
        angles[2] = clampAxis(angles[2], limitInfo.axisZ?.[0] ?? -180, limitInfo.axisZ?.[1] ?? 180);
        const limitedUnity = eulerDegreesToQuaternionXYZ(angles);
        const limited = convertUnityLimitToGlb
            ? quatNormalize([limitedUnity[0], -limitedUnity[1], -limitedUnity[2], limitedUnity[3]])
            : limitedUnity;
        solved = quatNormalize(quatMultiply(parent, limited));
    }
    return quatSlerp(defaultPose, solved, weight);
}

export function quaternionToEulerDegreesXYZ(q) {
    const [x, y, z, w] = q;
    const sinp = 2 * (w * y - z * x);
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
    const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    return [roll, pitch, yaw].map(value => value * 180 / Math.PI);
}

export function relativeEulerDegrees(rest, current) {
    return quaternionToEulerDegreesXYZ(quatMultiply(quatInverse(rest), current));
}

export function composeRestAndExtra(rest, extraEuler) {
    return quatMultiply(rest, eulerDegreesToQuaternionXYZ(extraEuler));
}

export function selectQuartzDrivers(table) {
    const useRecoveredAlgorithm = table?.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM;
    const supported = new Set([
        QUARTZ_HAIR,
        QUARTZ_SKIRT,
        QUARTZ_ROTATION,
        QUARTZ_HUMANOID_ARM,
        QUARTZ_HUMANOID_HAND,
        QUARTZ_HUMANOID_UPLEG,
    ]);
    return (table?.drivers || []).filter(driver => driver?.enabled
        && supported.has(driver.className)
        && !(driver.className === QUARTZ_SKIRT && !useRecoveredAlgorithm && /Back/i.test(driver.bone || ''))
        && !(driver.className === QUARTZ_SKIRT && table?.disableSkirtMotion));
}

export function jacketSkirtAnchor(boneName) {
    return (boneName || '').replace('Jacket', 'Skirt').replace(/3_S$/, '_A');
}

export function selectJacketFollowDrivers(table) {
    if (!APPLY_JACKET_SKIRT_FOLLOW || table?.disableJacketSkirtFollow) return [];
    const skirts = new Map(
        (table?.drivers || [])
            .filter(driver => driver?.enabled && driver.className === QUARTZ_SKIRT)
            .map(driver => [driver.bone, driver]),
    );
    const seen = new Set();
    return (table?.springs || []).flatMap(record => {
        const bone = record?.bone;
        if (!/Jacket3_S$/.test(bone || '') || seen.has(bone)) return [];
        seen.add(bone);
        const skirt = skirts.get(jacketSkirtAnchor(bone));
        return skirt ? [{ ...skirt, bone, className: QUARTZ_SKIRT }] : [];
    });
}

export const JACKET_FOLLOW_WEIGHT = 1;
export const FOLLOW_SMOOTH = 0.35;

export function scaleFollowExtra(extra, weight) {
    return quatSlerp([0, 0, 0, 1], quatShortest(extra || [0, 0, 0, 1]), weight);
}

export function smoothFollowExtra(previous, target, amount) {
    if (!previous) return quatShortest(target || [0, 0, 0, 1]);
    return quatSlerp(previous, quatShortest(target || [0, 0, 0, 1]), amount);
}

export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function vecLength(a) { return Math.hypot(a[0], a[1], a[2]); }
export function normalize(a) {
    const length = vecLength(a);
    return length < 1e-8 ? [0, 0, 0] : scale(a, 1 / length);
}

export function f32(value) {
    const number = Number(value);
    return Math.fround(Number.isFinite(number) ? number : 0);
}

export function f32Vector(value) {
    return [f32(value?.[0]), f32(value?.[1]), f32(value?.[2])];
}

export function medianScale(pairs) {
    const ratios = pairs.filter(([unity, pmx]) => unity > 1e-5 && pmx > 1e-5).map(([unity, pmx]) => pmx / unity).sort((a, b) => a - b);
    if (!ratios.length) return 1;
    const mid = Math.floor(ratios.length / 2);
    return ratios.length % 2 ? ratios[mid] : 0.5 * (ratios[mid - 1] + ratios[mid]);
}

/**
 * Native ActorSwing force terms, kept in the same order as the recovered
 * runtime job. `childDefault` is the frame's carried/default child position;
 * it is deliberately independent of the previous projected position. The
 * native caller applies the 0.01 mass conversion, while stiffness/pendulum
 * remain in their authored scale.
 */
export function nativeSwingForce(current, childDefault, rest, params = {}, worldScale = 1, prewarm = false, speed = [0, 0, 0]) {
    const damping = f32(clampAxis(params.damping ?? 0, 0, 0.98));
    const dampingSquare = f32((1 - damping) * (1 - damping));
    const childRestore = scale(sub(childDefault || rest, current), dampingSquare);
    const anchor = params.nativeAnchor || [0, 0, 0];
    const restDirection = normalize(params.nativeRestDirection || sub(rest, anchor));
    const currentOffset = sub(current, anchor);
    const defaultOffset = sub(childDefault || rest, anchor);
    const pendulum = f32(params.pendulum ?? 0);
    const pendulumRange = f32(params.pendulumRange ?? 0);
    let pendulumCorrection = 0;
    if (pendulum > 1e-5 && pendulumRange > 1e-5) {
        if (Number(params.dynamicType) === 1) {
            const distance = f32(vecLength(sub(childDefault || rest, current)));
            pendulumCorrection = f32(f32(1 - f32(Math.min(f32(distance * 10), pendulumRange) / pendulumRange)) * pendulum);
        } else {
            // ActorSwing compares root-space positions, not vectors relative
            // to this node's anchor. A translated chain must keep this term.
            const rootOrigin = params.nativeRootOrigin || [0, 0, 0];
            const actual = sub(current, rootOrigin);
            const target = sub(childDefault || rest, rootOrigin);
            const denominator = f32(vecLength(actual) * vecLength(target));
            const cosine = denominator > 1e-9
                ? f32(Math.abs(f32(dot(actual, target))) / denominator)
                : 0;
            pendulumCorrection = f32(f32(f32(1 / pendulumRange) * Math.max(0, f32(cosine - f32(1 - pendulumRange)))) * pendulum);
        }
    }
    let stiffnessDelta;
    if (Number(params.dynamicType) === 1) {
        const target = add(anchor, scale(restDirection, f32(params.nativeRestLength ?? vecLength(sub(rest, anchor)))));
        stiffnessDelta = sub(target, current);
    } else {
        stiffnessDelta = restDirection;
    }
    const stiffness = scale(stiffnessDelta, f32(f32(params.stiffness ?? 0) - pendulumCorrection));
    const spring = prewarm ? [0, 0, 0] : scale(speed, f32(params.spring ?? 0));
    const mass = f32(params.mass ?? 0) * 0.01;
    const gravityScale = f32(params.gravityScale ?? 1);
    const gravity = [0, f32(-mass * gravityScale * f32(worldScale)), 0];
    let force = f32Vector(add(add(add(childRestore, stiffness), spring), gravity));
    if (!prewarm && Number(params.dynamicType) === 1 && (params.axisAddXToY || params.axisAddXToZ)) {
        const rotation = params.nativeSelfRotation || [0, 0, 0, 1];
        const local = quatRotate(quatInverse(rotation), force);
        local[1] += f32(params.axisAddXToY ?? 0) * Math.sign(local[1]) * Math.abs(local[0]);
        local[2] += f32(params.axisAddXToZ ?? 0) * Math.sign(local[2]) * Math.abs(local[0]);
        force = quatRotate(rotation, local);
    }
    return f32Vector(force);
}

/**
 * Integrate one native fixed step. `speed` is the free, pre-projection
 * displacement state. Collision and chain projection must never be written
 * back into it as velocity; that distinction is what prevents contact
 * correction from becoming an alternating impulse on the next frame.
 */
export function nativeIntegrateTail(current, speed, childDefault, rest, params = {}, dt = NATIVE_FIXED_STEP, worldScale = 1, prewarm = false) {
    const step = f32(Math.min(Math.max(dt || NATIVE_FIXED_STEP, 0), NATIVE_FIXED_STEP) * NATIVE_STEP_SCALE);
    const weight = f32(params.swingPowerWeight ?? 1);
    const force = nativeSwingForce(current, childDefault, rest, params, worldScale, prewarm, speed || [0, 0, 0]);
    const nextSpeed = f32Vector(scale(force, f32(step * weight)));
    return {
        force,
        speed: nextSpeed,
        next: f32Vector(add(current, nextSpeed)),
        step,
    };
}

/** One ActorSwing node in root/world space, including its native prewarm loop. */
export function nativeIntegrateSwingNode(state, params = {}, options = {}) {
    const anchor = options.anchor || [0, 0, 0];
    const childLocal = options.childLocal || [0, 1, 0];
    const axis = normalize(options.axis || childLocal);
    const length = Number(options.length ?? vecLength(childLocal));
    const defaultRotation = quatNormalize(state.selfRotation || [0, 0, 0, 1]);
    const childDefault = add(anchor, quatRotate(defaultRotation, childLocal));
    const prewarm = options.prewarm === true;
    const steps = prewarm ? Math.max(0, Number(options.prewarmSteps) || 0) * 0.5 : 1;
    let remaining = NATIVE_FIXED_STEP * steps;
    let position = prewarm ? [...childDefault] : [...state.position];
    let speed = prewarm ? [0, 0, 0] : [...(state.speed || [0, 0, 0])];
    let selfRotation = defaultRotation;
    let previousPosition = [...position];
    const cache = [];
    while (remaining > 1e-9) {
        const step = f32(Math.min(remaining, NATIVE_FIXED_STEP) * NATIVE_STEP_SCALE);
        const restDirection = quatRotate(selfRotation, axis);
        const force = nativeSwingForce(position, childDefault, childDefault, {
            ...params,
            nativeAnchor: anchor,
            nativeRestDirection: restDirection,
            nativeRestLength: length,
            nativeSelfRotation: selfRotation,
        }, options.worldScale ?? 1, prewarm, speed);
        speed = f32Vector(scale(force, f32(step * f32(params.swingPowerWeight ?? 1))));
        let next = f32Vector(add(position, speed));
        if (Number(params.dynamicType) !== 1) {
            selfRotation = quatNormalize(quatMultiply(quatFromTo(restDirection, sub(next, anchor)), defaultRotation));
            next = constrainLength(anchor, next, length);
        }
        if (options.collision) next = options.collision(next, anchor, selfRotation);
        previousPosition = position;
        position = next;
        remaining -= NATIVE_FIXED_STEP;
        if (prewarm) {
            cache.push(position);
            if (cache.length > 5) cache.shift();
            if (cache.length === 5 && cache.reduce((sum, point, index) =>
                sum + dot(sub(point, cache[(index + 1) % 5]), sub(point, cache[(index + 1) % 5])), 0) < 1e-6) break;
        }
    }
    return { position, previousPosition, speed, selfRotation, defaultRotation, childDefault };
}

// Backward-compatible pure helper for diagnostics and existing callers. The
// runtime path uses nativeIntegrateTail with a persistent speed state.
export function integrateTail(previous, current, rest, params, dt = NATIVE_FIXED_STEP, worldScale = 1) {
    const speed = sub(current, previous);
    return nativeIntegrateTail(current, speed, rest, rest, params, dt, worldScale).next;
}

export function constrainLength(origin, point, length) {
    const offset = sub(point, origin);
    const current = vecLength(offset);
    if (current < 1e-8) return add(origin, [0, length, 0]);
    return add(origin, scale(offset, length / current));
}

export function closestOnSegment(point, start, end) {
    const span = sub(end, start);
    const denom = dot(span, span);
    if (denom < 1e-12) return { point: start, t: 0 };
    const t = clampAxis(dot(sub(point, start), span) / denom, 0, 1);
    return { point: add(start, scale(span, t)), t };
}

export function resolveSphere(point, pointRadius, center, radius) {
    const offset = sub(point, center);
    const distance = vecLength(offset);
    const min = (pointRadius || 0) + (radius || 0);
    if (distance >= min || min <= 1e-8) return point;
    if (distance < 1e-8) return add(center, [0, min, 0]);
    return add(center, scale(offset, min / distance));
}

export function resolveCapsule(point, pointRadius, start, end, radiusA, radiusB) {
    const { point: closest, t } = closestOnSegment(point, start, end);
    return resolveSphere(point, pointRadius, closest, radiusA + (radiusB - radiusA) * t);
}

export function resolveCapsuleInside(point, pointRadius, start, end, radiusA, radiusB) {
    if (!Array.isArray(point) || !Array.isArray(start) || !Array.isArray(end)) return point;
    const { point: closest, t } = closestOnSegment(point, start, end);
    const radius = (radiusA || 0) + ((radiusB || 0) - (radiusA || 0)) * t;
    const allowed = Math.max(0, radius - Math.max(0, pointRadius || 0));
    const offset = sub(point, closest);
    const distance = vecLength(offset);
    if (distance <= allowed) return point;
    if (distance < 1e-8) return point;
    return add(closest, scale(offset, allowed / distance));
}

export function resolveCapsuleKeepSide(point, pointRadius, start, end, radiusA, radiusB, restPoint) {
    const { point: closest, t } = closestOnSegment(point, start, end);
    const radius = (radiusA || 0) + ((radiusB || 0) - (radiusA || 0)) * t;
    const min = (pointRadius || 0) + radius;
    if (min <= 1e-8) return point;
    const offset = sub(point, closest);
    const distance = vecLength(offset);
    if (distance >= min) return point;
    const restDir = restPoint ? sub(restPoint, closest) : offset;
    let dir = offset;
    if (distance < 1e-8 || (vecLength(restDir) > 1e-8 && dot(dir, restDir) < 0)) {
        dir = vecLength(restDir) > 1e-8 ? restDir : [0, min, 0];
    }
    return add(closest, scale(normalize(dir), min));
}

// ActorAnimationSwingSolver.CheckCapsuleCollision compares a dynamic chain
// segment with a static body capsule, then translates the whole dynamic
// segment along the contact normal. A particle-only projection cannot protect
// the cloth surface between two spring tails, which is why a skirt can still
// clip a thigh even when both tail points are outside the collider.
export function closestSegmentPoints(firstStart, firstEnd, secondStart, secondEnd) {
    const epsilon = 1e-5;
    const firstDirection = sub(firstEnd, firstStart);
    const secondDirection = sub(secondEnd, secondStart);
    const between = sub(firstStart, secondStart);
    const a = dot(firstDirection, firstDirection);
    const e = dot(secondDirection, secondDirection);
    const f = dot(secondDirection, between);
    let firstT = 0;
    let secondT = 0;
    if (a <= epsilon && e <= epsilon) {
        return { first: [...firstStart], second: [...secondStart], firstT, secondT };
    }
    if (a <= epsilon) {
        secondT = clampAxis(f / e, 0, 1);
    } else {
        const c = dot(firstDirection, between);
        if (e <= epsilon) {
            firstT = clampAxis(-c / a, 0, 1);
        } else {
            const b = dot(firstDirection, secondDirection);
            const denominator = a * e - b * b;
            firstT = denominator > epsilon ? clampAxis((b * f - c * e) / denominator, 0, 1) : 0;
            secondT = (b * firstT + f) / e;
            if (secondT < 0) {
                secondT = 0;
                firstT = clampAxis(-c / a, 0, 1);
            } else if (secondT > 1) {
                secondT = 1;
                firstT = clampAxis((b - c) / a, 0, 1);
            }
        }
    }
    return {
        first: add(firstStart, scale(firstDirection, firstT)),
        second: add(secondStart, scale(secondDirection, secondT)),
        firstT,
        secondT,
    };
}

export function resolveCapsuleSegmentCollision(dynamicStart, dynamicEnd, dynamicRadius, staticStart, staticEnd, staticRadiusA, staticRadiusB) {
    const closest = closestSegmentPoints(dynamicStart, dynamicEnd, staticStart, staticEnd);
    const delta = sub(closest.first, closest.second);
    const distance = vecLength(delta);
    const staticRadius = (staticRadiusA || 0) + ((staticRadiusB || 0) - (staticRadiusA || 0)) * closest.secondT;
    const minimum = Math.max(0, dynamicRadius || 0) + Math.max(0, staticRadius);
    if (distance > 1e-8 && distance >= minimum) {
        return { first: [...dynamicStart], second: [...dynamicEnd], collided: false, correction: 0 };
    }
    const restDirection = distance > 1e-8 ? scale(delta, 1 / distance) : [0, 1, 0];
    const contact = add(closest.second, scale(restDirection, minimum));
    const axis = sub(dynamicEnd, dynamicStart);
    const axisLengthSquared = dot(axis, axis);
    let offset = sub(contact, dynamicStart);
    if (axisLengthSquared > 1e-8) offset = sub(offset, scale(axis, dot(axis, offset) / axisLengthSquared));
    return {
        first: add(dynamicStart, offset),
        second: add(dynamicEnd, offset),
        collided: true,
        correction: vecLength(offset),
        staticRadius,
        firstT: closest.firstT,
        secondT: closest.secondT,
    };
}

export const COLLIDER_AIM_BONE = {
    LeftUpLeg: 'LeftLeg',
    LeftLeg: 'LeftFoot',
    RightUpLeg: 'RightLeg',
    RightLeg: 'RightFoot',
    Spine: 'Spine2',
    Spine1: 'Spine2',
    Spine2: 'Head',
    Neck: 'Head',
    Hips: 'Spine2',
    LeftArm: 'LeftForeArm',
    RightArm: 'RightForeArm',
    LeftForeArm: 'LeftHand',
    RightForeArm: 'RightHand',
};

const TYPE2_LIMB_LENGTH = 0.08;

export function dominantAxis(vector) {
    const values = [Math.abs(vector?.[0] || 0), Math.abs(vector?.[1] || 0), Math.abs(vector?.[2] || 0)];
    if (values[0] >= values[1] && values[0] >= values[2]) return 0;
    if (values[1] >= values[2]) return 1;
    return 2;
}

export function pmxBasisFromChild(childLocal) {
    const along = normalize(childLocal);
    if (vecLength(along) < 1e-6) return { along: [0, 1, 0], side: [1, 0, 0], forward: [0, 0, 1] };
    let side = cross(along, [0, 0, 1]);
    if (vecLength(side) < 0.2) side = cross(along, [1, 0, 0]);
    side = normalize(side);
    return { along, side, forward: normalize(cross(side, along)) };
}

export function remapUnityOffsetToPmx(offset, alongAxis, basis, scaleFactor = 1) {
    const others = [0, 1, 2].filter(index => index !== alongAxis);
    return add(
        add(scale(basis.along, (offset?.[alongAxis] || 0) * scaleFactor), scale(basis.side, (offset?.[others[0]] || 0) * scaleFactor)),
        scale(basis.forward, (offset?.[others[1]] || 0) * scaleFactor),
    );
}

function clampOffsetToAim(local, childLocal) {
    const maxLength = vecLength(childLocal);
    const length = vecLength(local);
    if (maxLength < 1e-4 || length <= maxLength * 1.02) return local;
    return scale(normalize(local), maxLength);
}

function scaledColliderRadii(record, scaleFactor) {
    return {
        radiusA: (record?.radiusA || 0) * scaleFactor,
        radiusB: (record?.radiusB || 0) * scaleFactor,
    };
}

export function authoredColliderShape(record, scaleFactor = 1, childLocal = null) {
    const offsetA = record?.offsetA || [0, 0, 0];
    const offsetB = record?.offsetB || [0, 0, 0];
    const isPmxLocal = record?.space === 'pmxLocal';
    const hasScaledGlbRoot = isPmxLocal && Number.isFinite(Number(record?.runtimeWorldScale))
        && Math.abs(Number(record.runtimeWorldScale)) > 1e-6;
    // PMX-local collider endpoints and radii are already in the Stage's
    // world unit. GLB bones are under a uniformly scaled model root, so only
    // convert the local endpoint back before worldPointFromLocal applies that
    // root scale. Unity-local records still need the regular scale conversion.
    const hasUnityLocalGlbEndpoints = hasScaledGlbRoot
        && Array.isArray(record?.unityOffsetA)
        && Array.isArray(record?.unityOffsetB);
    // A GLB profile stores unityOffsetA/B in the exported bone's local meter
    // space. The GLB root scale must therefore be allowed to enlarge these
    // coordinates once through matrixWorld. The older offsetA/B values are
    // already stage-baked PMX coordinates and keep the inverse-root fallback.
    const endpointScale = hasScaledGlbRoot && !hasUnityLocalGlbEndpoints
        ? 1 / Number(record.runtimeWorldScale)
        : 1;
    // The PMX-local endpoints are converted back through the GLB root, but
    // authored collider radii are still Unity/game radii and must be brought
    // into the Stage world scale once. Keeping these two conversions separate
    // prevents tiny invisible colliders while avoiding stretched capsules.
    const radiusScale = scaleFactor;
    const { radiusA: authoredRadiusA, radiusB: authoredRadiusB } = scaledColliderRadii(record, radiusScale);
    const radiusA = authoredRadiusA;
    const radiusB = authoredRadiusB;
    if (record?.space === 'pmxLocal') {
        const runtimeOffsetA = hasScaledGlbRoot && Array.isArray(record.unityOffsetA) ? record.unityOffsetA : offsetA;
        const runtimeOffsetB = hasScaledGlbRoot && Array.isArray(record.unityOffsetB) ? record.unityOffsetB : offsetB;
        if (record.kind === 'capsule') {
            return { kind: 'capsule', localA: scale(runtimeOffsetA, endpointScale), localB: scale(runtimeOffsetB, endpointScale), radiusA, radiusB, unityLength: record.unityLength || 0 };
        }
        return { kind: 'sphere', localA: scale(runtimeOffsetA, endpointScale), radiusA: Math.max(radiusA, radiusB), unityLength: record.unityLength || 0 };
    }
    const hasAim = vecLength(childLocal || [0, 0, 0]) > 1e-4;
    const basis = hasAim ? pmxBasisFromChild(childLocal) : { along: [0, 1, 0], side: [1, 0, 0], forward: [0, 0, 1] };
    const mapOffset = (offset, alongAxis) => {
        const mapped = hasAim ? remapUnityOffsetToPmx(offset, alongAxis, basis, scaleFactor) : scale(offset, scaleFactor);
        return hasAim ? clampOffsetToAim(mapped, childLocal) : mapped;
    };
    if (record?.type === 1) {
        const unityLength = vecLength(sub(offsetB, offsetA));
        if (unityLength > 1e-4) {
            const alongAxis = dominantAxis(sub(offsetB, offsetA));
            return { kind: 'capsule', localA: mapOffset(offsetA, alongAxis), localB: mapOffset(offsetB, alongAxis), radiusA, radiusB, unityLength };
        }
        return { kind: 'sphere', localA: mapOffset(offsetA, dominantAxis(offsetA)), radiusA: Math.max(radiusA, radiusB), unityLength };
    }
    if (record?.type === 2) {
        const height = Math.max(Math.abs(offsetA[0] || 0), Math.abs(offsetA[1] || 0), Math.abs(offsetA[2] || 0));
        if (height >= TYPE2_LIMB_LENGTH) {
            const alongAxis = dominantAxis(offsetA);
            return {
                kind: 'capsule',
                localA: [0, 0, 0],
                localB: mapOffset(offsetA, alongAxis),
                radiusA,
                radiusB,
                unityLength: vecLength(offsetA),
            };
        }
        return { kind: 'sphere', localA: mapOffset(offsetA, hasAim ? 0 : dominantAxis(offsetA)), radiusA: Math.max(radiusA, radiusB), unityLength: vecLength(offsetA) };
    }
    return { kind: 'sphere', localA: scale(offsetA, scaleFactor), radiusA: Math.max(radiusA, radiusB), unityLength: vecLength(sub(offsetB, offsetA)) };
}

/**
 * The native swing job consumes static colliders in registration order.
 * Asset/path export order is a separate ordering and is not interchangeable
 * once several projections hit the same particle in one step. Profiles that
 * recovered the runtime list carry nativeIndex; keep legacy profiles in their
 * authored order when that evidence is unavailable.
 */
export function orderStaticCollidersForNativePass(colliders, table = null) {
    if (table?.physicsAlgorithm !== RECOVERED_PHYSICS_ALGORITHM) return colliders;
    if (!Array.isArray(colliders) || !colliders.some(collider => Number.isInteger(Number(collider?.record?.nativeIndex)))) {
        return colliders;
    }
    return colliders
        .map((collider, exportIndex) => ({
            collider,
            exportIndex,
            nativeIndex: Number.isInteger(Number(collider?.record?.nativeIndex))
                ? Number(collider.record.nativeIndex)
                : Number.POSITIVE_INFINITY,
        }))
        .sort((first, second) => first.nativeIndex - second.nativeIndex || first.exportIndex - second.exportIndex)
        .map(item => item.collider);
}

function colliderAimLocal(boneName, entry, byName) {
    const aim = byName.get(COLLIDER_AIM_BONE[boneName]);
    if (!aim?.bone || !entry?.bone) return null;
    updateWorld(entry.bone);
    updateWorld(aim.bone);
    const local = worldToLocalDir(entry.bone, sub(worldPositionOf(aim.bone), worldPositionOf(entry.bone)));
    return vecLength(local) > 1e-4 ? local : null;
}

export function colliderWorldEnds(record, entry, aim, shape, scaleFactor) {
    const runtimeRootScale = Number(record?.runtimeWorldScale);
    const hasScaledGlbRoot = Number.isFinite(runtimeRootScale) && Math.abs(runtimeRootScale) > 1e-6;
    // scaleFactor is already the solver's world-unit scale. The GLB root
    // only affects local endpoint coordinates; do not apply its inverse to
    // radii or native trim lengths a second time.
    const effectiveScale = scaleFactor;
    const start = worldPointFromLocal(entry.bone, shape.localA);
    if (shape.kind !== 'capsule') return { start, end: start };
    // Limb colliders with aimBone are rebuilt from the driven/aim transform
    // pair every frame. Their baked local segment only describes the rest
    // shape; keeping it here makes a thigh capsule inherit the calf's axis.
    // Type-1 native payloads contain expanded local endpoints. Type-2 limb
    // payloads still contain the source trim values (identical on left and
    // right). Treating those as local endpoints flips one mirrored limb down
    // the calf and removes the mask-1 thigh segment used by the skirt.
    if (record?.aimBone && aim?.bone) {
        updateWorldPath(aim.bone);
        const origin = worldPositionOf(entry.bone);
        const target = worldPositionOf(aim.bone);
        const span = sub(target, origin);
        const distance = vecLength(span);
        if (distance > 1e-4) {
            const direction = scale(span, 1 / distance);
            const trim = Array.isArray(record.nativePair) ? record.nativePair : null;
            const nativeScale = Number.isFinite(Number(record.nativeScale)) ? Number(record.nativeScale) : 1;
            const trimStart = trim?.[0] > 0 ? trim[0] * nativeScale * effectiveScale : 0;
            const trimEnd = trim?.[1] > 0 ? trim[1] * nativeScale * effectiveScale : 0;
            if (trimStart + trimEnd > 0 && distance - trimStart - trimEnd > 1e-4) {
                return {
                    start: add(origin, scale(direction, trimStart)),
                    end: sub(target, scale(direction, trimEnd)),
                };
            }
            return { start: origin, end: target };
        }
    }
    // 5573E010 writes the transformed native collider endpoints back to
    // position/subPosition. A profile without aimBone already contains
    // those recovered local endpoints, as with the horizontal Spine2 body.
    let end = worldPointFromLocal(entry.bone, shape.localB);
    // A recovered endpoint can be farther than the authored model-space
    // segment after a GLB export. Clamp only this pathological fallback; aim
    // driven limbs above keep their real animated endpoint pair.
    const authoredLength = Number(shape.unityLength || 0);
    const span = sub(end, start);
    const length = vecLength(span);
    const maxLength = authoredLength > 1e-4
        ? authoredLength * Math.max(1, Number(effectiveScale) || 1) * 1.25
        : 0;
    if (maxLength > 0 && length > maxLength) end = add(start, scale(span, maxLength / length));
    return { start, end };
}

export function applyRecoveredStaticColliderPair(record, first, second) {
    const pair = record?.nativePair;
    if (record?.type !== 2 || !Array.isArray(pair) || pair.length < 2) {
        return { first: [...first], second: [...second], collided: false };
    }
    return recoveredSwingPairCollision(
        first,
        second,
        pair[0],
        pair[1],
        record.nativeScale ?? 1,
    );
}

export function masksOverlap(first, second) {
    return ((first | 0) & (second | 0)) !== 0;
}

export function effectiveSpringCollisionMask(record, table) {
    const mask = Number(record?.collisionMask) | 0;
    if (table?.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM
        && table?.skirtCollidesWithThigh
        && /Skirt/i.test(record?.bone || '')) {
        // Kotone thighs sit on layer 64. Other idols (e.g. hski school) keep
        // Leg/UpLeg on whatever mask the native capture used — OR those in too.
        let thighLayers = 64;
        for (const collider of table.colliders || []) {
            if (/^(Left|Right)(UpLeg|Leg)$/.test(collider?.bone || '')) {
                thighLayers |= Number(collider.collisionMask) | 0;
            }
        }
        return mask | thighLayers;
    }
    return mask;
}

export function nativeStaticColliderAllowed(records, collider, table) {
    const dynamicRecords = Array.isArray(records) ? records : [records];
    const effectiveMask = dynamicRecords.reduce(
        (mask, record) => mask & effectiveSpringCollisionMask(record, table),
        -1,
    );
    const colliderMask = Number(collider?.mask) | 0;
    if (!masksOverlap(effectiveMask, colliderMask)) return false;

    // The recovered skirt flag adds the thigh layer as a targeted contact.
    // Layer 64 is also used by Hips/Spine in some captures, so do not let
    // that extra bit silently turn every body capsule into a skirt shell.
    const hasSkirt = dynamicRecords.some(record => /Skirt/i.test(record?.bone || ''));
    const originalMask = dynamicRecords.reduce(
        (mask, record) => mask & dynamicRecordMask(record),
        -1,
    );
    const isAddedSkirtLayer = table?.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM
        && table?.skirtCollidesWithThigh
        && hasSkirt
        && !masksOverlap(originalMask, colliderMask);
    if (isAddedSkirtLayer && !THIGH_COLLIDER_NAME.test(collider?.record?.bone || '')) return false;
    return true;
}

// ActorAnimationSwingSolver builds a node on the current bone but takes its
// dynamic setting from that node's first non-zero child. The current record
// still owns the root weights and angular limits; this merged view is only
// for particle force and collision properties.
export function nativeDynamicSpringRecord(item) {
    const record = item?.record || {};
    const dynamic = item?.dynamicRecord || item?.tailRecord || record;
    if (dynamic === record) return record;
    return {
        ...record,
        ...dynamic,
        bone: record.bone,
        part: record.part,
        rootWeight: record.rootWeight,
        rootHorizontalWeight: record.rootHorizontalWeight,
        rootVerticalWeight: record.rootVerticalWeight,
        limitInfo: record.limitInfo,
        referenceLimitInfo: record.referenceLimitInfo,
    };
}

export function quatFromTo(from, to) {
    const a = normalize(from);
    const b = normalize(to);
    if (vecLength(a) < 1e-8 || vecLength(b) < 1e-8) return [0, 0, 0, 1];
    const cosine = dot(a, b);
    if (cosine > 0.999999) return [0, 0, 0, 1];
    if (cosine < -0.999999) {
        let axis = cross(a, [1, 0, 0]);
        if (vecLength(axis) < 1e-6) axis = cross(a, [0, 1, 0]);
        return quatFromAxisAngle(normalize(axis), 180);
    }
    const axis = cross(a, b);
    return quatNormalize([axis[0], axis[1], axis[2], 1 + cosine]);
}

export function carryParticleWithRest(current, previous, origin, lastOrigin, restTail, lastRestTail, rotateRestDirection = true) {
    let nextCurrent = current;
    let nextPrevious = previous;
    if (lastOrigin) {
        const carried = sub(origin, lastOrigin);
        nextCurrent = add(nextCurrent, carried);
        nextPrevious = add(nextPrevious, carried);
    }
    if (rotateRestDirection && lastRestTail) {
        const from = sub(lastRestTail, lastOrigin || origin);
        const to = sub(restTail, origin);
        if (vecLength(from) > 1e-6 && vecLength(to) > 1e-6 && dot(normalize(from), normalize(to)) > -0.85) {
            const extra = quatFromTo(from, to);
            nextCurrent = add(origin, quatRotate(extra, sub(nextCurrent, origin)));
            nextPrevious = add(origin, quatRotate(extra, sub(nextPrevious, origin)));
        }
    }
    return { current: nextCurrent, previous: nextPrevious };
}

// ActorAnimationSwingSolver.NativeRootCancel removes only the configured
// portion of hips translation from a dynamic node's anchor. This is what lets
// a skirt lag behind a moving leg instead of being teleported with it.
export function relativeRootMotionDelta(delta, record, rootFollow = 1) {
    if (!Array.isArray(delta) || !/Skirt/i.test(record?.bone || '')) return [0, 0, 0];
    const weight = clampAxis((Number(record?.rootWeight) || 0) * (Number(rootFollow) || 0), 0, 1);
    return scale(delta, 1 - weight);
}

/**
 * Carry a native skirt particle through the thigh's rigid-frame rotation.
 *
 * The actual ttmr GLB parents its skirt roots under UpLeg_H, below UpLeg.
 * The transform hierarchy already carries their base pose; only particle
 * history needs the parent's rigid delta before relative swing is integrated.
 * Never multiply the thigh rotation into the inherited bone pose again.
 */
export function carryParticleWithCarrier(current, previous, previousAnchor, currentAnchor, previousRotation, currentRotation) {
    const delta = quatNormalize(quatMultiply(currentRotation || [0, 0, 0, 1], quatInverse(previousRotation || [0, 0, 0, 1])));
    const carry = point => add(currentAnchor, quatRotate(delta, sub(point, previousAnchor)));
    return { current: carry(current), previous: carry(previous), delta };
}

export function preserveHairRestTail(restTail, origin, lastOrigin, previousRestTail, isHair) {
    if (!isHair || !previousRestTail || !lastOrigin) return restTail;
    return add(previousRestTail, sub(origin, lastOrigin));
}

export function extraAxisAngle(extraQuat) {
    const [x, y, z, w] = extraQuat;
    const clamped = clampAxis(w, -1, 1);
    const angle = 2 * Math.acos(clamped) * 180 / Math.PI;
    const sine = Math.sin(Math.acos(clamped));
    if (angle < 1e-6 || Math.abs(sine) < 1e-8) return { axis: [1, 0, 0], angle: 0 };
    return { axis: [x / sine, y / sine, z / sine], angle };
}

export function remapLimitsToTail(limitInfo, tailLocal) {
    if (!limitInfo?.useLimit) return limitInfo;
    const names = ['axisX', 'axisY', 'axisZ'];
    const locked = names.findIndex(name => {
        const range = limitInfo[name];
        return Array.isArray(range) && range[0] === 0 && range[1] === 0;
    });
    const chain = dominantAxis(tailLocal);
    if (locked < 0 || chain === locked) return limitInfo;
    const unlocked = [0, 1, 2].filter(index => index !== locked);
    const targets = [0, 1, 2].filter(index => index !== chain);
    const next = { ...limitInfo };
    next[names[chain]] = limitInfo[names[locked]];
    next[names[targets[0]]] = limitInfo[names[unlocked[0]]];
    next[names[targets[1]]] = limitInfo[names[unlocked[1]]];
    return next;
}

export function clampExtraByLimits(extraQuat, limitInfo) {
    if (!limitInfo?.useLimit) return extraQuat;
    const names = ['axisX', 'axisY', 'axisZ'];
    const lockedAxis = names.findIndex(name => {
        const range = limitInfo[name];
        return Array.isArray(range) && range[0] === 0 && range[1] === 0;
    });
    if (lockedAxis >= 0) {
        const { axis, angle } = extraAxisAngle(extraQuat);
        axis[lockedAxis] = 0;
        const length = vecLength(axis);
        if (length < 1e-8 || angle < 1e-6) return [0, 0, 0, 1];
        const maxAngle = names
            .map((name, index) => index === lockedAxis ? 0 : Math.max(Math.abs(limitInfo[name]?.[0] ?? 0), Math.abs(limitInfo[name]?.[1] ?? 0)))
            .reduce((max, value) => Math.max(max, value), 0);
        const limited = clampAxis(angle, -maxAngle, maxAngle);
        return quatFromAxisAngle(scale(axis, 1 / length), limited);
    }
    const euler = quaternionToEulerDegreesXYZ(extraQuat);
    return eulerDegreesToQuaternionXYZ([
        clampAxis(euler[0], limitInfo.axisX?.[0] ?? -180, limitInfo.axisX?.[1] ?? 180),
        clampAxis(euler[1], limitInfo.axisY?.[0] ?? -180, limitInfo.axisY?.[1] ?? 180),
        clampAxis(euler[2], limitInfo.axisZ?.[0] ?? -180, limitInfo.axisZ?.[1] ?? 180),
    ]);
}

function isNativeHairFrameSegment(record) {
    const name = record?.bone || '';
      // Segment 1 is the attached anchor. The captured local-frame
      // calibration starts at the first free child segment, i.e. segment 2.
    return /^(?:Center|Left|Right)(?:HairSide|SideHair|FrontTopSideHair|SideBackCHair|SideBackHair|BackHair|BackSideHair|BackUHair)(?:[2-9]\d*)_S(?:_End)?$/i.test(name);
}

/**
 * Build the local frame used by the native swing particle after the hair
 * anchor. Unity stores the dynamic axis in boneAxis and the particle's rest
 * orientation in modelingLocalTx.rotation. PMX tailLocal is the stage-side
 * representation of the same chain direction, so this quaternion maps the
 * native simulation axis into the PMX bone-local tail axis.
 */
export function nativeHairLimitFrame(record, tailLocal) {
    if (!isNativeHairFrameSegment(record)) return null;
    const axis = normalize(record?.nativeBoneAxis || [0, 0, 0]);
    const rotation = record?.modelingLocalTx?.rotation;
    const tail = normalize(tailLocal || [0, 0, 0]);
    if (vecLength(axis) < 1e-8 || vecLength(tail) < 1e-8 || !Array.isArray(rotation) || rotation.length < 4) return null;
    const nativeAxisInParent = normalize(quatRotate(unityLocalRotationToThree(rotation), axis));
    if (vecLength(nativeAxisInParent) < 1e-8) return null;
    return quatFromTo(nativeAxisInParent, tail);
}

export function clampExtraByNativeHairFrame(extraQuat, record, tailLocal) {
    const frame = nativeHairLimitFrame(record, tailLocal);
    if (!frame) return clampExtraByLimits(extraQuat, remapLimitsToTail(record?.limitInfo, tailLocal));
    const inverse = quatInverse(frame);
    const nativeExtra = quatMultiply(quatMultiply(inverse, extraQuat), frame);
    const limited = clampExtraByLimits(nativeExtra, record?.limitInfo);
    return quatMultiply(quatMultiply(frame, limited), inverse);
}

export function nativeParticleLimitFrame(record, tailRecord, recordsByIndex, tailLocal) {
    if (!record?.limitInfo?.useLimit || !Array.isArray(tailRecord?.nativeBoneAxis)) return null;
    if (!(recordsByIndex instanceof Map)) return null;
    const chain = [];
    const seen = new Set();
    let current = record;
    while (current) {
        const rotation = current?.modelingLocalTx?.rotation;
        if (!Array.isArray(rotation) || rotation.length < 4 || seen.has(current)) return null;
        seen.add(current);
        chain.push(rotation);
        const parentIndex = current.nativeParentIndex;
        if (!Number.isInteger(parentIndex) || parentIndex < 0) break;
        current = recordsByIndex.get(parentIndex);
        if (!current) return null;
    }
    let unity = [0, 0, 0, 1];
    for (const rotation of chain.reverse()) unity = quatMultiply(unity, quatNormalize(rotation));
    const axisUnity = quatRotate(unity, normalize(tailRecord.nativeBoneAxis));
    const axisThree = [-axisUnity[0], axisUnity[1], axisUnity[2]];
    const tail = normalize(tailLocal || [0, 0, 0]);
    if (vecLength(axisThree) < 1e-8 || vecLength(tail) < 1e-8) return null;
    const fix = quatFromTo(axisThree, tail);
    // The frame is derived from the child particle axis, but the spring being
    // solved owns the angular limits. Keep the authored parent limits here;
    // using the child limits changes the permitted swing for the visible tail.
    return { unity: quatNormalize(unity), fix, limitInfo: record.limitInfo };
}

function nativeParticleToLocal(frame, vectorThree) {
    const unfixed = quatRotate(quatInverse(frame.fix), vectorThree);
    const mirrored = [unfixed[0], -unfixed[1], -unfixed[2]];
    return quatRotate(quatInverse(frame.unity), mirrored);
}

function nativeParticleToThree(frame, vectorLocal) {
    const unity = quatRotate(frame.unity, vectorLocal);
    return quatRotate(frame.fix, [unity[0], -unity[1], -unity[2]]);
}

export function clampExtraByNativeParticleLimits(extraQuat, frame, limitInfo = frame?.limitInfo) {
    if (!frame || !limitInfo?.useLimit) return extraQuat;
    const q = extraQuat[3] < 0 ? extraQuat.map(value => -value) : extraQuat;
    const { axis, angle } = extraAxisAngle(q);
    if (angle < 1e-6) return [0, 0, 0, 1];
    const local = nativeParticleToLocal(frame, scale(axis, angle));
    const limited = [
        clampAxis(local[0], limitInfo.axisX?.[0] ?? -180, limitInfo.axisX?.[1] ?? 180),
        clampAxis(local[1], limitInfo.axisY?.[0] ?? -180, limitInfo.axisY?.[1] ?? 180),
        clampAxis(local[2], limitInfo.axisZ?.[0] ?? -180, limitInfo.axisZ?.[1] ?? 180),
    ];
    const back = nativeParticleToThree(frame, limited);
    const limitedAngle = vecLength(back);
    if (limitedAngle < 1e-6) return [0, 0, 0, 1];
    return quatFromAxisAngle(scale(back, 1 / limitedAngle), limitedAngle);
}

export function nativeParticleSwing(extraQuat, frame) {
    const q = extraQuat[3] < 0 ? extraQuat.map(value => -value) : extraQuat;
    const { axis, angle } = extraAxisAngle(q);
    if (!frame || angle < 1e-6) return [0, 0, 0];
    return nativeParticleToLocal(frame, scale(axis, angle));
}

export function separateRing(points, minDistance, around, response = 1, restDistances = null) {
    if (!points?.length || minDistance <= 0) return points?.map(point => [...point]) || [];
    const next = points.map(point => [...point]);
    const correctionResponse = Number.isFinite(Number(response))
        ? clampAxis(Number(response), 0, 1)
        : 1;
    const last = around ? next.length : next.length - 1;
    for (let index = 0; index < last; index++) {
        const other = (index + 1) % next.length;
        const offset = sub(next[other], next[index]);
        const distance = vecLength(offset);
        const authoredDistance = Array.isArray(restDistances) ? Number(restDistances[index]) : Infinity;
        const pairMinimum = Number.isFinite(authoredDistance)
            ? Math.min(minDistance, Math.max(0, authoredDistance))
            : minDistance;
        if (distance >= pairMinimum || distance < 1e-8) continue;
        const push = scale(offset, ((pairMinimum - distance) / (2 * distance)) * correctionResponse);
        next[index] = sub(next[index], push);
        next[other] = add(next[other], push);
    }
    return next;
}

/**
 * Port of CallTarget_7FF9660E3020 mode 2, which is the pair-overlap branch
 * called by the recovered 5573E010 body. When the two points are inside the
 * sum of their scaled radii, the native routine moves them toward the
 * contact interval. A later collision stage consumes those points to decide
 * the final response; this function must not be used as a replacement for
 * chain-wide separation. Its second displacement intentionally uses the
 * first displacement in the denominator; preserve that ordering instead of
 * replacing it with a symmetrical solver.
 */
export function recoveredSwingPairCollision(first, second, radiusA, radiusB, radiusScale = 1, epsilon = 1e-8) {
    const pointA = Array.isArray(first) ? first : [0, 0, 0];
    const pointB = Array.isArray(second) ? second : [0, 0, 0];
    const rawA = Number(radiusA);
    const rawB = Number(radiusB);
    if (!(rawA > 0 || rawB > 0)) return { first: [...pointA], second: [...pointB], collided: false };

    const delta = sub(pointB, pointA);
    const distance = vecLength(delta);
    if (!(distance > epsilon)) return { first: [...pointA], second: [...pointB], collided: false };

    const finiteRadius = value => Number.isFinite(value) && value >= 0 ? value : 0;
    const scaleValue = Number.isFinite(Number(radiusScale)) ? Number(radiusScale) : 0;
    const scaledA = finiteRadius(rawA) * scaleValue;
    const scaledB = finiteRadius(rawB) * scaleValue;
    const total = scaledA + scaledB;
    if (!(distance < total) || !(total > epsilon)) return { first: [...pointA], second: [...pointB], collided: false };

    const overlap = total - distance;
    const moveA = Math.max(0, scaledA - (overlap * scaledA) / total);
    const moveBDenominator = scaledB + moveA;
    const moveB = moveBDenominator > epsilon
        ? Math.max(0, scaledB - (overlap * scaledB) / moveBDenominator)
        : 0;
    const direction = scale(delta, 1 / distance);
    return {
        first: add(pointA, scale(direction, moveA)),
        second: sub(pointB, scale(direction, moveB)),
        collided: true,
        distance,
        radiusA: scaledA,
        radiusB: scaledB,
        moveA,
        moveB,
    };
}

function matrixElements(bone) {
    return bone?.matrixWorld?.elements;
}

function worldPositionOf(bone) {
    const m = matrixElements(bone);
    return m ? [m[12], m[13], m[14]] : [0, 0, 0];
}

function worldQuaternionOf(bone) {
    if (!bone) return [0, 0, 0, 1];
    const target = bone.quaternion?.clone?.();
    if (target && typeof bone.getWorldQuaternion === 'function') {
        bone.getWorldQuaternion(target);
        return readQuat(target);
    }
    return readQuat(bone.quaternion);
}

function nativeRootCancel(hips, record = {}, tuning = DEFAULT_SECONDARY_TUNING) {
    const weight = f32(Number(tuning.nativeRootWeight ?? 1));
    const rootWeight = f32(Number(record.rootWeight ?? 0));
    const horizontal = f32(Number(record.rootHorizontalWeight ?? rootWeight));
    const vertical = f32(Number(record.rootVerticalWeight ?? rootWeight));
    return [
        f32((hips?.[0] || 0) * (1 - weight * horizontal * rootWeight)),
        f32((hips?.[1] || 0) * (1 - weight * vertical * rootWeight)),
        f32((hips?.[2] || 0) * (1 - weight * horizontal * rootWeight)),
    ];
}

function worldToLocalDir(bone, v) {
    const m = matrixElements(bone);
    if (!m) return v;
    return [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
        m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
    ];
}

function localToWorldDir(bone, v) {
    const m = matrixElements(bone);
    if (!m) return v;
    return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
    ];
}

function worldPointFromLocal(bone, local) {
    const m = matrixElements(bone);
    if (!m) return local;
    const x = local[0];
    const y = local[1];
    const z = local[2];
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
}

function localPositionOf(bone, restEntry) {
    if (restEntry?.position?.toArray) return restEntry.position.toArray();
    if (bone?.position?.toArray) return bone.position.toArray();
    return [0, 0, 0];
}

function modelingWorldPositionOf(record) {
    const position = record?.modelingWorldPosition;
    if (!Array.isArray(position) || position.length < 3) return null;
    const values = position.slice(0, 3).map(Number);
    return values.every(Number.isFinite) ? values : null;
}

function modelingRestTailLocal(parentRecord, childRecord, worldScale) {
    const parent = modelingWorldPositionOf(parentRecord);
    const child = modelingWorldPositionOf(childRecord);
    if (!parent || !child) return null;
    // modelingLocalTx is in Unity's parent space. Converting its resolved
    // world rest positions avoids applying the Unity parent rotation twice to
    // the PMX skeleton, whose rest quaternions are identity-based.
    return [
        (parent[0] - child[0]) * worldScale,
        (child[1] - parent[1]) * worldScale,
        (child[2] - parent[2]) * worldScale,
    ];
}

function nativeChainKind(item) {
    return /Skirt/i.test(item?.record?.bone || '') ? 'skirt'
        : /Jacket/i.test(item?.record?.bone || '') ? 'jacket'
            : 'other';
}

function nativeChainMinimumDistance(link, source, target, scaleFactor, tuning) {
    const kind = nativeChainKind(source) !== 'other'
        ? nativeChainKind(source)
        : nativeChainKind(target);
    const radiusScale = kind === 'skirt'
        ? Number(tuning.chainSkirtRadius)
        : kind === 'jacket'
            ? Number(tuning.chainJacketRadius)
            : 1;
    const safeRadiusScale = Number.isFinite(radiusScale) ? Math.max(0, radiusScale) : 1;
    const radiusA = Number(link?.radiusA);
    const radiusB = Number(link?.radiusB);
    const authoredRadius = Number.isFinite(radiusA) && Number.isFinite(radiusB)
        ? Math.max(0, radiusA) + Math.max(0, radiusB)
        : 0;
    const fallbackRadius = Number(link?.layerRadius) > 0 ? Number(link.layerRadius) * 2 : 0;
    const gap = Number.isFinite(Number(tuning.chainGap)) ? Math.max(0, Number(tuning.chainGap)) : 0;
    return (Math.max(authoredRadius, fallbackRadius) * safeRadiusScale + gap) * scaleFactor;
}

function updateWorld(bone) {
    bone?.updateMatrixWorld?.(true);
}

// Updating one bone with updateMatrixWorld(true) also walks every descendant.
// The solver writes spring bones from shallow to deep, so the hot path only
// needs the ancestor chain up to the bone being read. Keeping this separate
// from updateWorld() preserves the recursive refresh used for a complete
// model reset while avoiding an O(springs * modelSubtree) walk every tick.
function updateWorldPath(bone) {
    if (!bone?.updateMatrixWorld) return;
    const path = [];
    for (let current = bone; current; current = current.parent) {
        path.push(current);
        // The scene is a container for several stage actors. Updating it can
        // recursively refresh sibling actors even with a false force flag;
        // the model-level node already provides the complete local path.
        if (current.parent?.isScene || current.parent?.type === 'Scene') break;
    }
    for (let index = path.length - 1; index >= 0; index -= 1) {
        const node = path[index];
        // Object3D.updateMatrixWorld(false) can still recurse into all
        // children when matrixWorldNeedsUpdate is set. The solver only needs
        // this node's world matrix, so update the path node directly and keep
        // the unrelated render hierarchy out of the physics hot path.
        if (node.matrix && node.matrixWorld && typeof node.matrixWorld.multiplyMatrices === 'function') {
            if (node.matrixAutoUpdate) node.updateMatrix?.();
            if (node.parent?.matrixWorld) node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
            else node.matrixWorld.copy(node.matrix);
            node.matrixWorldNeedsUpdate = false;
        } else {
            node.updateMatrixWorld(false);
        }
    }
}

function writeQuat(bone, q) {
    bone?.quaternion?.set?.(q[0], q[1], q[2], q[3]);
}

function writeVec3(vector, value) {
    if (!value) return;
    vector?.set?.(value[0], value[1], value[2]);
}

function capturePose(bones) {
    return (bones || []).map(bone => ({
        bone,
        position: [bone.position?.x || 0, bone.position?.y || 0, bone.position?.z || 0],
        quaternion: bone.quaternion?.toArray?.() || [0, 0, 0, 1],
    }));
}

function writePose(pose) {
    for (const entry of pose || []) {
        writeVec3(entry.bone?.position, entry.position);
        writeQuat(entry.bone, entry.quaternion);
    }
    // The host updates the complete model after the physics pass. During a
    // fixed substep refresh only the topmost bone branches represented by the
    // pose; walking up to the Scene or updating every descendant repeatedly
    // makes each catch-up step needlessly expensive.
    const entries = pose || [];
    const included = new Set(entries.map(entry => entry.bone));
    for (const entry of entries) {
        if (!included.has(entry.bone?.parent)) updateWorld(entry.bone);
    }
}

function blendPose(previous, current, alpha) {
    const left = previous || current || [];
    const right = current || previous || [];
    const rightByBone = new Map(right.map(entry => [entry.bone, entry]));
    const t = clampAxis(Number(alpha) || 0, 0, 1);
    return left.map(entry => {
        const other = rightByBone.get(entry.bone) || entry;
        return {
            bone: entry.bone,
            position: [0, 1, 2].map(index => entry.position[index] + (other.position[index] - entry.position[index]) * t),
            quaternion: quatSlerp(entry.quaternion, other.quaternion, t),
        };
    });
}

function isBoneNode(node) {
    return node?.isBone || (node?.isBone === undefined && node?.quaternion);
}

export function firstChildBone(bone, byName) {
    if (bone?.name) {
        const prefix = bone.name.replace(/_S(?:_End)?$/, '').replace(/\d+$/, '');
        const index = Number((/(\d+)_S/.exec(bone.name) || [])[1] || 0);
        const named = byName.get(`${prefix}${index + 1}_S`)?.bone || byName.get(`${prefix}${index + 1}_S_End`)?.bone;
        // The next numbered bone is the tail only when the PMX actually parents
        // it here. HSKI skips LeftHairSide3 and hangs 4_S_End directly on 2_S.
        if (named && named.parent === bone) return named;
    }
    return (bone?.children || []).find(child => isBoneNode(child)) || null;
}

export function usesModelingHairRest() {
    // modelingWorldPosition is a world-space sample. The PMX child local
    // position is already the visible tail. Using the world sample as a
    // bone-local axis rotates the bind pose on the first physics write.
    return false;
}

function terminalTailLocal(bone, record, scaleFactor, length) {
    const safeLength = Math.abs(Number(length) || 0) * (scaleFactor || 1);
    if (safeLength < 1e-4) return null;
    const parent = bone?.parent;
    if (parent) {
        updateWorld(bone);
        updateWorld(parent);
        const incoming = sub(worldPositionOf(bone), worldPositionOf(parent));
        const localIncoming = worldToLocalDir(bone, incoming);
        if (vecLength(localIncoming) > 1e-4) return scale(normalize(localIncoming), safeLength);
    }
    const axis = normalize(record?.nativeBoneAxis || [0, 0, 0]);
    if (vecLength(axis) > 1e-4) return scale(axis, safeLength);
    return null;
}

export function continueAlongRest(local, unityLength, scaleFactor) {
    const length = Math.abs(unityLength || 0) * (scaleFactor || 1);
    if (length < 1e-4) return [0, 0, 0];
    if (vecLength(local) > 1e-4) return scale(normalize(local), length);
    return [0, -length, 0];
}

export class SecondaryMotion {
    constructor(table = { drivers: [], springs: [], colliders: [], chains: [] }) {
        this.table = table;
        this.tuning = { ...DEFAULT_SECONDARY_TUNING };
        this.bindings = [];
        this.bindingByBone = new Map();
        this.bindingByTarget = new Map();
        this.springs = [];
        this.colliders = [];
        this.chains = [];
        this.nativeChainLinks = [];
        this.nativeChainGroups = [];
        this.referenceLimitBindings = [];
        this.referenceAffectedSprings = [];
        this.dynamicClothingPairs = [];
        this.dynamicClothingPairsByGroup = [];
        this.skirtRootFollowBindings = [];
        this.springDepthGroups = [];
        this.enabled = true;
        this.missing = [];
        this.scale = 1;
        this.localScale = 1;
        this.clothingTrace = null;
        this.lastColliderGeometry = null;
        // Match FixedStepSwingClock: the render loop supplies elapsed time,
        // while the native job consumes accumulated 1/60 s ticks and the
        // rendered pose is interpolated between the last two ticks.
        this.fixedRemainder = 0;
        this.fixedInitialized = false;
        this.fixedBones = [];
        this.fixedPreviousInput = null;
        this.fixedCurrentInput = null;
        this.fixedPreviousOutput = null;
        this.fixedCurrentOutput = null;
        this.animationPose = null;
        this.fixedStepCount = 0;
        this.fixedRoot = null;
        this.lastRootPosition = null;
        this.nativePrewarmSteps = Number.isFinite(Number(table.nativePrewarmSteps ?? table.prewarmSteps))
            ? Math.max(0, Math.floor(Number(table.nativePrewarmSteps ?? table.prewarmSteps)))
            : table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM ? 30 : 0;
        this.prewarmPending = false;
        // The authored Unity values are local-model units. GLB models may be
        // uniformly rescaled by the Stage before being attached to the scene;
        // that parent scale must also affect world tails, gravity and colliders.
        this.worldScale = 1;
        this.motionRoot = null;
        this.lastMotionRoot = null;
        // Runtime counters mirror the Unity runner's observable Step state.
        // Keep them separate from clothingTrace so normal use can show that
        // the solver is actually ticking.
        this.runtime = {
            renderFrames: 0,
            fixedSteps: 0,
            lastDelta: 0,
            lastOutputBones: 0,
            maxAngularOffset: 0,
            skirtQuartzDrivers: 0,
            skirtQuartzMaxAngle: 0,
            skirtQuartzLastBone: '',
            quartzDriversApplied: 0,
            staticCollisionHits: 0,
            thighCollisionHits: 0,
            maxCollisionCorrection: 0,
            lastCollisionBone: '',
            chainCollisionHits: 0,
            thighChainCollisionHits: 0,
            referenceLimitApplied: 0,
            referenceLimitMaxAngle: 0,
            referenceLimitLastBone: '',
        };
    }

    bind(restPose) {
        // The stage constructs this solver before its idol profile is loaded.
        // Re-read the profile-level prewarm setting here so the browser path
        // gets the same ActorSwing initialization budget as direct callers
        // that pass the table to the constructor.
        this.nativePrewarmSteps = Number.isFinite(Number(this.table.nativePrewarmSteps ?? this.table.prewarmSteps))
            ? Math.max(0, Math.floor(Number(this.table.nativePrewarmSteps ?? this.table.prewarmSteps)))
            : this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM ? 30 : 0;
        const byName = new Map((restPose || []).map(entry => [entry.bone?.name, entry]));
        const springRecords = new Map((this.table.springs || []).map(record => [record.bone, record]));
        this.missing = [];
        this.bindings = [];
        this.bindingByBone = new Map();
        this.bindingByTarget = new Map();
        this.springs = [];
        this.colliders = [];
        this.chains = [];
        this.nativeChainLinks = [];
        this.nativeChainGroups = [];
        this.referenceLimitBindings = [];
        this.referenceAffectedSprings = [];
        this.dynamicClothingPairs = [];
        this.dynamicClothingPairsByGroup = [];
        this.skirtRootFollowBindings = [];
        let root = restPose?.[0]?.bone;
        // Keep the solver root at the model's top-level Object3D. Walking all
        // the way to Scene makes refreshWorld() traverse unrelated stage
        // objects and also puts the native root frame outside the actor.
        while (root?.parent && !root.parent.isScene && root.parent.type !== 'Scene') root = root.parent;
        this.fixedRoot = root;
        this.motionRoot = byName.get('Hips')?.bone || root;
        root?.updateMatrixWorld?.(true);
        const authoredScale = medianScale((this.table.springs || []).map(record => [
            vecLength(record.unityLocalPosition || [0, 0, 0]),
            vecLength(localPositionOf(byName.get(record.bone)?.bone, byName.get(record.bone))),
        ]));
        this.localScale = authoredScale;
        const sceneScale = Number.isFinite(Number(this.worldScale)) ? Math.max(0, Number(this.worldScale)) : 1;
        this.scale = authoredScale * sceneScale;
        for (const driver of [...selectQuartzDrivers(this.table), ...selectJacketFollowDrivers(this.table)]) {
            const target = byName.get(driver.bone);
            if (!target) {
                this.missing.push(driver.bone);
                continue;
            }
            const humanoidReference = [QUARTZ_HUMANOID_ARM, QUARTZ_HUMANOID_HAND, QUARTZ_HUMANOID_UPLEG].includes(driver.className)
                ? (driver.setting?.referenceBone?.name || driver.bone?.replace(/_(?:Roll_)?H$/, ''))
                : null;
            const referenceName = driver.className === QUARTZ_ROTATION
                ? driver.setting?.referenceBone?.name
                : driver.className === QUARTZ_SKIRT
                    ? driver.setting?.referenceBone?.name
                    : humanoidReference;
            const sources = driver.className === QUARTZ_HAIR
                ? [byName.get('Head'), byName.get('Neck')]
                : [byName.get(referenceName)];
            if (sources.some(entry => !entry)) {
                this.missing.push(`${driver.bone}←${driver.className === QUARTZ_HAIR ? 'Head/Neck' : referenceName}`);
                continue;
            }
            this.bindings.push({
                driver,
                target,
                sources,
                skirtOuter: true,
                restPosition: localPositionOf(target.bone, target),
            });
        }
        // Jacket3 drivers reuse the matching skirt anchor's computed delta.
        // Index once at bind time so the per-tick Quartz pass stays linear in
        // the number of drivers instead of rescanning every binding.
        this.bindingByBone = new Map(this.bindings.map(binding => [binding.driver.bone, binding]));
        this.bindingByTarget = new Map(this.bindings.map(binding => [binding.target.bone, binding]));
        const skirtRootFollow = this.table.nativeSkirtRootFollow;
        if (skirtRootFollow && typeof skirtRootFollow === 'object' && !Array.isArray(skirtRootFollow)) {
            for (const [targetName, sourceName] of Object.entries(skirtRootFollow)) {
                const target = byName.get(targetName);
                const source = byName.get(sourceName);
                if (!target || !source) {
                    this.missing.push(`${targetName}←${sourceName}`);
                    continue;
                }
                this.skirtRootFollowBindings.push({
                    target,
                    source,
                    targetRest: target.quaternion.toArray(),
                    sourceRest: source.quaternion.toArray(),
                });
            }
        }
        const nativeRecordsByIndex = new Map((this.table.springs || [])
            .filter(record => Number.isInteger(record?.nativeDynamicIndex))
            .map(record => [record.nativeDynamicIndex, record]));
        for (const record of this.table.springs || []) {
            if (this.table.disableHairSprings && record.part === 'hair') continue;
            if (this.table.disableSkirtMotion && (record.part === 'skirt' || /Skirt/i.test(record.bone || ''))) continue;
            if (this.table.disabledSpringBones?.includes(record.bone)) continue;
            const entry = byName.get(record.bone);
            if (!entry) {
                this.missing.push(record.bone);
                continue;
            }
            const child = firstChildBone(entry.bone, byName);
            const childRest = child ? byName.get(child.name) : null;
            const childRecord = child ? springRecords.get(child.name) : null;
            // PMX keeps the imported jacket chain in an identity-based rest
            // frame, so the captured Unity world positions are used there to
            // rebuild the tail. GLB keeps each bone's bind rotation. Feeding
            // that same world delta into a GLB parent as a local vector turns
            // the tail sideways (and can make the jacket jump outward). The
            // exported child local position is already in the correct GLB
            // parent frame.
            const useModelingRest = this.table.skirtDriverBasis !== 'gltf-unity'
                && this.table.useModelingRestPose !== false
                && /Jacket/i.test(record.bone || '');
            const useModelingHair = usesModelingHairRest(record, this.table);
            let tailLocal = useModelingRest || useModelingHair
                ? modelingRestTailLocal(record, childRecord, this.localScale)
                : null;
            if (!tailLocal) tailLocal = childRest ? localPositionOf(child, childRest) : [0, 0, 0];
            if (vecLength(tailLocal) < 1e-4) {
                if (childRest) continue;
                tailLocal = useModelingHair
                    ? terminalTailLocal(entry.bone, record, this.localScale, vecLength(record.unityLocalPosition || [0, 0, 0]))
                    : continueAlongRest(localPositionOf(entry.bone, entry), vecLength(record.unityLocalPosition || [0, 0, 0]), this.localScale);
            }
            if (vecLength(tailLocal) < 1e-4) continue;
            const nativeParticleLimit = shouldUseNativeParticleHairLimit(record, this.table)
                ? nativeParticleLimitFrame(record, childRecord, nativeRecordsByIndex, tailLocal)
                : null;
            const nativeSkirtCarrierName = this.table.nativeSkirtCarrier === 'thigh' && /Skirt/i.test(record.bone || '')
                ? (/^Left/i.test(record.bone || '') ? 'LeftUpLeg'
                    : /^Right/i.test(record.bone || '') ? 'RightUpLeg' : null)
                : null;
            this.springs.push({
                record,
                dynamicRecord: childRecord || record,
                entry,
                tailLocal,
                axis: normalize(tailLocal),
                childLocalPosition: scale(tailLocal, sceneScale),
                childLocalRotation: childRest?.quaternion?.toArray?.() || child?.quaternion?.toArray?.() || [0, 0, 0, 1],
                nativeParticleLimit,
                // tailLocal remains in the GLB bone's local space; the
                // constraint/integration length is evaluated in world space.
                restLength: vecLength(tailLocal) * sceneScale,
                current: [0, 0, 0],
                previous: [0, 0, 0],
                nativePosition: [0, 0, 0],
                nativePreviousPosition: [0, 0, 0],
                speed: [0, 0, 0],
                selfRotation: worldQuaternionOf(entry.bone),
                defaultRotation: worldQuaternionOf(entry.bone),
                poseRootRotation: worldQuaternionOf(entry.bone),
                poseParentRootRotation: worldQuaternionOf(entry.bone?.parent),
                rootCancel: [0, 0, 0],
                prewarmCache: [],
                parentSpring: null,
                childSpring: null,
                nativeAnchor: null,
                carrierBone: nativeSkirtCarrierName ? byName.get(nativeSkirtCarrierName)?.bone || null : null,
                carrierLastRotation: null,
                carrierLastPosition: null,
                skeletonDepth: 0,
                lastOrigin: null,
                lastRestTail: null,
                physicsRestTail: null,
                motionRoot: /Skirt/i.test(record.bone || '') && /Left/i.test(record.bone || '')
                    ? byName.get('LeftUpLeg')?.bone
                    : /Skirt/i.test(record.bone || '') && /Right/i.test(record.bone || '')
                        ? byName.get('RightUpLeg')?.bone
                        : this.motionRoot,
                lastMotionRoot: null,
                collided: false,
                collisionHold: 0,
                tailBone: child?.name || null,
                tailParent: child?.parent?.name || null,
                tailRecord: childRecord || null,
                renderedTailLocal: childRest && usesRenderedChildCollision(record, this.table) ? localPositionOf(child, childRest) : null,
            });
        }
        const depth = bone => {
            let count = 0;
            let node = bone?.parent;
            while (node) {
                count += 1;
                node = node.parent;
            }
            return count;
        };
        for (const item of this.springs) item.skeletonDepth = depth(item.entry.bone);
        this.springs.sort((a, b) => a.skeletonDepth - b.skeletonDepth
            || Number(a.record.nativeDynamicIndex ?? Number.POSITIVE_INFINITY) - Number(b.record.nativeDynamicIndex ?? Number.POSITIVE_INFINITY));
        const springByBone = new Map(this.springs.map(item => [item.record.bone, item]));
        for (const item of this.springs) {
            const parentName = item.entry.bone?.parent?.name;
            item.parentSpring = parentName ? springByBone.get(parentName) || null : null;
            if (item.parentSpring) item.parentSpring.childSpring = item;
        }
        for (const item of this.springs) {
            if (!item.carrierBone) continue;
            const thigh = item.carrierBone;
            let chainRoot = item;
            while (chainRoot.parentSpring) chainRoot = chainRoot.parentSpring;
            const parent = chainRoot.entry.bone?.parent;
            let ancestor = parent;
            while (ancestor && ancestor !== thigh) ancestor = ancestor.parent;
            // UpLeg_H applies the captured roll correction. Use that real
            // parent frame for every particle in the chain, including children.
            // A PMX sibling hierarchy does not inherit the GLB thigh pose and
            // must not silently receive this GLB-specific state adaptation.
            item.carrierBone = ancestor === thigh ? parent : null;
        }
        this.referenceLimitBindings = (this.table.nativeReferenceLimits === true ? this.springs : [])
            .map(target => {
                const info = target.record?.referenceLimitInfo;
                if (!target.record?.limitInfo?.useLimit || !hasNativeReferenceLimit(info)) return null;
                const referenceName = info.bone?.name || info.bone;
                const referenceItem = springByBone.get(referenceName) || null;
                const referenceEntry = byName.get(referenceName) || null;
                if (!referenceItem && !referenceEntry) {
                    this.missing.push(`${target.record.bone}←${referenceName}`);
                    return null;
                }
                return { target, referenceItem, referenceEntry, info };
            })
            .filter(Boolean)
            .sort((first, second) => first.target.skeletonDepth - second.target.skeletonDepth);
        const referenceTargets = new Set(this.referenceLimitBindings.map(binding => binding.target));
        // Cache only the constrained branches; never traverse meshes or scan
        // every spring for every reference correction during a physics tick.
        this.referenceAffectedSprings = this.springs.filter(item => {
            for (let ancestor = item; ancestor; ancestor = ancestor.parentSpring) {
                if (referenceTargets.has(ancestor)) return true;
            }
            return false;
        });
        this.springDepthGroups = [];
        for (const item of this.springs) {
            let group = this.springDepthGroups.at(-1);
            if (!group || group.depth !== item.skeletonDepth) {
                group = { depth: item.skeletonDepth, items: [] };
                this.springDepthGroups.push(group);
            }
            group.items.push(item);
        }
        const springGroupIndex = new Map();
        this.springDepthGroups.forEach((group, index) => {
            for (const item of group.items) springGroupIndex.set(item, index);
        });
        for (const record of this.table.colliders || []) {
            const sourceEntry = byName.get(record.bone);
            // Some recovered colliders are stage aliases rather than PMX
            // bones. Keep the bake reference and runtime carrier separate:
            // the native Head_Face endpoints are authored in Head rest space,
            // while the native driven handle points at the face helper. A
            // profile can therefore set carrierBone when the helper has its
            // own runtime transform; otherwise restBone remains the carrier.
            const carrierName = record.carrierBone || record.restBone || record.bone;
            const entry = byName.get(carrierName) || sourceEntry;
            if (!entry) {
                this.missing.push(record.bone);
                continue;
            }
            // Head_Face is a stage-only native collider. Its local endpoints
            // stay in the captured bake frame; carrierBone only selects the
            // transform that moves that frame at runtime.
            this.colliders.push({
                record,
                entry,
                childLocal: colliderAimLocal(record.bone, entry, byName),
                aim: record.aimBone ? byName.get(record.aimBone) : null,
            });
        }
        for (const chain of this.table.chains || []) {
            this.chains.push({
                ...chain,
                layers: (chain.layers || []).filter(layer => layer.active).map(layer => ({
                    ...layer,
                    items: (layer.bones || []).map(name => this.springs.find(item => item.record.bone === name)).filter(Boolean),
                })),
            });
        }
        const nativeChainRecords = this.table.nativeChainGeometry?.records || [];
        const springByNativeIndex = new Map(this.springs
            .filter(item => Number.isInteger(Number(item.record.nativeDynamicIndex)))
            .map(item => [Number(item.record.nativeDynamicIndex), item]));
        // ActorSwingChain stores particles by the named child transform. The
        // explicit GLB export uses sourceBone/targetBone for that representation
        // so a chain link for Jacket2 points at the tail of Jacket1, matching
        // BuildChainLayers in Unity. Older PMX tables keep the native-index
        // path below for compatibility.
        const springByTailBone = new Map(this.springs
            .filter(item => item.tailBone)
            .map(item => [item.tailBone, item]));
        const nativeGroups = new Map();
        for (const native of nativeChainRecords) {
            if (native.active === false || Number(native.active) === 0) continue;
            const childParticleBinding = native.particleBinding === 'child';
            const source = childParticleBinding
                ? springByTailBone.get(native.sourceBone)
                : springByNativeIndex.get(Number(native.dynamicBoneIndex));
            const targetIndex = Number(native.dynamicBoneIndex) + Number(native.chainOffsetIndex);
            const target = childParticleBinding
                ? springByTailBone.get(native.targetBone)
                : springByNativeIndex.get(targetIndex);
            if (!source || !target || source === target) continue;
            const key = `${native.depth}:${native.around ? 1 : 0}:${nativeChainKind(source)}`;
            const group = nativeGroups.get(key) || {
                depth: Number(native.depth) || 0,
                around: !!native.around,
                kind: nativeChainKind(source),
                initialLoopLength: Number(native.initialLoopLength) || 0,
                smoothing: Number(native.smoothing) || 0,
                links: [],
            };
            group.links.push({
                source,
                target,
                radiusA: Number(native.radiusA),
                radiusB: Number(native.radiusB),
                smoothing: Number(native.smoothing) || 0,
                chainOffsetIndex: Number(native.chainOffsetIndex) || 0,
                sourceBone: native.sourceBone || null,
                targetBone: native.targetBone || null,
                particleBinding: native.particleBinding || 'spring',
            });
            nativeGroups.set(key, group);
        }
        this.nativeChainGroups = [...nativeGroups.values()]
            .filter(group => group.links.length > 0)
            .sort((first, second) => first.depth - second.depth);
        this.nativeChainLinks = this.nativeChainGroups.flatMap(group => group.links);
        this.dynamicClothingPairs = [];
        const nativePairGrouping = this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM;
        const dynamicPairGroupCount = this.springs.length > 0
            ? nativePairGrouping ? Math.max(1, this.springDepthGroups.length) : 1
            : 0;
        this.dynamicClothingPairsByGroup = Array.from({ length: dynamicPairGroupCount }, () => []);
        for (let firstIndex = 0; firstIndex < this.springs.length; firstIndex += 1) {
            const first = this.springs[firstIndex];
            for (let secondIndex = firstIndex + 1; secondIndex < this.springs.length; secondIndex += 1) {
                const second = this.springs[secondIndex];
                if (!dynamicParticlePairAllowed(first.record, second.record)) continue;
                const pair = [first, second];
                this.dynamicClothingPairs.push(pair);
                const firstGroup = nativePairGrouping ? (springGroupIndex.get(first) ?? 0) : 0;
                const secondGroup = nativePairGrouping ? (springGroupIndex.get(second) ?? firstGroup) : 0;
                const pairGroup = Math.max(firstGroup, secondGroup);
                this.dynamicClothingPairsByGroup[pairGroup].push(pair);
            }
        }
        for (const chain of this.chains) {
            for (const layer of chain.layers) {
                const restPoints = layer.items.map(item => worldPointFromLocal(item.entry.bone, item.tailLocal));
                const edgeCount = layer.around ? restPoints.length : Math.max(0, restPoints.length - 1);
                layer.restDistances = Array.from({ length: edgeCount }, (_, index) => {
                    const other = (index + 1) % restPoints.length;
                    return vecLength(sub(restPoints[other], restPoints[index]));
                });
            }
        }
        this.fixedBones = this.#collectFixedBones(restPose?.[0]?.bone);
        this.runtime.renderFrames = 0;
        this.runtime.fixedSteps = 0;
        this.runtime.lastDelta = 0;
        this.runtime.lastOutputBones = this.springs.length;
        this.runtime.maxAngularOffset = 0;
        this.runtime.staticCollisionHits = 0;
        this.runtime.thighCollisionHits = 0;
        this.runtime.maxCollisionCorrection = 0;
        this.runtime.lastCollisionBone = '';
        this.runtime.chainCollisionHits = 0;
        this.runtime.thighChainCollisionHits = 0;
        this.reset();
        this.#traceBindings();
        return this;
    }

    setTuning(values = {}) {
        for (const key of ['gravity', 'damping', 'spring', 'stiffness', 'physics', 'rootFollow']) {
            const value = Number(values[key]);
            if (Number.isFinite(value)) this.tuning[key] = Math.max(0, value);
        }
        for (const key of ['chainSkirtRadius', 'chainJacketRadius']) {
            const value = Number(values[key]);
            if (Number.isFinite(value)) this.tuning[key] = clampAxis(value, 0, 2);
        }
        const gap = Number(values.chainGap);
        if (Number.isFinite(gap)) this.tuning.chainGap = clampAxis(gap, 0, 0.06);
        if (values.chainOrder === 'before-collision' || values.chainOrder === 'after-collision') {
            this.tuning.chainOrder = values.chainOrder;
        }
    }

    getTuning() {
        return { ...this.tuning };
    }

    setInitialRotation(boneName, euler = [0, 0, 0]) {
        const record = (this.table.springs || []).find(item => item.bone === boneName);
        if (!record) return;
        record.initialRotationEuler = euler.map(value => Number.isFinite(Number(value)) ? Number(value) : 0);
        this.reset();
    }

    startClothingTrace(metadata = {}) {
        this.clothingTrace = { metadata: { schemaVersion: 1, startedAt: new Date().toISOString(), ...metadata }, resets: [], droppedResets: 0, frames: [], bindings: [], ticks: 0, complete: false };
        this.#traceBindings();
    }

    clearClothingTrace() { this.clothingTrace = null; }
    getClothingTraceStatus() { const t=this.clothingTrace; return t ? {active:true,ticks:t.ticks,frames:t.frames.length,complete:t.complete,droppedResets:t.droppedResets} : {active:false,ticks:0,complete:false}; }
    getClothingTrace() { return this.clothingTrace ? JSON.parse(JSON.stringify(this.clothingTrace)) : null; }
    #traceBindings() { if (!this.clothingTrace) return; this.clothingTrace.bindings=this.springs.map(item=>({bone:item.record.bone,part:item.record.part,tailBone:item.tailBone,tailParent:item.tailParent,tailLocal:[...item.tailLocal],restLength:item.restLength,restQuaternion:item.entry.quaternion.toArray(),record:{...item.record}})); }
    #traceReset() { if (!this.clothingTrace) return; const e={tick:this.clothingTrace.ticks,bones:this.springs.map(item=>({bone:item.record.bone,origin:worldPositionOf(item.entry.bone),tail:worldPointFromLocal(item.entry.bone,item.tailLocal),quaternion:item.entry.bone.quaternion.toArray()}))}; if(this.clothingTrace.resets.length<8)this.clothingTrace.resets.push(e);else this.clothingTrace.droppedResets++; }
    reset() {
        this.#traceReset();
        this.lastColliderGeometry = null;
        this.fixedRemainder = 0;
        this.fixedInitialized = false;
        this.fixedPreviousInput = null;
        this.fixedCurrentInput = null;
        this.fixedPreviousOutput = null;
        this.fixedCurrentOutput = null;
        this.animationPose = null;
        this.fixedStepCount = 0;
        this.lastRootPosition = null;
        this.lastMotionRoot = this.motionRoot ? worldPositionOf(this.motionRoot) : null;
        this.prewarmPending = this.nativePrewarmSteps > 0;
        for (const binding of this.bindings) binding.extra = null;
        for (const item of this.springs) {
            // The captured localTx is an initial dynamic state. Seed it once
            // during reset; applying it again on every frame would compound
            // the snapshot rotation and make the chain drift.
            writeQuat(item.entry.bone, this.enabled ? this.#followedRest(item, seedsInitialRotationOffset(item.record, this.table)) : item.entry.quaternion.toArray());
            updateWorldPath(item.entry.bone);
            const origin = worldPositionOf(item.entry.bone);
            const tail = worldPointFromLocal(item.entry.bone, item.tailLocal);
            item.current = tail;
            item.previous = [...tail];
            item.nativePosition = this.#solverPointFromWorld(tail);
            item.nativePreviousPosition = [...item.nativePosition];
            item.speed = [0, 0, 0];
            item.selfRotation = worldQuaternionOf(item.entry.bone);
            item.defaultRotation = [...item.selfRotation];
            item.poseRootRotation = [...item.selfRotation];
            item.poseParentRootRotation = worldQuaternionOf(item.entry.bone?.parent);
            item.rootCancel = [0, 0, 0];
            item.prewarmCache = [];
            item.nativeAnchor = this.#solverPointFromWorld(origin);
            if (item.carrierBone && this.table.nativeSkirtCarrier === 'thigh') {
                updateWorldPath(item.carrierBone);
                const carrierRotation = this.#solverRotationFromWorld(worldQuaternionOf(item.carrierBone));
                item.carrierLastRotation = [...carrierRotation];
                item.carrierLastPosition = this.#solverPointFromWorld(worldPositionOf(item.carrierBone));
            } else {
                item.carrierLastRotation = null;
                item.carrierLastPosition = null;
            }
            item.lastOrigin = origin;
            item.lastRestTail = tail;
            item.physicsRestTail = tail;
            item.lastMotionRoot = item.motionRoot ? worldPositionOf(item.motionRoot) : null;
        }
    }

    // Unity's HairSwingAdapter restores the animation pose before Animator
    // runs. The host must call this immediately before updating its mixer or
    // animation helper so a previous interpolated physics pose is not fed back
    // into the next animation sample.
    restoreBeforeAnimation() {
        if (!this.animationPose) return;
        writePose(this.animationPose);
    }

    update(delta = 1 / 60, options = {}) {
        this.runtime.renderFrames += 1;
        if (!this.enabled) {
            this.#restoreRest();
            this.reset();
            return;
        }
        const requestedMaxSteps = Number(options?.maxFixedSteps);
        const maxFixedSteps = Number.isFinite(requestedMaxSteps)
            ? Math.max(1, Math.min(6, Math.floor(requestedMaxSteps)))
            : 6;
        const dropRemainder = options?.dropRemainder === true;
        const renderDelta = Number.isFinite(Number(delta)) ? Math.max(0, Number(delta)) : NATIVE_FIXED_STEP;
        this.lastRenderDelta = renderDelta;
        this.runtime.lastDelta = renderDelta;
        const input = capturePose(this.fixedBones);
        this.animationPose = input;
        const rootNow = this.fixedRoot ? worldPositionOf(this.fixedRoot) : null;
        const resetDistance = Number.isFinite(Number(this.table.resetDistance))
            ? Math.max(0, Number(this.table.resetDistance)) * this.scale
            : 2 * this.scale;
        if (rootNow && this.lastRootPosition && resetDistance > 0
            && vecLength(sub(rootNow, this.lastRootPosition)) > resetDistance) {
            // HairSwingAdapter requests a solver reset when the animated root
            // teleports. Keep the freshly sampled animation pose; reset only
            // the dynamic history before the next fixed tick consumes it.
            this.reset();
            this.animationPose = input;
        }
        this.lastRootPosition = rootNow;

        // FixedStepSwingClock performs one native step to initialize the
        // solver, even if the first render frame is shorter than one tick.
        if (!this.fixedInitialized) {
            this.fixedPreviousInput = input;
            this.fixedCurrentInput = input;
            if (this.prewarmPending) {
                // ActorSwing performs the configured prewarm budget inside one
                // node step (NativeStep * prewarmSteps * 0.5). Repeating the
                // whole stage pass here multiplies that budget by N and also
                // reinitializes each particle between passes.
                this.#runFixedStep(input, true);
                this.prewarmPending = false;
            }
            this.#runFixedStep(input);
            this.runtime.fixedSteps += 1;
            const output = this.#captureOutputPose();
            this.fixedPreviousOutput = output;
            this.fixedCurrentOutput = output;
            this.fixedInitialized = true;
            this.fixedRemainder = 0;
            this.fixedStepCount = 1;
            return;
        }

        this.fixedCurrentInput = input;
        const clampedDelta = Math.min(renderDelta, 0.1);
        if (clampedDelta <= 0) {
            writePose(input);
            this.#applyQuartz();
            this.#refreshWorld();
            this.#applyInterpolatedOutput(1);
            this.fixedStepCount = 0;
            return;
        }

        let elapsed = this.fixedRemainder + clampedDelta;
        let nextTick = NATIVE_FIXED_STEP - this.fixedRemainder;
        let stepCount = 0;
        while (elapsed + 1e-7 >= NATIVE_FIXED_STEP && stepCount < maxFixedSteps) {
            const fraction = clampAxis(nextTick / clampedDelta, 0, 1);
            const tickInput = blendPose(this.fixedPreviousInput, this.fixedCurrentInput, fraction);
            writePose(tickInput);
            this.#runFixedStep(tickInput);
            this.runtime.fixedSteps += 1;
            this.fixedPreviousOutput = this.fixedCurrentOutput || this.#captureOutputPose();
            this.fixedCurrentOutput = this.#captureOutputPose();
            elapsed -= NATIVE_FIXED_STEP;
            nextTick += NATIVE_FIXED_STEP;
            stepCount += 1;
        }
        // Background actors can intentionally trade temporal fidelity for CPU
        // time. In that mode the caller asks for one fixed step and drops the
        // accumulated catch-up debt instead of replaying every skipped tick.
        this.fixedRemainder = dropRemainder ? 0 : Math.max(0, elapsed);
        this.fixedPreviousInput = input;
        writePose(input);
        this.#applyQuartz();
        this.#refreshWorld();
        // At an exact tick boundary the newest fixed output is the visible
        // pose. The reference clock's zero remainder represents the start of
        // that output interval; using alpha=0 here would leave the rendered
        // bone one tick behind its particle state and detach chain diagnostics
        // from the bone it describes.
        const outputAlpha = this.fixedRemainder < 1e-7
            ? 1
            : this.fixedRemainder / NATIVE_FIXED_STEP;
        this.#applyInterpolatedOutput(outputAlpha);
        this.fixedStepCount = stepCount;
    }

    #collectFixedBones(root) {
        const bones = new Set();
        const add = bone => {
            let current = bone;
            // GLTFLoader may represent Unity driver/end nodes as ordinary
            // Object3D instances. Include the starting node, then walk only
            // through actual bones so the Scene/Group hierarchy is not
            // accidentally captured into the animation pose.
            while (current && (current === bone || current.isBone)) {
                bones.add(current);
                current = current.parent;
            }
        };
        for (const item of this.springs) add(item.entry?.bone);
        for (const binding of this.bindings) {
            add(binding.target?.bone);
            for (const source of binding.sources || []) add(source?.bone);
        }
        for (const collider of this.colliders) {
            add(collider.entry?.bone);
            add(collider.aim?.bone);
        }
        for (const binding of this.referenceLimitBindings) add(binding.referenceEntry?.bone);
        for (const binding of this.skirtRootFollowBindings) {
            add(binding.target?.bone);
            add(binding.source?.bone);
        }
        if (!bones.size && root?.isBone) add(root);
        const depth = bone => {
            let value = 0;
            for (let current = bone?.parent; current; current = current.parent) value += 1;
            return value;
        };
        return [...bones].sort((a, b) => depth(a) - depth(b));
    }

    #captureOutputPose() {
        const pose = capturePose(this.springs.map(item => item.entry?.bone).filter(Boolean));
        let maxAngularOffset = 0;
        for (const item of this.springs) {
            const actual = item.entry?.bone?.quaternion?.toArray?.();
            if (!actual) continue;
            maxAngularOffset = Math.max(maxAngularOffset, quatAngleDegrees(actual, this.#followedRest(item, false)));
        }
        this.runtime.lastOutputBones = pose.length;
        this.runtime.maxAngularOffset = Math.max(this.runtime.maxAngularOffset, maxAngularOffset);
        return pose;
    }

    #applyInterpolatedOutput(alpha) {
        const pose = blendPose(this.fixedPreviousOutput, this.fixedCurrentOutput, alpha);
        writePose(pose);
    }

    #runFixedStep(input, prewarm = false) {
        writePose(input);
        this.#applyQuartz();
        this.#refreshWorld();
        this.#applySprings(NATIVE_FIXED_STEP, prewarm);
    }

    #restoreRest() {
        for (const binding of this.bindings) {
            const rest = binding.target.quaternion.toArray();
            writeQuat(binding.target.bone, rest);
            if (binding.hairShifted) writeVec3(binding.target.bone?.position, binding.restPosition);
        }
        for (const item of this.springs) {
            const rest = item.entry.quaternion.toArray();
            writeQuat(item.entry.bone, rest);
        }
        for (const binding of this.skirtRootFollowBindings) {
            writeQuat(binding.target.bone, binding.targetRest);
        }
    }

    #applyQuartz() {
        this.runtime.skirtQuartzDrivers = 0;
        this.runtime.skirtQuartzMaxAngle = 0;
        this.runtime.skirtQuartzLastBone = '';
        this.runtime.quartzDriversApplied = 0;
        // Some GLB outfits keep the skirt root as a sibling of the humanoid
        // thigh instead of parenting it below UpLeg_H. Unity still carries
        // that duplicate root with the thigh before the panel Quartz driver
        // runs. Apply the captured local delta first so the panel driver adds
        // its bend on top of a moving hip attachment point.
        for (const binding of this.skirtRootFollowBindings) {
            const relative = relativeQuaternion(
                binding.sourceRest,
                binding.source.bone.quaternion.toArray(),
            );
            writeQuat(binding.target.bone, composeRestAndQuat(binding.targetRest, relative));
        }
        for (const binding of this.bindings) {
            const { driver, target, sources } = binding;
            if (driver.className === QUARTZ_HAIR) {
                if (this.table.disableHairQuartz) continue;
                const headRest = sources[0].quaternion.toArray();
                const neckRest = sources[1].quaternion.toArray();
                const headLive = sources[0].bone.quaternion.toArray();
                const neckLive = sources[1].bone.quaternion.toArray();
                if (this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM) {
                    const headRelative = relativeQuaternion(headRest, headLive);
                    const neckRelative = relativeQuaternion(neckRest, neckLive);
                    writeQuat(target.bone, composeRestAndQuat(
                        target.quaternion.toArray(),
                        recoveredHairDriverQuaternion(headRelative, neckRelative, driver.setting),
                    ));
                    binding.hairShifted = true;
                    writeVec3(target.bone?.position, binding.restPosition);
                } else {
                    writeQuat(target.bone, composeRestAndExtra(
                        target.quaternion.toArray(),
                        hairDriverEuler(
                            relativeEulerDegrees(headRest, headLive),
                            relativeEulerDegrees(neckRest, neckLive),
                            driver.setting,
                        ),
                    ));
                }
                continue;
            }
            if (driver.className === QUARTZ_HUMANOID_UPLEG) {
                const restRotation = sources[0].quaternion.toArray();
                const liveRotation = sources[0].bone.quaternion.toArray();
                const relative = relativeQuaternion(restRotation, liveRotation);
                binding.extra = humanoidUpLegDriverQuaternion(relative, driver.setting);
                writeQuat(target.bone, composeRestAndQuat(target.quaternion.toArray(), binding.extra));
                this.runtime.quartzDriversApplied += 1;
                continue;
            }
            if (driver.className === QUARTZ_HUMANOID_ARM || driver.className === QUARTZ_HUMANOID_HAND) {
                const restRotation = sources[0].quaternion.toArray();
                const liveRotation = sources[0].bone.quaternion.toArray();
                const relative = relativeQuaternion(restRotation, liveRotation);
                binding.extra = humanoidQuartzDriverQuaternion(relative, driver.setting);
                writeQuat(target.bone, composeRestAndQuat(target.quaternion.toArray(), binding.extra));
                this.runtime.quartzDriversApplied += 1;
                continue;
            }
            if (driver.className === QUARTZ_ROTATION) {
                const restRotation = sources[0].quaternion.toArray();
                const liveRotation = sources[0].bone.quaternion.toArray();
                const relative = relativeQuaternion(restRotation, liveRotation);
                binding.extra = quartzRotationDriverQuaternion(relative, driver.setting);
                writeQuat(target.bone, composeRestAndQuat(target.quaternion.toArray(), binding.extra));
                this.runtime.quartzDriversApplied += 1;
                continue;
            }
            const side = driverSide(driver.bone);
            const recovered = this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM;
            const restRotation = sources[0].quaternion.toArray();
            const liveRotation = sources[0].bone.quaternion.toArray();
            const relative = recovered
                ? skirtReferenceQuaternion(restRotation, liveRotation)
                : relativeQuaternion(restRotation, liveRotation);
            const outer = skirtIsOuter(relative, driver.setting, side, binding.skirtOuter);
            binding.skirtOuter = outer;
            let extra = recovered
                ? (this.table.skirtDriverBasis === 'gltf-unity'
                    ? nativeSkirtDriverQuaternion(restRotation, liveRotation, driver.setting, {
                        settingsConverted: this.table.skirtDriverSettingsConverted === true,
                    })
                    : recoveredSkirtDriverQuaternion(relative, driver.setting, skirtDriverSwingSigns(this.table, driver.bone)))
                : skirtDriverQuaternion(relative, driver.setting, side, outer);
            if (/Jacket3_S$/.test(driver.bone || '')) {
                    const skirtExtra = this.bindingByBone.get(jacketSkirtAnchor(driver.bone))?.extra;
                extra = scaleFollowExtra(skirtExtra || extra, JACKET_FOLLOW_WEIGHT);
                binding.extra = extra;
            } else {
                binding.extra = recovered ? extra : smoothFollowExtra(binding.extra, extra, FOLLOW_SMOOTH);
            }
            writeQuat(target.bone, composeRestAndQuat(target.quaternion.toArray(), binding.extra));
            this.runtime.quartzDriversApplied += 1;
            if (driver.className === QUARTZ_SKIRT && !/Jacket3_S$/.test(driver.bone || '')) {
                const angle = quatAngleDegrees([0, 0, 0, 1], binding.extra);
                this.runtime.skirtQuartzDrivers += 1;
                if (angle > this.runtime.skirtQuartzMaxAngle) {
                    this.runtime.skirtQuartzMaxAngle = angle;
                    this.runtime.skirtQuartzLastBone = driver.bone;
                }
            }
        }
    }

    #refreshWorld() {
        // Quartz writes several local rotations before the spring pass. Keep
        // the refresh restricted to the binding/collider paths; refreshing
        // the complete model root here makes idle characters pay for every
        // mesh and helper node on every physics tick.
        const refreshed = new Set();
        const refresh = bone => {
            if (!bone || refreshed.has(bone)) return;
            refreshed.add(bone);
            updateWorldPath(bone);
        };
        for (const { target } of this.bindings) refresh(target.bone);
        for (const item of this.colliders) {
            refresh(item.entry.bone);
            refresh(item.aim?.bone);
        }
    }

    #solverRootPosition() {
        return this.fixedRoot ? worldPositionOf(this.fixedRoot) : [0, 0, 0];
    }

    #solverRootRotation() {
        return worldQuaternionOf(this.fixedRoot);
    }

    #solverPointFromWorld(point) {
        return quatRotate(quatInverse(this.#solverRootRotation()), sub(point, this.#solverRootPosition()));
    }

    #worldPointFromSolver(point) {
        return add(this.#solverRootPosition(), quatRotate(this.#solverRootRotation(), point));
    }

    #solverRotationFromWorld(rotation) {
        return quatNormalize(quatMultiply(quatInverse(this.#solverRootRotation()), rotation));
    }

    #worldRotationFromSolver(rotation) {
        return quatNormalize(quatMultiply(this.#solverRootRotation(), rotation));
    }

    #writeNativeRotation(item, rotation) {
        const worldRotation = this.#worldRotationFromSolver(rotation);
        const parentRotation = worldQuaternionOf(item.entry.bone?.parent);
        writeQuat(item.entry.bone, quatNormalize(quatMultiply(quatInverse(parentRotation), worldRotation)));
        item.selfRotation = quatNormalize(rotation);
        return item.selfRotation;
    }

    #nativeWriteToward(item, anchor, next, applyUnityLimits = false, convertUnityLimitToGlb = false) {
        const direction = normalize(sub(next, anchor));
        const solved = nativeSwingRotation(
            item.selfRotation,
            item.selfRotation,
            item.poseParentRootRotation || item.selfRotation,
            item.axis,
            direction,
            applyUnityLimits ? item.record?.limitInfo : null,
            1,
            convertUnityLimitToGlb,
        );
        this.#writeNativeRotation(item, solved);
        return solved;
    }

    #carryNativeSkirtState() {
        if (this.table.nativeSkirtCarrier !== 'thigh') return;
        const frames = new Map();
        for (const item of this.springs) {
            if (!item.carrierBone) continue;
            let frame = frames.get(item.carrierBone);
            if (!frame) {
                updateWorldPath(item.carrierBone);
                frame = {
                    position: this.#solverPointFromWorld(worldPositionOf(item.carrierBone)),
                    rotation: this.#solverRotationFromWorld(worldQuaternionOf(item.carrierBone)),
                };
                frames.set(item.carrierBone, frame);
            }
            const carried = carryParticleWithCarrier(
                item.nativePosition,
                item.nativePreviousPosition,
                item.carrierLastPosition || frame.position,
                frame.position,
                item.carrierLastRotation || frame.rotation,
                frame.rotation,
            );
            item.nativePosition = carried.current;
            item.nativePreviousPosition = carried.previous;
            // Free velocity is a relative vector, not a world-fixed direction.
            // Carry it too; collision projections still never become speed.
            item.speed = quatRotate(carried.delta, item.speed);
            item.current = this.#worldPointFromSolver(add(item.nativePosition, item.rootCancel));
            item.previous = this.#worldPointFromSolver(add(item.nativePreviousPosition, item.rootCancel));
            item.carrierLastRotation = frame.rotation;
            item.carrierLastPosition = frame.position;
        }
    }

    #applySprings(dt, prewarm = false) {
        const worldColliders = orderStaticCollidersForNativePass(this.colliders.map(({ record, entry, childLocal, aim }) => {
            const runtimeRecord = { ...record, runtimeWorldScale: this.worldScale };
            const shape = authoredColliderShape(runtimeRecord, this.scale, childLocal);
            let { start, end } = colliderWorldEnds(runtimeRecord, entry, aim, shape, this.scale);
            return {
                mask: record.collisionMask,
                start,
                end,
                radiusA: shape.radiusA,
                radiusB: shape.kind === 'capsule' ? shape.radiusB : shape.radiusA,
                shape,
                bone: entry.bone,
                record,
            };
        }), this.table);
        this.#traceFrameStart(dt, worldColliders);
        const movingBody = colliderGeometryMoved(worldColliders, this.lastColliderGeometry);
        this.lastColliderGeometry = worldColliders.map(collider => ({
            start: [...collider.start],
            end: [...collider.end],
        }));
        const nativeOrder = this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM;
        const springGroups = nativeOrder && this.springDepthGroups?.length
            ? this.springDepthGroups
            : [{ depth: null, items: this.springs }];
        const processed = new Set();
        const appliedNativeGroups = new Set();
        if (nativeOrder) {
            // Carry all depths once, after Quartz and before any spring writes.
            // The inherited bone pose already contains the thigh/helper turn.
            this.#carryNativeSkirtState();
            // CapturePose records every local rotation before the depth pass.
            // The parent pass later copies its solved rotation into the
            // downstream node, so a child starts from the current animated
            // parent frame while its particle history remains dynamic.
            for (const item of this.springs) {
                writeQuat(item.entry.bone, this.#followedRest(item, false));
                updateWorldPath(item.entry.bone);
                item.poseLocalRotation = readQuat(item.entry.bone?.quaternion);
                item.poseRootRotation = this.#solverRotationFromWorld(worldQuaternionOf(item.entry.bone));
            }
        }
        for (const [groupIndex, group] of springGroups.entries()) {
            for (const item of group.items) {
            writeQuat(item.entry.bone, this.#followedRest(item, false));
            updateWorldPath(item.entry.bone);
            const nativeParent = nativeOrder ? item.parentSpring : null;
            const animatedWorldRotation = worldQuaternionOf(item.entry.bone);
            const origin = worldPositionOf(item.entry.bone);
            const restTail = worldPointFromLocal(item.entry.bone, item.tailLocal);
            const isHairParticle = shouldPreserveHairRestTail(item.record.bone, this.table);
            const physicsRestTail = preserveHairRestTail(
                restTail,
                origin,
                item.lastOrigin,
                item.physicsRestTail,
                isHairParticle,
            );
            const carried = nativeOrder
                ? { current: [...item.current], previous: [...item.previous] }
                : carryParticleWithRest(
                    item.current,
                    item.previous,
                    origin,
                    item.lastOrigin,
                    restTail,
                    item.lastRestTail,
                    !isHairParticle,
                );
            item.current = carried.current;
            item.previous = carried.previous;
            item.lastOrigin = origin;
            item.lastRestTail = restTail;
            item.physicsRestTail = physicsRestTail;
            if (nativeOrder && prewarm) {
                item.current = [...physicsRestTail];
                item.previous = [...physicsRestTail];
                item.nativePosition = this.#solverPointFromWorld(physicsRestTail);
                item.nativePreviousPosition = [...item.nativePosition];
                item.speed = [0, 0, 0];
            }
            const tuning = this.tuning;
            // HskiHairPortRunner assigns actor.transform as
            // rootMotionSource. Hips is only the legacy PMX clothing root;
            // using it for the recovered GLB solver treats the bind-pose
            // height of the hips as root translation and can lift a skirt
            // upward by the whole character height.
            const motionRoot = nativeOrder
                ? (this.fixedRoot || this.motionRoot)
                : (item.motionRoot || this.motionRoot);
            const currentMotionRoot = motionRoot ? worldPositionOf(motionRoot) : null;
            const rootDelta = currentMotionRoot && item.lastMotionRoot
                ? sub(currentMotionRoot, item.lastMotionRoot)
                : [0, 0, 0];
            const hips = currentMotionRoot ? this.#solverPointFromWorld(currentMotionRoot) : [0, 0, 0];
            const rootCancel = nativeOrder
                ? nativeRootCancel(hips, item.record, tuning)
                : relativeRootMotionDelta(rootDelta, item.record, tuning.rootFollow);
            item.rootCancel = [...rootCancel];
            item.lastMotionRoot = currentMotionRoot;
            if (nativeOrder) {
                if (nativeParent) {
                    // The parent pass assigns downstream.selfRotation before
                    // IntegrateNode runs. Particle position/velocity provide
                    // inertia; the local rotation frame itself follows the
                    // solved parent and the captured child local rotation.
                    item.selfRotation = quatNormalize(quatMultiply(nativeParent.selfRotation, item.poseLocalRotation));
                    item.poseParentRootRotation = [...item.selfRotation];
                } else {
                    item.poseRootRotation = this.#solverRotationFromWorld(animatedWorldRotation);
                    item.selfRotation = [...item.poseRootRotation];
                    item.poseParentRootRotation = [...item.selfRotation];
                }
                item.defaultRotation = [...item.selfRotation];
                item.nativeAnchor = nativeParent
                    ? [...nativeParent.nativePosition]
                    : sub(this.#solverPointFromWorld(origin), rootCancel);
            }
            // Unity solves this node in a root-cancelled frame. Native
            // particles stay in root space; the legacy path keeps its older
            // world-space carry behavior for PMX compatibility.
            const simulationOrigin = nativeOrder
                ? [...item.nativeAnchor]
                : sub(origin, rootCancel);
            const simulationCurrent = nativeOrder
                ? [...item.nativePosition]
                : sub(item.current, rootCancel);
            const simulationPrevious = nativeOrder
                ? [...item.nativePreviousPosition]
                : sub(item.previous, rootCancel);
            const simulationRestTail = nativeOrder
                ? this.#solverPointFromWorld(physicsRestTail)
                : sub(physicsRestTail, rootCancel);
            const dynamicRecord = nativeOrder
                ? (item.dynamicRecord || item.tailRecord || item.record)
                : item.record;
            // Keep profile-level clothing gravity overrides active for the
            // recovered native path too. The generic tuning remains the
            // default, while an idol can disable skirt gravity without
            // disabling its carried thigh frame, inertia, damping or contacts.
            const gravityScale = gravityScaleForSpring(item.record, this.table, tuning)
                * (nativeOrder ? 1 : pendulumGravityFactor(item.record, item.tailRecord, this.table));
            const params = {
                ...dynamicRecord,
                damping: (dynamicRecord.damping ?? 0) * tuning.damping,
                spring: (dynamicRecord.spring ?? 0) * tuning.spring,
                stiffness: (dynamicRecord.stiffness ?? 0) * tuning.stiffness,
                gravityScale,
                bone: item.record.bone,
                nativeAnchor: simulationOrigin,
                nativeRestDirection: nativeOrder
                    ? quatRotate(item.selfRotation, item.axis)
                    : normalize(sub(simulationRestTail, simulationOrigin)),
                nativeSelfRotation: nativeOrder ? item.selfRotation : null,
                nativeRootOrigin: [0, 0, 0],
                nativeRestLength: item.restLength,
            };
            // Unity applies gravity in actor-world units. GLB geometry is
            // rendered under the stage root scale, while `this.scale` is the
            // local bone-to-authored conversion used for lengths. Keep these
            // scales separate so hair gravity is not reduced to a barely
            // visible local-space nudge.
            const gravityWorldScale = Number.isFinite(Number(this.worldScale))
                ? Math.max(1, Number(this.worldScale))
                : 1;
            const integration = nativeOrder
                ? nativeIntegrateSwingNode({
                    position: simulationCurrent,
                    speed: item.speed,
                    selfRotation: item.selfRotation,
                }, params, {
                    anchor: simulationOrigin,
                    childLocal: item.childLocalPosition,
                    axis: item.axis,
                    length: item.restLength,
                    worldScale: gravityWorldScale,
                    prewarm,
                    prewarmSteps: this.nativePrewarmSteps,
                })
                : { next: integrateTail(simulationPrevious, simulationCurrent, simulationRestTail, params, dt * tuning.physics, gravityWorldScale), speed: sub(simulationCurrent, simulationPrevious) };
            if (nativeOrder) {
                item.speed = integration.speed;
                item.selfRotation = integration.selfRotation;
                item.nativePreviousPosition = integration.previousPosition;
                item.nativePosition = integration.position;
            }
            let next = nativeOrder ? integration.position : add(integration.next, rootCancel);
            const traceFrame = this.clothingTrace?.frames.at(-1);
            const traceBone = traceFrame?.bones.find(entry => entry.bone === item.record.bone);
            if (traceBone) { traceBone.before = { current: [...item.current], previous: [...item.previous], speed: [...item.speed], origin: [...origin], restTail: [...restTail] }; traceBone.afterIntegration = [...next]; traceBone.parameters = { damping: params.damping, spring: params.spring, stiffness: params.stiffness, gravityScale: params.gravityScale, dt: dt * tuning.physics, fixedStep: NATIVE_FIXED_STEP, nativeOrder }; }
            // Unity's native solver applies rootWeight through NativeRootCancel
            // (the root-follow cancellation term), not by pinning the solved
            // particle back to its rest tail. Keep the old rest-tail blend only
            // for the legacy Stage integrator; applying it to native particles
            // suppresses the rotation of SideBackHair1_S and similar roots.
            if (!nativeOrder && /1_S$/.test(item.record.bone || '')) {
                const rootWeight = clampAxis((item.record.rootWeight ?? 0) * this.tuning.rootFollow, 0, 1);
                const rootRest = nativeOrder ? this.#solverPointFromWorld(physicsRestTail) : physicsRestTail;
                next = add(scale(next, 1 - rootWeight), scale(rootRest, rootWeight));
            }
            const nativeIntegratedRotation = nativeOrder ? [...item.selfRotation] : null;
            const nativeAnchorWorld = nativeOrder
                ? this.#worldPointFromSolver(add(simulationOrigin, rootCancel))
                : origin;
            if (nativeOrder) next = constrainLength(simulationOrigin, next, item.restLength);
            let nextWorld = nativeOrder
                ? this.#worldPointFromSolver(add(next, rootCancel))
                : next;
            // ActorSwing derives the provisional rotation from the free,
            // unprojected point before applying the fixed-length and contact
            // projections. The final writeback below is still based on the
            // projected point, but collision helpers see the same provisional
            // local frame as the native pass.
            const nativeBaseQuaternion = nativeOrder ? this.#followedRest(item, false) : null;
            const nativePreProjectionExtra = nativeOrder
                ? this.#nativeWriteToward(item, simulationOrigin, next)
                : null;
            const nativeProvisionalQuaternion = nativeOrder ? item.entry.bone.quaternion.toArray() : null;
            if (nativeOrder) updateWorldPath(item.entry.bone);
            if (!nativeOrder) next = constrainLength(origin, next, item.restLength);
            const restoreNativeBase = () => {
                if (!nativeOrder) return;
                writeQuat(item.entry.bone, nativeBaseQuaternion);
                updateWorldPath(item.entry.bone);
            };
            const restoreNativeProvisional = () => {
                if (!nativeOrder || !nativeProvisionalQuaternion) return;
                writeQuat(item.entry.bone, nativeProvisionalQuaternion);
                updateWorldPath(item.entry.bone);
            };
            // Stage adaptation: keep the angular constraint active before contact.
            // The legacy contact/3-frame-hold switch repeatedly snaps hair back
            // inside a collider as soon as its angle limit is re-enabled.
            const stableContact = this.table.stableHairContacts === true && HAIR_BONE_NAME.test(item.record.bone || '');
            const unconstrainedTail = next;
            if (stableContact && APPLY_SPRING_ANGLE_LIMITS) {
                // The provisional write above is only for collision helpers.
                // Limits are defined relative to the animated/rest quaternion;
                // using the provisional quaternion here makes every free
                // displacement look like zero and erases hair gravity.
                restoreNativeBase();
                nextWorld = nativeOrder
                    ? this.#limitTail(item, nativeAnchorWorld, restTail, nextWorld)
                    : this.#limitTail(item, origin, restTail, next);
                next = nativeOrder ? sub(this.#solverPointFromWorld(nextWorld), rootCancel) : nextWorld;
                restoreNativeProvisional();
            }
            const collisionBeforeChain = this.tuning.chainOrder !== 'before-collision';
            const collisionResult = collisionBeforeChain
                ? this.#resolveStaticCollisions(
                    item,
                    nativeOrder ? nextWorld : next,
                    worldColliders,
                    physicsRestTail,
                    traceBone,
                    'afterCollision',
                    true,
                    nativeOrder ? nativeAnchorWorld : null,
                )
                : { next: nativeOrder ? nextWorld : next, collided: false };
            nextWorld = collisionResult.next;
            next = nativeOrder ? sub(this.#solverPointFromWorld(nextWorld), rootCancel) : nextWorld;
            const collided = collisionResult.collided;
            if (collided) item.collisionHold = 3;
            else item.collisionHold = Math.max(0, (item.collisionHold || 0) - 1);
            const free = collided || item.collisionHold > 0;
            if (!stableContact && !free && APPLY_SPRING_ANGLE_LIMITS) {
                restoreNativeBase();
                nextWorld = nativeOrder
                    ? this.#limitTail(item, nativeAnchorWorld, restTail, nextWorld)
                    : this.#limitTail(item, origin, restTail, next);
                next = nativeOrder ? sub(this.#solverPointFromWorld(nextWorld), rootCancel) : nextWorld;
                restoreNativeProvisional();
            }
            if (traceBone) { traceBone.afterAngleLimit = [...next]; traceBone.collided = free; traceBone.collisionHold = item.collisionHold; traceBone.rotationFromUnprojected = nativePreProjectionExtra ? [...nativePreProjectionExtra] : null; }
            item.collided = free;
            item.previous = [...item.current];
            restoreNativeBase();
// The parent-local Euler writeback is profile-scoped because most HSKI hair
// segments already use the recovered native hair-frame limit. Only records
// listed by the profile need the Unity local clamp; GLB-space records can
// additionally request the Unity↔GLB quaternion sign conversion.
            const useUnityNativeLimit = Array.isArray(this.table.nativeUnityLocalLimitBones)
                && this.table.nativeUnityLocalLimitBones.includes(item.record.bone);
            const convertUnityLimitToGlb = Array.isArray(this.table.nativeUnityLocalLimitGlbBones)
                && this.table.nativeUnityLocalLimitGlbBones.includes(item.record.bone);
            const appliedExtra = nativeOrder
                ? (item.selfRotation = [...nativeIntegratedRotation], this.#nativeWriteToward(item, simulationOrigin, next, useUnityNativeLimit, convertUnityLimitToGlb))
                : this.#writeBoneToward(item, origin, next, !stableContact && !free);
            if (traceBone) traceBone.appliedExtra = [...appliedExtra];
            updateWorldPath(item.entry.bone);
            item.current = worldPointFromLocal(item.entry.bone, item.tailLocal);
            if (nativeOrder) {
                item.nativePreviousPosition = integration.previousPosition;
                item.nativePosition = sub(this.#solverPointFromWorld(item.current), item.rootCancel);
            }
            if (!nativeOrder && (collided || stableContact)) {
                // A contact/constraint correction is not velocity. Include the
                // rendered displacement (after fixed length/writeback) in both
                // samples. Without this, the next integration frame treats the
                // outward projection as a real impulse and alternates between
                // re-entering and leaving the collider.
                item.previous = add(item.previous, sub(item.current, unconstrainedTail));
            }
            if (nativeOrder) item.previous = [...item.current];
            if (nativeOrder && item.childSpring) {
                item.childSpring.selfRotation = quatNormalize(quatMultiply(item.selfRotation, item.childLocalRotation));
                item.childSpring.poseParentRootRotation = [...item.childSpring.selfRotation];
            }
            processed.add(item);
            }
            if (nativeOrder) {
                // The recovered runtime resolves dynamic particle contacts at
                // the current depth before applying that depth's chain pass.
                this.#applyDynamicClothingPairs(movingBody, processed, this.dynamicClothingPairsByGroup[groupIndex] || []);
                this.#applyNativeChains(processed, appliedNativeGroups, worldColliders);
            }
        }
        if (!nativeOrder) {
            this.#applyDynamicClothingPairs(movingBody);
            this.#applyChains();
            if (this.tuning.chainOrder === 'before-collision') this.#applyStaticCollisionsAfterChains(worldColliders);
        }
        if (nativeOrder) this.#applyNativeReferenceLimits();
        this.#traceFrameEnd(dt, worldColliders);
    }

    #applyNativeReferenceLimits() {
        if (!this.referenceLimitBindings.length) return;
        const before = new Map(this.referenceAffectedSprings.map(item => [item, [...item.current]]));
        let corrected = false;
        const convertGlbUnity = this.table.nativeReferenceLimitSpace === 'gltf-unity'
            || this.table.skirtDriverBasis === 'gltf-unity';
        for (const binding of this.referenceLimitBindings) {
            const target = binding.target;
            const targetBone = target.entry?.bone;
            const referenceBone = binding.referenceItem?.entry?.bone || binding.referenceEntry?.bone;
            if (!targetBone || !referenceBone) continue;
            updateWorldPath(targetBone);
            updateWorldPath(referenceBone);
            const targetRotation = this.#solverRotationFromWorld(worldQuaternionOf(targetBone));
            const referenceRotation = this.#solverRotationFromWorld(worldQuaternionOf(referenceBone));
            const limited = nativeReferenceLimitQuaternion(
                targetRotation,
                referenceRotation,
                binding.info.min,
                binding.info.max,
                convertGlbUnity,
            );
            const correctionAngle = quatAngleDegrees(targetRotation, limited);
            if (correctionAngle <= 1e-6) continue;
            this.#writeNativeRotation(target, limited);
            updateWorldPath(targetBone);
            corrected = true;
            this.runtime.referenceLimitApplied += 1;
            this.runtime.referenceLimitMaxAngle = Math.max(this.runtime.referenceLimitMaxAngle, correctionAngle);
            this.runtime.referenceLimitLastBone = target.record.bone;
            const traceFrame = !this.clothingTrace?.complete ? this.clothingTrace?.frames.at(-1) : null;
            if (traceFrame) {
                traceFrame.referenceLimits ??= [];
                traceFrame.referenceLimits.push({
                    bone: target.record.bone,
                    referenceBone: binding.info.bone?.name || binding.info.bone,
                    correctionAngle,
                    convertGlbUnity,
                });
            }
        }
        if (!corrected) return;
        // A parent reference limit moves every rendered child endpoint. Carry
        // those histories by the same correction rather than leaving a child
        // detached or interpreting the constraint as a new velocity impulse.
        for (const item of this.referenceAffectedSprings) {
            updateWorldPath(item.entry.bone);
            const tail = worldPointFromLocal(item.entry.bone, item.tailLocal);
            const native = sub(this.#solverPointFromWorld(tail), item.rootCancel || [0, 0, 0]);
            item.previous = add(item.previous, sub(tail, before.get(item)));
            item.nativePreviousPosition = add(item.nativePreviousPosition, sub(native, item.nativePosition));
            item.current = tail;
            item.nativePosition = native;
            item.nativeAnchor = sub(this.#solverPointFromWorld(worldPositionOf(item.entry.bone)), item.rootCancel || [0, 0, 0]);
            item.selfRotation = this.#solverRotationFromWorld(worldQuaternionOf(item.entry.bone));
        }
    }

    #resolveStaticCollisions(item, next, worldColliders, restTail, traceBone, traceKey = 'afterCollision', keepLength = true, originOverride = null) {
        const renderedLocal = item.renderedTailLocal;
        if (!renderedLocal || traceKey !== 'afterCollision' || vecLength(renderedLocal) < 1e-6) {
            return this.#resolveStaticCollisionsAt(item, next, worldColliders, restTail, traceBone, traceKey, keepLength, originOverride);
        }
        const bone = item.entry.bone;
        const origin = originOverride || worldPositionOf(bone);
        const boneOrigin = worldPositionOf(bone);
        const predict = tail => {
            const extra = quatFromTo(item.tailLocal, worldToLocalDir(bone, sub(tail, boneOrigin)));
            return worldPointFromLocal(bone, quatRotate(extra, renderedLocal));
        };
        const rendered = predict(next);
        const renderedRest = restTail ? predict(restTail) : null;
        const result = this.#resolveStaticCollisionsAt(item, rendered, worldColliders, renderedRest, null, traceKey, false, originOverride, predict(item.current));
        if (!result.collided) return { next, collided: false };
        const corrected = tailFromRenderedCorrection(origin, next, rendered, result.next, item.restLength);
        if (traceBone) traceBone[traceKey] = [...corrected];
        return { next: corrected, collided: true };
    }

    #resolveStaticCollisionsAt(item, next, worldColliders, restTail, traceBone, traceKey = 'afterCollision', keepLength = true, originOverride = null, contactHistory = item.current) {
        const dynamicRecord = nativeDynamicSpringRecord(item);
        // ActorAnimationSwingSolver does not use the dynamic collider enum to
        // disable static-body checks. A child setting with type 4 still
        // supplies collisionMask and collisionRadius to CheckDynamicCollision;
        // only an empty mask means that this spring has no static contacts.
        if (!hasStaticSpringCollision(dynamicRecord, this.table)) return { next, collided: false };
        if (!effectiveSpringCollisionMask(dynamicRecord, this.table)) return { next, collided: false };
        const before = next;
        for (const collider of worldColliders) {
            if (!nativeStaticColliderAllowed(dynamicRecord, collider, this.table)) continue;
            if (skipsContralateralLegCollider(item.record.bone, collider.record.bone)) continue;
            if (skipsConfiguredHairStaticCollider(dynamicRecord, collider.record, this.table)) continue;
            if (skipsConfiguredStaticCollisionPair(dynamicRecord, collider.record, this.table)) continue;
            if (skipsHairSpineCollider(item.record.bone, collider.record.bone, this.table)) continue;
            if (skipsConfiguredHairRootCollider(item.record.bone, collider.record.bone, this.table)) continue;
            if (skipsHairRootFaceCollider(item.record.bone, collider.record.bone)) continue;
            if (skipsLargeSpineSkirtCollider(item.record.bone, collider.record.bone, collider.mask)) continue;
            // The native swing job folds the dynamic particle radius into the
            // static collider query for the jacket. The skirt hem has a
            // separate thigh-follow correction and keeps zero extra radius;
            // applying its 0.05 Unity radius here would expand the whole hem
            // by a visible extra ring.
            const clothRadius = springStaticParticleRadiusForCollider(
                item.record,
                dynamicRecord,
                collider.record,
                this.table,
                this.scale,
            );
            // The native Spine2 mask-16 collider is the captured chest
            // capsule. Resolve it with the same outside contact rule as the
            // other body colliders; its long shape is not a hair-volume hint.
            const beforeCollider = next;
            if (isHairVolumeCollider(collider.record)) {
                next = resolveCapsuleInside(next, clothRadius, collider.start, collider.end, collider.radiusA, collider.radiusB);
            } else {
                // Stage adaptation, enabled per profile: a moving hand can cross
                // the authored rest side while holding a braid. Using that side
                // flips the contact normal repeatedly. Keep the last rendered
                // particle's side instead; reset() initializes it at the new pose.
                // Both references must be in the same endpoint/world basis.
                const useHistory = HAIR_BONE_NAME.test(item.record.bone || '')
                    && this.table.hairContactHistoryColliders?.includes(collider.record.bone);
                const side = useHistory && contactHistory?.every(Number.isFinite) ? contactHistory : restTail;
                next = resolveCapsuleKeepSide(next, clothRadius, collider.start, collider.end, collider.radiusA, collider.radiusB, side);
            }
            const correction = vecLength(sub(next, beforeCollider));
            if (correction > 1e-7) {
                this.runtime.staticCollisionHits += 1;
                this.runtime.maxCollisionCorrection = Math.max(this.runtime.maxCollisionCorrection, correction);
                this.runtime.lastCollisionBone = `${item.record.bone}←${collider.record.bone}`;
                if (/Skirt/i.test(item.record.bone || '') && /^(Left|Right)(UpLeg|Leg)$/.test(collider.record.bone || '')) {
                    this.runtime.thighCollisionHits += 1;
                }
                if (traceBone) {
                    traceBone.collisions ??= [];
                    traceBone.collisions.push({
                        collider: collider.record.bone,
                        correction,
                        before: [...beforeCollider],
                        after: [...next],
                        clothRadius,
                        radiusA: collider.radiusA,
                        radiusB: collider.radiusB,
                    });
                }
            }
            // Native Swing projects the particle back to its bone length
            // immediately after each successful collider projection. Doing a
            // single projection after the whole collider list changes the
            // result when two capsules overlap, because these projections do
            // not commute.
            if (keepLength && vecLength(sub(next, beforeCollider)) > 1e-7) {
                next = constrainLength(originOverride || worldPositionOf(item.entry.bone), next, item.restLength);
            }
        }
        if (keepLength) next = constrainLength(originOverride || worldPositionOf(item.entry.bone), next, item.restLength);
        const collided = vecLength(sub(next, before)) > 1e-5;
        if (traceBone) traceBone[traceKey] = [...next];
        return { next, collided };
    }

    #applyStaticCollisionsAfterChains(worldColliders) {
        for (const item of this.springs) {
            if (item.record.colliderType === 4) continue;
            const origin = worldPositionOf(item.entry.bone);
            const current = worldPointFromLocal(item.entry.bone, item.tailLocal);
            const restTail = item.physicsRestTail || current;
            const traceFrame = this.clothingTrace?.frames.at(-1);
            const traceBone = traceFrame?.bones.find(entry => entry.bone === item.record.bone);
            const result = this.#resolveStaticCollisions(item, current, worldColliders, restTail, traceBone, 'afterPostChainCollision');
            if (!result.collided) {
                item.collided = item.collisionHold > 0;
                item.current = current;
                continue;
            }
            const correction = sub(result.next, current);
            item.previous = add(item.previous, correction);
            item.collisionHold = 3;
            item.collided = true;
            this.#writeBoneToward(item, origin, result.next, false);
            updateWorldPath(item.entry.bone);
            item.current = worldPointFromLocal(item.entry.bone, item.tailLocal);
        }
    }

    #applyDynamicClothingPairs(movingBody = false, available = null, candidatePairs = null) {
        if (this.table.nativeDynamicCollision !== true || !movingBody) return;
        const applyPoint = (item, point) => {
            const origin = worldPositionOf(item.entry.bone);
            const corrected = constrainLength(origin, point, item.restLength);
            const correction = sub(corrected, item.current);
            if (vecLength(correction) <= 1e-7) return false;
            // In the native path the free displacement is stored separately;
            // a contact projection must not be converted into velocity. Keep
            // the legacy sample correction only for legacy profiles.
            if (this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM) item.previous = [...corrected];
            else item.previous = add(item.previous, correction);
            item.current = corrected;
            item.collisionHold = 3;
            item.collided = true;
            if (this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM) {
                const anchor = sub(this.#solverPointFromWorld(origin), item.rootCancel || [0, 0, 0]);
                const point = sub(this.#solverPointFromWorld(corrected), item.rootCancel || [0, 0, 0]);
                this.#nativeWriteToward(item, anchor, point);
            } else {
                this.#writeBoneToward(item, origin, corrected, false);
            }
            updateWorldPath(item.entry.bone);
            item.current = worldPointFromLocal(item.entry.bone, item.tailLocal);
            if (this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM) {
                item.nativePosition = sub(this.#solverPointFromWorld(item.current), item.rootCancel || [0, 0, 0]);
            }
            return true;
        };
        for (const pair of (candidatePairs || this.dynamicClothingPairs || [])) {
                const [first, second] = pair;
                if (available && (!available.has(first) || !available.has(second))) continue;
                const result = resolveDynamicParticlePair(
                    first.current,
                    second.current,
                    nativeDynamicSpringRecord(first),
                    nativeDynamicSpringRecord(second),
                    this.scale,
                    first.previous,
                    second.previous,
                    first.physicsRestTail,
                    second.physicsRestTail,
                    true,
                );
                if (!result.collided) continue;
                const traceFrame = this.clothingTrace?.frames.at(-1);
                if (traceFrame) {
                    traceFrame.dynamicPairs ??= [];
                    traceFrame.dynamicPairs.push({
                        first: first.record.bone,
                        second: second.record.bone,
                        distance: result.distance,
                        overlap: result.overlap,
                        firstCurrent: [...first.current],
                        secondCurrent: [...second.current],
                        firstPrevious: [...first.previous],
                        secondPrevious: [...second.previous],
                        firstRest: Array.isArray(first.physicsRestTail) ? [...first.physicsRestTail] : null,
                        secondRest: Array.isArray(second.physicsRestTail) ? [...second.physicsRestTail] : null,
                    });
                }
                applyPoint(first, result.first);
                applyPoint(second, result.second);
        }
    }

    #traceFrameStart(dt, worldColliders) {
        if (!this.clothingTrace || this.clothingTrace.ticks >= 300) return;
        const tick = this.clothingTrace.ticks;
        const sample = this.clothingTrace.metadata?.allFrames
            || tick === 0
            || [1, 2, 3, 6, 12, 30, 60, 120, 180, 240, 299].includes(tick);
        if (!sample) return;
        const includeHair = this.clothingTrace.metadata?.includeHair === true;
        const tracedBones = this.springs
            .filter(item => item.record.part === 'body'
                || item.record.part === 'clothing'
                || /Skirt|Jacket/i.test(item.record.bone || '')
                || (includeHair && item.record.part === 'hair'))
            .map(item => ({ bone: item.record.bone, part: item.record.part, collisions: [] }));
        this.clothingTrace.frames.push({
            tick,
            delta: dt,
            enabled: this.enabled,
            tuning: { ...this.tuning },
            colliders: worldColliders.map(collider => ({
                bone: collider.record.bone,
                mask: collider.mask,
                start: [...collider.start],
                end: [...collider.end],
                radiusA: collider.radiusA,
                radiusB: collider.radiusB,
            })),
            dynamicPairs: [],
            bones: tracedBones,
        });
    }
    #traceFrameEnd() {
        const trace = this.clothingTrace;
        if (!trace || trace.complete || trace.ticks >= 300) return;
        const frame = trace.frames.at(-1);
        if (frame) {
            const includeHair = trace.metadata?.includeHair === true;
            for (const item of this.springs) {
                if (!(item.record.part === 'body'
                    || item.record.part === 'clothing'
                    || /Skirt|Jacket/i.test(item.record.bone)
                    || (includeHair && item.record.part === 'hair'))) continue;
                let bone = frame.bones.find(entry => entry.bone === item.record.bone);
                if (!bone) {
                    bone = { bone: item.record.bone, part: item.record.part, collisions: [] };
                    frame.bones.push(bone);
                }
                bone.final = {
                    quaternion: item.entry.bone.quaternion.toArray(),
                    current: [...item.current],
                    collided: item.collided,
                    collisionHold: item.collisionHold,
                };
            }
        }
        trace.ticks += 1;
        if (trace.ticks >= 300) trace.complete = true;
    }

    #followedRest(item, includeInitialOffset = false) {
        const rest = item.entry.quaternion.toArray();
        const offset = includeInitialOffset && Array.isArray(item.record.initialRotationEuler)
            ? eulerDegreesToQuaternionXYZ(item.record.initialRotationEuler)
            : includeInitialOffset && Array.isArray(item.record.initialRotationOffset)
                ? quatSlerp([0, 0, 0, 1], item.record.initialRotationOffset, clampAxis(item.record.initialRotationWeight ?? 1, 0, 1))
                : null;
        const base = offset ? composeRestAndQuat(rest, offset) : rest;
        const extra = this.bindingByTarget.get(item.entry.bone)?.extra;
        return extra ? composeRestAndQuat(base, extra) : base;
    }

    #limitTail(item, origin, restTail, next) {
        const extra = this.#extraToward(item, origin, next, true);
        const localDir = quatRotate(extra, item.tailLocal);
        return add(origin, scale(normalize(localToWorldDir(item.entry.bone, localDir)), item.restLength));
    }

    #extraToward(item, origin, next, useLimits = true) {
        const restDir = item.tailLocal;
        const nextDir = worldToLocalDir(item.entry.bone, sub(next, origin));
        if (vecLength(restDir) < 1e-8 || vecLength(nextDir) < 1e-8) return [0, 0, 0, 1];
        const extra = quatFromTo(restDir, nextDir);
        if (!useLimits || !APPLY_SPRING_ANGLE_LIMITS) return extra;
        if (item.nativeParticleLimit) return clampExtraByNativeParticleLimits(extra, item.nativeParticleLimit);
        if (isNativeHairFrameSegment(item.record)) {
            return clampExtraByNativeHairFrame(extra, item.record, item.tailLocal);
        }
        const limitInfo = /Skirt|Jacket|Hair/i.test(item.record.bone || '')
            ? remapLimitsToTail(item.record.limitInfo, item.tailLocal)
            : item.record.limitInfo;
        return clampExtraByLimits(extra, limitInfo);
    }

    #writeBoneToward(item, origin, next, useLimits = true) {
        const extra = this.#extraToward(item, origin, next, useLimits);
        writeQuat(item.entry.bone, quatMultiply(this.#followedRest(item, false), extra));
        return extra;
    }

    debugState() {
        const colliders = this.colliders.map(({ record, entry, childLocal, aim }) => {
            updateWorldPath(entry.bone);
            const runtimeRecord = { ...record, runtimeWorldScale: this.worldScale };
            const shape = authoredColliderShape(runtimeRecord, this.scale, childLocal);
            let { start, end } = colliderWorldEnds(runtimeRecord, entry, aim, shape, this.scale);
            return {
                bone: record.bone,
                type: record.type,
                mask: record.collisionMask,
                kind: shape.kind,
                start,
                end,
                radiusA: shape.radiusA,
                radiusB: shape.kind === 'capsule' ? shape.radiusB : shape.radiusA,
                unityRadius: record.radiusA,
            };
        });
        const particles = this.springs.filter(item => {
            const dynamicRecord = nativeDynamicSpringRecord(item);
            return dynamicRecord.colliderType !== 4 && effectiveSpringCollisionMask(dynamicRecord, this.table);
        }).map(item => {
            const dynamicRecord = nativeDynamicSpringRecord(item);
            return {
            bone: item.record.bone,
            mask: effectiveSpringCollisionMask(dynamicRecord, this.table),
            position: item.current,
            radius: (dynamicRecord.particleRadius || 0) * this.scale,
            unityRadius: dynamicRecord.particleRadius,
            };
        });
        return {
            scale: this.scale,
            colliders,
            particles,
            nativeChainLinks: this.nativeChainLinks.length,
            referenceLimitBindings: this.referenceLimitBindings.length,
            runtime: { ...this.runtime },
        };
    }

    #applyChains() {
        if (this.table.disableChainSeparation) return;
        if (this.nativeChainGroups.length) {
            this.#applyNativeChains();
            return;
        }
        const beforeChain = new Map(this.springs.map(item => [item, [...item.current]]));
        for (const chain of this.chains) {
            for (const layer of chain.layers) {
                if (layer.items.length < 2) continue;
                const points = layer.items.map(item => worldPointFromLocal(item.entry.bone, item.tailLocal));
                const separated = separateRing(
                    points,
                    chainLayerMinimumDistance(layer, this.scale, this.tuning),
                    !!layer.around,
                    CHAIN_SEPARATION_RESPONSE,
                    layer.restDistances,
                );
                if (!separated.some((point, index) => vecLength(sub(point, points[index])) > 1e-7)) continue;
                layer.items.forEach((item, index) => {
                    const origin = worldPositionOf(item.entry.bone);
                    const restTail = worldPointFromLocal(item.entry.bone, item.tailLocal);
                    item.current = constrainLength(origin, separated[index], item.restLength);
                    if (!item.collided && APPLY_SPRING_ANGLE_LIMITS) item.current = this.#limitTail(item, origin, restTail, item.current);
                    this.#writeBoneToward(item, origin, item.current, !item.collided);
                    updateWorldPath(item.entry.bone);
                });
            }
        }
        for (const item of this.springs) {
            const renderedTail = worldPointFromLocal(item.entry.bone, item.tailLocal);
            const correction = sub(renderedTail, beforeChain.get(item));
            item.previous = add(item.previous, correction);
            item.current = renderedTail;
        }
    }

    #applyNativeChainSmoothing(group, applyPoint) {
        const smoothing = clampAxis(Number(group.smoothing) || 0, 0, 1);
        if (!group.around || smoothing <= 0) return;
        const nodes = [...new Set(group.links.flatMap(link => [link.source, link.target]))];
        if (nodes.length < 3) return;
        const neighbors = new Map(nodes.map(item => [item, new Set()]));
        for (const link of group.links) {
            neighbors.get(link.source)?.add(link.target);
            neighbors.get(link.target)?.add(link.source);
        }
        const original = new Map(nodes.map(item => [item, worldPointFromLocal(item.entry.bone, item.tailLocal)]));
        const smoothed = new Map();
        for (const item of nodes) {
            const connected = [...(neighbors.get(item) || [])];
            if (!connected.length) {
                smoothed.set(item, original.get(item));
                continue;
            }
            const average = connected.reduce((sum, other) => add(sum, original.get(other)), [0, 0, 0]);
            smoothed.set(item, add(original.get(item), scale(sub(scale(average, 1 / connected.length), original.get(item)), smoothing)));
        }

        // ActorSwing keeps an authored around-chain from collapsing while it
        // smooths neighboring particles. The recovered record is in native
        // units; convert it to the stage space used by PMX bones here.
        const targetLoop = Math.max(0, Number(group.initialLoopLength) || 0) * this.scale;
        if (targetLoop > 1e-7) {
            const loopLength = group.links.reduce((sum, link) => sum + vecLength(sub(smoothed.get(link.target), smoothed.get(link.source))), 0);
            if (loopLength > 1e-7 && loopLength < targetLoop) {
                const center = nodes.reduce((sum, item) => add(sum, smoothed.get(item)), [0, 0, 0]);
                const centroid = scale(center, 1 / nodes.length);
                const factor = targetLoop / loopLength;
                for (const item of nodes) smoothed.set(item, add(centroid, scale(sub(smoothed.get(item), centroid), factor)));
            }
        }
        for (const item of nodes) applyPoint(item, smoothed.get(item));
    }

    #applyNativeChains(available = null, applied = null, worldColliders = []) {
        const groups = this.nativeChainGroups.filter(group => !applied?.has(group)
            && group.links.every(link => !available || (available.has(link.source) && available.has(link.target))));
        if (!groups.length) return;
        const links = groups.flatMap(group => group.links)
            .filter(link => !available || (available.has(link.source) && available.has(link.target)));
        const affected = new Set(links.flatMap(link => [link.source, link.target]));
        const beforeChain = new Map([...affected].map(item => [item, [...item.current]]));
        const response = clampAxis(CHAIN_SEPARATION_RESPONSE, 0, 1);
        const applyPoint = (item, point) => {
            const origin = worldPositionOf(item.entry.bone);
            const constrained = constrainLength(origin, point, item.restLength);
            if (vecLength(sub(constrained, item.current)) <= 1e-7) return;
            item.current = constrained;
            if (!item.collided && APPLY_SPRING_ANGLE_LIMITS) {
                item.current = this.#limitTail(item, origin, worldPointFromLocal(item.entry.bone, item.tailLocal), item.current);
            }
            if (this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM) {
                const anchor = sub(this.#solverPointFromWorld(origin), item.rootCancel || [0, 0, 0]);
                const point = sub(this.#solverPointFromWorld(item.current), item.rootCancel || [0, 0, 0]);
                this.#nativeWriteToward(item, anchor, point);
            } else {
                this.#writeBoneToward(item, origin, item.current, !item.collided);
            }
            updateWorldPath(item.entry.bone);
            item.current = worldPointFromLocal(item.entry.bone, item.tailLocal);
        };

        for (const group of groups) {
            applied?.add(group);
            for (const link of group.links) {
                if (available && (!available.has(link.source) || !available.has(link.target))) continue;
                const first = link.source;
                const second = link.target;
                const firstPoint = worldPointFromLocal(first.entry.bone, first.tailLocal);
                const secondPoint = worldPointFromLocal(second.entry.bone, second.tailLocal);
                const offset = sub(secondPoint, firstPoint);
                const distance = vecLength(offset);
                if (distance < 1e-8) continue;
                const minimum = nativeChainMinimumDistance(link, first, second, this.scale, this.tuning);
                if (!(minimum > 0) || distance >= minimum) continue;
                const push = scale(offset, ((minimum - distance) / (2 * distance)) * response);
                applyPoint(first, sub(firstPoint, push));
                applyPoint(second, add(secondPoint, push));
            }
            this.#applyNativeChainSmoothing(group, applyPoint);
            this.#applyNativeChainStaticCollisions(group, worldColliders, applyPoint);
        }

        for (const item of affected) {
            const renderedTail = worldPointFromLocal(item.entry.bone, item.tailLocal);
            const previous = beforeChain.get(item);
            if (previous && this.table.physicsAlgorithm !== RECOVERED_PHYSICS_ALGORITHM) {
                item.previous = add(item.previous, sub(renderedTail, previous));
            }
            item.current = renderedTail;
            if (this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM) {
                item.nativePosition = sub(this.#solverPointFromWorld(renderedTail), item.rootCancel || [0, 0, 0]);
            }
            if (this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM) item.previous = [...renderedTail];
        }
    }

    #applyNativeChainStaticCollisions(group, worldColliders, applyPoint) {
        if (!worldColliders?.length) return;
        for (const link of group.links) {
            const first = link.source;
            const second = link.target;
            if (!first || !second) continue;
            let positionA = [...first.current];
            let positionB = [...second.current];
            for (const collider of worldColliders) {
                if (!nativeStaticColliderAllowed([
                    nativeDynamicSpringRecord(first),
                    nativeDynamicSpringRecord(second),
                ], collider, this.table)) continue;
                if (skipsContralateralLegChainCollider(
                    first.record.bone,
                    second.record.bone,
                    collider.record.bone,
                )) continue;
                if (skipsConfiguredHairStaticCollider(first.record, collider.record, this.table)
                    || skipsConfiguredHairStaticCollider(second.record, collider.record, this.table)) continue;
                if (skipsConfiguredStaticCollisionPair(first.record, collider.record, this.table)
                    || skipsConfiguredStaticCollisionPair(second.record, collider.record, this.table)) continue;
                if (skipsHairSpineCollider(first.record.bone, collider.record.bone, this.table)
                    || skipsHairSpineCollider(second.record.bone, collider.record.bone, this.table)) continue;
                if (skipsConfiguredHairRootCollider(first.record.bone, collider.record.bone, this.table)
                    || skipsConfiguredHairRootCollider(second.record.bone, collider.record.bone, this.table)) continue;
                if (skipsHairRootFaceCollider(first.record.bone, collider.record.bone)
                    || skipsHairRootFaceCollider(second.record.bone, collider.record.bone)) continue;
                if (skipsLargeSpineSkirtCollider(first.record.bone, collider.record.bone, collider.mask)
                    || skipsLargeSpineSkirtCollider(second.record.bone, collider.record.bone, collider.mask)) continue;
                const chainRadius = nativeChainCollisionRadius(
                    link,
                    first.record.bone,
                    second.record.bone,
                    collider.record.bone,
                    this.scale,
                    this.table,
                );
                const result = resolveCapsuleSegmentCollision(
                    positionA,
                    positionB,
                    chainRadius,
                    collider.start,
                    collider.end,
                    collider.radiusA,
                    collider.radiusB,
                );
                if (!result.collided || result.correction <= 1e-7) continue;
                positionA = result.first;
                positionB = result.second;
                this.runtime.staticCollisionHits += 1;
                this.runtime.chainCollisionHits += 1;
                this.runtime.maxCollisionCorrection = Math.max(this.runtime.maxCollisionCorrection, result.correction);
                this.runtime.lastCollisionBone = `${first.record.bone}+${second.record.bone}←${collider.record.bone}`;
                const traceFrame = this.clothingTrace?.frames.at(-1);
                if (traceFrame) {
                    traceFrame.chainCollisions ??= [];
                    traceFrame.chainCollisions.push({
                        first: first.record.bone,
                        second: second.record.bone,
                        collider: collider.record.bone,
                        correction: result.correction,
                        chainRadius,
                    });
                }
                if (/Skirt/i.test(first.record.bone || '') && /^(Left|Right)(UpLeg|Leg)$/.test(collider.record.bone || '')) {
                    this.runtime.thighCollisionHits += 1;
                    this.runtime.thighChainCollisionHits += 1;
                }
            }
            applyPoint(first, positionA);
            applyPoint(second, positionB);
        }
    }
}
