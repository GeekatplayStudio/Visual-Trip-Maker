#!/usr/bin/env bash
# Visual Trip Maker - stop the background server started by start.sh
# Usage: ./scripts/stop.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PID_FILE=".run/server.pid"
if [ ! -f "$PID_FILE" ]; then
  echo "Not running (no PID file)."
  exit 0
fi

pid="$(cat "$PID_FILE")"
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  kill "$pid" 2>/dev/null || true
  sleep 0.5
  # Git Bash on Windows: fall back to taskkill for native processes
  if kill -0 "$pid" 2>/dev/null && command -v taskkill >/dev/null 2>&1; then
    taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
  fi
  echo "Stopped (PID $pid)."
else
  echo "The recorded process is no longer running."
fi
rm -f "$PID_FILE"
