export const DEFAULT_BASE_URL = 'https://www.jobzyn.com/api/integrations';
export const VERSION = '0.1.0';

export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
  requestTimeoutMs: number;
}

export interface HttpConfig {
  host: string;
  port: number;
  authToken: string;
  allowedHosts: string[];
  allowedOrigins: string[];
}

function secret(value: string | undefined, name: string): string {
  if (!value || value.trim() !== value || /[\s\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${name} is required and must not contain whitespace or control characters.`);
  }
  return value;
}

function integer(value: string | undefined, fallback: number, name: string, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}.`);
  }
  return Number(value);
}

export function validateApiConfig(config: ApiConfig): ApiConfig {
  secret(config.apiKey, 'JOBZYN_API_KEY');
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error('JOBZYN_BASE_URL must be a valid absolute URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('JOBZYN_BASE_URL requires HTTPS (HTTP only on loopback), without credentials, query, or fragment.');
  }
  if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1 || config.requestTimeoutMs > 300_000) {
    throw new Error('JOBZYN_REQUEST_TIMEOUT_MS must be an integer between 1 and 300000.');
  }
  return { ...config, baseUrl: url.href.replace(/\/+$/, '') };
}

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return validateApiConfig({
    apiKey: secret(env.JOBZYN_API_KEY, 'JOBZYN_API_KEY'),
    baseUrl: env.JOBZYN_BASE_URL ?? DEFAULT_BASE_URL,
    requestTimeoutMs: integer(env.JOBZYN_REQUEST_TIMEOUT_MS, 30_000, 'JOBZYN_REQUEST_TIMEOUT_MS', 300_000),
  });
}

function list(value: string | undefined): string[] {
  return value?.split(',').map(item => item.trim()).filter(Boolean) ?? [];
}

export function validateHttpConfig(config: HttpConfig): HttpConfig {
  secret(config.authToken, 'MCP_AUTH_TOKEN');
  if (!/^[A-Za-z0-9._~+\/-]+={0,}$/.test(config.authToken) || config.authToken.length < 32) {
    throw new Error('MCP_AUTH_TOKEN must be a bearer token of at least 32 characters. Generate it with openssl rand -hex 32.');
  }
  if (!config.host || /[\s/]/.test(config.host)) throw new Error('HOST must be a hostname or IP address.');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  if (config.allowedHosts.length === 0 || config.allowedHosts.some(host =>
    !/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])$/.test(host) || host.includes('*'))) {
    throw new Error('MCP_ALLOWED_HOSTS must contain exact hostnames or IPs, without schemes, ports, or wildcards.');
  }
  for (const origin of config.allowedOrigins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('MCP_ALLOWED_ORIGINS must contain exact HTTP(S) origins.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('MCP_ALLOWED_ORIGINS must contain exact HTTP(S) origins, without paths or trailing slashes.');
    }
  }
  return { ...config, allowedHosts: config.allowedHosts.map(host => host.toLowerCase()), allowedOrigins: [...config.allowedOrigins] };
}

export function readHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const host = env.HOST ?? '127.0.0.1';
  const allowedHosts = env.MCP_ALLOWED_HOSTS === undefined && ['127.0.0.1', 'localhost', '::1'].includes(host)
    ? ['localhost', '127.0.0.1', '[::1]'] : list(env.MCP_ALLOWED_HOSTS);
  return validateHttpConfig({
    host,
    port: integer(env.PORT, 3000, 'PORT', 65535),
    authToken: secret(env.MCP_AUTH_TOKEN, 'MCP_AUTH_TOKEN'),
    allowedHosts,
    allowedOrigins: list(env.MCP_ALLOWED_ORIGINS),
  });
}
