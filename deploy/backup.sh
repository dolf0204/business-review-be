#!/usr/bin/env sh
# Saves the database and the uploaded pictures into deploy/backups/<date>/, and removes backups older than 14 days.
# Usage: ./backup.sh [local|prod]      (run from cron on the server, for example nightly)
set -eu
cd "$(dirname "$0")"
mode="${1:-prod}"
root="${BACKUP_DIR:-./backups}"
out="$root/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"

./compose.sh "$mode" exec -T postgres pg_dump -U brev -d brev --no-owner | gzip > "$out/db.sql.gz"
./compose.sh "$mode" exec -T api tar -C /data -cz uploads > "$out/uploads.tar.gz"

# A zero-byte file means the dump failed half way; never keep it as a "good" backup.
for f in "$out/db.sql.gz" "$out/uploads.tar.gz"; do
  [ -s "$f" ] || { echo "Backup failed: $f is empty" >&2; rm -rf "$out"; exit 1; }
done
find "$root" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "Backup saved in $out"
