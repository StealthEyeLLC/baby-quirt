#!/usr/bin/env bash
# Build in two isolated exact-commit worktrees, require identical bytes, then
# generate and verify the signed external manifest. Never install or activate.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

VERSION="${1:-$(node -p "require('./package.json').version")}"
PRIVATE_KEY="${BABY_QUIRT_RELEASE_SIGNING_PRIVATE_KEY:?release signing private key path required}"
PUBLIC_KEY="${BABY_QUIRT_RELEASE_SIGNING_PUBLIC_KEY:?release signing public key path required}"
KEY_ID="${BABY_QUIRT_RELEASE_SIGNING_KEY_ID:?release signing key ID required}"
PEER_DIGEST="${BABY_QUIRT_COMPATIBLE_GATEWAY_MANIFEST_DIGEST:?gateway manifest digest required}"
TEST_EVIDENCE="${BABY_QUIRT_TEST_EVIDENCE_PATH:?test evidence index path required}"
COMMIT="${BABY_QUIRT_SOURCE_COMMIT:-$(git rev-parse HEAD)}"
TREE="${BABY_QUIRT_SOURCE_TREE:-$(git show -s --format=%T "$COMMIT")}"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct "$COMMIT")}"
RELEASE_NAME="baby-quirt-${VERSION}"
ARCHIVE="$ROOT/release/${RELEASE_NAME}.tar.gz"
DIGEST_FILE="$ROOT/release/${RELEASE_NAME}.sha256"
MANIFEST="$ROOT/release/${RELEASE_NAME}.manifest.json"
SBOM="$ROOT/release/${RELEASE_NAME}.spdx.json"
TEST_EVIDENCE_OUTPUT="$ROOT/release/${RELEASE_NAME}.test-evidence.json"
REPORT="$ROOT/release/${RELEASE_NAME}.candidate-report.json"
WORKSPACE="$(mktemp -d /tmp/baby-quirt-release.XXXXXX)"
SOURCE_A="$WORKSPACE/source-a"
SOURCE_B="$WORKSPACE/source-b"
BUILD_A="$WORKSPACE/build-a"
BUILD_B="$WORKSPACE/build-b"
EXTRACTED="$WORKSPACE/candidate"
FROZEN_TEST_EVIDENCE="$WORKSPACE/test-evidence.json"
WORKTREE_A_ADDED=0
WORKTREE_B_ADDED=0

cleanup() {
  set +e
  if [ "$WORKTREE_A_ADDED" = "1" ]; then
    git -C "$ROOT" worktree remove --force "$SOURCE_A" >/dev/null 2>&1
  fi
  if [ "$WORKTREE_B_ADDED" = "1" ]; then
    git -C "$ROOT" worktree remove --force "$SOURCE_B" >/dev/null 2>&1
  fi
  rm -rf -- "$WORKSPACE"
}
trap cleanup EXIT

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]] || {
  echo "ERROR: release version is invalid" >&2
  exit 1
}
if [ "$VERSION" = "0.2.1" ] || [ "$VERSION" = "0.2.2" ]; then
  echo "ERROR: reserved releases 0.2.1 and 0.2.2 may not be built or reused" >&2
  exit 1
fi
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

git worktree add --detach "$SOURCE_A" "$COMMIT" >/dev/null
WORKTREE_A_ADDED=1
git worktree add --detach "$SOURCE_B" "$COMMIT" >/dev/null
WORKTREE_B_ADDED=1

mkdir "$WORKSPACE/home-a" "$WORKSPACE/home-b"
(
  cd "$SOURCE_A"
  HOME="$WORKSPACE/home-a" \
    NPM_CONFIG_CACHE="$WORKSPACE/npm-cache-a" \
    npm --cache "$WORKSPACE/npm-cache-a" ci --include=dev
)
(
  cd "$SOURCE_B"
  HOME="$WORKSPACE/home-b" \
    NPM_CONFIG_CACHE="$WORKSPACE/npm-cache-b" \
    npm --cache "$WORKSPACE/npm-cache-b" ci --include=dev
)

export BABY_QUIRT_SOURCE_COMMIT="$COMMIT"
export BABY_QUIRT_SOURCE_TREE="$TREE"
export SOURCE_DATE_EPOCH
export BABY_QUIRT_KEEP_BUILD_ROOT=1

