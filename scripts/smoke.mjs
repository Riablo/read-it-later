import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run with Node or Bun; every check uses a temporary database and local metadata source.
const directory = await mkdtemp(join(tmpdir(), 'readlater-smoke-'));
const dataPath = join(directory, 'readlater.json');
const source = createServer((request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(`<title>阅读测试 ${request.url}</title><meta name="description" content="本地摘要">`);
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const article = `http://127.0.0.1:${source.address().port}/article`;
const child = spawn(process.execPath, ['src/server.ts'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: '0', READLATER_DATA: dataPath },
  stdio: ['ignore', 'pipe', 'inherit']
});

try {
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
  const get = path => fetch(`${base}${path}`);
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  for (const [path, contentType] of [['/', 'text/html'], ['/styles.css', 'text/css'], ['/app.js', 'text/javascript'], ['/favicon.svg', 'image/svg+xml']]) {
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes(contentType));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await get('/missing')).status, 404);
  assert.equal((await get('/api/missing')).status, 404);
  const oversized = await new Promise((resolve, reject) => {
    const socket = connect(Number(new URL(base).port), '127.0.0.1', () => {
      socket.write('POST /api/save HTTP/1.1\r\nHost: localhost\r\nContent-Length: 134217729\r\nConnection: close\r\n\r\n');
    });
    let response = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('Oversized request timed out')));
    socket.on('data', chunk => { response += chunk; });
    socket.on('error', reject);
    socket.on('end', () => resolve(Number(response.split(' ')[1])));
  });
  assert.equal(oversized, 413);
  assert.equal((await get('/save')).status, 400);
  assert.deepEqual((await (await get('/api/items')).json()).counts, { inbox: 0, kept: 0, trash: 0 });
  assert.equal((await post('/api/save', { url: '' })).status, 400);
  assert.equal((await (await post('/api/preview-domain', { url: 'example.com' })).json()).domain, 'example');

  const saved = await post('/api/save', { url: article });
  assert.equal(saved.status, 201);
  const { item } = await saved.json();
  assert.equal(item.title, '阅读测试 /article');
  assert.equal(item.summary, '本地摘要');
  const duplicate = await (await post('/api/save', { url: article })).json();
  assert.equal(duplicate.item.id, item.id);
  assert.equal(duplicate.counts.inbox, 1);
  await new Promise(resolve => setTimeout(resolve, 10)); // Keep creation times distinct on fast runtimes.
  const redirect = await fetch(`${base}/save?u=${encodeURIComponent(`${article}-second`)}`, { redirect: 'manual' });
  assert.equal(redirect.status, 303);
  assert.match(redirect.headers.get('location'), /^\/\?saved=/);
  assert.equal((await (await get('/api/items?q=second')).json()).items.length, 1);
  assert.equal((await (await get('/api/items?q=unmatched')).json()).items.length, 0);
  assert.equal((await (await get('/api/items?sort=asc')).json()).items[0].id, item.id);
  assert.equal((await (await get('/api/items?sort=desc')).json()).items.at(-1).id, item.id);

  for (const [action, status] of [['keep', 'kept'], ['trash', 'trash'], ['restore', 'inbox']]) {
    const moved = await (await post(`/api/items/${item.id}/${action}`)).json();
    assert.equal(moved.item.status, status);
    assert.ok((await (await get(`/api/items?status=${status}`)).json()).items.some(value => value.id === item.id));
  }
  assert.equal((await post('/api/items/missing/keep')).status, 404);
  await post(`/api/items/${item.id}/trash`);
  assert.equal((await post('/api/trash/clear', {})).status, 400);
  assert.equal((await (await get('/api/items?status=trash')).json()).items.length, 1);
  assert.equal((await (await post('/api/trash/clear', { confirm: 'CLEAR_TRASH' })).json()).removed, 1);
  const persisted = JSON.parse(await readFile(dataPath, 'utf8'));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.items.length, 1);
  assert.equal(persisted.items[0].status, 'inbox');
  console.log(`${process.versions.bun ? 'Bun' : 'Node'}: static assets, metadata, save, deduplication, redirects, search, sort, moves, trash confirmation and persistence passed.`);
} finally {
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  source.closeAllConnections();
  await new Promise(resolve => source.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
