#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readApiConfig, readHttpConfig, VERSION } from './config.js';
import { createJobzynServer } from './server.js';
import { startHttpServer } from './http.js';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    transport: { type: 'string', short: 't' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  } });
  if (values.help) {
    process.stdout.write(`JobZyn MCP ${VERSION}\n\nUsage: jobzyn-mcp [--transport stdio|http]\n\nDefault: stdio (or MCP_TRANSPORT). Node.js 22+ required.\n\nRequired: JOBZYN_API_KEY\nHTTP also requires: MCP_AUTH_TOKEN (at least 32 characters, distinct from the API key)\nOptional: JOBZYN_BASE_URL, JOBZYN_REQUEST_TIMEOUT_MS\nHTTP options: HOST (127.0.0.1), PORT (3000), MCP_ALLOWED_HOSTS, MCP_ALLOWED_ORIGINS\nNon-loopback HOST requires an explicit MCP_ALLOWED_HOSTS list.\n\nSee README.md for Claude Desktop, Codex, and transport setup.\n`);
    return;
  }
  if (values.version) { process.stdout.write(`${VERSION}\n`); return; }
  const transport = values.transport ?? process.env.MCP_TRANSPORT ?? 'stdio';
  if (transport !== 'stdio' && transport !== 'http') throw new Error('Transport must be stdio or http.');
  const apiConfig = readApiConfig();
  let close: () => Promise<void>;
  if (transport === 'http') {
    const httpConfig = readHttpConfig();
    const listener = await startHttpServer(apiConfig, httpConfig);
    close = () => new Promise((resolve, reject) => {
      listener.close(error => error ? reject(error) : resolve());
      listener.closeIdleConnections();
    });
    process.stderr.write(`JobZyn MCP listening on ${httpConfig.host}:${httpConfig.port}/mcp (Streamable HTTP).\n`);
  } else {
    const server = createJobzynServer(apiConfig);
    await server.connect(new StdioServerTransport());
    close = () => server.close();
  }
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    void close().then(() => { clearTimeout(forceExit); process.exitCode = 0; }).catch(() => { process.exitCode = 1; });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  // Config errors are deliberately written without including credential values.
  process.stderr.write(`jobzyn-mcp: ${error instanceof Error ? error.message : 'Failed to start.'}\n`);
  process.exitCode = 1;
});
