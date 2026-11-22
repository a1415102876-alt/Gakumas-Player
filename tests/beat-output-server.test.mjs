import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPlayerServer } from '../server.mjs';

async function fixture(t) {
  const tempRoot = path.resolve(os.tmpdir());
  const assetRoot = await fs.mkdtemp(path.join(tempRoot, 'gakumas-beat-output-'));
  const server = createPlayerServer({ assetRoot });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(assetRoot)), tempRoot);
    assert.match(path.basename(assetRoot), /^gakumas-beat-output-/);
    await fs.rm(assetRoot, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    assetRoot,
    request(url, init) {
      return fetch(new URL(url, origin), init);
    },
    put(url, body, type) {
      return fetch(new URL(url, origin), { method: 'PUT', body, headers: { Origin: origin, 'Content-Type': type } });
    },
  };
}

function jobRoute(name) {
  return `/api/beat-jobs?${new URLSearchParams({ name })}`;
}

function clipRoute(name, options = {}) {
  return `/api/beat-tts?${new URLSearchParams({ name, ...options })}`;
}

test('named script saves exact source, can be listed and opened, and replaces the previous file', async t => {
  const { assetRoot, request, put } = await fixture(t);
  const name = '学園 #1';
  const source = '<beat_script>\r\n<beat speaker="hski">おはよう</beat>\r\n</beat_script>\r\n';

  assert.deepEqual(await (await request('/api/beat-jobs')).json(), { jobs: [] });
  assert.equal((await request(jobRoute(name))).status, 404);
  assert.equal((await request(jobRoute(name), { method: 'PUT', body: source })).status, 403);
  assert.equal((await request(jobRoute(name), { method: 'PUT', body: source, headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal((await put(jobRoute('../escape'), source, 'text/plain')).status, 400);
  assert.equal((await put(jobRoute('COM1'), source, 'text/plain')).status, 400);
  assert.equal((await put(jobRoute(name), source, 'application/json')).status, 415);

  const saved = await put(jobRoute(` ${name} `), source, 'text/plain;charset=UTF-8');
  assert.equal(saved.status, 200);
  const job = await saved.json();
  assert.equal(job.name, name);
  assert.deepEqual(await (await request('/api/beat-jobs')).json(), { jobs: [job] });
  assert.deepEqual(await (await request(jobRoute(name))).json(), job);
  assert.equal(await (await request(job.url)).text(), source);
  assert.equal(await fs.readFile(path.join(assetRoot, 'jobs', `${name}.txt`), 'utf8'), source);

  const replacement = source.replace('おはよう', 'こんにちは');
  assert.equal((await put(jobRoute(name), replacement, 'text/plain')).status, 200);
  assert.equal(await (await request(job.url)).text(), replacement);
});

test('exported audio is grouped by script and current beat, with revision checks for single-line replacement', async t => {
  const { assetRoot, request, put } = await fixture(t);
  const name = '放課後';
  const fingerprint = 'f'.repeat(64);
  const secondFingerprint = 'b'.repeat(64);
  const wave = Buffer.from('RIFF\x00\x00\x00\x00WAVE');
  const mp3 = Buffer.from('ID3mock');
  const index = 3;
  const clip = { index, fingerprint };

  assert.deepEqual(await (await request(clipRoute(name))).json(), { clips: [] });
  assert.equal((await request(clipRoute(name, clip), { method: 'PUT', body: wave })).status, 403);
  assert.equal((await put(clipRoute(name, { ...clip, fingerprint: '../bad' }), wave, 'audio/wav')).status, 400);
  assert.equal((await put(clipRoute(name, clip), wave, 'text/html')).status, 415);

  const original = await put(clipRoute(name, { ...clip, expectedRevision: '' }), wave, 'application/octet-stream');
  assert.equal(original.status, 200);
  const old = await original.json();
  assert.equal(old.index, index);
  assert.equal(old.fingerprint, fingerprint);
  assert.match(old.url, /\/0004-.*\.wav$/);
  const audio = await request(old.url);
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await audio.arrayBuffer()), wave);
  const pointer = `/assets/tts-output/${encodeURIComponent(name)}/.line-${index}.json`;
  assert.equal((await request(pointer)).status, 403);
  assert.deepEqual(await (await request(clipRoute(name))).json(), { clips: [old] });
  assert.deepEqual(await (await request(clipRoute('別の脚本'))).json(), { clips: [] });
  assert.equal((await put(clipRoute(name, { ...clip, expectedRevision: '' }), mp3, 'audio/mpeg')).status, 409);

  const competingUrl = clipRoute(name, { ...clip, expectedRevision: old.revision });
  const writers = await Promise.all([put(competingUrl, mp3, 'audio/mpeg'), put(competingUrl, wave, 'audio/x-wav')]);
  assert.deepEqual(writers.map(response => response.status).sort(), [200, 409]);
  const winner = await writers.find(response => response.status === 200).json();
  assert.notEqual(winner.revision, old.revision);
  assert.equal((await request(old.url)).status, 404);

  const exported = await put(clipRoute(name, { index, fingerprint: secondFingerprint }), mp3, 'audio/mp3');
  assert.equal(exported.status, 200);
  const newer = await exported.json();
  assert.equal(newer.fingerprint, secondFingerprint);
  assert.equal((await request(winner.url)).status, 404);
  assert.deepEqual(await (await request(clipRoute(name))).json(), { clips: [newer] });
  const filename = newer.url.split('/').at(-1);
  const directory = path.join(assetRoot, 'tts-output', name);
  assert.deepEqual(await fs.readFile(path.join(directory, filename)), mp3);
  assert.deepEqual((await fs.readdir(directory)).sort(), [`.line-${index}.json`, filename]);

  await fs.unlink(path.join(directory, filename));
  assert.deepEqual(await (await request(clipRoute(name))).json(), { clips: [] });
  assert.equal((await put(clipRoute(name, { ...clip, expectedRevision: '' }), wave, 'audio/wav')).status, 200);
});
