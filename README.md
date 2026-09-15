# JobZyn MCP server

Connect JobZyn to Claude Desktop, Codex, and other Model Context Protocol clients. This TypeScript server exposes **one tool for each of the five documented JobZyn API endpoints**, through either **stdio** or an optional **Streamable HTTP `/mcp` endpoint**.

The distribution is an npm package running locally over **stdio**. **No hosted service is planned.** Streamable HTTP remains available as an optional capability for independently managed installations; both transports use the same tools and validation.

**npm package:** [`jobzyn-mcp`](https://www.npmjs.com/package/jobzyn-mcp), version `0.1.1`. Use the pinned installation and client configuration examples below. Maintainers can run `npm run release:prepare` to build and verify a publication artifact; that command does not publish the package.


## Contents

- [Features and endpoint coverage](#features-and-endpoint-coverage)
- [Requirements and authentication](#requirements-and-authentication)
- [Quick start from source](#quick-start-from-source)
- [Install from npm](#install-from-npm)
- [Claude Desktop](#claude-desktop)
- [Codex](#codex)
- [Streamable HTTP](#streamable-http)
- [Hosting and Docker](#hosting-and-docker)
- [Configuration reference](#configuration-reference)
- [Tool reference](#tool-reference)
- [Results and errors](#results-and-errors)
- [Security and operating model](#security-and-operating-model)
- [Development, testing, and releases](#development-testing-and-releases)
- [Troubleshooting](#troubleshooting)
- [Documentation sources](#documentation-sources)

## Features and endpoint coverage

API base URL: `https://www.jobzyn.com/api/integrations`.

| MCP tool | API method and path | Scope | Behavior |
| --- | --- | --- | --- |
| `jobzyn_create_job` | `POST /job` | `write` | Create a job; publishes immediately unless explicitly created as a draft |
| `jobzyn_update_job` | `PUT /job/{externalJobId}` | `write` | Change supplied fields; creates a missing job through an upsert |
| `jobzyn_unpublish_job` | `DELETE /job/{externalJobId}` | `write` | Remove public visibility while retaining job data |
| `jobzyn_get_candidates` | `GET /job/{externalJobId}/candidates` | `read` | Retrieve one page of applications, with date filters |
| `jobzyn_link_external_ids` | `POST /job/link` | `write` | Attach external IDs to existing JobZyn jobs |

Coverage was checked against the [JobZyn documentation](https://docs.jobzyn.com/) on **September 15, 2026**. The site documents five method/path combinations. Authentication, accepted-values, and error pages describe those endpoints; they do not add API operations. There is no documented list-jobs endpoint or webhook registration endpoint to wrap.

Other features:

- Typed, validated tool inputs, including all documented enums and query parameters.
- Extra JSON fields inside `job` pass through, as allowed by JobZyn.
- Tool annotations identify read operations, writes, and changes that can remove or replace data.
- Responses include both readable JSON text and MCP `structuredContent`.
- Request timeouts, cancellation, bounded responses, and no automatic retries.
- Authenticated HTTP, exact host/origin allowlists, and stateless request handling.
- A CLI, TypeScript library exports, Dockerfile, and CI for Node.js 22 and 24.

## Requirements and authentication

- **Node.js 22 or newer** and npm for local execution or building.
- A JobZyn company API key. In the JobZyn backoffice, a Company Admin can open **Settings → API Keys → Generate New Key**. Copy the key when it is shown.
- `read` scope to retrieve candidates; `write` scope to create, update, unpublish, or link jobs. JobZyn binds each key to a company.

Set the key as `JOBZYN_API_KEY`. The server sends it to JobZyn in the `x-api-key` header. Tools never ask the model to provide an API key.

HTTP mode also needs **a separate `MCP_AUTH_TOKEN`** of at least 32 characters. Generate a random token with:

```sh
openssl rand -hex 32
```

Use this token in the MCP client's `Authorization: Bearer ...` header. The server rejects a token that equals the JobZyn API key. The two credentials have different roles:

```text
AI client ── MCP bearer token ──▶ JobZyn MCP server ── x-api-key ──▶ JobZyn
```

## Quick start from source

```sh
git clone https://github.com/Yasmine-Works/jobzyn-mcp.git
cd jobzyn-mcp
npm ci
npm run build
cp .env.example .env
```

Edit `.env` and replace `JOBZYN_API_KEY` with your company key. Then:

```sh
# Local MCP process; stdin/stdout belong to the MCP client.
node --env-file=.env dist/cli.js
```

The stdio process waits for MCP messages, so a quiet terminal is normal. A client usually launches this process itself; you do not need to run a separate stdio server first.

`.env` is **not loaded automatically**. Use Node's `--env-file` option, set environment variables through your client, or have your hosting platform inject them. Never commit real credentials. `npm start` and `npm run start:http` use the current process environment.

## Install from npm

Use an exact reviewed version:

```sh
export JOBZYN_API_KEY='YOUR_JOBZYN_API_KEY'
npx --yes jobzyn-mcp@0.1.1
```

Or install the CLI globally:

```sh
npm install --global jobzyn-mcp@0.1.1
jobzyn-mcp --transport stdio
```

To try the package locally before publishing:

```sh
npm pack
npm exec --yes --package=./jobzyn-mcp-0.1.1.tgz -- jobzyn-mcp --help
```

Pin reviewed releases in client configurations. Updating the package version requires updating and reviewing those pins as well.

## Claude Desktop

### Local stdio

Use Claude Desktop's developer settings to open its MCP configuration. Standard locations are:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Merge the following into your existing `mcpServers` object. Replace the executable and checkout paths with absolute paths on your machine:

```json
{
  "mcpServers": {
    "jobzyn": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/jobzyn-mcp/dist/cli.js"],
      "env": {
        "JOBZYN_API_KEY": "YOUR_JOBZYN_API_KEY"
      }
    }
  }
}
```

On Windows, use an absolute `node.exe` path and escape backslashes in JSON. Restart Claude Desktop after saving. The tool list should contain the five `jobzyn_*` tools.

The equivalent npm package configuration is:

```json
{
  "mcpServers": {
    "jobzyn": {
      "command": "npx",
      "args": ["--yes", "jobzyn-mcp@0.1.1"],
      "env": {
        "JOBZYN_API_KEY": "YOUR_JOBZYN_API_KEY"
      }
    }
  }
}
```

This local configuration follows the [official MCP local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers). Protect the configuration file because it contains a credential. An absolute executable path avoids PATH differences between terminal and desktop applications.

### Remote connections

For a client that supports custom authorization headers, configure the hosted HTTPS `/mcp` URL and the separate MCP bearer token. **This server does not implement OAuth discovery, browser login, or dynamic client registration.** If a Claude remote connector requires OAuth or cannot supply a custom bearer header, it needs a compatible authentication gateway in front of this server. Local stdio remains available without that gateway. Remote availability and authentication options depend on the client's managed configuration.

## Codex

### Local checkout

Add this entry to `~/.codex/config.toml`, replacing the absolute paths:

```toml
[mcp_servers.jobzyn]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/jobzyn-mcp/dist/cli.js"]
env_vars = ["JOBZYN_API_KEY"]
```

Start Codex with `JOBZYN_API_KEY` available in its environment. If your desktop launcher does not inherit shell variables, use an absolute protected env-file path instead:

```toml
[mcp_servers.jobzyn]
command = "/absolute/path/to/node"
args = ["--env-file=/absolute/path/to/jobzyn-mcp/.env", "/absolute/path/to/jobzyn-mcp/dist/cli.js", "--transport", "stdio"]
```

Choose one configuration for `mcp_servers.jobzyn`; do not duplicate the table.

### Pinned npm package

Use the pinned npm package:

```toml
[mcp_servers.jobzyn]
command = "npx"
args = ["--yes", "jobzyn-mcp@0.1.1"]
env_vars = ["JOBZYN_API_KEY"]
```

### Hosted HTTP

The remote client does not need Node.js or the npm package:

```toml
[mcp_servers.jobzyn]
url = "https://mcp.example.com/mcp"
bearer_token_env_var = "JOBZYN_MCP_TOKEN"
```

Set `JOBZYN_MCP_TOKEN` in Codex's environment to the server's `MCP_AUTH_TOKEN`. The client variable name is independent from the server variable name. You can also register the URL with the CLI:

```sh
codex mcp add jobzyn --url https://mcp.example.com/mcp --bearer-token-env-var JOBZYN_MCP_TOKEN
codex mcp list
```

The [official Codex MCP documentation](https://developers.openai.com/codex/mcp/) describes environment forwarding and bearer-token configuration. `codex mcp login` is for OAuth-enabled servers and is not the login mechanism for this static-token endpoint.

## Streamable HTTP

This is an optional capability for independently managed installations. The planned npm distribution uses stdio and includes no hosted endpoint.

The implementation follows the SDK's [Streamable HTTP guidance](https://ts.sdk.modelcontextprotocol.io/server), using its stateless JSON-response mode. Each HTTP request receives its own MCP server and transport instance. There are no session IDs, in-memory client sessions, standalone SSE streams, or resumable event history.

| Route | Access | Purpose |
| --- | --- | --- |
| `POST /mcp` | MCP bearer token | Initialize, discover tools, call tools, send notifications |
| `OPTIONS /mcp` | No bearer token; origin validation applies | Browser CORS preflight |
| `GET /mcp` | MCP bearer token | Returns `405`; no standalone SSE subscription |
| `DELETE /mcp` | MCP bearer token | Returns `405`; no sessions to delete |
| `GET /healthz` | No bearer token; host validation applies | Liveness only; returns `{"status":"ok"}` |

Requests include `Content-Type: application/json` and `Accept: application/json, text/event-stream`. Responses use JSON; valid notifications receive `202`. The SDK handles protocol negotiation and rejects unsupported protocol-version headers. Returning `405` for an unsupported standalone GET stream is permitted by the [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

Local HTTP startup:

```sh
export JOBZYN_API_KEY='YOUR_JOBZYN_API_KEY'
export MCP_AUTH_TOKEN='YOUR_SEPARATE_RANDOM_MCP_TOKEN'
node dist/cli.js --transport http
```

Then check liveness and discovery from a second terminal with the token in its environment:

```sh
curl --fail http://127.0.0.1:3000/healthz

curl --fail http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-check","version":"1.0.0"}}}'

curl --fail http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

These checks do not create or modify jobs. `/healthz` does not verify your JobZyn credentials or upstream connectivity. The stateless server also accepts independent discovery requests; SDK clients perform the normal initialization exchange.

## Hosting and Docker

No service will be hosted for this release. The following reference is only for operators choosing to host their own copy.

Deploy the Node process or container behind an HTTPS reverse proxy or security gateway. A typical configuration is:

```dotenv
JOBZYN_API_KEY=YOUR_JOBZYN_API_KEY
MCP_AUTH_TOKEN=YOUR_SEPARATE_RANDOM_MCP_TOKEN
MCP_TRANSPORT=http
HOST=0.0.0.0
PORT=3000
MCP_ALLOWED_HOSTS=mcp.example.com,127.0.0.1,localhost
```

Replace `mcp.example.com` with the real hostname. `MCP_ALLOWED_HOSTS` validates the incoming `Host` hostname, ignoring its port. If the proxy rewrites `Host` to an internal service name, add that exact hostname. Forwarded host headers are not trusted. Do not use wildcards.

For browser-based clients that send an `Origin` header, add only the origins that should connect:

```dotenv
MCP_ALLOWED_ORIGINS=https://your-client.example.com
```

Origins include the scheme and optional port, with no trailing slash. Use the actual Origin sent by your client. Requests with an `Origin` header are rejected unless it is explicitly allowed; server-to-server requests without that header work with an empty list.

Build and run:

```sh
docker build -t jobzyn-mcp:0.1.1 .
docker run --rm --init --name jobzyn-mcp \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -e MCP_TRANSPORT=http \
  -e MCP_ALLOWED_HOSTS=mcp.example.com,localhost,127.0.0.1 \
  jobzyn-mcp:0.1.1
```

The container runs as the non-root `node` user. The example publishes the port only on the host's loopback interface for a local reverse proxy. Use your platform's private networking when the proxy runs elsewhere. The client URL is the public HTTPS address ending in `/mcp`, not the container address.

At the proxy/gateway:

- Terminate TLS, authenticate callers, and forward the server's bearer token securely.
- Preserve `Authorization`, `Accept`, `Content-Type`, and `MCP-Protocol-Version`; do not log authorization headers or bodies.
- Allow MCP POST and any required CORS preflight. Set request timeouts above `JOBZYN_REQUEST_TIMEOUT_MS`.
- Apply rate and concurrency limits appropriate to your JobZyn account. The package does not provide a distributed rate limiter.
- Restrict network access so an organization gateway cannot be bypassed by connecting directly to the origin.
- Use `/healthz` for liveness. Supply an allowed Host header for platform health probes.

Stateless replicas need no session affinity. Each deployment is configured for **one JobZyn company**. Run separately configured deployments for different companies, or build an authenticated tenant-to-credential mapping before offering a shared service.

No hosting provider or public hostname is provisioned by this repository. The Dockerfile is supplied for deployment; validate the image in your target environment.

## Configuration reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `JOBZYN_API_KEY` | Required | Company API key, forwarded only as JobZyn's `x-api-key` |
| `JOBZYN_BASE_URL` | `https://www.jobzyn.com/api/integrations` | Upstream integration root; HTTPS required, except HTTP on loopback for tests |
| `JOBZYN_REQUEST_TIMEOUT_MS` | `30000` | Deadline for headers and response body, 1–300000 milliseconds |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`; overridden by `--transport` |
| `MCP_AUTH_TOKEN` | Required in HTTP mode | Separate bearer token, at least 32 characters; use a random value |
| `HOST` | `127.0.0.1` | HTTP listen address; use `0.0.0.0` in containers |
| `PORT` | `3000` | HTTP listen port, 1–65535 |
| `MCP_ALLOWED_HOSTS` | Loopback hosts when bound to loopback | Comma-separated exact hostnames/IPs, no scheme or port; required for non-loopback binding |
| `MCP_ALLOWED_ORIGINS` | Empty | Comma-separated exact browser origins; empty rejects all requests that include Origin |

HTTP-specific configuration is only required in HTTP mode. Base URLs may not include embedded credentials, query parameters, or fragments. Changing the base URL changes where the API key is sent; configure only trusted JobZyn environments. Tool inputs cannot change it.

CLI options:

```text
jobzyn-mcp [--transport stdio|http]
jobzyn-mcp --help
jobzyn-mcp --version
```

The HTTP request-body limit is **1 MiB**. Upstream responses are limited to **10 MiB**. Reduce candidate `pageSize` or split mapping batches if needed. Upstream API limits still apply.

## Tool reference

Examples below are **tool argument objects**, used with the named MCP tool. A raw MCP call wraps them in `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"TOOL_NAME","arguments":{...}}}`.

### `jobzyn_create_job`

Required: `job.id` and `job.title`.

```json
{
  "job": {
    "id": "REQ-2026-001",
    "title": "Software Engineer",
    "description": "<p>Build recruiting tools with our team.</p>",
    "city": ["Casablanca", "Rabat"],
    "country": "Maroc",
    "languages": ["fr", "en"],
    "contractType": "CDI",
    "educationLevel": "BAC +5",
    "workMode": "HYBRID",
    "minSalary": 8000,
    "maxSalary": 12000,
    "displaySalary": true,
    "minExperience": 0,
    "maxExperience": 5,
    "status": "UNPUBLISHED",
    "recruitmentProcess": ["Screening", "Technical interview"],
    "atsDepartment": "Engineering"
  }
}
```

This example creates a **draft**. Omitting `status` lets JobZyn default to `PUBLISHED`, so the job goes live immediately. A duplicate company/external-ID combination returns `409`; use the update tool when appropriate.

#### All job fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Required for create; your ATS identifier, used in later operations |
| `title` | string | Required for create |
| `description` | string | HTML supported; JobZyn sanitizes it |
| `responsibilities` | string | HTML supported |
| `qualifications` | string | HTML supported |
| `benefits` | string or string[] | Text or a list |
| `city` | string or string[] | One or multiple city names |
| `country` | string | JobZyn creation default: `Maroc` |
| `languages` | string[] | `fr`, `en`, `ar` |
| `contractType` | string | `CDI`, `CDD`, `Stage`, `Alternance`, `Freelance`, `VIE`, `Autre` |
| `educationLevel` | string | `Non défini`, `Niveau BAC`, `BAC`, `BAC +1`, `BAC +1/2`, `BAC +3/4`, `BAC +5`, `BAC +5 et plus` |
| `workMode` | string | `REMOTE`, `HYBRID`, `ONSITE` |
| `minSalary`, `maxSalary` | number | Net monthly salary bounds |
| `displaySalary` | boolean | JobZyn creation default: `false` |
| `minExperience`, `maxExperience` | number | Each between 0 and 20 years |
| `status` | string | `PUBLISHED` or `UNPUBLISHED` |
| `recruitmentProcess` | string[] | Ordered interview/recruitment steps |
| Additional fields | JSON values | Preserved inside `job`, including nested objects and arrays |

Enums are case- and space-sensitive. The documentation's create example uses `Bac+5`, but the [accepted-values page](https://docs.jobzyn.com/enums) explicitly requires `BAC +5`; this server follows the accepted-values list. It does not normalize or silently substitute values. Unknown top-level tool arguments are rejected; custom fields belong inside `job`.

### `jobzyn_update_job`

Required: `externalJobId` and a `job` object. Job fields are optional and only supplied fields are forwarded, so defaults do not overwrite existing data. `false`, `0`, empty strings, and arrays are preserved.

```json
{
  "externalJobId": "REQ-2026-001",
  "job": {
    "title": "Senior Software Engineer",
    "displaySalary": false,
    "status": "PUBLISHED"
  }
}
```

This example publishes the job. The endpoint is an **upsert**: it updates an existing job (`200`) or creates a missing one (`201`). Include enough creation data, including a title, if the job may not exist. JobZyn accepts all create fields on update, including optional `job.id`; normally omit that field and use `externalJobId` to identify the target. The server forwards supplied values without rewriting the ID.

### `jobzyn_unpublish_job`

```json
{ "externalJobId": "REQ-2026-001" }
```

The server sends DELETE with no body. Job data is retained, but candidates can no longer see the job publicly. To republish, call the update tool with `job.status` set to `PUBLISHED`.

### `jobzyn_get_candidates`

```json
{
  "externalJobId": "REQ-2026-001",
  "from": "2026-07-01T00:00:00Z",
  "to": "2026-07-31T23:59:59Z",
  "page": 1,
  "pageSize": 50
}
```

| Parameter | Meaning |
| --- | --- |
| `externalJobId` | Required; your ATS job ID |
| `since` | Applications after this date; JobZyn gives it priority over `from` |
| `from` | Applications on or after this date |
| `to` | Applications on or before this date |
| `page` | Integer starting at 1; JobZyn defaults to 1 |
| `pageSize` | Integer 1–100; JobZyn defaults to 50 |

Dates accept ISO calendar dates such as `2026-07-01` or ISO timestamps with `Z` or a UTC offset. Prefer UTC timestamps for polling. All supplied filters are forwarded, including both `since` and `from`; JobZyn applies precedence.

Each call retrieves **one page**. Use the top-level `data.total` and your effective `pageSize` to determine how many pages remain. Candidate records may include application ID, name, email, phone, application date, status, cover message, LinkedIn URL, CV URL, and job/company references. CV URLs are returned as data; this server does not download resumes or open links.

For polling, keep a checkpoint in your own application, retrieve every page in a fixed date window, and advance the checkpoint only after processing that window successfully. A small overlap with deduplication by application `id` can protect against timestamp boundary or arrival-order issues. The documentation does not promise snapshot-stable pagination. The server does not retain polling state or run a scheduler. JobZyn documents polling as the current alternative to webhooks.

### `jobzyn_link_external_ids`

```json
{
  "links": [
    { "jobzynJobId": 2625, "externalJobId": "REQ-2026-001" },
    { "jobzynJobId": 2626, "externalJobId": "REQ-2026-002" }
  ]
}
```

`jobzynJobId` is JobZyn's **internal numeric job ID**, available in the backoffice job URL. `externalJobId` is your **external ATS ID**. This is the only tool that needs internal IDs.

Each result has one of three documented statuses:

- `linked`: mapping was created.
- `already_linked`: the job already has an external ID; no change was made. This does not prove that the existing ID equals the one requested.
- `not_found`: the job does not exist or is outside the API key's company.

Inspect every result. A batch can partly succeed even with HTTP `200`. The MCP result sets `isError: true` if any mapping is `not_found`, while retaining all successes and statuses. Existing mappings are not overwritten.

## Results and errors

A successful call returns the upstream HTTP status and JobZyn response body:

```json
{
  "httpStatus": 200,
  "data": {
    "jobId": 1234,
    "jobUrl": "https://www.jobzyn.com/fr/companies/example/jobs/example-job",
    "error": null
  }
}
```

This object appears in MCP `structuredContent` and is serialized in a text content block. Upstream response fields remain available; an accidental echo of the configured API key is redacted.

API failures retain `httpStatus` and the response body and set MCP `isError: true`. Application-level `error` fields and partial link failures also set `isError`. If present, the upstream `Retry-After` header appears as `retryAfter`. An HTTP MCP request can return `200` while the enclosed tool result reports a JobZyn error: check `isError` and `httpStatus`.

| JobZyn status | Typical action |
| --- | --- |
| `400` | Correct required fields, dates, or enum values |
| `401` / `403` | Check key, scopes, company ownership, and external job ID |
| `404` | Check the job ID; unpublish documents this for missing jobs |
| `409` | Job exists; consider update instead of create |
| `429` | Respect any retry guidance; reduce request rate |
| `500` | Investigate upstream failure; verify write outcome before repeating |

JobZyn's authentication page describes missing credentials as `403`, while its error guide lists `401`; the server preserves the actual upstream status. Candidate lookup can also return `403` for an unknown or inaccessible job.

Transport failures use a safe local error envelope:

```json
{
  "error": {
    "code": "TIMEOUT",
    "message": "JobZyn request timed out.",
    "outcomeUnknown": true,
    "guidance": "The write may have completed. Verify the job in JobZyn before repeating the request."
  }
}
```

Other codes include `CANCELLED`, `NETWORK_ERROR`, `INVALID_RESPONSE`, `RESPONSE_TOO_LARGE`, and `INTERNAL_ERROR`. An `outcomeUnknown` warning accompanies failed write transport/response handling. The server never retries automatically. Cancellation or timeout cannot roll back a request that JobZyn already applied.

## Security and operating model

- **Single company per process/deployment.** Every bearer-token holder can use the configured company's API scopes. The static token is not a user identity or tenant selector.
- **Gateway authentication.** The bearer token is a shared deployment secret, not a complete MCP OAuth authorization service. Add the authentication and authorization gateway your managed client requires.
- **Secret separation.** MCP authorization headers are not forwarded to JobZyn. Incoming `x-api-key` headers cannot select a different upstream account.
- **Restricted outbound requests.** Only the five fixed endpoint shapes can be called. External job IDs are URL-encoded; `.` and `..` path segments are rejected. Redirects are not followed, and production upstream URLs require HTTPS.
- **Browser protections.** Exact Host and Origin checks apply as documented above. CORS is not authentication; bearer authentication is still required for actual MCP calls.
- **Tool policy.** Only candidate retrieval is marked read-only. Annotation hints help clients present approvals; they do not replace JobZyn scopes or gateway enforcement. Use a read-scoped JobZyn key and client/gateway tool restrictions for candidate-only access. All five tools remain discoverable.
- **Candidate privacy.** Tool responses can contain personal information. Control who can invoke candidate retrieval and where your client retains responses. The server has no persistent application database and does not log tool bodies, but client/gateway infrastructure may retain them.
- **Untrusted content.** Treat returned candidate text and job HTML as data, not instructions. The server does not execute returned content or follow resume links.
- **Shutdown.** SIGINT/SIGTERM closes the transport/listener; HTTP gets up to 10 seconds to drain before forced exit. A process termination may leave an upstream write outcome uncertain.

## Development, testing, and releases

```sh
npm ci
npm run check
npm test
npm run verify:package
```

`npm test` builds the executable and runs tests against a local mock API using the actual MCP SDK clients. The suite verifies all five endpoints through both stdio and Streamable HTTP, custom-field preservation, input validation, request encoding, authorization/origin/host checks, concurrent clients, errors, partial successes, redaction, redirect refusal, and timeouts. It does not require credentials or mutate live JobZyn data. Live account behavior must be validated separately.

For source development, use `npm run dev` with credentials in the process environment. CLI diagnostics go to stderr so stdout remains valid MCP traffic.

### Project layout

```text
src/
  cli.ts        CLI, transport selection, shutdown
  config.ts     Environment parsing and configuration validation
  schemas.ts    All job fields and endpoint input schemas
  client.ts     Fixed JobZyn API operations and bounded HTTP requests
  server.ts     Five MCP tool registrations and result handling
  http.ts       Authenticated stateless HTTP app and listener
  index.ts      Public library exports
test/           Local API, MCP transport, validation, and error tests
examples/       Client configuration examples
```

### Library usage

The package exports the MCP server factory, HTTP app/listener, typed API client, input schemas, and configuration readers. For example:

```ts
import { createJobzynServer, readApiConfig } from 'jobzyn-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = createJobzynServer(readApiConfig());
await server.connect(new StdioServerTransport());
```

`createHttpApp(apiConfig, httpConfig)` lets an existing Express host mount the application. Keep its authentication and validation middleware intact. The `JobzynClient` methods are typed API wrappers; MCP input validation occurs in the server, so direct JavaScript callers should validate payloads with the exported schemas.

### Live validation without stored credentials in code

Use an ignored local `.env` file containing `JOBZYN_API_KEY`, then run:

```sh
npm run build
npm run test:live -- --job-id YOUR_EXTERNAL_JOB_ID
```

The helper uses stdio, makes one read-only candidate lookup, and prints only status and counts. It never writes jobs, persists candidate records, or prints the API key or candidate details. No credentials are needed for CI or release preparation. See [the live-test instructions](docs/RELEASING.md#optional-live-check).

### Release process

Create the reviewed npm artifact with:

```sh
npm run release:prepare
```

This produces `.release/jobzyn-mcp-0.1.1.tgz` and an integrity manifest after checking the package allowlist, credentials, clean installation, TypeScript exports, and all five stdio tools. `.release/`, local `.env*` files, and `.npmrc` are excluded from Git. Only explicitly listed public files enter the package.

Follow [the npm publication guide](docs/RELEASING.md) for the dry run, maintainer login, publication of the exact reviewed tarball, and registry verification. The npm examples for [Claude Desktop](examples/claude-desktop-npm.json) and [Codex](examples/codex-npm.toml) are pinned to `0.1.1`.

1. Confirm npm ownership/availability of `jobzyn-mcp`, or change the package name and all client examples to your organization's scope.
2. Update `package.json`, `src/config.ts`'s version, and client examples together. Commit the lockfile.
3. Run the checks above. Inspect the tarball to confirm it contains compiled runtime files and declarations, README, examples, and LICENSE, with no secrets.
4. Test the tarball in a clean installation. Confirm the CLI works without source files or development dependencies.
5. Publish the reviewed version using your organization's npm release process. When publishing from the source directory, `prepublishOnly` runs the full release preparation gate and `prepack` builds the runtime.
6. Record the published release metadata:

```sh
npm view jobzyn-mcp@0.1.1 version dist.integrity dist.tarball --json
```

Publishing and hosting are separate actions. A public npm package has no public `/mcp` endpoint until someone deploys the HTTP server. No CI job in this repository publishes or deploys automatically.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| stdio appears to do nothing | It is waiting for a client; configure Claude/Codex to launch it |
| JSON parsing errors in a local client | Launch the CLI directly; keep banners and logs off stdout |
| `JOBZYN_API_KEY` missing | `.env` is not automatic; use `--env-file`, client env settings, or hosting secrets |
| `npx` says package/version not found | Publish the intended version first, or use the built checkout/tarball |
| Desktop cannot find Node | Set an absolute Node executable path; verify Node 22+ |
| HTTP `401` from `/mcp` | Supply the separate MCP token, not the JobZyn API key |
| HTTP `403` before a tool runs | Check allowed Host and Origin; your proxy may rewrite Host |
| HTTP `405` on `GET /mcp` | Expected; this endpoint uses Streamable HTTP POST and has no standalone SSE stream |
| HTTP `413` | Reduce the request below 1 MiB, e.g. split a link batch |
| MCP tool returns JobZyn `403` | Check API scopes, company ownership, and the external job ID |
| `BAC +5` validation error | Use the exact accepted value with spaces and capitalization |
| Missing candidates | Check date filters, `since` precedence, `total`, and additional pages |
| Timeout while writing | Verify the job in the JobZyn backoffice before retrying |
| HTTP startup fails on `0.0.0.0` | Set explicit `MCP_ALLOWED_HOSTS` and a separate `MCP_AUTH_TOKEN` |
| OAuth login fails | This server uses a static bearer token; configure headers or a compatible gateway |

## Documentation sources

- [JobZyn API overview](https://docs.jobzyn.com/) and [authentication](https://docs.jobzyn.com/authentication)
- [Create job](https://docs.jobzyn.com/endpoints/create-job), [update job](https://docs.jobzyn.com/endpoints/update-job), [unpublish job](https://docs.jobzyn.com/endpoints/unpublish-job)
- [Get candidates](https://docs.jobzyn.com/endpoints/get-candidates), [link external IDs](https://docs.jobzyn.com/endpoints/link-external-ids)
- [Accepted values](https://docs.jobzyn.com/enums) and [error handling](https://docs.jobzyn.com/errors)
- [MCP TypeScript SDK server and transports](https://ts.sdk.modelcontextprotocol.io/server)
- [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Local MCP connections with Claude Desktop](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp/)

## License

[MIT](LICENSE), copyright 2026 Yasmine Works and Agenz.
