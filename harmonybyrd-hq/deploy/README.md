# Installing HarmonyByrd HQ on a server — plain-English guide

This guide takes you from nothing to HQ running on your own small server. Only you can reach it
(through SSH), it backs itself up every night, and it is checked to hold exactly what the
preservation backup holds. Read docs/HOSTING.md first for the reasons behind each choice.

**Nothing in this guide has been done for you.** Steps marked **(approval)** create paid
infrastructure, move private records or open access. Do them only when you have decided to.

What you need:
- a computer with a terminal (macOS, Linux, or Windows with WSL);
- the preservation package `hq-preservation-2026-11-21-v1.zip` and its `.sha256` file;
- the HQ release archive `harmonybyrd-hq-release-<commit>.zip` (made in step 0);
- about an hour.

Commands you type **on your computer** are marked `you$`. Commands **on the server** are marked
`server#`; they need `sudo` or a root shell.

---

## 0. Make the release archive (on any machine with the repository)

```
you$ git -C filebrowser archive --format=zip --prefix=harmonybyrd-hq/ -o harmonybyrd-hq-release-$(git -C filebrowser rev-parse --short HEAD).zip HEAD:harmonybyrd-hq
you$ shasum -a 256 harmonybyrd-hq-release-*.zip
```

The archive holds code and these scripts only: no records, no secrets.

## 1. Two keys on your computer

**An SSH key** lets you log in to the server without a password:
```
you$ ssh-keygen -t ed25519 -C "hq-admin"          # press Enter for the default file; set a passphrase
```

**A backup key.** Every backup is locked with your public key, and only your private key opens it.
The private key never goes on the server. Install `age` (macOS: `brew install age`; Ubuntu:
`sudo apt install age`), then:
```
you$ mkdir -p ~/hq-keys && chmod 700 ~/hq-keys
you$ age-keygen -o ~/hq-keys/hq-backup-key.txt     # prints "Public key: age1..."
```
Keep `hq-backup-key.txt` safe and keep a second copy offline (for example a USB stick in a drawer).
**If you lose it, the backups cannot be opened.** The public key (`age1…`) is not secret.

## 2. Create the server **(approval: paid)**

At DigitalOcean (or any provider; see docs/HOSTING.md):
- Create → Droplets; Region **Sydney (SYD1)**; Image **Ubuntu 24.04 (LTS) x64**.
- Size: Basic, Regular, **2 vCPU / 4 GB**.
- Authentication: **SSH key**. Paste the contents of `~/.ssh/id_ed25519.pub`.
- Optional: enable Backups (see docs/HOSTING.md on what those snapshots hold).
- Do not add a managed database, a load balancer or a domain.

Note the server's IP address. Log in and create your own admin login, so you stop using root:
```
you$ ssh root@<server-ip>
server# adduser hqadmin && usermod -aG sudo hqadmin
server# rsync --archive --chown=hqadmin:hqadmin ~/.ssh /home/hqadmin
server# exit
you$ ssh hqadmin@<server-ip>          # works with your key? Then continue as hqadmin with sudo.
```

## 3. Prepare the server

Copy the release archive across and run the installer:
```
you$ scp harmonybyrd-hq-release-<commit>.zip hqadmin@<server-ip>:
server# sudo apt-get update && sudo apt-get install -y unzip
server# unzip -q harmonybyrd-hq-release-<commit>.zip 'harmonybyrd-hq/deploy/*' -d ~/hq-src
server# sudo bash ~/hq-src/harmonybyrd-hq/deploy/install.sh
```
The installer:
- installs PostgreSQL 16, Node.js 22 (checksum-verified), `age` and the firewall;
- sets PostgreSQL to accept local connections only;
- creates the `hq` user and the folders;
- generates the secrets file `/etc/hq/hq.env` (never printed);
- turns on the firewall with SSH only, and allows SSH logins with keys only;
- installs the timers.

It does not start HQ or touch any data, and it is safe to run again.

Add your backup **public** key:
```
server# echo 'age1...your public key...' | sudo tee /etc/hq/backup-recipients.txt
```

Install the application:
```
server# sudo /usr/local/bin/hq-release ~/harmonybyrd-hq-release-<commit>.zip
```
This builds HQ in `/opt/hq/releases/…` and points `/opt/hq/current` at it. It says the database does
not exist yet; that is expected.

