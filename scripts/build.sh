#!/usr/bin/env bash
# Visual Trip Maker - type-check, lint and build the production bundle
# Usage: ./scripts/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "Dependencies are missing. Run ./scripts/install.sh first." >&2
  exit 1
fi

echo "Linting..."
npm run lint
echo "Building..."
npm run build
echo "Build finished: dist/"
