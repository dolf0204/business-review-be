#!/usr/bin/env sh
# Usage: ./compose.sh local|prod <docker compose arguments>
#   ./compose.sh local up --build -d     start (or rebuild and restart) everything on this computer
#   ./compose.sh local logs -f api       follow the API log
#   ./compose.sh local down              stop everything (data is kept)
set -eu
cd "$(dirname "$0")"

mode="${1:-}"
case "$mode" in local|prod) shift ;; *) echo "Usage: $0 local|prod <docker compose arguments>" >&2; exit 2 ;; esac

env_file="$mode.env"
if [ ! -f "$env_file" ]; then
  cp "$env_file.example" "$env_file"
  echo "Created deploy/$env_file from the example. Open it and set your values, then run this again." >&2
  [ "$mode" = prod ] && exit 1
fi

[ -d ../../business-review-fe ] || { echo "Missing ../../business-review-fe. The two repositories must sit side by side." >&2; exit 1; }

exec docker compose --env-file "$env_file" -f docker-compose.yml -f "docker-compose.$mode.yml" "$@"
