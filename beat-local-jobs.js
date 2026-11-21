import { normalizeBeatJobName } from './beat-job-name.js';

export { normalizeBeatJobName };

const JOBS_ROUTE = '/api/beat-jobs';

function namedRoute(route, name, fields) {
    const query = new URLSearchParams({ name: normalizeBeatJobName(name), ...fields });
    return `${route}?${query}`;
}

async function checkedFetch(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' ? body.error : `本地文件请求失败（HTTP ${response.status}）。`);
    }
    return response;
}

export async function listBeatJobs({ signal } = {}) {
    const response = await checkedFetch(JOBS_ROUTE, { cache: 'no-store', signal });
    return (await response.json()).jobs;
}

export async function loadBeatJob(name, { signal } = {}) {
    const job = await checkedFetch(namedRoute(JOBS_ROUTE, name), { cache: 'no-store', signal });
    const { url } = await job.json();
    return (await checkedFetch(url, { cache: 'no-store', signal })).text();
}

export async function saveBeatJob(name, source) {
    const response = await checkedFetch(namedRoute(JOBS_ROUTE, name), {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: source,
    });
    return response.json();
}
