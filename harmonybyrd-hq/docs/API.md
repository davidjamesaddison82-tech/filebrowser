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

Every tool answers with this envelope, the three inbox tools and `list_my_proposals` included.

- `revision` says exactly which dataset revision the answer was computed from.
- Pass `rev` to a read tool to **pin** a revision. Two clients that pin the same revision receive
  identical `data`. Every read tool takes `rev` except `get_recent_changes` and `list_my_proposals`,
  which always answer at the latest revision. A `rev` beyond the latest revision is `404`.
- `provenance.sources` lists the sources the returned records cite, with checksums.
- The inbox tools and `list_my_proposals` answer at the latest revision. Their result is in `data`
  and, for clients written before the envelope, also at the top level (`proposal`, `status`, `note`;
  `proposals`).
- `search_records` returns `total` (every match), `returned`, `truncated` and at most 60 `hits`.

## Errors

```json
{ "error": { "code": "forbidden", "message": "…", "detail": { }, "request_id": "…" } }
```

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_json` | The body is not a JSON object |
| 401 | `unauthenticated` | No valid identity |
| 403 | `forbidden` | Identity is valid but may not do this. Includes a proposal that sets a protected or build-only field, uses one of HQ's own labels, or tries to change or create a decision record (`detail.protected_fields` lists the fields); a proposal that asserts an acceptance — a build standing `accepted_reported`, a module `lifecycle.founder_accepted` of `yes` or `partial`, or a `founder_accepted` field (`detail.rule` is `acceptance_claim`, `detail.field` names the field); and a cross-site request |
| 404 | `not_found` | No such record, tool, revision or proposal — or a proposal that is not yours |
| 409 | `conflict` | The proposal is stale (its target changed after it was written); its target carries a founder acceptance or rejection recorded in HQ (`detail.acceptance`); or the proposal is already closed |
| 413 | `payload_too_large` | The body is larger than `HQ_MAX_BODY_BYTES` (default 1,048,576 bytes; `detail.max_bytes`) |
| 422 | `invalid_request` | The input is invalid. Includes an argument the tool does not take, a quotation that cannot be verified (`detail.unverified_quotations`: `index`, `source_id`, `reason` — `no_text`, `too_short` or `not_found` — and `message`), a linked id that does not exist (`detail.unknown_links`), and a founder decision naming records that do not exist (`detail.problems`) |
| 503 | `service_unavailable` | The database is unavailable. HQ does not answer from memory |

The rules behind the 403, 409 and 422 refusals of a proposal are in docs/GOVERNANCE.md.

Refusals with 401 and 403, and refused proposals, are written to the audit log.

**Request ids.** HQ generates the id of every request itself (`GET /api/v1/health` has none). It is returned in the `x-request-id`
header and in an error body's `request_id`, and it is the id the audit log stores. A client may send
`X-Request-Id` to correlate its own calls: if it is 1–64 characters of letters, digits, `.`, `_` and
`-`, the REST endpoints echo it in `x-client-request-id` and keep it as `detail.client_request_id`
in the audit row they write for the call (an allowed call, or a 401 or 403 answer); otherwise it is
dropped. It never becomes the request id. The MCP endpoint does not read it.

The two founder routes (`POST /api/v1/proposals/{id}/review` and `POST /api/v1/decisions`) write no
“allowed” row of their own: a founder act is recorded as allowed only by the database function that
performs it, and that row carries no request id. A refusal on those routes is logged like any other.

## REST

| Method and path | Purpose | Needs |
| --- | --- | --- |
| `GET /api/v1` | Index: who you are, the current revision, where things are | read |
| `GET /api/v1/whoami` | Your identity and what you may do | any identity |
| `GET /api/v1/health` | Liveness and database reachability. No records | none |
| `GET /api/v1/tools` | The tools, with JSON Schemas for their arguments | read |
| `GET /api/v1/tools/<name>?arg=value` | Call a **read** tool. Arguments as query parameters (see below) | read |
| `POST /api/v1/tools/<name>` | Call any tool. Arguments as a JSON body | read, or propose for the three inbox tools |
| `GET /api/v1/proposals/<id>` | One proposal, if it is yours (or you are the founder) | read |
| `GET /api/v1/integrations` | Status of the optional GitHub and Drive adapters, and live look-ups (see below) | read |
| `POST /api/v1/proposals/<id>/review` | Accept, reject or ask for changes | **founder session only** |
| `POST /api/v1/decisions` | Record a founder decision | **founder session only** |

The last two refuse every bearer token with `403`, whoever it belongs to.

**Query arguments.** A query value is converted only as the tool's input schema declares that
argument: `true` or `false` for a true/false argument, a decimal number for a number argument,
comma-separated values for a list argument. Everything else stays text, so
`search_records?query=false` searches for the word “false”.

**Integrations.** `GET /api/v1/integrations` returns whether each adapter is configured
(`google_drive.allowed_file_ids` is the number of listed files). With query parameters it also makes
a read-only look-up:

- `?github=<owner>/<name>&ref=<branch, tag or commit>[&path=<file>]` — only for a repository listed in `HQ_GITHUB_REPOSITORIES`;
- `?drive_file=<file id>` — only for a file id listed in `HQ_GOOGLE_DRIVE_FILE_IDS` (otherwise `not_configured`).

Look-ups are made only for a founder or developer signed in to HQ. Any other caller, every API token
included, receives `lookup: { "ok": false, "reason": "forbidden" }`, and HQ sends nothing outward.

**Body size.** Every JSON body, REST and MCP, is limited to `HQ_MAX_BODY_BYTES` (default 1,048,576
bytes). A larger body is refused with `413`.

Example:

```bash
curl -s -H "Authorization: Bearer $HQ_TOKEN" \
  "http://localhost:3210/api/v1/tools/get_module_brief?module=MOD-FX-ALPHA"

