# Permanent hosting for HarmonyByrd HQ (HB-HQ-HOST-P1)

> **Founder decision (21 November 2026): HQ runs on the founder's Windows 11 laptop, not on a cloud
> server.** The Windows installation is in `windows/` (guide: `windows/Read me first.html`). It
> reuses this design's scripts inside a dedicated WSL 2 Linux system, with loopback-only listeners,
> plain restore-tested backups copied to a Windows folder, and no firewall or SSH changes. The cloud
> design below is kept for reference; nothing in it is approved.

Status: **prepared and rehearsed locally; nothing is deployed.** No server, paid service, tunnel or
token exists. Every step that would create one is listed under [Approvals](#actions-that-need-the-founders-approval).

The deployment package is in `deploy/`. The setup guide is `deploy/README.md`, and the acceptance
checklist is `deploy/ACCEPTANCE-CHECKLIST.md`.

## Recommendation

**One small Ubuntu 24.04 server at DigitalOcean, Sydney region (SYD1), running HQ and PostgreSQL 16
on the same machine.** Both are bound to loopback, so SSH is the only port open to the internet. The
founder uses HQ through an SSH port forward. AI clients are connected later, one at a time, each with
its own read-only token and only after approval. They reach `/api/mcp` and nothing else.

### Estimated monthly cost (AUD)

> **Prices not verified.** This session could not reach digitalocean.com, the RBA or any other
> price source: the session network blocked those hosts. The figures below are list prices as I
> last knew them, converted at about A$1.55 to US$1. Check the provider's pricing page before you
> approve anything.

| Item | US$/month | A$/month (about) |
| --- | --- | --- |
| Droplet, Basic, 2 vCPU / 4 GB / 80 GB SSD (recommended) | 24 | 37 |
| DigitalOcean daily backups add-on (optional, 30% of the droplet) | 7 | 11 |
| **Recommended total** | **24–31** | **37–48** |
| Smaller option: 1 vCPU / 2 GB / 50 GB (+ weekly backups 20%) | 12–14 | 19–23 |

Prices are before GST. DigitalOcean bills in US dollars, so the AUD amount moves with the exchange
rate.

4 GB is recommended because `next build` needs about 1.5–2 GB of memory while it runs, on top of
PostgreSQL and the running app. The database is small: the preserved copy is a 2 MB compressed dump
holding 1,581 record versions. The 2 GB size works if the build has swap, but releases will be slow.

The add-on backups are optional. HQ makes its own encrypted, restore-tested backups every night, so
the add-on is a second layer only. Its snapshots are **not** encrypted with your key. They hold the
whole disk, including `/etc/hq/hq.env` and the database, and DigitalOcean stores them. The server
itself is at DigitalOcean anyway, so the add-on does not add a new party.

### Alternatives considered

| Option | For | Against |
| --- | --- | --- |
| **DigitalOcean Sydney** (recommended) | Simple; Sydney region; predictable flat price; good docs; snapshot backups | US$ billing; US company (data stays in Sydney, but the provider is subject to US law) |
| Binary Lane (Australian-owned, Brisbane/Sydney/Melbourne/Perth) | AUD billing; Australian company | Smaller; fewer guides; price not verified |
| Vultr Sydney / Linode (Akamai) Sydney | Similar price and features to DigitalOcean | No advantage for HQ |
| AWS Lightsail Sydney | Similar flat price; part of AWS | AWS console and account set-up are more complex than HQ needs |
| Managed PostgreSQL (any provider) | Provider runs the database | Adds about US$15+/month and a network path to the database; HQ's database is tiny |
| **Private self-hosting** (a mini PC or old laptop at home or in the office) | No monthly fee beyond power; the data never leaves your premises | You are the operations team: power cuts, hardware failure, home internet outages, ISP changes. Remote AI access needs a tunnel anyway, because home connections usually cannot accept incoming connections (CG-NAT). Off-site backup is still needed |

The deployment package works on either option. `install.sh` targets any Ubuntu 24.04 machine, cloud
or physical. If you prefer self-hosting, the only differences are: no droplet; the machine must stay
on; and the copy of the backups you pull to your own computer must live somewhere other than the HQ
machine.

## Architecture

```
 Founder's computer                          Ubuntu 24.04 server (SYD1)
 ──────────────────                          ──────────────────────────────────────────────
 browser ── http://localhost:3210            sshd :22  (keys only; the ONLY public port; UFW)
    │                                          │
    └─ ssh -L 3210:127.0.0.1:3210 ─────────────┘
                                             hq.service      Next.js  127.0.0.1:3210  (user hq)
 age private key (never on the server)         │  DATABASE_URL = hq_app (no privileges of its own)
 pull-backups.sh  ◄── rsync over SSH ────┐     ▼
                                         │   PostgreSQL 16   127.0.0.1:5432 + local socket
                                         │     ▲ maintenance as the postgres OS user (peer), no superuser password
                                         │     │
                                         └── /var/lib/hq/backups/*.dump.age   (nightly, encrypted to your public key)
                                             timers: backup 02:15, health every 5 min, integrity Sun 03:30

 Phase 2, only with approval:
 Anthropic (Managed Agents) ─► MCP tunnel (outbound only) ─► hq-mcp-gateway 127.0.0.1:3211 ─► /api/mcp only ─► HQ
```

### Security design

| Requirement | How it is met | Checked by |
| --- | --- | --- |
| Database never public | PostgreSQL `listen_addresses = 'localhost'`, `scram-sha-256`; UFW denies all incoming except SSH | `hq-health` (every 5 min) and `hq-acceptance` §1 fail on any public listener but port 22 |
| Founder screens never public | HQ listens on 127.0.0.1:3210 only; the founder reaches it over SSH. Sign-in is still required, as now | `hq-acceptance` §1 and §3 |
| AI clients reach only MCP | The phase-2 gateway (`deploy/mcp-gateway/Caddyfile`) forwards `/api/mcp` and answers 404 to everything else, so a tunnel aimed at it can never reach `/`, `/sign-in`, the REST API or the founder acts. Rehearsed locally | Tested in the rehearsal; part of the phase-2 checks in the checklist |
| Separate read-only identities | `hq-identities` creates `researcher`, `qa-auditor` and `chatgpt` as readers with no token. `hq-token <name>` issues a token with scope `read` and an expiry (default 90 days). Each token is stored only as a hash and can be revoked on its own | `hq-acceptance` §4: 15 read tools listed, no write tool, a write refused, a founder act refused, revocation works |
| Rate limits per token | New in this commission: a token bucket per token (120/min, burst 30 by default; `HQ_TOKEN_RATE_PER_MINUTE`, `HQ_TOKEN_BURST`); 429 with `Retry-After`; MCP batches charged per message; refusals audited once a minute per token | `tests/unit/token-rate.test.ts`, `tests/api/token-rate.test.ts`; `hq-acceptance` §4 |
| Credentials | Generated on the server by `install.sh` into `/etc/hq/hq.env` (mode 0640, root:hq): the `hq_app` password and the session-signing secret. None is in the repository or the package. The superuser has no password (peer authentication only). The founder sets the passphrase on the server. Tokens are shown once and stored as hashes | Secret scan of the package; `.env.example` holds placeholders only |
| Encrypted backups | Nightly `pg_dump`. Each dump is restored into a scratch database and integrity-checked before it is kept. It is then encrypted with `age` to the founder's **public** key, so the server cannot read its own backups. Kept 35 days. The founder pulls copies off the server (`deploy/founder/pull-backups.sh`), which also test-decrypts the newest one | Rehearsed; `hq-health` alerts if no good backup for 26 h |
| Recovery tested | Every nightly backup is restore-tested. `hq-rollback db` restores into a check database and verifies it before swapping, keeping the replaced database | Rehearsed: the 38 checks identical after rollback |
| Monitoring | Health timer every 5 minutes: app answering, PostgreSQL ready, backup age, disk use, unexpected listeners. Weekly integrity check (seals, hash chain, citations, quotations). Failures run `hq-alert@`, which leaves a notice shown at every SSH login and writes to the journal; an optional `/etc/hq/alert.sh` can send it on (e.g. email) | Rehearsed |
| Updates | `unattended-upgrades` for security patches; Node pinned to a checksum-verified release; HQ releases installed side by side with instant app rollback | — |
| No record changes in migration | The database is restored from the preservation dump, not re-imported. `hq-restore-preservation` requires the 38 restoration checks to equal the preserved results exactly, both before and after running the migration command, which must apply nothing | Rehearsed: identical; seal `4ed52dc9…` unchanged |

### What HQ's own rules still guarantee

Hosting changes nothing in the application. AI tokens cannot accept proposals, record founder
decisions or change accepted builds. With scope `read` they cannot even submit proposals. The
database enforces the same rules again behind the application (docs/SECURITY.md).

## MCP tunnels

### Anthropic MCP tunnels — verified 21 November 2026 from platform.claude.com documentation

- **Availability:** research preview. Access is by request form, and an organisation admin must ask.
  Not generally available; no uptime commitment.
- **Who can use it:** Claude Managed Agents and the Messages API MCP connector. **Not** claude.ai or
  Claude Desktop connectors.
- **How it works:** you run Anthropic's tunnel components on your server (Docker Compose or Helm:
  `cloudflared` plus Anthropic's proxy). They make **outbound** connections only, to
  `api.anthropic.com:443` and to Cloudflare's edge (198.41.192.0/19 and 2606:4700:a0::/44, port 7844
  TCP/UDP). No inbound port is opened. You register a CA certificate. Each tunnel gets an address of
  the form `<id>.tunnel.anthropic.com`. Up to 10 tunnels per organisation.
