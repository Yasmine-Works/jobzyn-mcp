import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { readApiConfig, readHttpConfig, VERSION } from '../src/config.js';
import { createJobInput, updateJobInput, getCandidatesInput } from '../src/schemas.js';
import { createHttpApp } from '../src/http.js';
import { httpConfig, TEST_API_KEY, TEST_MCP_TOKEN } from './helpers.js';

test('configuration rejects missing credentials, insecure upstream URLs, and invalid limits', () => {
  assert.throws(() => readApiConfig({}), /JOBZYN_API_KEY/);
  const env = { JOBZYN_API_KEY: TEST_API_KEY };
  assert.equal(readApiConfig(env).baseUrl, 'https://www.jobzyn.com/api/integrations');
  for (const url of ['http://example.com/api', 'ftp://example.com', 'https://user:secret@example.com', 'https://example.com/?key=secret', 'https://example.com/#secret', 'bad-url']) {
    assert.throws(() => readApiConfig({ ...env, JOBZYN_BASE_URL: url }));
  }
  assert.equal(readApiConfig({ ...env, JOBZYN_BASE_URL: 'http://127.0.0.1:9000/api/' }).baseUrl, 'http://127.0.0.1:9000/api');
  for (const value of ['0', '-1', '1.5', 'abc', '300001']) {
    assert.throws(() => readApiConfig({ ...env, JOBZYN_REQUEST_TIMEOUT_MS: value }));
  }
  assert.throws(() => readApiConfig({ JOBZYN_API_KEY: 'secret\nvalue' }), error => error instanceof Error && !error.message.includes('secret'));
});

test('HTTP requires an independent strong token and exact allowlists', () => {
  assert.throws(() => readHttpConfig({}), /MCP_AUTH_TOKEN/);
  assert.throws(() => readHttpConfig({ MCP_AUTH_TOKEN: 'short' }), /32/);
  assert.throws(() => readHttpConfig({ MCP_AUTH_TOKEN: TEST_MCP_TOKEN, HOST: '0.0.0.0' }), /MCP_ALLOWED_HOSTS/);
  for (const hosts of ['*', 'https://example.com', 'example.com:3000']) {
    assert.throws(() => readHttpConfig({ MCP_AUTH_TOKEN: TEST_MCP_TOKEN, MCP_ALLOWED_HOSTS: hosts }));
  }
  for (const origins of ['*', 'null', 'https://client.example.com/', 'https://client.example.com/path']) {
    assert.throws(() => readHttpConfig({ MCP_AUTH_TOKEN: TEST_MCP_TOKEN, MCP_ALLOWED_ORIGINS: origins }));
  }
  assert.deepEqual(readHttpConfig({ MCP_AUTH_TOKEN: TEST_MCP_TOKEN }).allowedHosts, ['localhost', '127.0.0.1', '[::1]']);
  assert.throws(() => createHttpApp(readApiConfig({ JOBZYN_API_KEY: TEST_MCP_TOKEN }), httpConfig), /different/);
});

test('job schemas preserve extensions and partial updates, and enforce all documented enums', () => {
  assert.deepEqual(updateJobInput.parse({ externalJobId: 'ATS-1', job: { title: 'New' } }).job, { title: 'New' });
  const job = { id: 'ATS-1', title: 'Title', city: 'Casablanca', benefits: 'Insurance', custom: { nested: ['one', null] } };
  assert.deepEqual(createJobInput.parse({ job }).job, job);
  for (const [field, value] of Object.entries({ languages: ['es'], contractType: 'Full time', educationLevel: 'Bac+5', workMode: 'remote', status: 'DRAFT', minExperience: -1, maxExperience: 21 })) {
    assert.equal(createJobInput.safeParse({ job: { ...job, [field]: value } }).success, false);
  }
  for (const query of [{ page: 0 }, { page: 1.5 }, { pageSize: 0 }, { pageSize: 101 }, { since: 'yesterday' }]) {
    assert.equal(getCandidatesInput.safeParse({ externalJobId: 'ATS-1', ...query }).success, false);
  }
  assert.deepEqual(getCandidatesInput.parse({ externalJobId: 'ATS-1' }), { externalJobId: 'ATS-1' });
});

test('CLI help/version need no secrets; invalid startup fails without stdout protocol pollution', () => {
  const cli = new URL('../dist/cli.js', import.meta.url);
  const run = (...args: string[]) => spawnSync(process.execPath, [cli.pathname, ...args], { encoding: 'utf8', env: {} });
  assert.match(run('--help').stdout, /stdio\|http/);
  assert.equal(run('--version').stdout.trim(), VERSION);
  assert.equal(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version, VERSION);
  for (const args of [[], ['--transport', 'wrong'], ['--unknown']]) {
    const output = run(...args);
    assert.equal(output.status, 1);
    assert.equal(output.stdout, '');
    assert.ok(output.stderr.length > 0);
  }
});

test('CLI HTTP lifecycle selects transport from environment and exits cleanly on SIGTERM', async t => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, [new URL('../dist/cli.js', import.meta.url).pathname], {
    env: { JOBZYN_API_KEY: TEST_API_KEY, MCP_AUTH_TOKEN: TEST_MCP_TOKEN, MCP_TRANSPORT: 'http', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('HTTP CLI did not start')), 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`CLI exited before startup: ${code}`)); });
    child.stderr.on('data', chunk => {
      if (String(chunk).includes('listening')) { clearTimeout(timer); resolve(); }
    });
  });
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/healthz`)).json(), { status: 'ok' });
  const exit = once(child, 'exit');
  child.kill('SIGTERM');
  const [code, signal] = await exit;
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.equal(stdout, '');
});
