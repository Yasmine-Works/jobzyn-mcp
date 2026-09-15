import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function main() {
  const { values } = parseArgs({ options: { 'job-id': { type: 'string' } } });
  if (!process.env.JOBZYN_API_KEY || !values['job-id']?.trim()) {
    process.stderr.write('Set JOBZYN_API_KEY in the process environment or ignored .env file, and pass --job-id with an existing external job ID.\n');
    process.exitCode = 1;
    return;
  }
  const client = new Client({ name: 'jobzyn-read-only-smoke-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [join(root, 'dist/cli.js'), '--transport', 'stdio'], stderr: 'pipe',
    env: {
      JOBZYN_API_KEY: process.env.JOBZYN_API_KEY,
      ...(process.env.JOBZYN_BASE_URL ? { JOBZYN_BASE_URL: process.env.JOBZYN_BASE_URL } : {}),
      JOBZYN_REQUEST_TIMEOUT_MS: '15000',
    },
  });
  // Consume but never print diagnostics from the credential-bearing process.
  transport.stderr?.resume();
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const result = await client.callTool({ name: 'jobzyn_get_candidates', arguments: { externalJobId: values['job-id'], page: 1, pageSize: 1 } });
    const response = result.structuredContent;
    if (result.isError || response?.httpStatus !== 200 || !Array.isArray(response?.data?.candidates)) {
      const status = Number.isInteger(response?.httpStatus) ? response.httpStatus : 'unavailable';
      const message = response?.data?.error?.message;
      let reason = 'Check the API key, read scope, and external job ID.';
      if (typeof message === 'string') {
        if (/not associated with any job/i.test(message)) reason = 'No job is linked to that external ID in this company. Check whether the supplied ID is an internal JobZyn ID.';
        else if (/insufficient permissions/i.test(message)) reason = 'The API key needs read scope.';
        else if (/invalid api key/i.test(message)) reason = 'JobZyn rejected the API key.';
        else if (/provide an api key/i.test(message)) reason = 'JobZyn reported a missing API key.';
      }
      process.stderr.write(`Read-only JobZyn test failed (HTTP ${status}). ${reason} Response content was suppressed.\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${JSON.stringify({
      passed: true, transport: 'stdio', discoveredTools: tools.length,
      httpStatus: response.httpStatus, candidatesReturned: response.data.candidates.length,
      totalCandidates: Number.isInteger(response.data.total) ? response.data.total : null,
      writesPerformed: 0,
    }, null, 2)}\n`);
  } finally { await client.close(); }
}

main().catch(() => {
  process.stderr.write('Read-only JobZyn test could not complete. Check the build and connection. Credentials and candidate details were not logged.\n');
  process.exitCode = 1;
});
