#!/usr/bin/env bash
#
# Bring up a throwaway Social Cockpit and screenshot it.
#
# NOTHING here touches the live install. Specifically:
#
#   * the app runs from a detached `git worktree`, so `.next/` - the build the
#     production server is serving - is never written to;
#   * it listens on 3100, not 3000;
#   * every DB_PATH points into a scratch directory, so data/ is never opened;
#   * BASE_URL in the Instagram client is repointed at a local mock, so no
#     request can reach Meta even if something does wake up. There is no real
#     access token in the environment either.
#
# The scheduler worker IS left on. It has to be - the calendar shows a standing
# banner when it is off, and a portfolio screenshot of a disabled scheduler is
# worse than no screenshot. It is harmless here: every seeded job in the past is
# already `published`, so nothing is ever due, and the mock stands between it and
# Meta regardless.
#
# Usage: docs/portfolio/demo/run.sh [workdir]
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../../.." && pwd)
WORK=${1:-${TMPDIR:-/tmp}/sc-demo}
APP=$WORK/app
DATA=$WORK/data
PORT=3100
MOCK_PORT=3199

command -v node >/dev/null || { echo "node is required"; exit 1; }

# A leftover server from an earlier run answers on the same port, and every
# readiness check below would pass against it - so the run would screenshot a
# stale instance with stale data and no sign that anything was wrong. Refuse.
for p in $PORT $MOCK_PORT; do
  if lsof -ti "tcp:$p" >/dev/null 2>&1; then
    echo "port $p is already in use (pid $(lsof -ti "tcp:$p" | tr '\n' ' '))."
    echo "that is probably a leftover demo run - stop it and retry."
    exit 1
  fi
done

echo "== worktree =="
if [ ! -d "$APP" ]; then
  git -C "$REPO" worktree add --detach "$APP" HEAD
fi
[ -e "$APP/node_modules" ] || ln -s "$REPO/node_modules" "$APP/node_modules"

# Cut the copy off from Meta at the source. Two constants, both in the worktree
# only - the live tree is never edited.
for f in src/lib/instagram/client.ts src/lib/instagram/usage.ts; do
  /usr/bin/sed -i '' \
    "s|const BASE_URL = \"https://graph.instagram.com/v25.0\";|const BASE_URL = \"http://127.0.0.1:$MOCK_PORT/v25.0\"; // demo harness: see docs/portfolio/demo|" \
    "$APP/$f"
done
grep -q "127.0.0.1:$MOCK_PORT" "$APP/src/lib/instagram/client.ts" || {
  echo "failed to redirect the Instagram base URL - refusing to start"; exit 1; }

# `data/` in .gitignore has no leading slash, so it also matches src/lib/data/ -
# two real source modules the repo therefore does not track. A worktree checkout
# is missing them and the app will not compile. Copy them across and say so; the
# actual fix is to anchor that pattern as `/data/` and commit the two files.
if [ -d "$REPO/src/lib/data" ] && ! git -C "$REPO" ls-files --error-unmatch src/lib/data >/dev/null 2>&1; then
  echo "note: copying untracked src/lib/data/ (see .gitignore \`data/\` - it should be \`/data/\`)"
  mkdir -p "$APP/src/lib/data"
  cp "$REPO"/src/lib/data/* "$APP/src/lib/data/"
fi

mkdir -p "$DATA"

echo "== mock graph =="
node "$REPO/docs/portfolio/demo/mock-graph.mjs" "$MOCK_PORT" &
MOCK=$!

echo "== app =="
(cd "$APP" && env -i \
  PATH="$PATH" HOME="$HOME" LANG="${LANG:-en_AU.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" \
  NODE_ENV=development \
  INSTAGRAM_ACCOUNT_ID=17841400000000001 \
  INSTAGRAM_ACCESS_TOKEN=demo-not-a-real-token \
  DB_PATH="$DATA/automations.db" \
  CACHE_DB_PATH="$DATA/cache.db" \
  TRANSCRIPTS_DB_PATH="$DATA/transcripts.db" \
  EVENTS_DB_PATH="$DATA/events.db" \
  SCHEDULER_ENABLED=true \
  SCHEDULE_TIMEZONE=Australia/Brisbane \
  node node_modules/next/dist/bin/next dev -p $PORT) >"$WORK/app.log" 2>&1 &
APP_PID=$!

# `next dev` is a grandchild (the subshell above cd's first), so killing the
# recorded pid leaves the server listening - which the port guard then trips
# over on the next run. Clear the ports themselves.
cleanup() {
  kill $MOCK $APP_PID 2>/dev/null || true
  for p in $PORT $MOCK_PORT; do
    lsof -ti "tcp:$p" 2>/dev/null | xargs -r kill 2>/dev/null || true
  done
}
trap cleanup EXIT

echo "== waiting =="
for i in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/api/schedule" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://127.0.0.1:$PORT/api/schedule" >/dev/null || {
  echo "app never came up:"; tail -30 "$WORK/app.log"; exit 1; }

# The worker refuses to run until the scheduler integrity migration is present,
# and the calendar carries a standing banner while it is off. Apply it to the
# demo database - explicitly, by path, which is the only way this script accepts
# a target.
echo "== migrate =="
node "$REPO/scripts/migrate-scheduler-integrity.mjs" --db "$DATA/automations.db" --apply >/dev/null

echo "== seed =="
node "$REPO/docs/portfolio/demo/seed.mjs" "$DATA"

# Warm the local media cache before shooting. The first request to /media does a
# cold sync of every post and its insights; without this the screenshot catches
# the dashboard mid-skeleton.
echo "== warm =="
curl -fsS "http://127.0.0.1:$PORT/api/instagram/profile" >/dev/null
curl -fsS "http://127.0.0.1:$PORT/api/instagram/media?all=true" >/dev/null
curl -fsS "http://127.0.0.1:$PORT/api/instagram/insights?period=day&metrics=follower_count,reach,profile_views,accounts_engaged,total_interactions" >/dev/null

echo "== shoot =="
node "$REPO/docs/portfolio/demo/shoot.mjs" "http://127.0.0.1:$PORT"

if [ "${KEEP:-}" = "1" ]; then
  echo "KEEP=1 - leaving the demo up on http://127.0.0.1:$PORT (ctrl-c to stop)"
  wait $APP_PID
fi

echo "done. app log: $WORK/app.log"
