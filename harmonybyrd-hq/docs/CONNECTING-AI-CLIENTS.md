# Connecting Claude and ChatGPT

**Neither the Claude application nor ChatGPT has been connected to HQ.** What has been tested is
the protocol itself. This page says exactly what is tested, what is documented but untested, and what is blocked.

## What HQ offers

- MCP endpoint: `POST <base>/api/mcp` — Streamable HTTP, stateless, JSON responses.
- REST: `<base>/api/v1/tools/<name>`.
- Authentication: one bearer token per client, issued by the founder on the *AI & API access* screen.
  Give each client its own token: each has its own identity, permissions and audit trail, and one
  client cannot read another's proposals.

## Tested in this build

The automated HTTP suite drives `/api/mcp` with the **official MCP TypeScript SDK client**
(`@modelcontextprotocol/sdk`, `StreamableHTTPClientTransport`) — an independent implementation of the
protocol, not code written for HQ. It covers the handshake, tool listing, tool calls, two clients
reading the same pinned revision and receiving identical records, isolation between clients, stale
and protected-field refusals, and the absence of any approval tool. See `tests/api/mcp.test.ts`, and docs/TEST-RESULTS.md for one recorded run (on the commit it names).

This shows that HQ speaks MCP correctly to a standard client. It does **not** show that the Claude
or ChatGPT applications can connect: each adds its own rules about where the server must be and how it authenticates.

## Claude

The statements below come from Anthropic's documentation as read on 18 November 2026.

### Claude Code (command line) — documented, **not tested**

Claude Code supports remote HTTP MCP servers with a custom header, which is what HQ needs.

```bash
claude mcp add --transport http harmonybyrd-hq http://localhost:3210/api/mcp \
  --header "Authorization: Bearer $HQ_TOKEN"
```

Or, to share the entry with a project, in `.mcp.json` (keep the token in an environment variable, not in the file):

```json
{ "mcpServers": { "harmonybyrd-hq": {
    "type": "http",
    "url": "http://localhost:3210/api/mcp",
    "headers": { "Authorization": "Bearer ${HQ_TOKEN}" } } } }
```

The documentation does not say whether a plain `http://localhost` address is accepted. Try it; if it
is refused, the remaining external step is to serve HQ over HTTPS.
Source: <https://code.claude.com/docs/en/mcp>

### claude.ai and Claude Desktop (custom connector) — **blocked**

A custom connector must be an HTTPS address on port 443 that Anthropic's servers can reach from the
internet; a fixed credential can be supplied under “Request headers”. HQ's design fits, but only
once HQ is deployed to a public HTTPS address — which the commission does not authorise.

Steps, once a deployment is authorised: Customize → Connectors → “+ Add” → “Add custom connector”;
enter the public address of `/api/mcp`; under Request headers add `Authorization: Bearer <token>`.
Source: <https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp>

### Claude API (MCP connector) — **blocked**, same reason

```json
"mcp_servers": [ { "type": "url", "url": "https://<public-host>/api/mcp", "name": "hq", "authorization_token": "<token>" } ],
"tools":       [ { "type": "mcp_toolset", "mcp_server_name": "hq" } ]
```

Requires the beta header `mcp-client-2026-09-15` and a publicly reachable server.
Source: <https://platform.claude.com/docs/en/agents-and-tools/mcp-connector>

## ChatGPT and OpenAI

The statements below come from **search extracts** of OpenAI's documentation on 18 November 2026.
The pages themselves could not be opened from the build environment, so each should be confirmed before relying on it.

### ChatGPT application (custom MCP server) — **blocked**

Reported requirements: a public HTTPS MCP endpoint (or OpenAI's tunnel), a plan that allows custom
MCP servers, and authentication by **OAuth or none**. A static bearer token is reported as not
supported. HQ authenticates with bearer tokens, so ChatGPT cannot connect until HQ implements
OAuth 2.1 — and it also needs a public deployment.

Turning authentication off to make it work is not acceptable: HQ holds private development records.

Sources: <https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt>,
<https://developers.openai.com/api/docs/guides/custom-mcp-server>

### OpenAI Responses API (remote MCP tool) — **blocked** (needs a public address)

```json
"tools": [ { "type": "mcp", "server_label": "hq", "server_url": "https://<public-host>/api/mcp",
             "headers": { "Authorization": "Bearer <token>" }, "require_approval": "always" } ]
```

The tool is reported to accept custom headers, so HQ's token could be passed, but the server must
be reachable from the internet. No official example with a static bearer token was found.
Source: <https://developers.openai.com/api/docs/guides/tools-connectors-mcp>

### OpenAI Agents SDK — documented, **not tested**

`MCPServerStreamableHttp` is reported to accept custom headers and a localhost address. It is the
one OpenAI route that should work against a local HQ today.

```python
MCPServerStreamableHttp(params={"url": "http://localhost:3210/api/mcp",
                                "headers": {"Authorization": "Bearer <token>"}})
```

Source: <https://openai.github.io/openai-agents-python/mcp/>

## Remaining external steps, in order

1. **Founder decision** to deploy HQ to a private, authenticated HTTPS address (and where).
2. **OAuth 2.1** in HQ (authorisation-server metadata, PKCE, token endpoint, per-client consent) — needed for ChatGPT; useful for Claude.
3. A security review of the deployed service.
4. Issue one token (or OAuth client) per assistant; connect; run the same checks the automated
   suite runs — same pinned revision, same records — through the real applications, and record the result in HQ as evidence.

Until step 4 is done and recorded, HQ lists “Claude and ChatGPT connected” as an absent capability.
