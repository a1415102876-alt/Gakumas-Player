function catalogOf(item) {
    return item?.catalog || item || {};
}

function familyOf(item) {
    const catalog = catalogOf(item);
    return String(catalog.family || item?.family || '').trim().toLowerCase();
}

/** Return true for the common sit entry motions we want to expose. */
export function isPreferredSitItem(item) {
    const catalog = catalogOf(item);
    return familyOf(item) === 'sit'
        && String(catalog.scope || item?.scope || '') === 'all'
        && String(catalog.phase || item?.phase || '') === 'in'
        && !String(catalog.variant || item?.variant || '')
        && ['001', '002'].includes(String(catalog.index || item?.index || ''));
}

/** Remove home/variant/loop sit items while preserving every other family. */
export function filterPreferredSitItems(items) {
    return (Array.isArray(items) ? items : []).filter(item => familyOf(item) !== 'sit' || isPreferredSitItem(item));
}

