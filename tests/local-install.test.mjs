import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createPlayerServer } from '../server.mjs';

async function fixture(t, fetchImpl) {
  const server = createPlayerServer({ fetchImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  return (options = {}) => new Promise((resolve, reject) => {
    const { body = '', headers = {}, method = 'POST', path = '/api/fish-tts' } = options;
    const request = http.request({ hostname: '127.0.0.1', port, path, method, headers: {
      // Deliberately invalid placeholder, used only with the injected mock upstream.
      Authorization: 'Bearer local-test-placeholder',
      'Content-Type': 'application/json',
      Origin: `http://127.0.0.1:${port}`,
      ...headers,
    } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('local speech proxy forwards only to Fish and preserves binary audio', async t => {
  const audio = Buffer.from([0, 255, 128, 1, 2]);
  const payload = JSON.stringify({ text: 'test', reference_id: 'example', format: 'mp3' });
  let calls = 0;
  const request = await fixture(t, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.fish.audio/v1/tts');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer local-test-placeholder');
    assert.equal(options.headers.model, 'example-model');
    assert.equal(options.body.toString(), payload);
    assert.equal(options.redirect, 'error');
    return new Response(audio, { headers: { 'content-type': 'audio/mpeg' } });
  });
  const response = await request({ body: payload, headers: { model: 'example-model' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'audio/mpeg');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, audio);
  assert.equal(calls, 1);
});

test('proxy rejects foreign origins, hosts, methods and invalid bodies before contacting upstream', async t => {
  const request = await fixture(t, () => { throw new Error('Upstream must not be called'); });
  for (const [options, expected] of [
    [{ headers: { Origin: 'https://example.com' } }, 403],
    [{ headers: { Origin: 'null' } }, 403],
    [{ headers: { Host: 'example.com' } }, 403],
    [{ method: 'GET' }, 405],
    [{ method: 'OPTIONS' }, 405],
    [{ headers: { Authorization: '' } }, 401],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415],
    [{ body: '{invalid' }, 400],
    [{ body: '[]' }, 400],
    [{ body: '{"text":""}' }, 400],
    [{ body: JSON.stringify({ text: 'x'.repeat(1024 * 1024) }) }, 413],
    [{ method: 'POST', path: '/api/fish-tts?url=https://example.com' }, 405],
  ]) assert.equal((await request(options)).status, expected);
});

test('proxy preserves upstream errors and reports transport failures', async t => {
  let fail = false;
  const request = await fixture(t, async () => {
    if (fail) throw new Error('simulated network failure');
    return new Response('{"error":"rate limited"}', { status: 429, headers: { 'content-type': 'application/json' } });
  });
  const response = await request({ body: '{"text":"test"}' });
  assert.equal(response.status, 429);
  assert.deepEqual(JSON.parse(response.body), { error: 'rate limited' });
  fail = true;
  assert.equal((await request({ body: '{"text":"test"}' })).status, 502);
});

test('player and manifest are served, repository metadata is private', async t => {
  const request = await fixture(t);
  const page = await request({ method: 'GET', path: '/' });
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /gpTtsProxy/);
  const manifest = await request({ method: 'GET', path: '/resource-manifest.json' });
  assert.equal(manifest.status, 200);
  assert.ok(Object.keys(JSON.parse(manifest.body).assets).length > 0);
  assert.equal((await request({ method: 'HEAD', path: '/' })).body.length, 0);
  for (const path of ['/.git/config', '/.gakumas-clone.git/config', '/%2egit/config']) {
    assert.equal((await request({ method: 'GET', path })).status, 403);
  }
  assert.equal((await request({ method: 'GET', path: '/%ZZ' })).status, 400);
});

test('both speech clients use actual local ports and preserve saved custom proxies', async () => {
  const fishSource = await fs.readFile(new URL('../fish-tts.js', import.meta.url), 'utf8');
  const settingsSource = await fs.readFile(new URL('../free-chat-tts.js', import.meta.url), 'utf8');
  const oldLocation = globalThis.location;
  try {
    for (const origin of ['http://127.0.0.1:4173', 'http://localhost:4279', 'https://example.com']) {
      const location = new URL(origin);
      const context = vm.createContext({ location, URL });
      vm.runInContext(fishSource, context);
      globalThis.location = location;
      const settings = await import(`data:text/javascript;base64,${Buffer.from(settingsSource).toString('base64')}#${encodeURIComponent(origin)}`);
      const expected = location.protocol === 'http:' ? `${origin}/api/fish-tts` : 'https://tts.sawadaz.xyz/api/fish-tts';
      assert.equal(context.HatsuFishTts.DEFAULT_PROXY_URL, expected);
      assert.equal(settings.DEFAULT_FISH_TTS_PROXY, expected);
      assert.equal(settings.resolveFishTtsSettings({}, { getItem: () => null }).proxyUrl, expected);
      for (const custom of ['https://custom.example/tts', 'https://hatsuboshitest.a1415102876.workers.dev/api/fish-tts']) {
        const storage = { getItem: () => JSON.stringify({ proxyUrl: custom, enabled: true }) };
        assert.equal(settings.resolveFishTtsSettings({}, storage).proxyUrl, custom);
        context.HatsuFishTts.configure({ proxyUrl: custom });
        assert.equal(context.HatsuFishTts.getConfig().proxyUrl, custom);
      }
      context.HatsuFishTts.configure({ proxyUrl: '/api/fish-tts' });
      assert.equal(context.HatsuFishTts.getConfig().proxyUrl, expected);
    }
  } finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
  }
});
