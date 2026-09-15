import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assertSafePackageFile, localSecrets } from './package-policy.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'jobzyn-release-'));
const env = { ...process.env };
for (const key of ['JOBZYN_API_KEY', 'MCP_AUTH_TOKEN', 'NODE_OPTIONS']) delete env[key];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });

try {
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const secrets = localSecrets(root);
  // The caller builds first; avoid recursively invoking publication lifecycle hooks.
  const [packed] = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch]));
  assert.equal(packed.name, metadata.name);
  assert.equal(packed.version, metadata.version);
  const archive = join(scratch, packed.filename);
  const entries = run('tar', ['-tzf', archive]).trim().split('\n');
  assert.deepEqual(entries.map(entry => entry.replace(/^package\//, '')).sort(), packed.files.map(file => file.path).sort());
  for (const entry of entries) {
    assert.ok(entry.startsWith('package/') && !entry.includes('..'));
    const path = entry.slice('package/'.length);
    assertSafePackageFile(path, run('tar', ['-xOzf', archive, entry]), secrets);
  }
  for (const path of ['dist/cli.js', 'dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE']) {
    assert.ok(packed.files.some(file => file.path === path), `Missing required package file: ${path}`);
  }

  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'jobzyn-release-consumer', version: '1.0.0', private: true, type: 'module' }));
  run(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', archive], consumer);
  const installedCli = join(consumer, 'node_modules', metadata.name, 'dist/cli.js');
  assert.equal(run(process.execPath, [installedCli, '--version'], consumer).trim(), metadata.version);
  assert.match(run(process.execPath, [installedCli, '--help'], consumer), /stdio\|http/);
  run(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(metadata.name)}); if (m.TOOL_ENDPOINTS.length !== 5) throw new Error('Missing tools');`], consumer);
  writeFileSync(join(consumer, 'consumer.mts'), `import { createJobzynServer, readApiConfig, createHttpApp, readHttpConfig } from ${JSON.stringify(metadata.name)};\ncreateJobzynServer(readApiConfig());\ncreateHttpApp(readApiConfig(), readHttpConfig());\n`);
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.mts'], consumer);

  const client = new Client({ name: 'release-check', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [installedCli, '--transport', 'stdio'], stderr: 'pipe',
    env: { JOBZYN_API_KEY: 'jz_release_check_placeholder', JOBZYN_BASE_URL: 'http://127.0.0.1:1/api/integrations' },
  });
  transport.stderr?.resume();
  try {
    await client.connect(transport);
    const listed = (await client.listTools()).tools.map(tool => tool.name).sort();
    assert.deepEqual(listed, ['jobzyn_create_job', 'jobzyn_get_candidates', 'jobzyn_link_external_ids', 'jobzyn_unpublish_job', 'jobzyn_update_job']);
  } finally { await client.close(); }

  const bytes = readFileSync(archive);
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(integrity, packed.integrity);
  const output = join(root, '.release');
  mkdirSync(output, { recursive: true });
  copyFileSync(archive, join(output, packed.filename));
  const manifest = {
    package: `${metadata.name}@${metadata.version}`, filename: packed.filename,
    sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(),
    sourceDirty: run('git', ['status', '--porcelain']).trim().length > 0,
    integrity, sha256: createHash('sha256').update(bytes).digest('hex'),
    files: packed.files.map(file => file.path).sort(),
    verified: ['package allowlist', 'credential scan', 'clean production installation', 'CLI', 'TypeScript declarations', 'stdio tool discovery'],
    published: false,
  };
  writeFileSync(join(output, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Verified ${manifest.package}: ${packed.files.length} reviewed files, clean install, TypeScript declarations, and all five stdio tools.\nArtifacts: .release/${packed.filename} and .release/release-manifest.json\nNo registry publication or live API calls were performed.\n`);
} catch {
  // Do not print subprocess output or assertion values: either could contain secrets.
  process.stderr.write('Package verification failed. Check the build, reviewed file allowlist, credential scan, tar/npm availability, and clean-install connectivity. No credential values or package contents were logged.\n');
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
