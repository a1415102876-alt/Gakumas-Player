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
