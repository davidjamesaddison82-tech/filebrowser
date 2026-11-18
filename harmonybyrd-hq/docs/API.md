# API reference

One service, two transports. Both call the same 18 tools and return the same envelopes.

- **REST** — `/api/v1/…`
- **MCP** — `/api/mcp` (Streamable HTTP, stateless, JSON responses)

Base URL for a local installation: `http://localhost:3210`.

## Identity

Every request needs an identity.

| Caller | How |
| --- | --- |
| AI client or script | `Authorization: Bearer hbq_…` — a token the founder issued to that client |
| Person in the browser | The session cookie set at sign-in |

Tokens carry scopes: `read`, and optionally `propose`. There is no scope for approval.
A missing, unknown, revoked or expired token gets `401` with `WWW-Authenticate: Bearer`.

## Every answer

```json
{
  "hq":           { "authority": "prototype_non_authoritative", "notice": "…" },
  "revision":     { "rev": 7, "content_hash": "…", "created_at": "…", "kind": "…", "summary": "…",
                    "pinned": false, "head_rev": 7, "is_head": true },
  "requested_by": { "handle": "claude", "…": "…" },
  "data":         { "…": "…" },
  "provenance":   { "sources": [ { "id": "SRC-…", "title": "…", "sha256": "…" } ] }
}
```

- `revision` says exactly which dataset revision the answer was computed from.
- Pass `rev` to any read tool to **pin** a revision. Two clients that pin the same revision receive identical `data`.
- `provenance.sources` lists the sources the returned records cite, with checksums.

## Errors

```json
{ "error": { "code": "forbidden", "message": "…", "detail": { }, "request_id": "…" } }
```

| Status | Meaning |
| --- | --- |
| 400 | Malformed request |
| 401 | No valid identity |
| 403 | Identity is valid but may not do this (also: cross-site request refused) |
| 404 | No such record, tool or proposal — or a proposal that is not yours |
| 409 | Conflict: the proposal is stale — its target changed after the proposal was written |
| 422 | The input is invalid, or a proposal tries to set a protected field |
| 503 | The database is unavailable. HQ does not answer from memory |

Refusals (401, 403) are written to the audit log.

## REST

| Method and path | Purpose | Needs |
| --- | --- | --- |
| `GET /api/v1` | Index: who you are, the current revision, where things are | read |
| `GET /api/v1/whoami` | Your identity and what you may do | any identity |
| `GET /api/v1/health` | Liveness and database reachability. No records | none |
| `GET /api/v1/tools` | The tools, with JSON Schemas for their arguments | read |
| `GET /api/v1/tools/<name>?arg=value` | Call a **read** tool. Arguments as query parameters | read |
| `POST /api/v1/tools/<name>` | Call any tool. Arguments as a JSON body | read, or propose for the three inbox tools |
| `GET /api/v1/proposals/<id>` | One proposal, if it is yours (or you are the founder) | read |
| `GET /api/v1/integrations` | Status of the optional GitHub and Drive adapters | read |
| `POST /api/v1/proposals/<id>/review` | Accept, reject or ask for changes | **founder session only** |
| `POST /api/v1/decisions` | Record a founder decision | **founder session only** |

The last two refuse every bearer token with `403`, whoever it belongs to.

Example:

```bash
curl -s -H "Authorization: Bearer $HQ_TOKEN" \
  "http://localhost:3210/api/v1/tools/get_module_brief?module=MOD-FX-ALPHA"

curl -s -H "Authorization: Bearer $HQ_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"tempo"}' http://localhost:3210/api/v1/tools/search_founder_requirements
```

## Tools

Arguments marked * are required. Every read tool also accepts `rev`.

### Read (15)