- **Authentication:** the tunnel itself does **not** authenticate requests to your MCP server. HQ's
  bearer token is still required. In Managed Agents the token is held in a credential vault (a
  `static_bearer` credential for the tunnel's MCP URL) and attached to sessions, so the token never
  appears in prompts.
- **Limits:** Cloudflare is a subprocessor. Managed Agents sessions are not eligible for zero data
  retention, and transcripts are kept until deleted. In Managed Agents an MCP toolset defaults to
  asking before each tool call (`always_ask`). You can allowlist HQ's read tools.
- **Fit for HQ:** good for the Researcher and the QA Auditor. Point the tunnel at the gateway
  (127.0.0.1:3211), never at 3210.

### Anthropic without a tunnel

The Messages API connector and claude.ai connectors need a public `https://` URL. For HQ that means
phase 3: a public HTTPS endpoint (the gateway behind TLS, still `/api/mcp` only).

### OpenAI (ChatGPT) — NOT verified

The OpenAI documentation hosts were blocked from this session. **I could not verify "OpenAI Secure
MCP Tunnels": their existence, availability, authentication or limits are all unconfirmed.**

What earlier research found, also unverified: ChatGPT custom MCP connectors support OAuth or no
authentication, not a static bearer token. If that is still true, connecting ChatGPT needs either:
- an OAuth 2.1 authorisation server in HQ (not built; KNOWN-GAPS); or
- OpenAI's tunnel product, if it exists and lets HQ keep a bearer token.

Verify this before approving anything for ChatGPT. The `chatgpt` identity is created read-only and
gets no token until then.

## Phases

| Phase | What | Needs approval |
| --- | --- | --- |
| 1 | Server, HQ and PostgreSQL on loopback, migration from the preservation package, backups, monitoring, acceptance checks. Founder access over SSH only. No AI access | Yes: creating the server (paid) and copying the private package to it |
| 2 | Anthropic MCP tunnel → gateway → `/api/mcp`, for the Researcher and the QA Auditor, each with its own read-only token in a Managed Agents vault | Yes: tunnel access request, installing the tunnel, issuing each token, connecting each agent |
| 3 | ChatGPT: public HTTPS for `/api/mcp` with OAuth, or OpenAI's tunnel if verified | Yes, after verification; OAuth must be built first |

## Actions that need the founder's approval

None of these has been done. Each needs your explicit approval, separately:

1. Creating the DigitalOcean account or droplet, or any other paid infrastructure, including the
   optional backups add-on.
2. Copying the preservation package (private records) to the server.
3. Running `install.sh`, `hq-release` and `hq-restore-preservation` on that server.
4. Requesting Anthropic MCP tunnel access, and installing the tunnel on the server.
5. Installing and enabling the MCP gateway (`hq-mcp-gateway.service`).
6. Issuing each token (`hq-token researcher|qa-auditor|chatgpt`), and putting it in an Anthropic
   vault or any other client.
7. Connecting each AI client (the Researcher, the QA Auditor, ChatGPT), one at a time.
8. Opening any port beyond SSH, or any public HTTPS endpoint.
9. Building OAuth for ChatGPT.
10. Allowing this environment to reach digitalocean.com, openai.com and the RBA, so prices and the
    OpenAI tunnel can be verified.
11. Configuring outbound alerts (`/etc/hq/alert.sh`), if you want them to email or message anyone.

## What has and has not been tested

Rehearsed locally on a separate PostgreSQL 16 cluster, using the real preservation package:

| Step | Result |
| --- | --- |
| `hq-restore-preservation` | 77 package files verified. 38 checks identical after restore and again after the migration command ("up to date", 10 migrations, none applied) |
| `hq-identities` | researcher, qa-auditor and chatgpt created read-only, with no token |
| `hq-backup` | Restore test passed: 1,581 record versions, 12,063 quotations, 0 failing, seal `4ed52dc9…`. Encrypted file (`age-encryption.org/v1`), 2.0 MB |
| `hq-verify` | PASS |
| `hq-acceptance` | 18 PASS, 1 FAIL. The failure is a listener of the rehearsal container itself (port 2024), which a real server will not have. The check is right to flag it |
| `hq-rollback db` | Restored, verified and swapped; 38 checks identical; replaced database kept |
| MCP gateway | See deploy/README.md: `/api/mcp` passes, everything else answers 404 |

**Not tested** (they need a real Ubuntu 24.04 machine with systemd): `install.sh`, `hq-release`,
`hq-rollback app`, and the systemd timers and units. Run them first on a disposable local VM, or on
the approved server before the private package is copied there (deploy/README.md, step 3).