> This is the right moment to stop and test, before any private record is on the server. You can
> check that `install.sh` and `hq-release` work on a real Ubuntu 24.04 machine (this has not been
> tested before), and you can delete the droplet if anything is wrong.

## 4. Migrate the records **(approval: private records leave your computer)**

```
you$ scp hq-preservation-2026-11-21-v1.zip hq-preservation-2026-11-21-v1.zip.sha256 hqadmin@<server-ip>:
server# sudo hq-restore-preservation ~/hq-preservation-2026-11-21-v1.zip
```

What it does, and refuses to do:
- It **refuses** if the database already exists.
- It checks the package's SHA-256 and all 77 files inside it.
- It creates the HQ roles and restores the database **exactly as preserved**: nothing is re-imported
  or converted.
- It runs the 38 restoration checks and requires them to match the preserved results line for line.
- It runs the migration command, which must find nothing to apply.
- It runs the 38 checks again.

Any difference stops it. Nothing is changed after a failure, and the new database is left for
inspection. Then:
```
server# sudo systemctl start hq && sudo hq-health
server# rm ~/hq-preservation-2026-11-21-v1.zip*      # the server keeps the database, not the package
```

## 5. Sign in as the founder

The server makes no founder passphrase: set one yourself, on the server.

```
server# cd /opt/hq/current && sudo bash -c '. /usr/local/bin/hq-common.sh; load_hq_env; hq_node scripts/credentials.ts passphrase founder'
```
It generates a new passphrase and shows it **once**. Store it in your password manager straight
away. Running the command again replaces it.

Open HQ from your computer through an SSH tunnel. HQ is never on the public internet.
```
you$ ssh -N -L 3210:127.0.0.1:3210 hqadmin@<server-ip>
```
Leave that running and browse to **http://localhost:3210**. Close the terminal to disconnect.

## 6. Backups

- **Every night at 02:15 Sydney time**, the server:
  - dumps the database;
  - restores the dump into a scratch database and checks it;
  - encrypts it to your key;
  - keeps it for 35 days.
  Run one now to check it: `server# sudo systemctl start hq-backup && journalctl -u hq-backup -n 30`.
- **Copy them off the server** regularly, for example weekly. A backup that exists only on the
  server is lost with the server. Allow your login to read the encrypted files:
  ```
  server# sudo usermod -aG hqbackup hqadmin            # then log out and in again
  you$ bash pull-backups.sh hqadmin@<server-ip> ~/hq-backups ~/hq-keys/hq-backup-key.txt
  ```
  (`pull-backups.sh` is in `deploy/founder/`.) It copies the new files, checks each checksum and
  test-opens the newest with your key. Keep `~/hq-backups` on a disk that is itself backed up.

## 7. Monitoring

- Every 5 minutes, `hq-health` checks:
  - the app answers;
  - PostgreSQL is ready;
  - the last good backup is less than 26 hours old;
  - the disk is less than 85% full;
  - nothing but SSH is listening publicly.
- Every Sunday, `hq-verify` checks the seals, the hash chain, the citations and the quotations.
- Any failure leaves a notice that is shown **every time you log in by SSH**, and is written to the
  journal (`journalctl -u 'hq-alert@*'`).
- Check now at any time: `server# sudo hq-health`.
- To be told by email or message, write a small script at `/etc/hq/alert.sh` (it receives the
  failed unit's name). That sends data to a third party, so it needs your approval.
- Security updates install themselves (`unattended-upgrades`). Reboot when the login notice says one
  is required: `server# sudo reboot`.

## 8. Acceptance

Run the independent checks in `ACCEPTANCE-CHECKLIST.md`. The automated part is:
```
server# sudo hq-acceptance
```
It must end with `ALL CHECKS PASSED`.

## 9. AI identities and tokens

`hq-identities` creates three separate **read-only** identities, with **no token yet**:
`researcher`, `qa-auditor` and `chatgpt`:
```
server# sudo hq-identities
```

Do not issue a token until you have approved connecting that AI. When you have:
```
server# sudo hq-token researcher 90          # read-only, expires in 90 days; printed ONCE
```
- Paste the token straight into the client's credential store (in the Anthropic Console, a
  credential vault) and nowhere else.
