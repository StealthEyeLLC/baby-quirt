#!/usr/bin/env bash
# Fixed inactive-install adapter. Must run only behind the Fix privilege broker.
set -euo pipefail

AUTHORITY="${STEALTHEYE_DEPLOYMENT_AUTHORITY:?deployment authority required}"
DEPLOYMENT_ID="${STEALTHEYE_DEPLOYMENT_ID:?deployment ID required}"
GENERATION="${STEALTHEYE_DEPLOYMENT_GENERATION:?deployment generation required}"
PLAN_HASH="${STEALTHEYE_DEPLOYMENT_PLAN_HASH:?deployment plan hash required}"
VERSION="${BABY_QUIRT_VERSION:?version required}"
STAGING_PATH="${BABY_QUIRT_STAGING_PATH:?deployment-scoped staging path required}"
EXPECTED_COMMIT="${BABY_QUIRT_EXPECTED_COMMIT:?expected commit required}"
EXPECTED_TREE="${BABY_QUIRT_EXPECTED_TREE:?expected tree required}"
EXPECTED_ARCHIVE_SHA256="${BABY_QUIRT_EXPECTED_ARCHIVE_SHA256:?expected archive digest required}"
EXPECTED_MANIFEST_SHA256="${BABY_QUIRT_EXPECTED_MANIFEST_SHA256:?expected manifest digest required}"
EXPECTED_SIGNING_KEY_SHA256="${BABY_QUIRT_RELEASE_SIGNING_PUBLIC_KEY_SHA256:?trusted signing public-key digest required}"
EXTRACTOR="${BABY_QUIRT_STRICT_EXTRACTOR_PATH:?trusted strict extractor path required}"
EXPECTED_EXTRACTOR_SHA256="${BABY_QUIRT_STRICT_EXTRACTOR_SHA256:?trusted strict extractor digest required}"
INSTALL_CLI="${BABY_QUIRT_TRUSTED_INSTALL_CLI_PATH:?trusted inactive-install CLI path required}"
EXPECTED_INSTALL_CLI_SHA256="${BABY_QUIRT_TRUSTED_INSTALL_CLI_SHA256:?trusted inactive-install CLI digest required}"
RELEASE_ROOT="${BABY_QUIRT_RELEASE_ROOT:-/opt/baby-quirt/releases}"
NODE_PATH="${BABY_QUIRT_NODE_PATH:-/opt/node-v24.18.0-linux-x64/bin/node}"

test "$AUTHORITY" = "fix-privilege-broker" || {
  echo "ERROR: inactive installation requires the Fix privilege broker" >&2
  exit 1
}
[[ "$DEPLOYMENT_ID" =~ ^dep_[a-z0-9][a-z0-9-]{7,95}$ ]]
[[ "$GENERATION" =~ ^[1-9][0-9]*$ ]]
[[ "$PLAN_HASH" =~ ^[a-f0-9]{64}$ ]]
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]]
[[ "$EXPECTED_COMMIT" =~ ^[a-f0-9]{40}$ ]]
[[ "$EXPECTED_TREE" =~ ^[a-f0-9]{40}$ ]]
[[ "$EXPECTED_ARCHIVE_SHA256" =~ ^[a-f0-9]{64}$ ]]
[[ "$EXPECTED_MANIFEST_SHA256" =~ ^[a-f0-9]{64}$ ]]
[[ "$EXPECTED_SIGNING_KEY_SHA256" =~ ^[a-f0-9]{64}$ ]]
[[ "$EXPECTED_EXTRACTOR_SHA256" =~ ^[a-f0-9]{64}$ ]]
[[ "$EXPECTED_INSTALL_CLI_SHA256" =~ ^[a-f0-9]{64}$ ]]
test "$VERSION" != "0.2.1"
test "$VERSION" != "0.2.2"
test "$(id -u)" = "0" || {
  echo "ERROR: inactive adapter must execute as broker-authorized root" >&2
  exit 1
}
test -x "$NODE_PATH"
test "$($NODE_PATH -p 'process.versions.node')" = "24.18.0"
test -d "$STAGING_PATH"
test ! -L "$STAGING_PATH"
test "${EXTRACTOR#/}" != "$EXTRACTOR"
test -f "$EXTRACTOR"
test ! -L "$EXTRACTOR"
test "$(stat -c %u "$EXTRACTOR")" = "0"
test "$(sha256sum "$EXTRACTOR" | awk '{print $1}')" = "$EXPECTED_EXTRACTOR_SHA256"
test "${INSTALL_CLI#/}" != "$INSTALL_CLI"
test -f "$INSTALL_CLI"
test ! -L "$INSTALL_CLI"
test "$(stat -c %u "$INSTALL_CLI")" = "0"
test "$(sha256sum "$INSTALL_CLI" | awk '{print $1}')" = "$EXPECTED_INSTALL_CLI_SHA256"

ARCHIVE="$STAGING_PATH/baby-quirt-${VERSION}.tar.gz"
MANIFEST="$STAGING_PATH/baby-quirt-${VERSION}.manifest.json"
SBOM="$STAGING_PATH/baby-quirt-${VERSION}.spdx.json"
TEST_EVIDENCE="$STAGING_PATH/baby-quirt-${VERSION}.test-evidence.json"
SIGNING_PUBLIC_KEY="$STAGING_PATH/release-signing-public.pem"
EXTRACTED="$STAGING_PATH/extracted"

for required in "$ARCHIVE" "$MANIFEST" "$SBOM" "$TEST_EVIDENCE" "$SIGNING_PUBLIC_KEY"; do
  test -f "$required"
  test ! -L "$required"
done
test "$(sha256sum "$ARCHIVE" | awk '{print $1}')" = "$EXPECTED_ARCHIVE_SHA256"
test "$(sha256sum "$MANIFEST" | awk '{print $1}')" = "$EXPECTED_MANIFEST_SHA256"
test "$(sha256sum "$SIGNING_PUBLIC_KEY" | awk '{print $1}')" = "$EXPECTED_SIGNING_KEY_SHA256"
grep -q '^-----BEGIN PUBLIC KEY-----$' "$SIGNING_PUBLIC_KEY"
! grep -q 'PRIVATE KEY' "$SIGNING_PUBLIC_KEY"
test ! -e "$EXTRACTED"
python3 "$EXTRACTOR" "$ARCHIVE" "$EXTRACTED" "baby-quirt-$VERSION"
CANDIDATE_ROOT="$EXTRACTED/baby-quirt-$VERSION"

"$NODE_PATH" "$INSTALL_CLI" \
  --candidate-root "$CANDIDATE_ROOT" \
  --archive "$ARCHIVE" \
  --manifest "$MANIFEST" \
  --sbom "$SBOM" \
  --test-evidence "$TEST_EVIDENCE" \
  --signing-public-key "$SIGNING_PUBLIC_KEY" \
  --expected-version "$VERSION" \
  --expected-commit "$EXPECTED_COMMIT" \
  --expected-tree "$EXPECTED_TREE" \
  --release-root "$RELEASE_ROOT" \
  --owner-uid 0 \
  --owner-gid 0

printf '{"schemaVersion":"1.0.0","deploymentId":"%s","generation":%s,"planHash":"%s","product":"baby-quirt","version":"%s","inactive":true,"pointerChanged":false,"serviceChanged":false}\n' \
  "$DEPLOYMENT_ID" "$GENERATION" "$PLAN_HASH" "$VERSION"
