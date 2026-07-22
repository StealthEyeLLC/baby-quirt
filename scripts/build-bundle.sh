#!/usr/bin/env bash
# Produce one deterministic, tree-bound Baby Quirt archive. No signing or activation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

VERSION="${1:-$(node -p "require('./package.json').version")}"
RELEASE_NAME="baby-quirt-${VERSION}"
BUILD_ROOT="${BABY_QUIRT_BUILD_ROOT:-$(mktemp -d)}"
RELEASE_DIR="${BUILD_ROOT}/${RELEASE_NAME}"
ARCHIVE="${BABY_QUIRT_ARCHIVE_OUTPUT:-$ROOT/release/${RELEASE_NAME}.tar.gz}"
DIGEST_FILE="${BABY_QUIRT_DIGEST_OUTPUT:-$ROOT/release/${RELEASE_NAME}.sha256}"

export LC_ALL=C
export TZ=UTC

COMMIT="${BABY_QUIRT_SOURCE_COMMIT:-$(git rev-parse HEAD)}"
TREE="${BABY_QUIRT_SOURCE_TREE:-$(git show -s --format=%T "$COMMIT")}"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct "$COMMIT")}"
export SOURCE_DATE_EPOCH
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]] || {
  echo "ERROR: release version is invalid" >&2
  exit 1
}
if [ "$VERSION" = "0.2.1" ] || [ "$VERSION" = "0.2.2" ]; then
  echo "ERROR: reserved releases 0.2.1 and 0.2.2 may not be built or reused" >&2
  exit 1
fi
[[ "$COMMIT" =~ ^[a-f0-9]{40}$ ]] || {
  echo "ERROR: BABY_QUIRT_SOURCE_COMMIT must be an exact commit SHA" >&2
  exit 1
}
[[ "$TREE" =~ ^[a-f0-9]{40}$ ]] || {
  echo "ERROR: BABY_QUIRT_SOURCE_TREE must be an exact Git tree SHA" >&2
  exit 1
}
[[ "$SOURCE_DATE_EPOCH" =~ ^[0-9]+$ ]] || {
  echo "ERROR: SOURCE_DATE_EPOCH must be a non-negative integer" >&2
  exit 1
}
test "$(node -p 'process.versions.node')" = "24.18.0" || {
  echo "ERROR: release builds require exact Node 24.18.0" >&2
  exit 1
}
test "$COMMIT" = "$(git rev-parse HEAD)" || {
  echo "ERROR: release source commit must equal the checked-out HEAD" >&2
  exit 1
}
test "$TREE" = "$(git show -s --format=%T "$COMMIT")" || {
  echo "ERROR: release source tree does not match the exact commit" >&2
  exit 1
}
test "$SOURCE_DATE_EPOCH" = "$(git log -1 --format=%ct "$COMMIT")" || {
  echo "ERROR: SOURCE_DATE_EPOCH must equal the exact source commit timestamp" >&2
  exit 1
}
test -z "$(git status --porcelain --untracked-files=normal)" || {
  echo "ERROR: release builds require a clean exact source tree" >&2
  exit 1
}

npm run build
npm run build:native

test ! -e "$RELEASE_DIR"
mkdir -p \
  "$RELEASE_DIR/bin" \
  "$RELEASE_DIR/lib/dist" \
  "$RELEASE_DIR/lib/build/Release" \
  "$RELEASE_DIR/lib/native/src" \
  "$RELEASE_DIR/libexec" \
  "$RELEASE_DIR/ops"

test -d dist/src
cp -r dist/src/. "$RELEASE_DIR/lib/dist/"
cp package.json package-lock.json binding.gyp "$RELEASE_DIR/lib/"
cp native/src/peer_cred.cc "$RELEASE_DIR/lib/native/src/"
cp build/Release/peer_cred.node "$RELEASE_DIR/lib/build/Release/peer_cred.node"

NM_ROOT="${BUILD_ROOT}/.release-nm"
mkdir "$NM_ROOT"
cp package.json package-lock.json "$NM_ROOT/"
mkdir "$BUILD_ROOT/.release-home"
HOME="$BUILD_ROOT/.release-home" \
  NPM_CONFIG_CACHE="${BABY_QUIRT_NPM_CACHE:-$BUILD_ROOT/.release-npm-cache}" \
  npm --cache "${BABY_QUIRT_NPM_CACHE:-$BUILD_ROOT/.release-npm-cache}" \
  ci --omit=dev --ignore-scripts --prefix "$NM_ROOT"
