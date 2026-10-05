#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "$(git status --porcelain)" ]]; then
    echo "Deployment stopped: commit or stash local changes first." >&2
    exit 1
fi
git pull --ff-only
revision="$(git rev-parse HEAD)"
compose=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
    compose=(docker-compose)
fi
"${compose[@]}" build --build-arg "APP_REVISION=$revision" backend
"${compose[@]}" up -d --force-recreate --renew-anon-volumes backend
for attempt in {1..30}; do
    if "${compose[@]}" exec -T backend python -c 'import json,os,urllib.request; data=json.load(urllib.request.urlopen("http://127.0.0.1:8000/api/version", timeout=3)); assert data["backend_revision"] == os.environ["APP_REVISION"] and data["frontend_revision"] == os.environ["APP_REVISION"]' 2>/dev/null; then
        echo "Deployed backend and frontend revision $revision"
        exit 0
    fi
    sleep 2
done
"${compose[@]}" logs --tail=60 backend
echo "Deployment verification failed. Check backend logs before proceeding." >&2
exit 1
