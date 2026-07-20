#!/usr/bin/env bash
# Build deterministic release bundle (no tests)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-$(node -p "require('./package.json').version")}"
RELEASE_NAME="baby-quirt-${VERSION}"
BUILD_ROOT="${BABY_QUIRT_BUILD_ROOT:-$(mktemp -d)}"
RELEASE_DIR="${BUILD_ROOT}/${RELEASE_NAME}"
ARCHIVE="$ROOT/release/${RELEASE_NAME}.tar.gz"
DIGEST_FILE="$ROOT/release/${RELEASE_NAME}.sha256"
MANIFEST_FILE="$ROOT/release/${RELEASE_NAME}.manifest.json"

export LC_ALL=C
export TZ=UTC
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || echo 0)}"
export GZIP=-n

COMMIT="${BABY_QUIRT_SOURCE_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
if [ "$COMMIT" = "unknown" ] || [ "${#COMMIT}" -ne 40 ]; then
  echo "ERROR: BABY_QUIRT_SOURCE_COMMIT must be a 40-character git commit SHA"
  exit 1
fi

npm run build
npm run build:native

rm -rf "$RELEASE_DIR" "$ARCHIVE" "$DIGEST_FILE" "$MANIFEST_FILE"
mkdir -p "$RELEASE_DIR/bin" "$RELEASE_DIR/lib/native/build/Release" "$RELEASE_DIR/ops"

cp -r dist "$RELEASE_DIR/lib/"
cp package.json package-lock.json binding.gyp "$RELEASE_DIR/lib/"
mkdir -p "$RELEASE_DIR/lib/native/src"
cp native/src/peer_cred.cc "$RELEASE_DIR/lib/native/src/"
cp build/Release/peer_cred.node "$RELEASE_DIR/lib/native/build/Release/peer_cred.node"

NM_ROOT="${BUILD_ROOT}/.release-nm"
mkdir -p "$NM_ROOT"
cp package.json package-lock.json "$NM_ROOT/"
npm ci --omit=dev --ignore-scripts --prefix "$NM_ROOT"
cp -r "$NM_ROOT/node_modules" "$RELEASE_DIR/lib/node_modules"
rm -rf "$NM_ROOT"

cat > "$RELEASE_DIR/bin/baby-quirt-daemon" << 'EOF'
#!/usr/bin/env bash
exec /opt/node-v24.18.0-linux-x64/bin/node /opt/baby-quirt/current/lib/dist/index.js
EOF
chmod 0755 "$RELEASE_DIR/bin/baby-quirt-daemon"

cat > "$RELEASE_DIR/bin/baby-quirt" << 'EOF'
#!/usr/bin/env bash
exec /opt/node-v24.18.0-linux-x64/bin/node /opt/baby-quirt/current/lib/dist/cli/main.js "$@"
EOF
chmod 0755 "$RELEASE_DIR/bin/baby-quirt"

for cmd in install verify rollback repair; do
  cat > "$RELEASE_DIR/bin/baby-quirt-${cmd}" << EOF
#!/usr/bin/env bash
exec /opt/node-v24.18.0-linux-x64/bin/node /opt/baby-quirt/current/lib/dist/cli/${cmd}.js "\$@"
EOF
  chmod 0755 "$RELEASE_DIR/bin/baby-quirt-${cmd}"
done

cp -r ops/systemd "$RELEASE_DIR/ops/"
cp -r ops/tmpfiles "$RELEASE_DIR/ops/"
cp -r schemas "$RELEASE_DIR/"
cp -r contracts "$RELEASE_DIR/"

find "$RELEASE_DIR" -exec touch -h -d "@${SOURCE_DATE_EPOCH}" {} +

cat > "$RELEASE_DIR/manifest.json" << EOF
{
  "product": "baby-quirt",
  "version": "${VERSION}",
  "nodeVersion": "24.18.0",
  "sourceDateEpoch": ${SOURCE_DATE_EPOCH},
  "commit": "${COMMIT}"
}
EOF

mkdir -p "$ROOT/release"
tar --sort=name \
  --mtime="@${SOURCE_DATE_EPOCH}" \
  --owner=0 --group=0 --numeric-owner \
  -cf - -C "$BUILD_ROOT" "${RELEASE_NAME}" | gzip -n > "$ARCHIVE"

DIGEST=$(sha256sum "$ARCHIVE" | awk '{print $1}')
printf '%s  %s\n' "$DIGEST" "$(basename "$ARCHIVE")" > "$DIGEST_FILE"

cat > "$MANIFEST_FILE" << EOF
{
  "product": "baby-quirt",
  "version": "${VERSION}",
  "commit": "${COMMIT}",
  "archive": "$(basename "$ARCHIVE")",
  "sha256": "${DIGEST}",
  "sourceDateEpoch": ${SOURCE_DATE_EPOCH}
}
EOF

if [ "${BABY_QUIRT_KEEP_BUILD_ROOT:-0}" != "1" ]; then
  rm -rf "$BUILD_ROOT"
fi

echo "$DIGEST"
