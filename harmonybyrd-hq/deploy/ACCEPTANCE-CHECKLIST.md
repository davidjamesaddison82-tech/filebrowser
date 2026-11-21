# Acceptance checklist — hosted HarmonyByrd HQ

Use this after installation (deploy/README.md, steps 1–8). Anyone independent of the installer
should be able to run it: the founder, the QA Auditor working through the founder, or a second
engineer.

For each line, record PASS or FAIL, the date and who checked. A single FAIL means **not accepted**.
None of these checks changes an HQ record. The automated script issues one temporary read-only
token, uses it and revokes it.

## A. Automated (`sudo hq-acceptance` on the server; it must end with `ALL CHECKS PASSED`)

| # | Check |
| --- | --- |
| A1 | Only SSH listens on a public interface |
| A2 | HQ listens on 127.0.0.1:3210 only |
| A3 | PostgreSQL listens on loopback only |
| A4 | Firewall active, incoming denied by default |
| A5 | Integrity: seals, hash chain, citations, quotations |
| A6 | The 38 restoration checks equal the preserved database exactly |
| A7 | `/` without a session redirects to sign-in |
| A8 | The API without a token answers 401 |
| A9 | A read-only AI token can call a REST read tool |
| A10 | MCP lists exactly the 15 read tools to that token |
| A11 | MCP lists no write tool |
| A12 | MCP refuses a write tool to that token |
| A13 | A founder act (`POST /api/v1/decisions`) with that token is refused |
| A14 | The per-token rate limit answers 429 past the burst |
| A15 | The token stops working once revoked |
| A16 | The dataset seal is unchanged by the checks |
| A17 | A backup has succeeded in the last 26 hours |
| A18 | No unencrypted dump is on the server |

## B. Migration — nothing changed (from the `hq-restore-preservation` output)

| # | Check |
| --- | --- |
| B1 | "Package checksums: all 77 files OK" |
| B2 | "after restore: all 38 checks identical to the preserved database" |
| B3 | The migration command reported every migration as already applied (nothing applied) |
| B4 | "after migrate: all 38 checks identical to the preserved database" |
| B5 | The head seal shown on the HQ dashboard equals the seal in the preservation package's `verification/expected-results.txt` |

## C. From outside (on your computer, not the server)

| # | Check | Expected |
| --- | --- | --- |
| C1 | `nc -vz -w5 <server-ip> 5432` | Refused or timed out |
| C2 | `nc -vz -w5 <server-ip> 3210` and `… 3211` | Refused or timed out |
| C3 | `curl -m5 http://<server-ip>/` and `https://<server-ip>/` | No answer |
| C4 | `ssh -o PasswordAuthentication=yes -o PubkeyAuthentication=no hqadmin@<server-ip>` | "Permission denied (publickey)" |
| C5 | Optional: an online port scan of the IP (approval: it sends the IP to that service) | Only 22 open |

## D. Founder access

| # | Check |
| --- | --- |
| D1 | With `ssh -L 3210:127.0.0.1:3210 …` running, http://localhost:3210 shows the sign-in page |
| D2 | Signing in with the founder passphrase set in step 5 works; a wrong passphrase is refused |
| D3 | Dashboard, Module atlas, Requirements, Evidence and Sources show the expected records |
| D4 | The *AI & API access* screen lists researcher, qa-auditor and chatgpt, all **reader**, with **0** live tokens (until you issue one) |

## E. Backups and recovery

| # | Check |
| --- | --- |
| E1 | `sudo systemctl start hq-backup` ends with "Backup OK"; its journal shows the restore-test checks all PASS |
| E2 | `pull-backups.sh` on your computer copies the backup, the checksum matches, and it test-decrypts with your key |
| E3 | The server holds no backup private key (`sudo grep -rl AGE-SECRET-KEY /etc /var/lib/hq /root /home` finds nothing) |
| E4 | **Recovery drill** (do it once now, then every few months): `sudo hq-rollback db <latest backup> <key>` succeeds, `sudo hq-acceptance` passes, then drop `hq_replaced_<time>` |
| E5 | `sudo hq-rollback app` is tested once after the second release is installed |

## F. Monitoring

| # | Check |
| --- | --- |
| F1 | `sudo hq-health` prints OK |
| F2 | `systemctl list-timers 'hq-*'` shows hq-backup, hq-health and hq-verify scheduled |
| F3 | Alert test: `sudo systemctl stop hq`, wait 6 minutes, log in again by SSH; the notice names the problem. `sudo systemctl start hq`; the notice clears within 5 minutes |
| F4 | `sudo hq-verify` passes |

## G. MCP gateway and AI clients (phase 2, only once approved)

| # | Check |
| --- | --- |
| G1 | Through the gateway, `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3211/`, `…/sign-in` and `…/api/v1/health` each print 404 |
| G2 | Through the gateway, an MCP `initialize` POST to `http://127.0.0.1:3211/api/mcp` without a token prints 401, and with a read-only token prints 200 |
| G3 | `ss -ltn` shows the gateway on 127.0.0.1:3211 only; `hq-health` still OK |
| G4 | The tunnel's target is 127.0.0.1:3211 (not 3210) |
| G5 | Through the tunnel address, `/` answers 404 and `/api/mcp` without a token answers 401 |
| G6 | From the Researcher agent: tools list = 15 read tools; a read call works and appears in HQ's audit log under `researcher` |
| G7 | The QA Auditor uses its own token; revoking one token does not affect the other |
