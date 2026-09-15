# Managed Yasmine registration worksheet

The planned release is the **catalog-managed npm package over stdio**, with no hosted service. This is an operator handoff, not a Yasmine manifest or a completed approval. Use the organization's actual catalog interface.

## Reviewed release

| Item | Value |
| --- | --- |
| Package | `jobzyn-mcp` |
| Exact version for catalog review | `0.1.0` |
| Source | https://github.com/Yasmine-Works/jobzyn-mcp |
| Release commit | Fill in after review |
| npm integrity | Fill in from `npm view jobzyn-mcp@0.1.0 dist.integrity` after publication |
| Runtime | Node.js 22+ |
| Executable | `jobzyn-mcp` |
| Local arguments | `--transport stdio` |
| Local secret | `JOBZYN_API_KEY` (read and/or write scope as approved) |
| Upstream | `https://www.jobzyn.com/api/integrations` |
| Catalog approval | Pending; npm publication alone does not grant installability |

## Optional remote deployment reference

Not part of the planned npm release. No remote URL is being provisioned.

| Item | Value |
| --- | --- |
| Real HTTPS URL | Fill in; must end in `/mcp` |
| Transport | Stateless Streamable HTTP, JSON responses |
| Backend authentication | Separate `MCP_AUTH_TOKEN`, supplied as Bearer authorization |
| Client authentication | Confirm with gateway operator; add OAuth at gateway if required |
| Tenant mapping | One approved company deployment per configured JobZyn key |
| Browser Origin | Obtain actual origin from gateway operator if the request includes Origin |
| Allowed Host | Match the hostname sent by the reverse proxy/gateway |
| Health | `GET /healthz`, liveness only |
| Gateway approval | Pending; remote connections must pass through the security gateway |
| Network restriction | Restrict origin access so clients cannot bypass the gateway |

## Tools to review

| Tool | Required scope | Effect |
| --- | --- | --- |
| `jobzyn_create_job` | write | Publishes by default; `UNPUBLISHED` creates a draft |
| `jobzyn_update_job` | write | Changes fields/status; can create a missing job |
| `jobzyn_unpublish_job` | write | Removes public visibility, retains data |
| `jobzyn_get_candidates` | read | Returns personal information and CV URLs |
| `jobzyn_link_external_ids` | write | Sets external mappings; inspect per-item results |

## Acceptance evidence

- Record exact package release or deployed revision and approving operator.
- Confirm MCP initialization and discovery return exactly the five tools above.
- Verify a permitted candidate read for an authorized test job.
- Inject `JOBZYN_API_KEY` through the managed local runtime, never into the package or catalog metadata.
- Verify managed tool policies cover writes, candidate data, and company access.
- Exercise writes only on an agreed test job; create with `status: "UNPUBLISHED"`.
- Confirm every future package upgrade receives the required catalog review.

No real credentials belong in this worksheet.
