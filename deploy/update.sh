#!/usr/bin/env sh
# Server: pulls the latest code of both repositories and rebuilds. Database migrations run when the API starts.
# Usage: ./update.sh        (from the deploy folder of the backend repository)
set -eu
cd "$(dirname "$0")"
for repo in ../../business-review-be ../../business-review-fe; do
  echo "Updating $repo"
  git -C "$repo" pull --ff-only
done
./backup.sh prod || echo "Backup before the update failed. Continuing is your decision: press Ctrl+C within 10 seconds to stop." && sleep 10
./compose.sh prod up -d --build
docker image prune -f >/dev/null
./compose.sh prod ps
