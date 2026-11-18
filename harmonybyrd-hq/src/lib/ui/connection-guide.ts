/**
 * How each AI client can reach HQ, and — just as important — what has and has not been tested.
 *
 * The "per the documentation" statements were gathered on 18 November 2026. The Claude entries
 * come from Anthropic's documentation pages. The OpenAI entries come from search extracts of
 * OpenAI's documentation: the pages themselves could not be opened from the build environment,
 * so treat them as needing confirmation.
 */
export type ConnectionStatus = "tested_here" | "untested" | "blocked";

export interface ConnectionRoute {
  client: "Claude" | "ChatGPT / OpenAI" | "Any MCP client";
  route: string;
  status: ConnectionStatus;
  statusNote: string;
  how: string[];
  example?: string;
  requires: string[];
  sources: { label: string; url: string }[];
}

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  tested_here: "Tested in this build",
  untested: "Documented — not tested",
  blocked: "Blocked — needs a separate decision",
};

export function connectionRoutes(baseUrl: string): ConnectionRoute[] {
  const mcp = `${baseUrl}/api/mcp`;
  return [
    {
      client: "Any MCP client",
      route: "MCP over Streamable HTTP with a bearer token",
      status: "tested_here",
      statusNote:
        "Exercised by the automated suite with the official MCP TypeScript SDK client (an independent protocol implementation): handshake, tool listing, tool calls, per-client isolation, pinned revisions, refusals. This shows protocol compatibility. It does not show that the Claude or ChatGPT applications can connect.",
      how: [`Endpoint: POST ${mcp}`, "Header: Authorization: Bearer <HQ API token for that client>", "Stateless JSON responses; protocol versions 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05."],
      requires: ["An HQ API token issued to that client on this page."],
      sources: [{ label: "tests/api/mcp.test.ts", url: "" }],
    },
    {
      client: "Claude",
      route: "Claude Code (command line)",
      status: "untested",
      statusNote:
        "Claude Code supports remote HTTP MCP servers with a custom Authorization header, which matches HQ's design. Not run from this build. The documentation does not say whether a plain http://localhost URL is accepted — try it.",
      how: ["Add the server once, giving the token in a header.", "Use --scope project to share the entry through .mcp.json (keep the token in an environment variable)."],
      example: `claude mcp add --transport http harmonybyrd-hq ${mcp} --header "Authorization: Bearer $HQ_TOKEN"`,
      requires: ["HQ running where Claude Code can reach it.", "An HQ API token for the claude client."],
      sources: [{ label: "Claude Code — MCP", url: "https://code.claude.com/docs/en/mcp" }],
    },
    {
      client: "Claude",
      route: "claude.ai and Claude Desktop — custom connector",
      status: "blocked",
      statusNote:
        "Per Anthropic's help article, a custom connector must be an HTTPS URL on port 443 reachable from the public internet, and a fixed credential can be supplied under “Request headers”. HQ therefore fits — but only once it is deployed to a public HTTPS address, which this commission does not authorise.",
      how: ["Customize → Connectors → + Add → Add custom connector.", "Enter the public HTTPS URL of /api/mcp.", "Under Request headers, add Authorization: Bearer <token>."],
      requires: ["A founder decision to deploy HQ to a public HTTPS address.", "An HQ API token for the claude client."],
      sources: [{ label: "Getting started with custom connectors using remote MCP", url: "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp" }],
    },
    {
      client: "Claude",
      route: "Claude API — MCP connector",
      status: "blocked",
      statusNote:
        "Per Anthropic's documentation the API passes an authorization_token to a publicly reachable MCP server (beta header mcp-client-2026-09-15). Needs the same public deployment as above.",
      how: ['mcp_servers: [{ "type": "url", "url": "<public /api/mcp>", "name": "hq", "authorization_token": "<token>" }]', 'tools: [{ "type": "mcp_toolset", "mcp_server_name": "hq" }]'],
      requires: ["A public HTTPS deployment of HQ.", "An Anthropic API key (not needed by HQ itself)."],
      sources: [{ label: "MCP connector", url: "https://platform.claude.com/docs/en/agents-and-tools/mcp-connector" }],
    },
    {
      client: "ChatGPT / OpenAI",
      route: "ChatGPT app — custom MCP server",
      status: "blocked",
      statusNote:
        "Per OpenAI's documentation (search extracts; pages not opened), ChatGPT needs a public HTTPS MCP endpoint and supports OAuth or no authentication — it cannot present a static bearer token. HQ authenticates with per-client bearer tokens today, so ChatGPT cannot connect until HQ implements OAuth 2.1, and it would also need a public deployment. Running HQ without authentication is not an acceptable workaround.",
      how: ["Add a custom MCP server in ChatGPT (the product currently lists these as plugins/connectors).", "Enter the public HTTPS URL of /api/mcp and choose OAuth."],
      requires: ["OAuth 2.1 support in HQ (recommended next commission).", "A founder decision to deploy HQ to a public HTTPS address.", "A ChatGPT plan that permits custom MCP servers."],
      sources: [
        { label: "Connecting custom MCP servers in ChatGPT", url: "https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt" },
        { label: "Custom MCP server guide", url: "https://developers.openai.com/api/docs/guides/custom-mcp-server" },
      ],
    },
    {
      client: "ChatGPT / OpenAI",
      route: "OpenAI Responses API — remote MCP tool",
      status: "blocked",
      statusNote:
        "Per OpenAI's documentation (search extracts), the mcp tool accepts optional HTTP headers for authentication, so HQ's bearer token could be passed — but the server must be reachable from the public internet. Untested, and no official example with a static bearer token was found.",
      how: ['tools: [{ "type": "mcp", "server_label": "hq", "server_url": "<public /api/mcp>", "headers": { "Authorization": "Bearer <token>" }, "require_approval": "always" }]'],
      requires: ["A public HTTPS deployment of HQ.", "An OpenAI API key (not needed by HQ itself)."],
      sources: [{ label: "Connectors and MCP servers", url: "https://developers.openai.com/api/docs/guides/tools-connectors-mcp" }],
    },
    {
      client: "ChatGPT / OpenAI",
      route: "OpenAI Agents SDK — MCPServerStreamableHttp",
      status: "untested",
      statusNote:
        "Per the Agents SDK documentation (search extracts), this class connects to a Streamable HTTP server, accepts custom headers and is shown with a localhost URL. It is the one OpenAI route that should work against a local HQ with a bearer token. Not run from this build.",
      how: [`MCPServerStreamableHttp(params={"url": "${mcp}", "headers": {"Authorization": "Bearer <token>"}})`],
      requires: ["The OpenAI Agents SDK and an OpenAI API key on the developer's machine.", "An HQ API token for the chatgpt client."],
      sources: [{ label: "Agents SDK — MCP", url: "https://openai.github.io/openai-agents-python/mcp/" }],
    },
  ];
}
