export function detectLivePortraitFormat(idol) {
    return /\.glb$/i.test(String(idol?.model || '')) ? 'glb' : 'pmx';
}

export function configureGlbAnimationTarget(model, skinnedMeshes) {
    const skins = Array.isArray(skinnedMeshes) ? skinnedMeshes.filter(mesh => mesh?.skeleton?.bones) : [];
    if (!skins.length) throw new Error('GLB 中没有找到 SkinnedMesh 骨架');
    const animationTarget = skins.reduce((best, item) =>
        (item.skeleton.bones.length > (best?.skeleton?.bones?.length || 0) ? item : best), skins[0]);
    const morphSkin = skins.find(item => item.morphTargetDictionary && Object.keys(item.morphTargetDictionary).length) || animationTarget;
    const morphTargetDictionary = morphSkin.morphTargetDictionary || {};
    const morphTargetInfluences = morphSkin.morphTargetInfluences || [];
    model.skeleton = animationTarget.skeleton;
    model.morphTargetDictionary = morphTargetDictionary;
    model.morphTargetInfluences = morphTargetInfluences;
    animationTarget.userData ||= {};
    animationTarget.userData.glbMorphTarget = morphSkin;
    // MMDLoader expects a morph dictionary on the animation target even when
    // the body skin itself has no morph channels.
    animationTarget.morphTargetDictionary = morphTargetDictionary;
    animationTarget.morphTargetInfluences = morphTargetInfluences;
    return { animationTarget, morphSkin };
}