mkdir "$BUILD_A" "$BUILD_B"
ARCHIVE_A="$BUILD_A/${RELEASE_NAME}.tar.gz"
ARCHIVE_B="$BUILD_B/${RELEASE_NAME}.tar.gz"
DIGEST_A_FILE="$BUILD_A/${RELEASE_NAME}.sha256"
DIGEST_B_FILE="$BUILD_B/${RELEASE_NAME}.sha256"
BABY_QUIRT_BUILD_ROOT="$BUILD_A" \
  BABY_QUIRT_ARCHIVE_OUTPUT="$ARCHIVE_A" \
  BABY_QUIRT_DIGEST_OUTPUT="$DIGEST_A_FILE" \
  BABY_QUIRT_NPM_CACHE="$WORKSPACE/npm-runtime-cache-a" \
  bash "$SOURCE_A/scripts/build-bundle.sh" "$VERSION" >"$BUILD_A/build.digest"
DIGEST_A="$(awk 'NF {value=$1} END {print value}' "$BUILD_A/build.digest")"
BABY_QUIRT_BUILD_ROOT="$BUILD_B" \
  BABY_QUIRT_ARCHIVE_OUTPUT="$ARCHIVE_B" \
  BABY_QUIRT_DIGEST_OUTPUT="$DIGEST_B_FILE" \
  BABY_QUIRT_NPM_CACHE="$WORKSPACE/npm-runtime-cache-b" \
  bash "$SOURCE_B/scripts/build-bundle.sh" "$VERSION" >"$BUILD_B/build.digest"
DIGEST_B="$(awk 'NF {value=$1} END {print value}' "$BUILD_B/build.digest")"
test "$DIGEST_A" = "$DIGEST_B"
cmp -s "$ARCHIVE_A" "$ARCHIVE_B"
test -f "$TEST_EVIDENCE"
test ! -L "$TEST_EVIDENCE"
install -m 0644 "$TEST_EVIDENCE" "$FROZEN_TEST_EVIDENCE"

mkdir -p "$ROOT/release"
rm -f -- "$ARCHIVE" "$DIGEST_FILE" "$MANIFEST" "$SBOM" "$TEST_EVIDENCE_OUTPUT" "$REPORT"
install -m 0644 "$ARCHIVE_B" "$ARCHIVE"
printf '%s  %s\n' "$DIGEST_B" "$(basename "$ARCHIVE")" > "$DIGEST_FILE"
install -m 0644 "$FROZEN_TEST_EVIDENCE" "$TEST_EVIDENCE_OUTPUT"
test "$DIGEST_A" = "$(sha256sum "$ARCHIVE" | awk '{print $1}')"

node "$SOURCE_B/dist/src/cli/generate-release-manifest.js" \
  --release-root "$BUILD_B/$RELEASE_NAME" \
  --archive "$ARCHIVE" \
  --output "$MANIFEST" \
  --sbom-output "$SBOM" \
  --test-evidence "$TEST_EVIDENCE_OUTPUT" \
  --signing-private-key "$PRIVATE_KEY" \
  --signing-key-id "$KEY_ID" \
  --compatible-gateway-manifest-digest "$PEER_DIGEST" \
  --builder-a "${BABY_QUIRT_BUILDER_A:-git-worktree-a}" \
  --builder-b "${BABY_QUIRT_BUILDER_B:-git-worktree-b}" \
  --archive-digest-a "$DIGEST_A" \
  --archive-digest-b "$DIGEST_B"

mkdir "$EXTRACTED"
python3 "$SOURCE_B/scripts/bootstrap-safe-extract.py" "$ARCHIVE" "$EXTRACTED" "$RELEASE_NAME"
node "$SOURCE_B/dist/src/cli/verify-candidate.js" \
  --candidate-root "$EXTRACTED/$RELEASE_NAME" \
  --archive "$ARCHIVE" \
  --manifest "$MANIFEST" \
  --sbom "$SBOM" \
  --test-evidence "$TEST_EVIDENCE_OUTPUT" \
  --signing-public-key "$PUBLIC_KEY" \
  --expected-version "$VERSION" \
  --expected-commit "$COMMIT" \
  --expected-tree "$TREE" > "$REPORT"

printf 'ARCHIVE_SHA256=%s\nMANIFEST_SHA256=%s\nCANDIDATE_REPORT_SHA256=%s\n' \
  "$DIGEST_A" \
  "$(sha256sum "$MANIFEST" | awk '{print $1}')" \
  "$(sha256sum "$REPORT" | awk '{print $1}')"
