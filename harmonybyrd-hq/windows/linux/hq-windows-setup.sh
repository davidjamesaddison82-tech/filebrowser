#!/usr/bin/env bash
# Run by the Windows installer inside the HarmonyByrdHQ WSL distribution, as root:
#   hq-windows-setup.sh <release.zip> <preservation.zip> <Windows HarmonyByrdHQ folder> <first|update>
# Each step is safe to repeat. It never replaces an existing database: on an update it backs the
# database up, installs the new application release, and checks everything again.
set -euo pipefail
release="$1"; pres="$2"; windir="$3"; mode="${4:-first}"
step() { printf '\n=== %s\n' "$*"; }
fail() { printf '\nINSTALLATION STOPPED: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "must run as root"
[ "$(ps -p 1 -o comm=)" = systemd ] || fail "systemd is not running in the HarmonyByrdHQ distribution"
[ -f "$release" ] || fail "release archive not found: $release"
[ -d "$windir" ] || fail "folder not found: $windir"
export DEBIAN_FRONTEND=noninteractive

step "1/7  Preparing Ubuntu (PostgreSQL 16, Node.js 22; downloads from Ubuntu and nodejs.org)"
command -v unzip >/dev/null || { apt-get update -q && apt-get install -yq unzip; }
src=/root/hq-src; rm -rf "$src"; mkdir -p "$src"
unzip -q "$release" 'harmonybyrd-hq/deploy/*' -d "$src"
HQ_PLATFORM=wsl HQ_WINDOWS_DIR="$windir" bash "$src/harmonybyrd-hq/deploy/install.sh"
db_exists() { runuser -u postgres -- psql -X -Atqc "select 1 from pg_database where datname = 'hq'" | grep -q 1; }

if db_exists; then
  step "2/7  Backing up the existing database before changing anything"
  hq-backup
else
  step "2/7  No database yet (first installation)"
fi

step "3/7  Installing the HQ application (builds it; this takes several minutes)"
new_sum="$(sha256sum "$release" | cut -d' ' -f1)"
if [ -L /opt/hq/current ] && [ "$(cat /opt/hq/release.sha256 2>/dev/null)" = "$new_sum" ]; then
  echo "   This release is already installed."
else
  hq-release "$release"
  echo "$new_sum" > /opt/hq/release.sha256
fi

if db_exists; then
  step "4/7  Database already present: left exactly as it is"
else
  step "4/7  Restoring the 1,581 development records from the preservation archive"
  [ -f "$pres" ] || fail "preservation archive not found: $pres"
  hq-restore-preservation "$pres"
fi

step "5/7  Starting HQ (listening on this computer only)"
systemctl enable --now postgresql hq
for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:3210/api/v1/health >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:3210/api/v1/health >/dev/null || fail "HQ did not start (journalctl -u hq)"
echo "   HQ is running."

step "6/7  Read-only AI identities (no tokens are issued) and a first backup"
hq-identities
hq-backup

step "7/7  Acceptance checks"
mkdir -p "$windir/Logs"
report="$windir/Logs/acceptance-$(date +%Y%m%d-%H%M%S).txt"
set +e
if [ "$mode" = first ]; then hq-acceptance > "$report" 2>&1; else hq-acceptance --no-baseline > "$report" 2>&1; fi
rc=$?
set -e
cat "$report"
[ "$rc" = 0 ] || fail "some acceptance checks failed (report: Logs folder)"
echo
echo "INSTALLATION COMPLETE"
