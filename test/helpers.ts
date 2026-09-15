import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createHttpApp } from '../src/http.js';
import type { ApiConfig, HttpConfig } from '../src/config.js';

export const TEST_API_KEY = 'jz_test_api_key_for_local_tests_only';
export const TEST_MCP_TOKEN = 'test_mcp_token_for_local_tests_only_123456789';
export const httpConfig: HttpConfig = {
  host: '127.0.0.1', port: 3000, authToken: TEST_MCP_TOKEN,
  allowedHosts: ['localhost', '127.0.0.1', '[::1]'], allowedOrigins: ['https://client.example.com'],
};

export interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

export async function closeServer(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await closed;
}

export async function mockJobzyn(handler?: (req: CapturedRequest, res: ServerResponse) => void | Promise<void>) {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    const captured = { method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) as unknown : undefined };
    requests.push(captured);
    res.setHeader('Content-Type', 'application/json');
    if (handler) { await handler(captured, res); return; }
    if (req.method === 'GET') res.end(JSON.stringify({ candidates: [{ id: '456', email: 'candidate@example.com' }], total: 101, error: null }));
    else if (req.url === '/api/integrations/job/link') res.end(JSON.stringify({ results: [{ jobzynJobId: 2625, externalJobId: 'ATS-1', status: 'linked' }], error: null }));
    else res.end(JSON.stringify({ jobId: 1234, jobUrl: 'https://www.jobzyn.com/fr/example-job', error: null }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const config: ApiConfig = { apiKey: TEST_API_KEY, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integrations`, requestTimeoutMs: 2000 };
  return { server, config, requests, close: () => closeServer(server) };
}

export async function httpServer(api: ApiConfig, overrides: Partial<HttpConfig> = {}) {
  const app = createHttpApp(api, { ...httpConfig, ...overrides });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, origin, url: `${origin}/mcp`, close: () => closeServer(server) };
}
