import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AUDIO_FILE_TYPES } from './audio-file-types.js';
import { normalizeBeatJobName } from './beat-job-name.js';

const SCRIPT_LIMIT = 4 * 1024 * 1024;
const AUDIO_LIMIT = 32 * 1024 * 1024;
const BEAT_INDEX = /^(?:0|[1-9][0-9]{0,5})$/u;
const POINTER_FILENAME = /^\.line-(0|[1-9][0-9]{0,5})\.json$/u;
const FINGERPRINT = /^[a-f0-9]{64}$/u;
const REVISION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const AUDIO_EXTENSIONS = new Map(Object.entries(AUDIO_FILE_TYPES).map(([extension, type]) => [type, extension]));
AUDIO_EXTENSIONS.set('audio/ogg', '.ogg');
AUDIO_EXTENSIONS.set('audio/mp3', '.mp3');
AUDIO_EXTENSIONS.set('audio/x-mp3', '.mp3');
AUDIO_EXTENSIONS.set('audio/x-mpeg', '.mp3');
AUDIO_EXTENSIONS.set('audio/x-wav', '.wav');
AUDIO_EXTENSIONS.set('audio/wave', '.wav');
AUDIO_EXTENSIONS.set('audio/vnd.wave', '.wav');

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

function pointerFilename(directory, index) {
  return path.join(directory, `.line-${index}.json`);
}

function clipFilename(index, revision, extension) {
  return `${String(index + 1).padStart(4, '0')}-${revision}${extension}`;
}

function clipEntry(name, index, { fingerprint, revision, extension }) {
  return {
    index, fingerprint, revision,
    url: `/assets/tts-output/${encodeURIComponent(name)}/${clipFilename(index, revision, extension)}`,
  };
}

async function readClip(directory, index) {
  const filename = pointerFilename(directory, index);
  const stat = await statOrMissing(filename);
  if (!stat?.isFile() || stat.size > 512) return null;
  let entry;
  try {
    entry = JSON.parse(await fs.readFile(filename, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError || error.code === 'ENOENT') return null;
    throw error;
  }
  if (typeof entry?.fingerprint !== 'string' || !FINGERPRINT.test(entry.fingerprint)
    || typeof entry.revision !== 'string' || !REVISION.test(entry.revision)
    || typeof entry.extension !== 'string' || !Object.hasOwn(AUDIO_FILE_TYPES, entry.extension)) return null;
  const audio = await statOrMissing(path.join(directory, clipFilename(index, entry.revision, entry.extension)));
  return audio?.isFile() && audio.size > 0 ? entry : null;
}

function guessAudioExtension(audio) {
  if (audio.toString('ascii', 8, 12) === 'WAVE' && ['RIFF', 'RF64', 'RIFX'].includes(audio.toString('ascii', 0, 4))) return '.wav';
  if (audio.toString('ascii', 0, 3) === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)) return '.mp3';
  return '';
}

export function createBeatOutputHandler(assetRoot, readBody) {
  const clipWrites = new Map();

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

  async function listClips(response, name) {
    const output = await outputFolder('tts-output');
    const directory = output && await outputDirectory(path.join(output, name), false);
    const files = directory ? await fs.readdir(directory, { withFileTypes: true }) : [];
    const indexes = files.flatMap(file => {
      const match = file.isFile() && POINTER_FILENAME.exec(file.name);
      return match ? [Number(match[1])] : [];
    }).sort((a, b) => a - b);
    const clips = [];
    for (const index of indexes) {
      const entry = await readClip(directory, index);
      if (entry) clips.push(clipEntry(name, index, entry));
    }
    sendJson(response, 200, { clips });
  }

  async function saveClip(request, response, name, params) {
    const indexParam = params.get('index');
    const fingerprint = params.get('fingerprint');
    const expected = params.get('expectedRevision');
    if (!BEAT_INDEX.test(indexParam) || !FINGERPRINT.test(fingerprint) || (expected && !REVISION.test(expected))) {
      return fail(response, 400, '台词编号、内容指纹或语音版本无效。');
    }
    const type = (request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (type && type !== 'application/octet-stream' && !AUDIO_EXTENSIONS.has(type)) {
      return fail(response, 415, '语音格式不受支持。');
    }
    const audio = await readBody(request, response, AUDIO_LIMIT, '单句语音超过 32 MiB。');
    if (!audio) return;
    if (!audio.length) return fail(response, 400, '语音文件为空。');
    const extension = AUDIO_EXTENSIONS.get(type) || guessAudioExtension(audio);
    if (!extension) return fail(response, 415, '无法识别语音格式。');

    const index = Number(indexParam);
    const output = await outputFolder('tts-output', true);
    const directory = await outputDirectory(path.join(output, name), true);
    const pointer = pointerFilename(directory, index);
    // Some filesystems treat case and equivalent Unicode spellings as the same path.
    const lock = pointer.normalize('NFC').toUpperCase();
    const previousWrite = clipWrites.get(lock) || Promise.resolve();
    const pending = previousWrite.catch(() => {}).then(async () => {
      const previous = await readClip(directory, index);
      if (expected !== null && expected !== (previous?.revision || '')) {
        return fail(response, 409, '该句的语音已变更，请重新查看后再保存。');
      }

      const revision = randomUUID();
      const entry = { fingerprint, revision, extension };
      const filename = path.join(directory, clipFilename(index, revision, extension));
      // Publish the pointer only after the complete audio file is available.
      await writeAtomically(filename, audio);
      try {
        await writeAtomically(pointer, JSON.stringify(entry));
      } catch (error) {
        await fs.unlink(filename).catch(() => {});
        throw error;
      }
      if (previous) {
        await fs.unlink(path.join(directory, clipFilename(index, previous.revision, previous.extension))).catch(() => {});
      }
      sendJson(response, 200, clipEntry(name, index, entry));
    });
    clipWrites.set(lock, pending);
    try {
      await pending;
    } finally {
      if (clipWrites.get(lock) === pending) clipWrites.delete(lock);
    }
  }

  return async (request, response, pathname, query) => {
    if (request.method !== 'GET' && request.method !== 'PUT') {
      response.setHeader('Allow', 'GET, PUT');
      return fail(response, 405, '请使用 GET 或 PUT。');
    }
    if (request.method === 'PUT' && request.headers.origin !== `http://${request.headers.host}`) {
      return fail(response, 403, '请通过本机编辑器保存文件。');
    }
    const params = new URLSearchParams(query);
    const isJob = pathname === '/api/beat-jobs';
    try {
      if (isJob && request.method === 'GET' && !params.has('name')) return await listJobs(response);
      let name;
      try {
        name = normalizeBeatJobName(params.get('name'));
      } catch (error) {
        return fail(response, 400, error.message);
      }
      if (isJob) return await handleJob(request, response, name);
      if (request.method === 'GET') return await listClips(response, name);
      return await saveClip(request, response, name, params);
    } catch {
      if (response.headersSent) response.destroy();
      else fail(response, 500, isJob ? '无法访问脚本文件，请检查本地目录权限。' : '无法访问语音文件，请检查本地目录权限。');
    }
  };
}