| Tool | Arguments | Returns |
| --- | --- | --- |
| `get_ecosystem_overview` | — | Every module with its family and standing, connections, development health, missing work, priorities. Start here |
| `get_module_brief` | `module`* (id, name or alias) | Everything about one module: purpose, loops, capabilities, builds, lifecycle, defects, requirements, decisions, connections, blockers, sources |
| `list_learning_loops` | — | All loops against the shared progression, stage coverage, cross-module pathways |
| `get_learning_loop` | `loop_id`* | One loop in full, in its source's own steps |
| `search_founder_requirements` | `query`, `module`, `category`, `disposition`, `implementation_state`, `source_id`, `outstanding` | Requirements with durable ids and exact original wording |
| `find_outstanding_requirements` | `module` | Requirements with no implementation record, test evidence or founder disposition; modules with no source; documents HQ could not read |
| `get_acceptance_status` | `type`*, `id`* | Proposal / prototype / tested / accepted, kept apart; acceptance reported in a source versus recorded in HQ |
| `get_source_lineage` | `type`*, `id`* | Sources cited (location, version, checksum, authority), exact quotations, version history with hash chain, what refers to it |
| `get_development_dependencies` | `type`*, `id`* | What it depends on, what depends on it, what blocks it |
| `get_record` | `type`*, `id`* | Any record exactly as stored, with its version history |
| `search_records` | `query`*, `types` | Full-text search across all record types |
| `list_sources` | — | The source-access inventory, including documents named but not read |
| `get_review_items` | — | Conflicts, possible duplicates, acceptance without an instrument, unverified claims, dangling references |
| `get_recent_changes` | `limit` | Dataset revisions: what, when, why, by whom, under which commission |
| `list_my_proposals` | `status` | The caller's own proposals and their review notes |

### Add to the inbox (3) — need the `propose` scope

| Tool | Arguments | Effect |
| --- | --- | --- |
| `submit_change_proposal` | `title`*, `rationale`*, `base_rev`*, and either `target` + `set` (change a record) or `create` (new record); `kind`, `evidence`, `idempotency_key` | A proposal in the inbox. Changes nothing until the founder accepts it |
| `submit_defect_report` | `title`*, `description`*, `module_ids`*, `base_rev`*; `build_id`, `severity`, `evidence`, `idempotency_key` | A proposed defect record |
| `record_test_evidence` | `title`*, `result_summary`*, `base_rev`*; `type`, `module_ids`, `build_id`, `code_ref`, `counts`, `artifact_sha256`, `date`, `idempotency_key` | Proposed evidence, permanently labelled as an unverified submission |

`base_rev` is the dataset revision you read before writing. For a change to an existing record,
`target` also carries the record `version` you read. If the record has changed since, the proposal
is refused as stale when it is submitted, or marked stale when it is reviewed — never merged silently.

`idempotency_key` makes a retry safe: a second submission by the same client with the same key
returns the first proposal (marked `idempotent_replay`) instead of creating another.

### Not available as tools, by design

Reviewing a proposal; recording a founder decision (acceptance, requirement standing, resolving
conflicts); issuing or revoking credentials. These exist only in the founder's signed-in session.

## MCP

`POST /api/mcp` with a JSON-RPC 2.0 body and `Authorization: Bearer …`.

- Methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
- Protocol versions accepted: `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`.
- Stateless: no session id, no server-initiated stream. `GET` and `DELETE` return `405`.
- `tools/list` shows a client only the tools its token may call: a read-only token is not shown the three inbox tools.
- A tool result has `content` (the envelope as JSON text) and `structuredContent` (the envelope as an object).
  A refusal is returned as a tool result with `isError: true`, carrying the same error code and message as REST.
- A browser request from another origin is refused.

```bash
curl -s http://localhost:3210/api/mcp \
  -H "Authorization: Bearer $HQ_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_ecosystem_overview","arguments":{}}}'
```

How to register this endpoint in each AI client — and which of those routes have actually been
tested — is in [CONNECTING-AI-CLIENTS.md](CONNECTING-AI-CLIENTS.md).
