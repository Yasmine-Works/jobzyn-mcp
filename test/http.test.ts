import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { httpServer, mockJobzyn, TEST_MCP_TOKEN } from './helpers.js';

test('HTTP gateway boundaries: auth, hosts, origins, body limits, methods, health', async t => {
  const api = await mockJobzyn(); t.after(api.close);
  const http = await httpServer(api.config); t.after(http.close);
  const auth = { Authorization: `Bearer ${TEST_MCP_TOKEN}` };
  const json = { ...auth, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  for (const token of ['', 'Bearer wrong', `Basic ${TEST_MCP_TOKEN}`]) {
    const res = await fetch(http.url, { method: 'POST', headers: { Authorization: token } });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer realm="jobzyn-mcp"');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  const forbiddenHost = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(http.url, { method: 'POST', headers: { ...auth, Host: 'evil.example.com' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(forbiddenHost, 403);
  for (const origin of ['https://evil.example.com', 'null', 'https://client.example.com.evil.test']) {
    assert.equal((await fetch(http.url, { method: 'POST', headers: { ...json, Origin: origin }, body: '{}' })).status, 403);
  }
  const preflight = await fetch(http.url, { method: 'OPTIONS', headers: { Origin: 'https://client.example.com', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://client.example.com');
  assert.match(preflight.headers.get('access-control-allow-headers')!, /Authorization/);
  const malformed = await fetch(http.url, { method: 'POST', headers: json, body: '{bad-json-with-sensitive-content' });
  assert.equal(malformed.status, 400);
  assert.ok(!(await malformed.text()).includes('sensitive-content'));
  const tooLarge = await fetch(http.url, { method: 'POST', headers: json, body: JSON.stringify({ text: 'x'.repeat(1024 * 1024) }) });
  assert.equal(tooLarge.status, 413);
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const res = await fetch(http.url, { method, headers: auth });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST, OPTIONS');
  }
  const notification = await fetch(http.url, { method: 'POST', headers: { ...json, Origin: 'https://client.example.com' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(notification.status, 202);
  assert.equal(notification.headers.get('access-control-allow-origin'), 'https://client.example.com');
  const list = await fetch(http.url, { method: 'POST', headers: json, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal(list.status, 200);
  assert.match(list.headers.get('content-type')!, /application\/json/);
  assert.equal(list.headers.get('mcp-session-id'), null);
  assert.equal((await list.json() as { result: { tools: unknown[] } }).result.tools.length, 5);
  const unsupported = await fetch(http.url, { method: 'POST', headers: { ...json, 'MCP-Protocol-Version': '1900-01-01' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
  assert.equal(unsupported.status, 400);
  const health = await fetch(`${http.origin}/healthz`);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(health.headers.get('x-powered-by'), null);
  assert.equal((await fetch(`${http.origin}/missing`)).status, 404);
  assert.equal(api.requests.length, 0);
});
