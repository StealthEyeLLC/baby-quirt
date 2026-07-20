#!/usr/bin/env bash
# Build release bundle only (no tests). CI validation runs separately.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-$(node -p "require('./package.json').version")}"
export BABY_QUIRT_SOURCE_COMMIT="${BABY_QUIRT_SOURCE_COMMIT:-$(git rev-parse HEAD)}"

echo "==> Building release ${VERSION} from commit ${BABY_QUIRT_SOURCE_COMMIT}"

npm ci
npm run build:native
npm run build
chmod +x scripts/build-bundle.sh scripts/verify-runtime-deps.sh
bash scripts/verify-runtime-deps.sh
bash scripts/build-bundle.sh "$VERSION"

echo "==> Release bundle: release/baby-quirt-${VERSION}.tar.gz"
cat "release/baby-quirt-${VERSION}.sha256"
