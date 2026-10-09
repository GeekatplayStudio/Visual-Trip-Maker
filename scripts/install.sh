#!/usr/bin/env bash
# Visual Trip Maker - install dependencies (macOS / Linux / Git Bash)
# Usage: ./scripts/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node.js 20 or newer from https://nodejs.org and run this script again." >&2
  exit 1
fi
major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$major" -lt 20 ]; then
  echo "Node.js 20 or newer is required (found $(node -v))." >&2
  exit 1
fi

echo "Node $(node -v), npm $(npm -v)"
echo "Installing dependencies..."
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
echo "Done. Next: ./scripts/build.sh then ./scripts/start.sh"
