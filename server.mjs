import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AUDIO_FILE_TYPES } from './audio-file-types.js';
import { createBeatOutputHandler } from './beat-output-server.mjs';
import { readGradioGenerationParameters, synthesizeGradio } from './irodori-gradio.mjs';

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
  ...AUDIO_FILE_TYPES,
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
  if (section === 'assets' && ['jobs', 'tts-output'].includes(folder)) return path.join(assetRoot, folder, ...segments);
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

async function proxySpeech(request, response, fetchImpl) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Use POST for speech synthesis.');
  }
  const authorization = request.headers.authorization || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return jsonError(response, 401, 'Configure your Fish API Key in the page settings.');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return jsonError(response, 415, 'Expected application/json.');
  const body = await readProxyBody(request, response, 1024 * 1024, 'Speech request exceeds 1 MiB.');
  if (!body) return;
  try {
    const data = JSON.parse(body.toString('utf8'));
    if (!data || Array.isArray(data) || typeof data !== 'object' || typeof data.text !== 'string' || !data.text.trim()) throw new Error();
  } catch {
    return jsonError(response, 400, 'Expected a JSON object with nonempty text.');
  }
  try {
    const upstream = await fetchImpl('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: request.headers.accept || 'audio/mpeg',
        ...(request.headers.model ? { model: request.headers.model } : {}),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
    else response.end();
  } catch {
    if (response.headersSent) response.destroy();
    else jsonError(response, 502, 'Fish Audio is unavailable or timed out.');
  }
}

async function verifyIrodoriApi(fetchImpl, origin, { protocol, model, authorization, signal }) {
  const options = { signal, redirect: 'error' };
  if (protocol === 'gradio') {
    await readGradioGenerationParameters(fetchImpl, origin, options);
    return;
  }

  const upstream = await fetchImpl(`${origin}/v1/models`, {
    ...options,
    headers: { Accept: 'application/json', ...authorization },
  });
  if (!upstream.ok) {
    await upstream.body?.cancel();
    throw new Error(`Irodori-TTS 模型接口返回 HTTP ${upstream.status}，请检查接口类型和鉴权配置。`);
  }
  const models = await upstream.json().catch(() => null);
  if (!Array.isArray(models?.data) || !models.data.some(entry => entry?.id === model)) {
    throw new Error(`Irodori-TTS 服务未报告模型 ${model}，请检查服务和 IRODORI_MODEL_NAME 配置。`);
  }
}

