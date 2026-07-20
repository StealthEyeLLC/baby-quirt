#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-$(node -p "require('./package.json').version")}"

echo "==> Building Baby Quirt ${VERSION}"

npm ci
npm rebuild node-pty
npm run build
npm run test:all
npm run test:contracts

chmod +x scripts/build-bundle.sh
bash scripts/build-bundle.sh "$VERSION"

echo "==> Release bundle: release/baby-quirt-${VERSION}.tar.gz"
cat "release/baby-quirt-${VERSION}.sha256"
