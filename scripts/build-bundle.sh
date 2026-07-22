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
mkdir -p "$RELEASE_DIR/bin" "$RELEASE_DIR/lib/dist" "$RELEASE_DIR/lib/native/build/Release" "$RELEASE_DIR/ops"

# TypeScript is compiled with rootDir='.', so runtime source lands under dist/src.
# Flatten only that runtime subtree into lib/dist so all installed entrypoints are
# stable at lib/dist/{index,cli,...}.js. Compiled build-only scripts are excluded.
test -d dist/src
cp -r dist/src/. "$RELEASE_DIR/lib/dist/"
cp package.json package-lock.json binding.gyp "$RELEASE_DIR/lib/"
mkdir -p "$RELEASE_DIR/lib/native/src"
cp native/src/peer_cred.cc "$RELEASE_DIR/lib/native/src/"
cp build/Release/peer_cred.node "$RELEASE_DIR/lib/native/build/Release/peer_cred.node"

NM_ROOT="${BUILD_ROOT}/.release-nm"
mkdir -p "$NM_ROOT"
cp package.json package-lock.json "$NM_ROOT/"
npm ci --omit=dev --ignore-scripts --prefix "$NM_ROOT"
# npm creates executable-link entries under .bin directories. The production
# extractor intentionally rejects every symbolic and hard link, so remove all
# dependency symlinks before packaging and fail if any remain. Runtime modules
# resolve their actual files directly and do not require npm's command shims.
find "$NM_ROOT/node_modules" -type l -delete
if find "$NM_ROOT/node_modules" -type l -print -quit | grep -q .; then
  echo "ERROR: production dependency tree still contains a symbolic link" >&2
  exit 1
fi
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

# Fail the build before publication if the archive does not contain the exact
# runtime paths consumed by first-install, systemd, verification, and rollback.
ARCHIVE_LIST="${BUILD_ROOT}/archive.list"
tar -tzf "$ARCHIVE" > "$ARCHIVE_LIST"
for required in \
  "bin/baby-quirt-daemon" \
  "lib/dist/index.js" \
  "lib/dist/cli/install.js" \
  "lib/dist/cli/verify.js" \
  "lib/dist/cli/rollback.js" \
  "ops/systemd/baby-quirt.socket" \
  "ops/systemd/baby-quirt.service" \
  "ops/tmpfiles/baby-quirt.conf" \
  "manifest.json"; do
  if ! grep -Fxq "${RELEASE_NAME}/${required}" "$ARCHIVE_LIST"; then
    echo "ERROR: release archive is missing required runtime path: $required" >&2
    exit 1
  fi
done
if grep -Fq "${RELEASE_NAME}/lib/dist/src/" "$ARCHIVE_LIST"; then
  echo "ERROR: release archive contains an unexpected nested dist/src runtime" >&2
  exit 1
fi
python3 - "$ARCHIVE" <<'PYARCHIVE'
import sys
import tarfile

archive = sys.argv[1]
with tarfile.open(archive, 'r:gz') as bundle:
    forbidden = [
        member.name
        for member in bundle.getmembers()
        if member.issym() or member.islnk()
    ]
if forbidden:
    for name in forbidden:
        print(f"ERROR: release archive contains forbidden link entry: {name}", file=sys.stderr)
    raise SystemExit(1)
PYARCHIVE

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