async function proxyIrodori(request, response, fetchImpl, config, { check = false } = {}) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Use POST for Irodori-TTS requests.');
  }
  if (request.headers.origin !== `http://${request.headers.host}`) return jsonError(response, 403, 'Only same-origin local pages are allowed.');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return jsonError(response, 415, 'Expected application/json.');
  const body = await readProxyBody(request, response, 32 * 1024, 'Irodori request exceeds 32 KiB.');
  if (!body) return;

  let data;
  try {
    data = JSON.parse(body.toString('utf8'));
  } catch {
    return jsonError(response, 400, 'Expected a valid JSON object.');
  }
  const { input, voice, caption, port: portOverride, protocol: protocolOverride } = data ?? {};
  const port = portOverride ?? config.port;
  const protocol = protocolOverride ?? (port === config.port ? config.protocol : undefined) ?? ([7860, 7861].includes(port) ? 'gradio' : 'openai');
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === request.socket.localPort
    || !['gradio', 'openai'].includes(protocol)) {
    return jsonError(response, 400, 'Irodori-TTS 需要有效的本机端口和接口类型。');
  }
  if (!check && (typeof input !== 'string' || !input.trim() || input.length > 4096
    || typeof voice !== 'string' || !voice.trim() || voice.length > 256
    || (caption !== undefined && (typeof caption !== 'string' || caption.length > 160)))) {
    return jsonError(response, 400, 'Expected Japanese input, a voice ID and an optional style caption.');
  }

  const controller = new AbortController();
  response.once('close', () => controller.abort());
  const origin = `http://127.0.0.1:${port}`;
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(check ? 5000 : 320000)]);
  const authorization = config.apiKey && port === config.port ? { Authorization: `Bearer ${config.apiKey}` } : {};
  try {
    if (check) {
      await verifyIrodoriApi(fetchImpl, origin, { protocol, model: config.model, authorization, signal });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(JSON.stringify({ port, protocol }));
    }
    const speech = { input: input.trim(), voice: voice.trim(), caption: caption?.trim() };
    const upstream = protocol === 'gradio' ? await synthesizeGradio(fetchImpl, origin, speech, signal) : await fetchImpl(`${origin}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/wav',
        ...authorization,
      },
      body: JSON.stringify({
        model: config.model,
        input: speech.input,
        voice: speech.voice,
        response_format: 'wav',
        ...(speech.caption ? { irodori: { caption: speech.caption } } : {}),
      }),
      redirect: 'error',
      signal,
    });
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
    else response.end();
  } catch (error) {
    if (response.headersSent) response.destroy();
    else if (!response.destroyed) {
      if (check && signal.reason?.name === 'TimeoutError') {
        return jsonError(response, 504, `连接 Irodori-TTS 超时，请检查端口 ${port} 上的服务。`);
      }
      const detail = /^(Gradio|Irodori-TTS)/.test(error.message) ? error.message
        : `请检查 127.0.0.1:${port} 上的 Irodori-TTS 服务和接口类型。`;
      return jsonError(response, 502, detail);
    }
  }
}

export function createPlayerServer({ fetchImpl = globalThis.fetch, irodori = {}, assetRoot = defaultAssetRoot } = {}) {
  const irodoriConfig = {
    port: Number(irodori.port || 7862),
    protocol: irodori.protocol || undefined,
    model: irodori.model || 'irodori-tts',
    apiKey: irodori.apiKey || '',
  };
  if (!Number.isInteger(irodoriConfig.port) || irodoriConfig.port < 1 || irodoriConfig.port > 65535) {
    throw new Error('Invalid IRODORI_PORT.');
  }
  if (irodoriConfig.protocol && !['gradio', 'openai'].includes(irodoriConfig.protocol)) {
    throw new Error('IRODORI_PROTOCOL must be gradio or openai.');
  }
  const serveBeatOutput = createBeatOutputHandler(assetRoot, readProxyBody);
  const server = http.createServer(async (request, response) => {
    try {
      const actualPort = server.address().port;
      const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      if (!hosts.includes(request.headers.host)) return jsonError(response, 403, 'Only local hosts are allowed.');
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
        return jsonError(response, 403, 'Only same-origin local pages are allowed.');
      }
      if (request.url === '/api/fish-tts') return await proxySpeech(request, response, fetchImpl);
      if (request.url === '/api/irodori-tts' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return response.end(JSON.stringify({ port: irodoriConfig.port }));
      }
      if (request.url === '/api/irodori-tts') return await proxyIrodori(request, response, fetchImpl, irodoriConfig);
      if (request.url === '/api/irodori-tts/check') return await proxyIrodori(request, response, fetchImpl, irodoriConfig, { check: true });
      const [pathname, query] = (request.url || '/').split('?');
      if (pathname === '/api/beat-jobs' || pathname === '/api/beat-tts') return await serveBeatOutput(request, response, pathname, query);
      if (!['GET', 'HEAD'].includes(request.method)) return jsonError(response, 405, 'Use GET or HEAD for static files.');
      const target = resolveRequest(request.url, assetRoot);
      if (!target) return response.writeHead(403).end();
      const statFile = ['/assets/jobs/', '/assets/tts-output/'].some(prefix => pathname.startsWith(prefix)) ? fs.lstat : fs.stat;
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
  const server = createPlayerServer({ irodori: {
    port: process.env.IRODORI_PORT,
    protocol: process.env.IRODORI_PROTOCOL,
    model: process.env.IRODORI_MODEL_NAME,
    apiKey: process.env.IRODORI_API_KEY,
  } });
  server.listen(port, '127.0.0.1', () => {
    console.log(`gakumas-player http://127.0.0.1:${server.address().port}/`);
  });
}
