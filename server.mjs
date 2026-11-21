import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEAT_AUDIO_CATALOG_PATH, BEAT_AUDIO_FOLDER, BEAT_AUDIO_GROUPS, BEAT_AUDIO_TYPES, normalizeBeatAudioName } from './beat-audio.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const defaultAssetRoot = path.join(root, 'assets');
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  ...BEAT_AUDIO_TYPES,
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain; charset=utf-8',
  '.vmd': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveRequest(urlPath, assetRoot) {
  const decoded = decodeURIComponent(String(urlPath || '/').split('?')[0]);
  const requested = decoded === '/' ? '/gakumas-player.html' : decoded;
  const target = path.resolve(root, `.${requested}`);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
  const [section, ...segments] = relative.split(path.sep);
  if (section === 'assets') return path.join(assetRoot, ...segments);
  return target;
}

async function serveBeatAudioCatalog(request, response, assetRoot) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (request.method !== 'GET') {
    response.writeHead(405, { ...headers, Allow: 'GET' });
    response.end(JSON.stringify({ error: 'Use GET for the audio catalog.' }));
    return;
  }
  try {
    const groups = await Promise.all(BEAT_AUDIO_GROUPS.map(async kind => {
      const directory = path.join(assetRoot, BEAT_AUDIO_FOLDER, kind);
      const files = await fs.promises.readdir(directory, { withFileTypes: true }).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      const names = files.filter(file => file.isFile() && normalizeBeatAudioName(file.name) === file.name)
        .map(file => file.name)
        .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
      return [kind, names];
    }));
    response.writeHead(200, headers);
    response.end(JSON.stringify(Object.fromEntries(groups)));
  } catch {
    response.writeHead(500, headers);
    response.end(JSON.stringify({ error: 'Could not read the audio folders.' }));
  }
}

export function createPlayerServer({ assetRoot = defaultAssetRoot } = {}) {
  return http.createServer((request, response) => {
    if (request.url.split('?')[0] === `/${BEAT_AUDIO_CATALOG_PATH}`) {
      void serveBeatAudioCatalog(request, response, assetRoot);
      return;
    }
    const target = resolveRequest(request.url, assetRoot);
    if (!target) {
      response.writeHead(403).end();
      return;
    }
    fs.stat(target, (error, stat) => {
      if (error || !stat.isFile()) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      const type = types[path.extname(target).toLowerCase()] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      const stream = fs.createReadStream(target);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createPlayerServer().listen(port, '127.0.0.1', () => {
    console.log(`gakumas-player http://127.0.0.1:${port}/`);
  });
}
