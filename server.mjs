import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBeatOutputHandler } from './beat-output-server.mjs';

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
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain; charset=utf-8',
  '.vmd': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveRequest(urlPath, assetRoot) {
  const decoded = decodeURIComponent(String(urlPath || '/').split('?')[0]);
  if (decoded.split(/[\\/]/).some(part => part.startsWith('.'))) return '';
  const requested = decoded === '/' ? '/gakumas-player.html' : decoded;
  const target = path.resolve(root, `.${requested}`);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
  const [section, folder, ...segments] = relative.split(path.sep);
  if (section === 'assets' && folder === 'jobs') return path.join(assetRoot, folder, ...segments);
  return target;
}

function jsonError(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ error: message }));
}

async function readProxyBody(request, response, limit, tooLarge) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      jsonError(response, 413, tooLarge);
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createPlayerServer({ assetRoot = defaultAssetRoot } = {}) {
  const serveBeatOutput = createBeatOutputHandler(assetRoot, readProxyBody);
  const server = http.createServer(async (request, response) => {
    try {
      const actualPort = server.address().port;
      const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      if (!hosts.includes(request.headers.host)) return jsonError(response, 403, 'Only local hosts are allowed.');
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
        return jsonError(response, 403, 'Only same-origin local pages are allowed.');
      }
      const [pathname, query] = (request.url || '/').split('?');
      if (pathname === '/api/beat-jobs') return await serveBeatOutput(request, response, query);
      if (!['GET', 'HEAD'].includes(request.method)) return jsonError(response, 405, 'Use GET or HEAD for static files.');
      const target = resolveRequest(request.url, assetRoot);
      if (!target) return response.writeHead(403).end();
      const statFile = pathname.startsWith('/assets/jobs/') ? fs.lstat : fs.stat;
      statFile(target, (error, stat) => {
        if (error || !stat.isFile()) {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
          return;
        }
        const type = types[path.extname(target).toLowerCase()] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        if (request.method === 'HEAD') return response.end();
        const stream = fs.createReadStream(target);
        stream.on('error', () => response.destroy());
        stream.pipe(response);
      });
    } catch {
      if (!response.headersSent) jsonError(response, 400, 'Invalid request.');
      else response.destroy();
    }
  });
  server.requestTimeout = 30000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPlayerServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`gakumas-player http://127.0.0.1:${server.address().port}/`);
  });
}
