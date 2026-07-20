#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building Baby Quirt"
npm ci
npm run build

echo "==> Build complete"
ls -la dist/
