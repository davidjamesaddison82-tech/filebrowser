#!/usr/bin/env bash
# HarmonyByrd HQ: prepare a fresh Ubuntu 24.04 LTS server. Run once, as root:
#   sudo bash deploy/install.sh
# It installs PostgreSQL 16, Node.js 22, age and the firewall; creates the `hq` user, folders and a
# secrets file with newly generated values; installs the systemd units. It does NOT install the
# application, restore any data, open any port other than SSH, or start HQ. Safe to run again.
#
# On Windows (WSL 2) the Windows installer runs it with HQ_PLATFORM=wsl and HQ_WINDOWS_DIR set to the
# Linux path of the user's HarmonyByrdHQ folder. Then: no firewall or SSH changes (nothing in WSL is
# reachable from the network: HQ and PostgreSQL listen on loopback, which Windows forwards only to its
# own localhost); backups are plain pg_dump files, restore-tested, copied to that Windows folder.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v22.23.5}"   # the version HQ was built and tested with; any later v22 should also work
HERE="$(cd "$(dirname "$0")" && pwd)"
log() { printf '== %s\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
HQ_PLATFORM="${HQ_PLATFORM:-server}"
case "$HQ_PLATFORM" in
  server) ;;
  wsl) [ -n "${HQ_WINDOWS_DIR:-}" ] && [ -d "$HQ_WINDOWS_DIR" ] || { echo "HQ_WINDOWS_DIR must be the Windows HarmonyByrdHQ folder"; exit 1; }
       [ "$(ps -p 1 -o comm=)" = systemd ] || { echo "systemd is not running in this WSL distribution (see /etc/wsl.conf)"; exit 1; } ;;
  *) echo "HQ_PLATFORM must be server or wsl"; exit 1;;
esac
. /etc/os-release
[ "${ID:-}" = ubuntu ] && [ "${VERSION_ID:-}" = "24.04" ] || { echo "Expected Ubuntu 24.04 LTS; found ${PRETTY_NAME:-unknown}."; exit 1; }

log "System packages (PostgreSQL 16 is Ubuntu 24.04's own version)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq postgresql-16 postgresql-client-16 age unattended-upgrades curl ca-certificates xz-utils unzip openssl iproute2
[ "$HQ_PLATFORM" = server ] && apt-get install -yq ufw
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Node.js $NODE_VERSION (official build, checksum verified)"
if ! /usr/local/bin/node --version 2>/dev/null | grep -qx "$NODE_VERSION"; then
  arch=x64; [ "$(uname -m)" = aarch64 ] && arch=arm64
  tmp="$(mktemp -d)"; tarball="node-$NODE_VERSION-linux-$arch.tar.xz"
  curl -fsSLo "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball"
  curl -fsSLo "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  ( cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c - )
  tar -xJf "$tmp/$tarball" -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude LICENSE --exclude README.md
  rm -r "$tmp"
fi
node --version

log "PostgreSQL: local connections only"
conf=/etc/postgresql/16/main/postgresql.conf
grep -q "^listen_addresses = 'localhost'" "$conf" || echo "listen_addresses = 'localhost'" >> "$conf"
grep -q "^password_encryption = scram-sha-256" "$conf" || echo "password_encryption = scram-sha-256" >> "$conf"
systemctl enable --now postgresql
systemctl restart postgresql

log "User, folders, permissions"
id hq >/dev/null 2>&1 || useradd --system --home /opt/hq --shell /usr/sbin/nologin hq
# Members of hqbackup can read the ENCRYPTED backups (to copy them off the server). Add your own login:
#   sudo usermod -aG hqbackup <your user>
getent group hqbackup >/dev/null || groupadd --system hqbackup
install -d -m 0755 -o root -g root /opt/hq /opt/hq/releases
install -d -m 0750 -o root -g hq /etc/hq
install -d -m 0755 -o root -g root /var/lib/hq
install -d -m 2750 -o postgres -g hqbackup /var/lib/hq/backups
install -d -m 0755 -o root -g root /var/lib/hq/health

log "Secrets file /etc/hq/hq.env (generated once; never printed)"
if [ ! -f /etc/hq/hq.env ]; then
  umask 027
  cat > /etc/hq/hq.env <<EOF
# HarmonyByrd HQ runtime settings. Generated $(date -u +%F) by install.sh. Readable by root and hq only.
NODE_ENV=production
DATABASE_URL=postgres://hq_app:$(openssl rand -hex 24)@127.0.0.1:5432/hq
HQ_JWT_SECRET=$(openssl rand -hex 32)
# The founder opens HQ through an SSH tunnel, so the address in the browser is localhost.
HQ_BASE_URL=http://localhost:3210
# Per-token rate limit for API and MCP clients.
HQ_TOKEN_RATE_PER_MINUTE=120
HQ_TOKEN_BURST=30
NEXT_TELEMETRY_DISABLED=1
EOF
  chown root:hq /etc/hq/hq.env; chmod 0640 /etc/hq/hq.env
fi
# Settings for the operations scripts (no secrets).
if [ "$HQ_PLATFORM" = wsl ]; then
  install -d "$HQ_WINDOWS_DIR/Backups"
  cat > /etc/hq/ops.conf <<EOF
# Written by install.sh (Windows / WSL). No secrets.
HQ_PLATFORM=wsl
# Backups are plain pg_dump files (no age key on a single laptop); keep the laptop's disk encrypted.
HQ_BACKUP_PLAIN=1
# Each good backup is also copied here, so it survives even if this WSL distribution is removed.
HQ_BACKUP_EXPORT="$HQ_WINDOWS_DIR/Backups"
HQ_BACKUP_KEEP_DAYS=35
EOF
  chmod 0644 /etc/hq/ops.conf
fi
if [ ! -f /etc/hq/backup-recipients.txt ]; then
  echo "# Put the founder's age PUBLIC key(s) here, one per line (age1...). See deploy/README.md." > /etc/hq/backup-recipients.txt
  chmod 0644 /etc/hq/backup-recipients.txt
fi

if [ "$HQ_PLATFORM" = server ]; then
log "Firewall: SSH only"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

log "SSH: keys only (applied only if a key is already installed, so you cannot be locked out)"
if compgen -G "/root/.ssh/authorized_keys" >/dev/null || compgen -G "/home/*/.ssh/authorized_keys" >/dev/null; then
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/60-hq.conf
  systemctl reload ssh || systemctl reload sshd || true
else
  echo "   WARNING: no SSH key found; password login left as it is. Add a key, then run this script again."
fi
fi

log "Operations scripts and systemd units"
install -m 0755 "$HERE"/bin/hq-* /usr/local/bin/
install -m 0644 "$HERE"/systemd/*.service "$HERE"/systemd/*.timer /etc/systemd/system/
[ "$HQ_PLATFORM" = server ] && install -m 0755 "$HERE/motd/99-hq" /etc/update-motd.d/99-hq
systemctl daemon-reload
systemctl enable hq-backup.timer hq-health.timer hq-verify.timer
# hq.service is enabled by hq-release once an application release exists.

if [ "$HQ_PLATFORM" = wsl ]; then log "Done (Windows). The Windows installer continues."; exit 0; fi
log "Done. Next: deploy/README.md, step 3 (install a release) and step 4 (restore the preservation package)."