if find "$NM_ROOT/node_modules" -type l -print -quit | grep -q .; then
  echo "ERROR: production dependency tree contains a symbolic link" >&2
  exit 1
fi
cp -r "$NM_ROOT/node_modules" "$RELEASE_DIR/lib/node_modules"
rm -rf -- "$NM_ROOT"
rm -rf -- "$BUILD_ROOT/.release-home" "$BUILD_ROOT/.release-npm-cache"

write_wrapper() {
  local target="$1"
  local relative_entrypoint="$2"
  local temporary="${BUILD_ROOT}/wrapper.$$.tmp"
  {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'set -euo pipefail'
    printf '%s\n' 'RELEASE_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"'
    printf '%s\n' 'NODE="${BABY_QUIRT_NODE_PATH:-/opt/node-v24.18.0-linux-x64/bin/node}"'
    printf 'exec "$NODE" "$RELEASE_ROOT/%s" "$@"\n' "$relative_entrypoint"
  } > "$temporary"
  install -m 0755 "$temporary" "$target"
  rm -f -- "$temporary"
}

write_wrapper "$RELEASE_DIR/bin/baby-quirt-daemon" 'lib/dist/index.js'
write_wrapper "$RELEASE_DIR/bin/baby-quirt" 'lib/dist/cli/main.js'
write_wrapper "$RELEASE_DIR/bin/baby-quirt-install" 'lib/dist/cli/install.js'
write_wrapper "$RELEASE_DIR/bin/baby-quirt-verify" 'lib/dist/cli/verify.js'
write_wrapper "$RELEASE_DIR/bin/baby-quirt-repair" 'lib/dist/cli/repair.js'
write_wrapper "$RELEASE_DIR/bin/baby-quirt-rollback" 'lib/dist/cli/rollback.js'
write_wrapper "$RELEASE_DIR/bin/baby-quirt-verify-candidate" 'lib/dist/cli/verify-candidate.js'

cp -r ops/systemd "$RELEASE_DIR/ops/"
cp -r ops/tmpfiles "$RELEASE_DIR/ops/"
cp -r schemas "$RELEASE_DIR/"
cp -r contracts "$RELEASE_DIR/"
install -m 0555 scripts/bootstrap-safe-extract.py "$RELEASE_DIR/libexec/bootstrap-safe-extract.py"

node dist/src/cli/write-internal-manifest.js \
  --release-root "$RELEASE_DIR" \
  --version "$VERSION" \
  --commit "$COMMIT" \
  --tree "$TREE" \
  --source-date-epoch "$SOURCE_DATE_EPOCH"

find "$RELEASE_DIR" -exec touch -h -d "@${SOURCE_DATE_EPOCH}" {} +
find "$RELEASE_DIR" -type d -exec chmod 0555 {} +
find "$RELEASE_DIR" -type f -exec chmod 0444 {} +
find "$RELEASE_DIR/bin" -type f -exec chmod 0555 {} +
chmod 0555 "$RELEASE_DIR/libexec/bootstrap-safe-extract.py"

mkdir -p "$(dirname "$ARCHIVE")" "$(dirname "$DIGEST_FILE")"
test ! -L "$ARCHIVE"
test ! -L "$DIGEST_FILE"
rm -f -- "$ARCHIVE" "$DIGEST_FILE"
tar --format=ustar \
  --sort=name \
  --mtime="@${SOURCE_DATE_EPOCH}" \
  --owner=0 --group=0 --numeric-owner \
  --no-acls --no-selinux --no-xattrs \
  -cf - -C "$BUILD_ROOT" "$RELEASE_NAME" | gzip -n -9 > "$ARCHIVE"

STRICT_ROOT="${BUILD_ROOT}/strict-validation"
python3 scripts/bootstrap-safe-extract.py "$ARCHIVE" "$STRICT_ROOT" "$RELEASE_NAME"
test -f "$STRICT_ROOT/$RELEASE_NAME/manifest.json"
test -f "$STRICT_ROOT/$RELEASE_NAME/lib/build/Release/peer_cred.node"
test ! -e "$STRICT_ROOT/$RELEASE_NAME/lib/native/build/Release/peer_cred.node"

DIGEST="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
printf '%s  %s\n' "$DIGEST" "$(basename "$ARCHIVE")" > "$DIGEST_FILE"

if [ "${BABY_QUIRT_KEEP_BUILD_ROOT:-0}" != "1" ]; then
  rm -rf -- "$BUILD_ROOT"
fi

printf '%s\n' "$DIGEST"
