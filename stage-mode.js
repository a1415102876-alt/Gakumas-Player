export function resolveSharedStageMode({ search = '', storedPreference = null } = {}) {
    const query = new URLSearchParams(search).get('stage');
    if (query === 'private') return false;
    if (query === 'shared') return true;
    return storedPreference !== 'private';
}
