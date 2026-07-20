#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-$(node -p "require('./package.json').version")}"
export BABY_QUIRT_SOURCE_COMMIT="${BABY_QUIRT_SOURCE_COMMIT:-$(git rev-parse HEAD)}"

echo "==> Building Baby Quirt ${VERSION} from commit ${BABY_QUIRT_SOURCE_COMMIT}"

npm ci
npm run build:native
npm run build
npm run test
npm run test:integration
npm run test:contracts

chmod +x scripts/build-bundle.sh
bash scripts/build-bundle.sh "$VERSION"

echo "==> Release bundle: release/baby-quirt-${VERSION}.tar.gz"
cat "release/baby-quirt-${VERSION}.sha256"
