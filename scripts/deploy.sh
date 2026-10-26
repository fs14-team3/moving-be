#!/usr/bin/env bash
# Runs on the EC2 server as the `moving` user, started by the server's SSH deploy gate:
#   scripts/deploy.sh <dev|prod> <release dir>
# Builds the release, applies migrations, then switches `current` and reloads PM2.
# Migrations are not rolled back if the new release fails its health check.
set -euo pipefail

ENV=$1
RELEASE=$2
BASE=/srv/moving/$ENV
NAME=moving-be-$ENV
CONFIG=/srv/moving/config/$ENV.env
PORT=$(sed -n 's/^PORT=//p' "$CONFIG" | tr -d "\"'\r")
case $PORT in
  '' | *[!0-9]*)
    echo "PORT in $CONFIG must be a single number, got '$PORT'" >&2
    exit 1
    ;;
esac

# fd 9 is the gate's per-environment lock, inherited through exec; keep it open.
exec 8>"$HOME/deploy.lock"
if ! flock -n 8; then
  echo "== Waiting for another deploy on this server"
  flock 8
fi

cd "$RELEASE"
ln -sfn "$CONFIG" .env

echo "== Install"
CI=true npm ci --no-audit --no-fund --loglevel=error

echo "== Build"
npm run build

echo "== Migrate"
PRISMA_HIDE_UPDATE_MESSAGE=1 npx prisma migrate deploy

switch_to() {
  ln -sfn "$1" "$BASE/current.next"
  mv -Tf "$BASE/current.next" "$BASE/current"
  if pm2 describe "$NAME" >/dev/null 2>&1; then
    pm2 reload "$NAME" --update-env
  else
    # kill-timeout exceeds the app's 10s graceful shutdown (src/server.ts)
    pm2 start "$BASE/current/dist/server.js" --name "$NAME" \
      --cwd "$BASE/current" --kill-timeout 12000 --time
  fi
  pm2 save --force >/dev/null
}

ready() {
  for _ in $(seq 1 15); do
    curl -fsS "http://127.0.0.1:$PORT/api/ready" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

PREVIOUS=$(readlink "$BASE/current" || true)

echo "== Release"
switch_to "$RELEASE"

if ! ready; then
  echo "$NAME did not become ready" >&2
  pm2 logs "$NAME" --lines 40 --nostream || true
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
    echo "Rolling back to $PREVIOUS" >&2
    switch_to "$PREVIOUS"
  fi
  exit 1
fi
echo "$NAME is ready on port $PORT"

# Keep the three newest releases plus whatever is live.
LIVE=$(realpath "$BASE/current")
ls -1dt "$BASE"/releases/*/ | tail -n +4 | while read -r dir; do
  [ "$(realpath "$dir")" = "$LIVE" ] || rm -rf "$dir"
done
