import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { JobzynClient, JobzynRequestError } from '../src/client.js';
import { createJobzynServer } from '../src/server.js';
import { mockJobzyn, TEST_API_KEY } from './helpers.js';

for (const status of [200, 201, 400, 401, 403, 404, 409, 429, 500]) {
  test(`HTTP ${status}: preserve status and response, signal API failures without retrying`, async t => {
    const success = status < 400;
    const api = await mockJobzyn((_req, res) => {
      res.statusCode = status;
      if (status === 429) res.setHeader('Retry-After', '60');
      res.end(JSON.stringify({ jobId: success ? 123 : null, error: success ? null : { message: `Error with ${TEST_API_KEY}` } }));
    });
    t.after(api.close);
    const server = createJobzynServer(api.config);
    const client = new Client({ name: 'error-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    t.after(() => client.close()); t.after(() => server.close());
    const result = await client.callTool({ name: 'jobzyn_update_job', arguments: { externalJobId: 'ATS-1', job: { title: 'Title' } } });
    assert.equal(Boolean(result.isError), !success);
    const data = result.structuredContent as { httpStatus: number; retryAfter?: string };
    assert.equal(data.httpStatus, status);
    assert.equal(data.retryAfter, status === 429 ? '60' : undefined);
    assert.ok(!JSON.stringify(result).includes(TEST_API_KEY));
    if (!success) assert.ok(JSON.stringify(result).includes('[REDACTED]'));
    assert.equal(api.requests.length, 1);
  });
}

test('application errors and partial link failures retain useful results', async t => {
  const api = await mockJobzyn((req, res) => {
    if (req.url.endsWith('/link')) res.end(JSON.stringify({ results: [
      { jobzynJobId: 1, status: 'linked' }, { jobzynJobId: 2, status: 'already_linked' }, { jobzynJobId: 3, status: 'not_found' },
    ], error: null }));
    else res.end(JSON.stringify({ error: { message: 'Application-level error' } }));
  });
  t.after(api.close);
  const server = createJobzynServer(api.config);
  const client = new Client({ name: 'partial-test', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  t.after(() => client.close()); t.after(() => server.close());
  assert.equal((await client.callTool({ name: 'jobzyn_unpublish_job', arguments: { externalJobId: 'ATS-1' } })).isError, true);
  const partial = await client.callTool({ name: 'jobzyn_link_external_ids', arguments: { links: [{ jobzynJobId: 1, externalJobId: 'ATS-1' }] } });
  assert.equal(partial.isError, true);
  assert.equal((partial.structuredContent as { data: { results: unknown[] } }).data.results.length, 3);
});

test('upstream redirects never forward the API key to another destination', async t => {
  const target = await mockJobzyn(); t.after(target.close);
  const api = await mockJobzyn((_req, res) => { res.writeHead(307, { Location: target.config.baseUrl }); res.end(); });
  t.after(api.close);
  await assert.rejects(new JobzynClient(api.config).createJob({ id: 'ATS-1', title: 'Title' }), error =>
    error instanceof JobzynRequestError && error.code === 'NETWORK_ERROR' && error.outcomeUnknown);
  assert.equal(api.requests.length, 1);
  assert.equal(target.requests.length, 0);
});

test('non-JSON, unexpected JSON, and oversized responses produce bounded, sanitized errors', async t => {
  for (const body of ['<html>private upstream failure</html>', 'null', '[]', JSON.stringify({ data: 'x'.repeat(10 * 1024 * 1024) })]) {
    const api = await mockJobzyn((_req, res) => { res.end(body); });
    t.after(api.close);
    await assert.rejects(new JobzynClient(api.config).getCandidates('ATS-1'), error => {
      assert.ok(error instanceof JobzynRequestError);
      assert.ok(['INVALID_RESPONSE', 'RESPONSE_TOO_LARGE'].includes(error.code));
      assert.equal(error.outcomeUnknown, false);
      assert.ok(!error.message.includes('private upstream failure'));
      return true;
    });
  }
});

test('timeouts cover the response body and report uncertain write outcomes through MCP', async t => {
  const api = await mockJobzyn((_req, res) => { res.writeHead(200); res.write('{'); });
  t.after(api.close);
  const server = createJobzynServer({ ...api.config, requestTimeoutMs: 60 });
  const client = new Client({ name: 'timeout-test', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  t.after(() => client.close()); t.after(() => server.close());
  const result = await client.callTool({ name: 'jobzyn_create_job', arguments: { job: { id: 'ATS-1', title: 'Title' } } });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as { error: { code: string } }).error.code, 'TIMEOUT');
  assert.equal((result.structuredContent as { error: { outcomeUnknown: boolean } }).error.outcomeUnknown, true);
  assert.equal(api.requests.length, 1);
});

test('caller cancellation aborts the upstream operation', async t => {
  const api = await mockJobzyn((_req, res) => { res.writeHead(200); res.write('{'); });
  t.after(api.close);
  const controller = new AbortController();
  const operation = new JobzynClient(api.config).getCandidates('ATS-1', {}, controller.signal);
  controller.abort();
  await assert.rejects(operation, error => error instanceof JobzynRequestError && error.code === 'CANCELLED');
});
