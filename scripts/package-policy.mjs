import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const publicFiles = new Set([
  'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', '.env.example', 'docs/RELEASING.md',
  'examples/claude-desktop.json', 'examples/claude-desktop-npm.json',
  'examples/codex-stdio.toml', 'examples/codex-npm.toml', 'examples/codex-http.toml',
  'examples/yasmine-registration.md',
]);
const runtimeFile = /^dist\/(cli|client|config|http|index|schemas|server)\.(js|js\.map|d\.ts)$/;

export function localSecrets(root, env = process.env) {
  const sources = [env];
  for (const name of readdirSync(root).filter(name => /^\.env(?:$|\.)/.test(name) && name !== '.env.example')) {
    const path = join(root, name);
    if (existsSync(path)) sources.push(parseEnv(readFileSync(path, 'utf8')));
  }
  return [...new Set(sources.flatMap(source => ['JOBZYN_API_KEY', 'MCP_AUTH_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN']
    .map(key => source[key]).filter(value => value && !/replace_with|YOUR_/i.test(value))))];
}

export function assertSafePackageFile(path, content, secrets = []) {
  if (!publicFiles.has(path) && !runtimeFile.test(path)) {
    throw new Error('The package contains a file outside the reviewed allowlist.');
  }
  if (/\bjz_[A-Za-z0-9]{32}\b/.test(content) || /\bnpm_[A-Za-z0-9]{30,}\b/.test(content) ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content) ||
      secrets.some(secret => content.includes(secret))) {
    throw new Error('The package may contain a credential. No credential value has been logged.');
  }
}
