#!/usr/bin/env bash
# Run on YOUR computer (macOS or Linux), not on the server. Copies the encrypted HQ backups you do not
# have yet into a local folder, checks each one's SHA-256, and test-decrypts the newest with your key.
#   bash pull-backups.sh <you>@<server address> <local folder> <path to your age key file>
# Your login on the server must be in the hqbackup group (deploy/README.md, step 6).
set -euo pipefail
server="${1:?usage: pull-backups.sh <user@server> <local folder> <age key file>}"
dest="${2:?local folder}"; key="${3:?age key file}"
mkdir -p "$dest"
rsync -av --ignore-existing "$server:/var/lib/hq/backups/hq-*.dump.age*" "$dest/"
cd "$dest"
for f in hq-*.dump.age.sha256; do sha256sum -c "$f" 2>/dev/null || shasum -a 256 -c "$f"; done
newest="$(ls -1 hq-*.dump.age | sort | tail -1)"
age -d -i "$key" "$newest" | head -c 5 | grep -q PGDMP && echo "OK: $newest decrypts with your key and is a PostgreSQL backup."
