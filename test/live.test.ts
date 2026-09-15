import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { mockJobzyn, TEST_API_KEY } from './helpers.js';

const execute = promisify(execFile);
const script = new URL('../scripts/test-live.mjs', import.meta.url).pathname;

test('live-test helper performs a single read and suppresses credentials and candidate details', async t => {
  const api = await mockJobzyn(); t.after(api.close);
  const { stdout, stderr } = await execute(process.execPath, [script, '--job-id', 'ATS-EXAMPLE'], {
    env: { JOBZYN_API_KEY: TEST_API_KEY, JOBZYN_BASE_URL: api.config.baseUrl }, timeout: 5000,
  });
  assert.deepEqual(JSON.parse(stdout), {
    passed: true, transport: 'stdio', discoveredTools: 5, httpStatus: 200,
    candidatesReturned: 1, totalCandidates: 101, writesPerformed: 0,
  });
  assert.equal(stderr, '');
  assert.ok(!stdout.includes(TEST_API_KEY));
  assert.ok(!stdout.includes('candidate@example.com'));
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0]?.method, 'GET');
  assert.equal(api.requests[0]?.url, '/api/integrations/job/ATS-EXAMPLE/candidates?page=1&pageSize=1');
});

test('live-test failures explain an unlinked ID without echoing upstream errors', async t => {
  const api = await mockJobzyn((_req, res) => {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: { message: `External id ATS-EXAMPLE is not associated with any job within company PRIVATE_COMPANY ${TEST_API_KEY}` } }));
  });
  t.after(api.close);
  await assert.rejects(execute(process.execPath, [script, '--job-id', 'ATS-EXAMPLE'], {
    env: { JOBZYN_API_KEY: TEST_API_KEY, JOBZYN_BASE_URL: api.config.baseUrl }, timeout: 5000,
  }), error => {
    const failure = error as Error & { stdout: string; stderr: string };
    assert.equal(failure.stdout, '');
    assert.match(failure.stderr, /No job is linked to that external ID/);
    assert.ok(!failure.stderr.includes('PRIVATE_COMPANY'));
    assert.ok(!failure.stderr.includes(TEST_API_KEY));
    return true;
  });
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0]?.method, 'GET');
});
