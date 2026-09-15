import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertSafePackageFile, localSecrets } from '../scripts/package-policy.mjs';

test('release policy rejects unexpected files and credentials without echoing their values', () => {
  for (const path of ['.env', '.env.local', '.npmrc', 'examples/.env', 'dist/credentials.json', '../secret', 'test/fixture.ts']) {
    assert.throws(() => assertSafePackageFile(path, 'anything'), /reviewed allowlist/);
  }
  for (const secret of [`jz_${'A'.repeat(32)}`, `npm_${'B'.repeat(36)}`, '-----BEGIN PRIVATE KEY-----', 'custom-secret-value']) {
    assert.throws(() => assertSafePackageFile('dist/cli.js', `prefix ${secret} suffix`, [secret]), error => {
      assert.ok(error.message.includes('credential'));
      assert.ok(!error.message.includes(secret));
      return true;
    });
  }
  assert.doesNotThrow(() => assertSafePackageFile('.env.example', 'JOBZYN_API_KEY=jz_replace_with_your_jobzyn_api_key'));
});

test('release scanning reads local secrets without adding them to process environment', () => {
  const root = mkdtempSync(join(tmpdir(), 'jobzyn-secret-scan-'));
  try {
    writeFileSync(join(root, '.env'), 'JOBZYN_API_KEY=local-value\nMCP_AUTH_TOKEN=YOUR_PLACEHOLDER\n');
    writeFileSync(join(root, '.env.local'), 'MCP_AUTH_TOKEN=local-token\n');
    writeFileSync(join(root, '.env.example'), 'JOBZYN_API_KEY=example-value\n');
    assert.deepEqual(localSecrets(root, { NPM_TOKEN: 'env-token' }).sort(), ['env-token', 'local-value', 'local-token'].sort());
  } finally { rmSync(root, { recursive: true, force: true }); }
});
