const suffixKinds = {
    col: 'base', col_alp: 'base', sdw: 'shade', shade: 'shade', def: 'def',
    rmp: 'ramp', ramp: 'ramp', toon: 'ramp', hhl: 'highlight', sph: 'highlight', highlight: 'highlight', hl: 'highlight',
    rma: 'rampAdd', lyr: 'layer', aniso: 'anisotropic', anisotropic: 'anisotropic',
};

export const GAKUMAS_TEXTURE_KINDS = ['shade', 'def', 'ramp', 'highlight', 'rampAdd', 'layer', 'anisotropic'];
export const GAKUMAS_ACTIVE_TEXTURE_KINDS = ['shade', 'def', 'ramp', 'highlight', 'rampAdd'];
export const GAKUMAS_OPTIONAL_TEXTURE_KINDS = ['layer'];

export function gakumasLoadedTextureKinds({ faceLayer = false } = {}) {
    return faceLayer
        ? [...GAKUMAS_ACTIVE_TEXTURE_KINDS, ...GAKUMAS_OPTIONAL_TEXTURE_KINDS]
        : GAKUMAS_ACTIVE_TEXTURE_KINDS;
}

// Authored mdl_chr_fktn-cstm-0001_body material properties. m_bdyco shares
// m_bdy's RampAdd atlas even though its albedo/def maps have a separate stem.
// These values are variant data; other outfits keep their normal bindings.
const authoredRampAdd = Object.freeze({
    't_chr_fktn-cstm-0001_bdy': { stem: 't_chr_fktn-cstm-0001_bdy', color: [0.84, 0.84, 0.84] },
    't_chr_fktn-cstm-0001_bdyco': { stem: 't_chr_fktn-cstm-0001_bdy', color: [1, 1, 1] },
});

export function textureDescriptor(path) {
    const name = String(path || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
    // GLTFLoader keeps the embedded image name without its original file
    // extension. Accept both `foo_sdw.png` and `foo_sdw` so GLB materials can
    // use the same texture table as PMX materials.
    const match = name.match(/^(.*?)[_-](col_alp|col|sdw|shade|def|rmp|ramp|toon|hhl|sph|highlight|hl|rma|lyr|aniso|anisotropic)(?:_[a-z0-9]+)?(?:\.(?:png|jpe?g|webp))?$/);
    const stem = match?.[1] || name.replace(/\.[^.]+$/, '');
    const character = stem.match(/(?:^|_)chr_([a-z0-9]+)-/)?.[1] || '';
    return { name, stem, character, kind: suffixKinds[match?.[2]] || '', role: materialRole(stem) };
}

export function materialRole(name) {
    const value = String(name || '').toLowerCase();
    if (/(?:^|[_\-\s])ehl(?:$|[_\-\s])/.test(value)) return 'eyeHighlight';
    if (/(?:^|[_\-\s])hirco(?:$|[_\-\s])/.test(value)) return 'hairAccessory';
    if (/(?:^|[_\-\s])hir(?:$|[_\-\s])|hair|髪|头发/.test(value)) return 'hair';
    if (/(?:^|[_\-\s])fce(?:$|[_\-\s])|face|脸|面部/.test(value)) return 'face';
    if (/eye|eyeball|iris|pupil|眼|瞳/.test(value)) return 'eye';
    if (/(?:^|[_\-\s])bdyco(?:$|[_\-\s])/.test(value)) return 'bodyAccessory';
    if (/(?:^|[_\-\s])bdy(?:$|[_\-\s])|body|cloth|dress|身体|衣|裙/.test(value)) return 'body';
    return 'other';
}

export function describeMaterial(material) {
    const source = material.userData?.MMD?.mapFileName
        || material.map?.userData?.sourceName
        || material.map?.name
        || material.name
        || '';
    const descriptor = textureDescriptor(source);
    return { ...descriptor, role: descriptor.role === 'other' ? materialRole(material.name) : descriptor.role };
}

export function selectMaterialTextures(material, entries) {
    const descriptor = describeMaterial(material);
    const rampAdd = authoredRampAdd[descriptor.stem];
    const bindings = {};
    const ambiguous = [];
    for (const kind of GAKUMAS_TEXTURE_KINDS) {
        const candidates = entries.filter(entry => entry.kind === kind);
        let matches = candidates.filter(entry => entry.stem === descriptor.stem);
        if (kind === 'rampAdd' && rampAdd) {
            matches = candidates.filter(entry => entry.stem === rampAdd.stem);
        }
        if (!matches.length && kind === 'ramp') {
            matches = candidates.filter(entry => descriptor.character && entry.character === descriptor.character && entry.role === 'other');
            const shared = matches.filter(entry => entry.stem === `t_chr_${descriptor.character}-base-0000`);
            if (shared.length) matches = shared;
        }
        // hir_hhl is the hair highlight mask. hir_sph is the source map of
        // the separate m_hir+ sphere layer; both share the hir stem but are
        // not interchangeable supplemental bindings. Prefer the explicit
        // hhl mask when both suffixes are present.
        if (kind === 'highlight' && matches.length > 1) {
            const hhlMatches = matches.filter(entry => /(?:^|[_-])hhl(?:\.|_|$)/.test(entry.name));
            if (hhlMatches.length === 1) matches = hhlMatches;
        }
        if (matches.length === 1) bindings[kind] = matches[0];
        else if (matches.length > 1) ambiguous.push(kind);
    }
    return { descriptor, bindings, ambiguous, rampAddColor: rampAdd?.color || [1, 1, 1] };
}

export function textureUsesColorSpace(kind) {
    return !['def', 'anisotropic'].includes(kind);
}

export function setTextureColorSpace(texture, colorSpace) {
    if (!texture || texture.colorSpace === colorSpace) return;
    texture.colorSpace = colorSpace;
    texture.needsUpdate = true;
}
