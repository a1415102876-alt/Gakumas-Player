const PROP_ASSET_ROOT = 'assets/props/';
const phone = (variant, filename) => Object.freeze({
    id: 'phone',
    variant,
    assetKey: `assets/props/${filename}`,
    local: `${PROP_ASSET_ROOT}${filename}`,
    anchorNames: Object.freeze(['RightHand', 'LeftHand']),
    offset: Object.freeze([0, 0, 0]),
    rotation: Object.freeze([0, 0, 0]),
    scale: 1,
});

export const PHONE_PROP_DEFINITIONS = Object.freeze({
    amao: phone('amao-00', 'mdl_prp_smartphone-amao-00_smartphone.glb'),
    fktn: phone('fktn-00', 'mdl_prp_smartphone-fktn-00_smartphone.glb'),
    hmsz: phone('hmsz-00', 'mdl_prp_smartphone-hmsz-00_smartphone.glb'),
    hume: phone('hume-00', 'mdl_prp_smartphone-hume-00_smartphone.glb'),
    ssmk: phone('ssmk-00', 'mdl_prp_smartphone-ssmk-00_smartphone.glb'),
});

export const PHONE_PROP_DEFINITION = PHONE_PROP_DEFINITIONS;

export function phonePropForIdol(idolId) {
    return PHONE_PROP_DEFINITIONS[String(idolId || '').trim()] || null;
}

export function propAssetKeysForIdol(idolId) {
    const prop = phonePropForIdol(idolId);
    return prop ? [prop.assetKey] : [];
}

export function resolvePropAnchorName(boneNames, preferred = ['RightHand', 'LeftHand']) {
    const available = new Set((Array.isArray(boneNames) ? boneNames : []).map(value => String(value || '')));
    return (Array.isArray(preferred) ? preferred : []).map(value => String(value || '')).find(value => value && available.has(value)) || '';
}

export function propVisibilityForCue(cue) {
    const token = String(cue?.gesture || cue?.file || cue || '').toLowerCase();
    if (/(?:^|[-_\/])phone(?:on|show|talk)(?:[-_\/]|$)/u.test(token) || ['phoneon', 'phoneshow', 'phonetalk'].includes(token)) return true;
    if (/(?:^|[-_\/])phoneoff(?:[-_\/]|$)/u.test(token) || token === 'phoneoff') return false;
    return null;
}
