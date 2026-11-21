import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeBeatJobName } from './beat-job-name.js';

const SCRIPT_LIMIT = 4 * 1024 * 1024;

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function fail(response, status, error) {
  sendJson(response, status, { error });
}

async function statOrMissing(filename) {
  try {
    return await fs.lstat(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function outputDirectory(directory, create) {
  if (create) {
    await fs.mkdir(directory).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  const stat = await statOrMissing(directory);
  if (!stat) return null;
  if (!stat.isDirectory()) throw new Error('Expected a local directory.');
  return directory;
}

async function writeAtomically(filename, contents) {
  const temporary = path.join(path.dirname(filename), `.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, contents, { flag: 'wx' });
    await fs.rename(temporary, filename);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

function jobEntry(name) {
  return { name, url: `/assets/jobs/${encodeURIComponent(`${name}.txt`)}` };
}

export function createBeatOutputHandler(assetRoot, readBody) {
  async function outputFolder(folder, create = false) {
    const assets = await outputDirectory(assetRoot, create);
    return assets && outputDirectory(path.join(assets, folder), create);
  }

  async function listJobs(response) {
    const directory = await outputFolder('jobs');
    const files = directory ? await fs.readdir(directory, { withFileTypes: true }) : [];
    const jobs = [];
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.txt')) continue;
      const name = file.name.slice(0, -4);
      try {
        if (name === normalizeBeatJobName(name)) jobs.push(jobEntry(name));
      } catch { /* Ignore files with names the editor cannot save. */ }
    }
    jobs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    sendJson(response, 200, { jobs });
  }

  async function handleJob(request, response, name) {
    if (request.method === 'GET') {
      const directory = await outputFolder('jobs');
      const file = directory && await statOrMissing(path.join(directory, `${name}.txt`));
      return file?.isFile() ? sendJson(response, 200, jobEntry(name)) : fail(response, 404, '找不到该脚本。');
    }
    if (!/^text\/plain(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
      return fail(response, 415, '脚本必须使用纯文本格式。');
    }
    const source = await readBody(request, response, SCRIPT_LIMIT, '脚本超过 4 MiB。');
    if (!source) return;
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(source);
    } catch {
      return fail(response, 400, '脚本必须使用 UTF-8 编码。');
    }
    if (!text.trim()) return fail(response, 400, '脚本不能为空。');
    const directory = await outputFolder('jobs', true);
    await writeAtomically(path.join(directory, `${name}.txt`), source);
    sendJson(response, 200, jobEntry(name));
  }

  return async (request, response, query) => {
    if (request.method !== 'GET' && request.method !== 'PUT') {
      response.setHeader('Allow', 'GET, PUT');
      return fail(response, 405, '请使用 GET 或 PUT。');
    }
    if (request.method === 'PUT' && request.headers.origin !== `http://${request.headers.host}`) {
      return fail(response, 403, '请通过本机编辑器保存文件。');
    }
    const params = new URLSearchParams(query);
    try {
      if (request.method === 'GET' && !params.has('name')) return await listJobs(response);
      let name;
      try {
        name = normalizeBeatJobName(params.get('name'));
      } catch (error) {
        return fail(response, 400, error.message);
      }
      return await handleJob(request, response, name);
    } catch {
      if (response.headersSent) response.destroy();
      else fail(response, 500, '无法访问脚本文件，请检查本地目录权限。');
    }
  };
}