- One token per client. Never share a token between the Researcher and the QA Auditor.
- **Revoke** a token on HQ's *AI & API access* screen. To see each identity and how many live tokens
  it has:
  `sudo bash -c '. /usr/local/bin/hq-common.sh; load_hq_env; hq_node scripts/credentials.ts list'`.

## 10. Connecting an AI client (phase 2) **(approval for each step)**

1. **Gateway.** Enable the gateway, which lets through `/api/mcp` and nothing else:
   ```
   server# sudo apt-get install -y caddy && sudo systemctl disable --now caddy
   server# sudo cp /opt/hq/current/deploy/systemd/hq-mcp-gateway.service /etc/systemd/system/
   server# sudo systemctl daemon-reload && sudo systemctl enable --now hq-mcp-gateway
   server# curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3211/        # must print 404
   ```
   It listens on 127.0.0.1:3211 only, so the firewall and `hq-health` still show SSH as the only
   public port.
2. **Anthropic MCP tunnel** (a research preview; an organisation admin requests access). Follow
   Anthropic's tunnel instructions. Install their components on this server, and set the tunnel's
   target to **`http://127.0.0.1:3211`**. Never point it at port 3210. The tunnel connects outbound
   only, so no firewall change is needed. The MCP address is then
   `https://<id>.tunnel.anthropic.com/api/mcp`.
3. **Researcher agent** (Anthropic Console → Managed Agents):
   - add an MCP server with that address;
   - create a credential vault holding a `static_bearer` credential for the same address, with the
     token from `hq-token researcher`;
   - attach the vault to sessions;
   - allowlist only HQ's read tools; you can keep "ask before each call" at first.
4. **QA Auditor:** repeat step 3 with `hq-token qa-auditor`, in its own vault.
5. **ChatGPT:** not yet. See docs/HOSTING.md: OAuth or a verified OpenAI tunnel is needed first.

Every call an AI makes is in HQ's audit log under its own identity. Each token is limited to
120 requests a minute.

---

## Updating HQ (a new release)

```
server# sudo hq-backup                                  # a fresh backup first
server# sudo hq-release ~/harmonybyrd-hq-release-<new commit>.zip
server# sudo hq-acceptance --no-baseline
```
If a release includes a database migration, `hq-release` does not run it. Run the migration
yourself, after the backup:
`sudo bash -c '. /usr/local/bin/hq-common.sh; load_hq_env; hq_node scripts/migrate.ts'`.

## Rollback

- **The application** (data untouched): `server# sudo hq-rollback app`. This switches back to the
  previous release and restarts.
- **The database** from a backup:
  - copy your private key across for this command only:
    `you$ scp ~/hq-keys/hq-backup-key.txt hqadmin@<server-ip>:/tmp/k`
  - run `server# sudo hq-rollback db /var/lib/hq/backups/hq-<time>.dump.age /tmp/k && shred -u /tmp/k`.

  It restores into a check database, verifies it, and only then swaps it in. The replaced database
  is **kept** as `hq_replaced_<time>`; drop it yourself once you are sure:
  `sudo -u postgres dropdb hq_replaced_<time>`.
- **Everything** (a new server): repeat steps 2–5 using the preservation package, or using your
  latest backup. To decrypt a backup on your computer:
  `age -d -i ~/hq-keys/hq-backup-key.txt hq-<time>.dump.age > hq.dump`. Restore it with `pg_restore`
  into a database named `hq`, after creating the roles from the preservation package's
  `database/roles.sql`.
- **Abandoning the server:** your computer still has the preservation package and your pulled
  backups. Destroying the droplet loses nothing that you have pulled.

## Where things are on the server

| Path | What |
| --- | --- |
| `/opt/hq/current` → `/opt/hq/releases/<release>` | The running application; older releases kept beside it |
| `/etc/hq/hq.env` | Generated secrets (root:hq, 0640). Never copy it anywhere |
| `/etc/hq/backup-recipients.txt` | Your backup public key(s) |
| `/etc/hq/expected-results.txt` | The 38 preserved check results, for `hq-acceptance` (quotes founder wording) |
| `/var/lib/hq/backups` | Encrypted backups, `.sha256` files, `LAST_OK` |
| `/var/lib/hq/health/status` | The latest health result; `ALERT` while a problem stands |
| `/usr/local/bin/hq-*` | The operations scripts |
