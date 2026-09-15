import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { TOOL_ENDPOINTS } from '../src/server.js';
import { httpServer, mockJobzyn, TEST_API_KEY, TEST_MCP_TOKEN } from './helpers.js';

for (const mode of ['stdio', 'http'] as const) {
  test(`${mode}: real SDK client discovers and executes every endpoint`, async t => {
    const api = await mockJobzyn();
    t.after(api.close);
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    let stderr = '';
    if (mode === 'stdio') {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url))],
        env: { JOBZYN_API_KEY: TEST_API_KEY, JOBZYN_BASE_URL: api.config.baseUrl },
        stderr: 'pipe',
      });
      transport.stderr?.on('data', chunk => { stderr += String(chunk); });
      await client.connect(transport);
    } else {
      const http = await httpServer(api.config);
      t.after(http.close);
      await client.connect(new StreamableHTTPClientTransport(new URL(http.url), { requestInit: { headers: { Authorization: `Bearer ${TEST_MCP_TOKEN}` } } }));
    }
    t.after(() => client.close());
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), TOOL_ENDPOINTS.map(tool => tool.name).sort());
    assert.equal(tools.filter(tool => tool.annotations?.readOnlyHint).length, 1);
    assert.equal(tools.find(tool => tool.name === 'jobzyn_get_candidates')?.annotations?.readOnlyHint, true);
    assert.equal(tools.find(tool => tool.name === 'jobzyn_unpublish_job')?.annotations?.destructiveHint, true);

    const job = {
      id: 'ATS-1', title: 'Software Engineer', description: '<p>Build tools</p>',
      responsibilities: '<p>Develop</p>', qualifications: '<p>TypeScript</p>',
      benefits: ['Insurance', 'Remote work'], city: ['Casablanca', 'Rabat'], country: 'Maroc',
      languages: ['fr', 'en', 'ar'], contractType: 'CDI', educationLevel: 'BAC +5', workMode: 'HYBRID',
      minSalary: 0, maxSalary: 12000, displaySalary: false, minExperience: 0, maxExperience: 5,
      status: 'UNPUBLISHED', recruitmentProcess: ['Screen', 'Interview'],
      customMetadata: { nested: [true, null, 42] },
    };
    const created = await client.callTool({ name: 'jobzyn_create_job', arguments: { job } });
    assert.ok(!created.isError);
    assert.deepEqual(api.requests[0]?.body, { job });
    assert.equal(api.requests[0]?.method, 'POST');
    assert.equal(api.requests[0]?.url, '/api/integrations/job');

    const updated = await client.callTool({ name: 'jobzyn_update_job', arguments: { externalJobId: 'ATS-1', job: { displaySalary: false, minSalary: 0, custom: 'preserved' } } });
    assert.ok(!updated.isError);
    assert.equal(api.requests[1]?.method, 'PUT');
    assert.equal(api.requests[1]?.url, '/api/integrations/job/ATS-1');
    assert.deepEqual(api.requests[1]?.body, { job: { displaySalary: false, minSalary: 0, custom: 'preserved' } });

    assert.ok(!(await client.callTool({ name: 'jobzyn_unpublish_job', arguments: { externalJobId: 'ATS-1' } })).isError);
    assert.equal(api.requests[2]?.method, 'DELETE');
    assert.equal(api.requests[2]?.url, '/api/integrations/job/ATS-1');
    assert.equal(api.requests[2]?.body, undefined);
    assert.equal(api.requests[2]?.headers['content-type'], undefined);

    const dates = { since: '2026-07-02T00:00:00Z', from: '2026-07-01', to: '2026-07-03T23:59:59+01:00', page: 2, pageSize: 100 };
    const candidates = await client.callTool({ name: 'jobzyn_get_candidates', arguments: { externalJobId: 'ATS/é ?#', ...dates } });
    assert.ok(!candidates.isError);
    assert.equal(api.requests[3]?.method, 'GET');
    const candidateUrl = new URL(api.requests[3]!.url, api.config.baseUrl);
    assert.equal(candidateUrl.pathname, '/api/integrations/job/ATS%2F%C3%A9%20%3F%23/candidates');
    assert.deepEqual(Object.fromEntries(candidateUrl.searchParams), Object.fromEntries(Object.entries(dates).map(([key, value]) => [key, String(value)])));
    assert.equal((candidates.structuredContent as { data: { total: number } }).data.total, 101);
    assert.equal(api.requests.length, 4, 'one page, no automatic pagination');

    const links = [{ jobzynJobId: 2625, externalJobId: 'ATS-1' }];
    assert.ok(!(await client.callTool({ name: 'jobzyn_link_external_ids', arguments: { links } })).isError);
    assert.deepEqual(api.requests[4]?.body, { links });
    assert.equal(api.requests[4]?.method, 'POST');
    assert.equal(api.requests[4]?.url, '/api/integrations/job/link');
    for (const request of api.requests) {
      assert.equal(request.headers['x-api-key'], TEST_API_KEY);
      assert.equal(request.headers.authorization, undefined, 'MCP token must never be forwarded upstream');
    }
    const invalidCalls = [
      { name: 'jobzyn_create_job', arguments: { job: { id: 'ATS-1' } } },
      { name: 'jobzyn_create_job', arguments: { job: { id: 'ATS-1', title: 'Title', educationLevel: 'Bac+5' } } },
      { name: 'jobzyn_get_candidates', arguments: { externalJobId: 'ATS-1', pageSize: 101 } },
      { name: 'jobzyn_get_candidates', arguments: { externalJobId: 'ATS-1', since: '2026-02-30' } },
      { name: 'jobzyn_unpublish_job', arguments: { externalJobId: '..' } },
      { name: 'jobzyn_update_job', arguments: { externalJobId: 'ATS-1', job: {}, extra: 'typo' } },
    ];
    for (const call of invalidCalls) assert.equal((await client.callTool(call)).isError, true);
    assert.equal(api.requests.length, 5, 'invalid calls must not reach JobZyn');
    assert.equal(stderr, '', 'stdio must not emit startup chatter');
  });
}

test('HTTP: concurrent clients do not share SDK connection state', async t => {
  const api = await mockJobzyn(); t.after(api.close);
  const http = await httpServer(api.config); t.after(http.close);
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const client = new Client({ name: `parallel-${i}`, version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(http.url), { requestInit: { headers: { Authorization: `Bearer ${TEST_MCP_TOKEN}` } } }));
      assert.equal((await client.listTools()).tools.length, 5);
      assert.ok(!(await client.callTool({ name: 'jobzyn_get_candidates', arguments: { externalJobId: `ATS-${i}` } })).isError);
    } finally { await client.close(); }
  }));
  assert.equal(api.requests.length, 8);
});