curl -s -H "Authorization: Bearer $HQ_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"tempo"}' http://localhost:3210/api/v1/tools/search_founder_requirements
```

## Tools

Arguments marked * are required. Every read tool except `get_recent_changes` and
`list_my_proposals` also accepts `rev`. A tool refuses any argument it does not take, with `422` and
the message `<tool> does not take the argument "<name>".` This includes unknown keys inside
`submit_change_proposal`'s `target`.

### Read (15)

| Tool | Arguments | Returns |
| --- | --- | --- |
| `get_ecosystem_overview` | — | Every module with its family and standing, connections, development health, missing work, priorities. Start here |
| `get_module_brief` | `module`* (id, name or alias) | Everything about one module: purpose, loops, capabilities, builds, lifecycle, defects, requirements, decisions, connections, blockers, sources |
| `list_learning_loops` | — | All loops against the shared progression, stage coverage, cross-module pathways |
| `get_learning_loop` | `loop_id`* | One loop in full, in its source's own steps |
| `search_founder_requirements` | `query`, `module`, `category`, `disposition`, `implementation_state`, `source_id`, `outstanding` | Requirements with durable ids and exact original wording |
| `find_outstanding_requirements` | `module` | Requirements with no implementation record, verified test evidence or founder disposition; modules with no source; documents HQ could not read. Only linked evidence that a source reports or HQ's build checked counts (`has_linked_evidence`); `test_evidence` gives the verified, unverified and missing ids |
| `get_acceptance_status` | `type`*, `id`* | Proposal / prototype / tested / accepted, kept apart; acceptance reported in a source versus recorded in HQ |
| `get_source_lineage` | `type`*, `id`* | Sources cited (location, version, checksum, authority), exact quotations, version history with hash chain, what refers to it |
| `get_development_dependencies` | `type`*, `id`* | What it depends on, what depends on it, what blocks it |
| `get_record` | `type`*, `id`* | Any record exactly as stored, with its version history |
| `search_records` | `query`*, `types` | Full-text search across all record types: the true `total`, and at most 60 hits (`truncated` says whether there were more) |
| `list_sources` | — | The source-access inventory, including documents named but not read |
| `get_review_items` | — | Conflicts, possible duplicates, acceptance without an instrument, unverified claims, dangling references |
| `get_recent_changes` | `limit` | Dataset revisions: what, when, why, by whom, under which commission. Not pinnable |
| `list_my_proposals` | `status` | The caller's own proposals and their review notes, in `data.proposals`. Not pinnable |

### Add to the inbox (3) — need the `propose` scope

| Tool | Arguments | Effect |
| --- | --- | --- |
| `submit_change_proposal` | `title`*, `rationale`*, `base_rev`*, and either `target` (`type`, `id`, `base_version`) + `set` (change a record) or `create` (`record_type`, `record`) (new record); `kind`, `evidence`, `idempotency_key` | A proposal in the inbox. Changes nothing until the founder accepts it |
| `submit_defect_report` | `title`*, `description`*, `module_ids`*, `base_rev`*; `build_id`, `severity`, `evidence`, `idempotency_key` | A proposed defect record |
| `record_test_evidence` | `title`*, `result_summary`*, `base_rev`*; `type`, `module_ids`, `build_id`, `code_ref`, `counts`, `artifact_sha256`, `date`, `idempotency_key` | Proposed evidence, permanently labelled as an unverified submission |

`base_rev` is the dataset revision you read before writing. For a change to an existing record,
`target` is `{ "type": …, "id": …, "base_version": … }`, where `base_version` is the record version
you read. If the record has changed since, the proposal is refused as stale when it is submitted
(`409`), or marked stale when it is reviewed — never merged silently.

What a proposal may contain — verified quotations, which labels it may use, which fields it cannot
set, and that it can never assert an acceptance — is in docs/GOVERNANCE.md, “What a proposal may assert”.

When the founder reviews a proposal, HQ's review screen calls out a change to any of these fields
(its `sensitive_fields`): `status`, `standing`, `implementation_state`, `lifecycle`, `type`,
`result`, `statement`, `sha256`, `severity`, `exact_text`, `decision_ids`, `module_id`, `module_ids`,
`linked_evidence_ids`, `linked_build_ids` and `founder_accepted`. This list is shown on the screen
only; `GET /api/v1/proposals/<id>` does not return it.

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
- A refusal raised while running a tool the credential may call — invalid arguments, a stale
  target version, a protected field, an unverifiable quotation, a database refusal — is a tool result with
  `isError: true`, carrying the same `{ "error": { code, status, message, detail } }` as REST.
- Calling a tool the credential may not call is a JSON-RPC error `-32602`
  (“Tool "<name>" is not available to this credential: it needs the "<scope>" scope…”), with
  `error.data` `{ "code": "forbidden", "status": 403, "required_scope": … }`. An unknown tool is
  `-32602` with `error.data` `{ "code": "not_found", "status": 404 }`. `params` and `arguments` that
  are not objects are `-32602`.
- A batch holds 1 to 50 messages, and each is answered on its own: a message that is not a valid
  JSON-RPC request gets its own `-32600` error (with `id: null` if it has no valid id), and an
  internal failure of one message gets `-32603` for that message; the others still run. An empty or
  over-long batch is `-32600` with HTTP 400.
- A body over `HQ_MAX_BODY_BYTES` is HTTP 413 with a `-32600` error whose `data.code` is `payload_too_large`.
- A browser request from another origin is refused.

```bash
curl -s http://localhost:3210/api/mcp \
  -H "Authorization: Bearer $HQ_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_ecosystem_overview","arguments":{}}}'
```

How to register this endpoint in each AI client — and which of those routes have actually been
tested — is in [CONNECTING-AI-CLIENTS.md](CONNECTING-AI-CLIENTS.md).
