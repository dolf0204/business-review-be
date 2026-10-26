#!/usr/bin/env sh
# Replaces the database and the uploaded pictures with the contents of a backup. This deletes the current data.
# Usage: ./restore.sh [local|prod] backups/<date>
set -eu
cd "$(dirname "$0")"
mode="${1:?usage: restore.sh local|prod backups/<date>}"
dir="${2:?usage: restore.sh local|prod backups/<date>}"
[ -s "$dir/db.sql.gz" ] && [ -s "$dir/uploads.tar.gz" ] || { echo "No complete backup in $dir" >&2; exit 1; }

printf 'This DELETES the current data in "%s" and restores %s. Type yes to continue: ' "$mode" "$dir"
read -r answer
[ "$answer" = yes ] || { echo "Cancelled."; exit 1; }

./compose.sh "$mode" stop api web
./compose.sh "$mode" exec -T postgres psql -U brev -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS brev WITH (FORCE)" -c "CREATE DATABASE brev OWNER brev"
gunzip -c "$dir/db.sql.gz" | ./compose.sh "$mode" exec -T postgres psql -U brev -d brev -v ON_ERROR_STOP=1 -q
# Any small image of the stack will do to unpack files into the uploads volume.
./compose.sh "$mode" run --rm --no-deps -T -v "businessask_uploads:/data/uploads" -v "$(cd "$dir" && pwd):/backup:ro" --entrypoint sh postgres -c "rm -rf /data/uploads/* && tar -C /data -xzf /backup/uploads.tar.gz"
./compose.sh "$mode" start api web
echo "Restored from $dir"
