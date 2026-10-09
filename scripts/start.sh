#!/usr/bin/env bash
# Visual Trip Maker - start the app in the background (macOS / Linux / Git Bash)
# Usage: ./scripts/start.sh [--dev] [--port 5173]
#   default  serves the production build from dist/ (builds it first if missing)
#   --dev    runs the Vite development server with hot reload
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-5173}"
DEV=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dev) DEV=1 ;;
    --port) shift; PORT="${1:?--port needs a value}" ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ ! -d node_modules ]; then
  echo "Dependencies are missing. Run ./scripts/install.sh first." >&2
  exit 1
fi

RUN_DIR=".run"
PID_FILE="$RUN_DIR/server.pid"
LOG_FILE="$RUN_DIR/server.log"
mkdir -p "$RUN_DIR"

if [ -f "$PID_FILE" ]; then
  old="$(cat "$PID_FILE" || true)"
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
    echo "Already running (PID $old). Run ./scripts/stop.sh first."
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [ "$DEV" -eq 0 ] && [ ! -f dist/index.html ]; then
  echo "No production build found, building first..."
  ./scripts/build.sh
fi

if [ "$DEV" -eq 1 ]; then
  nohup node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$PORT" --strictPort >"$LOG_FILE" 2>&1 &
else
  nohup node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port "$PORT" --strictPort >"$LOG_FILE" 2>&1 &
fi
pid=$!
echo "$pid" >"$PID_FILE"

url="http://127.0.0.1:$PORT/"
for _ in $(seq 1 40); do
  sleep 0.5
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  if command -v curl >/dev/null 2>&1 && curl -fsS -o /dev/null "$url"; then
    echo "Visual Trip Maker is running at $url (PID $pid)"
    echo "Stop it with ./scripts/stop.sh"
    exit 0
  fi
done

cat "$LOG_FILE" >&2 || true
rm -f "$PID_FILE"
kill "$pid" 2>/dev/null || true
echo "The server did not start. Is port $PORT already in use? Try --port <other>." >&2
exit 1
