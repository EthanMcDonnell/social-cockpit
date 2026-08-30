#!/usr/bin/env bash
#
# Bring up an isolated Social Cockpit, fill it with a fabricated account, and
# write portfolio candidates to a new scratch directory. The active checkout is
# never built, seeded, stashed, reset, or otherwise modified.
#
# Usage: docs/portfolio/demo/run.sh [scratch-parent]
set -euo pipefail

SOURCE_REPO=$(cd "$(dirname "$0")/../../.." && pwd)
SCRATCH_PARENT=${1:-${TMPDIR:-/tmp}}
mkdir -p "$SCRATCH_PARENT"
WORK=$(mktemp -d "$SCRATCH_PARENT/sc-demo.XXXXXX")
APP="$WORK/app"
DATA="$WORK/data"
CANDIDATES="$WORK/candidates"
PATCH="$WORK/current-ui.patch"
MANIFEST="$WORK/capture-manifest.txt"
PORT=3100
MOCK_PORT=3199
CDP_PORT=9333

# These are deliberately the only local, user-owned interface changes a capture
# may inherit. The harness fails rather than silently sweeping unrelated work
# into a portfolio image.
OVERLAY_PATHS=(
  src/app/globals.css
  src/app/slugs/SlugsClient.tsx
  src/components/calendar/CalendarClient.tsx
  src/components/compose/ComposeStudio.tsx
)

command -v node >/dev/null || { echo "node is required"; exit 1; }
command -v git >/dev/null || { echo "git is required"; exit 1; }

# A left-over demo can make every readiness check pass against stale fixtures.
# Port 3000 is intentionally not queried: it is the live app and outside this
# harness's remit.
for port in "$PORT" "$MOCK_PORT" "$CDP_PORT"; do
  if lsof -ti "tcp:$port" >/dev/null 2>&1; then
    echo "port $port is already in use; refusing to capture a stale demo."
    exit 1
  fi
done

cleanup() {
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null || true
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

printf '== scratch ==\n%s\n' "$WORK"
printf '== worktree ==\n'
git -C "$SOURCE_REPO" worktree add --detach "$APP" HEAD >/dev/null
[ -e "$APP/node_modules" ] || ln -s "$SOURCE_REPO/node_modules" "$APP/node_modules"

# Make a binary-safe, explicitly allowlisted overlay of the active UI. `HEAD`
# includes this harness's committed implementation; this patch contains only
# the local Calendar/Compose/Slugs/style snapshot the user asked to capture.
git -C "$SOURCE_REPO" diff --binary HEAD -- "${OVERLAY_PATHS[@]}" >"$PATCH"
if [ -s "$PATCH" ]; then
  while IFS=$'\t' read -r _ _ path; do
    case "$path" in
      src/app/globals.css|src/app/slugs/SlugsClient.tsx|src/components/calendar/CalendarClient.tsx|src/components/compose/ComposeStudio.tsx) ;;
      *) echo "overlay contains an unapproved path: $path"; exit 1 ;;
    esac
  done < <(git apply --numstat "$PATCH")
  git -C "$APP" apply --check "$PATCH"
  git -C "$APP" apply "$PATCH"
fi

# Cut the worktree off from Meta at the source. The live checkout is never
# edited; fake credentials and the local mock are the only social connection.
for file in src/lib/instagram/client.ts src/lib/instagram/usage.ts; do
  /usr/bin/sed -i '' \
    "s|const BASE_URL = \"https://graph.instagram.com/v25.0\";|const BASE_URL = \"http://127.0.0.1:$MOCK_PORT/v25.0\"; // demo harness: local mock only|" \
    "$APP/$file"
done
if grep -R "https://graph.instagram.com" "$APP/src/lib/instagram/client.ts" "$APP/src/lib/instagram/usage.ts" >/dev/null; then
  echo "failed to redirect the Graph client; refusing to start"
  exit 1
fi

mkdir -p "$DATA" "$CANDIDATES" "$WORK/tmp"

printf '== mock graph ==\n'
node "$APP/docs/portfolio/demo/mock-graph.mjs" "$MOCK_PORT" >"$WORK/mock.log" 2>&1 &
MOCK_PID=$!

printf '== app ==\n'
(
  cd "$APP"
  exec env -i \
    PATH="$PATH" HOME="$HOME" LANG="${LANG:-en_AU.UTF-8}" TMPDIR="$WORK/tmp" \
    NODE_ENV=development \
    INSTAGRAM_ACCOUNT_ID=17841400000000001 \
    INSTAGRAM_ACCESS_TOKEN=demo-not-a-real-token \
    DB_PATH="$DATA/automations.db" \
    CACHE_DB_PATH="$DATA/cache.db" \
    TRANSCRIPTS_DB_PATH="$DATA/transcripts.db" \
    EVENTS_DB_PATH="$DATA/events.db" \
    SCHEDULER_ENABLED=true \
    SCHEDULE_TIMEZONE=Australia/Brisbane \
    node node_modules/next/dist/bin/next dev -p "$PORT"
) >"$WORK/app.log" 2>&1 &
APP_PID=$!

printf '== waiting ==\n'
for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:$PORT/api/schedule" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$PORT/api/schedule" >/dev/null || {
  echo "app never came up; inspect $WORK/app.log"
  exit 1
}

printf '== migrate ==\n'
node "$APP/scripts/migrate-scheduler-integrity.mjs" --db "$DATA/automations.db" --apply >/dev/null

printf '== seed ==\n'
node "$APP/docs/portfolio/demo/seed.mjs" "$DATA"

printf '== warm ==\n'
curl -fsS "http://127.0.0.1:$PORT/api/instagram/profile" >/dev/null
curl -fsS "http://127.0.0.1:$PORT/api/instagram/media?all=true" >/dev/null
curl -fsS "http://127.0.0.1:$PORT/api/instagram/insights?period=day&metrics=follower_count,reach,profile_views,accounts_engaged,total_interactions" >/dev/null

printf '== shoot ==\n'
SHOT_OUT="$CANDIDATES" SHOT_PROFILE="$WORK/chrome-profile" SHOT_CDP_PORT="$CDP_PORT" \
  node "$APP/docs/portfolio/demo/shoot.mjs" "http://127.0.0.1:$PORT"

{
  echo "base commit: $(git -C "$SOURCE_REPO" rev-parse HEAD)"
  echo "captured at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "overlay paths: ${OVERLAY_PATHS[*]}"
  echo "overlay sha256: $(shasum -a 256 "$PATCH" | cut -d ' ' -f 1)"
  echo "images:"
  for image in "$CANDIDATES"/*.png; do
    echo "  $(basename "$image"): $(sips -g pixelWidth -g pixelHeight "$image" | tr '\n' ' ')"
  done
} >"$MANIFEST"

printf 'candidates: %s\nmanifest: %s\n' "$CANDIDATES" "$MANIFEST"
if [ "${KEEP:-}" = "1" ]; then
  printf 'KEEP=1 — demo remains at http://127.0.0.1:%s (ctrl-c to stop)\n' "$PORT"
  wait "$APP_PID"
fi
