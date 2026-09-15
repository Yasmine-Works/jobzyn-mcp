import { createHash, timingSafeEqual } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import express, { type ErrorRequestHandler, type Response } from 'express';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { validateApiConfig, validateHttpConfig, type ApiConfig, type HttpConfig } from './config.js';
import { createJobzynServer } from './server.js';

function rpcError(res: Response, status: number, message: string, code = -32000): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

export function createHttpApp(apiConfig: ApiConfig, httpConfig: HttpConfig): express.Express {
  const api = validateApiConfig(apiConfig);
  const config = validateHttpConfig(httpConfig);
  if (api.apiKey === config.authToken) throw new Error('MCP_AUTH_TOKEN must be different from JOBZYN_API_KEY.');
  const tokenHash = createHash('sha256').update(config.authToken).digest();
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(hostHeaderValidation(config.allowedHosts));

  app.get('/healthz', (_req, res) => { res.json({ status: 'ok' }); });

  app.use('/mcp', (req, res, next) => {
    res.vary('Origin');
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!config.allowedOrigins.includes(origin)) {
        rpcError(res, 403, 'Origin is not allowed.');
        return;
      }
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID');
      res.set('Access-Control-Expose-Headers', 'MCP-Session-Id, MCP-Protocol-Version, WWW-Authenticate');
    }
    // Preflight carries no credentials; the actual request is always authenticated.
    if (req.method === 'OPTIONS') { res.set('Allow', 'POST, OPTIONS').status(204).end(); return; }
    const match = /^Bearer ([A-Za-z0-9._~+\/-]+={0,})$/i.exec(req.headers.authorization ?? '');
    if (!match?.[1] || !timingSafeEqual(createHash('sha256').update(match[1]).digest(), tokenHash)) {
      res.set('WWW-Authenticate', 'Bearer realm="jobzyn-mcp"');
      rpcError(res, 401, 'A valid MCP bearer token is required.');
      return;
    }
    next();
  });

  app.post('/mcp', express.json({ limit: '1mb', inflate: false }), async (req, res) => {
    const disconnected = new AbortController();
    // A distinct SDK server/transport for each request prevents cross-client state.
    const server = createJobzynServer(api, disconnected.signal);
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      disconnected.abort();
      await server.close();
    };
    res.once('close', () => { void close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) rpcError(res, 500, 'Internal MCP server error.', -32603);
      else if (!res.writableEnded) res.end();
      await close();
    }
  });
  app.all('/mcp', (_req, res) => {
    res.set('Allow', 'POST, OPTIONS');
    rpcError(res, 405, 'This server uses stateless Streamable HTTP POST; standalone SSE and session deletion are not supported.');
  });
  app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) { res.end(); return; }
    const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
    if (status === 413) rpcError(res, 413, 'Request body exceeds 1 MiB.');
    else if (status === 415) rpcError(res, 415, 'Unsupported request encoding or charset.');
    else if (status === 400) rpcError(res, 400, 'Invalid JSON request body.', -32700);
    else rpcError(res, 500, 'Internal MCP server error.', -32603);
  };
  app.use(errorHandler);
  return app;
}

export async function startHttpServer(api: ApiConfig, config: HttpConfig): Promise<HttpServer> {
  const app = createHttpApp(api, config);
  return new Promise((resolve, reject) => {
    const listener = app.listen(config.port, config.host);
    listener.once('error', reject);
    listener.once('listening', () => { listener.removeListener('error', reject); resolve(listener); });
  });
}
