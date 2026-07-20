#!/usr/bin/env bash
# Remote installation script — executed on the authorized VPS during deployment.
set -euo pipefail

VERSION="${BABY_QUIRT_VERSION:?BABY_QUIRT_VERSION required}"
STAGING_PATH="${BABY_QUIRT_STAGING_PATH:?BABY_QUIRT_STAGING_PATH required}"
EXPECTED_COMMIT="${BABY_QUIRT_EXPECTED_COMMIT:?BABY_QUIRT_EXPECTED_COMMIT required}"
EXPECTED_HOSTNAME="${BABY_QUIRT_EXPECTED_HOSTNAME:?BABY_QUIRT_EXPECTED_HOSTNAME required}"
EXPECTED_MACHINE_ID="${BABY_QUIRT_EXPECTED_MACHINE_ID_SHA256:?BABY_QUIRT_EXPECTED_MACHINE_ID_SHA256 required}"
EXPECTED_GATEWAY_KEY_SHA256="${BABY_QUIRT_EXPECTED_GATEWAY_PUBLIC_KEY_SHA256:?BABY_QUIRT_EXPECTED_GATEWAY_PUBLIC_KEY_SHA256 required}"
RELEASE_ROOT="${BABY_QUIRT_RELEASE_ROOT:-/opt/baby-quirt/releases}"
CURRENT_LINK="${BABY_QUIRT_CURRENT_LINK:-/opt/baby-quirt/current}"
PREVIOUS_LINK="${BABY_QUIRT_PREVIOUS_LINK:-/opt/baby-quirt/previous}"
CONFIG_ROOT="${BABY_QUIRT_CONFIG_ROOT:-/etc/baby-quirt}"
STATE_ROOT="${BABY_QUIRT_STATE_ROOT:-/var/lib/baby-quirt}"
NODE_PATH="${BABY_QUIRT_NODE_PATH:-/opt/node-v24.18.0-linux-x64/bin/node}"
SOCKET_GROUP="${BABY_QUIRT_SOCKET_GROUP:-horsey}"
GATEWAY_USER="${BABY_QUIRT_GATEWAY_USER:-fix-mcp}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "ERROR: invalid version format: $VERSION" >&2
  exit 1
fi
if [[ ! "$EXPECTED_COMMIT" =~ ^[a-f0-9]{40}$ ]]; then
  echo "ERROR: BABY_QUIRT_EXPECTED_COMMIT must be a lowercase 40-character SHA" >&2
  exit 1
fi
if [[ ! "$EXPECTED_MACHINE_ID" =~ ^[a-f0-9]{64}$ ]]; then
  echo "ERROR: expected machine-id digest must be a lowercase SHA-256" >&2
  exit 1
fi
if [[ ! "$EXPECTED_GATEWAY_KEY_SHA256" =~ ^[a-f0-9]{64}$ ]]; then
  echo "ERROR: expected gateway public-key digest must be a lowercase SHA-256" >&2
  exit 1
fi
if [ "$STAGING_PATH" != "/tmp/baby-quirt-deploy-$VERSION" ]; then
  echo "ERROR: unexpected staging path: $STAGING_PATH" >&2
  exit 1
fi
if [ ! -x "$NODE_PATH" ]; then
  echo "ERROR: pinned Node runtime is unavailable: $NODE_PATH" >&2
  exit 1
fi
for command in python3 sha256sum sudo systemctl getent id; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "ERROR: required command is unavailable: $command" >&2
    exit 1
  }
done
sudo -n true >/dev/null 2>&1 || {
  echo "ERROR: passwordless sudo is required for deployment" >&2
  exit 1
}
getent group "$SOCKET_GROUP" >/dev/null || {
  echo "ERROR: required socket group is missing: $SOCKET_GROUP" >&2
  exit 1
}
id -u "$GATEWAY_USER" >/dev/null 2>&1 || {
  echo "ERROR: required gateway user is missing: $GATEWAY_USER" >&2
  exit 1
}
if ! id -nG "$GATEWAY_USER" | tr ' ' '\n' | grep -Fxq "$SOCKET_GROUP"; then
  echo "ERROR: $GATEWAY_USER is not a member of $SOCKET_GROUP" >&2
  exit 1
fi

echo "==> Verifying machine identity"
ACTUAL_HOSTNAME=$(hostname)
if [ "$ACTUAL_HOSTNAME" != "$EXPECTED_HOSTNAME" ]; then
  echo "ERROR: hostname mismatch: got $ACTUAL_HOSTNAME, expected $EXPECTED_HOSTNAME" >&2
  exit 1
fi
MACHINE_ID_SHA256=$(tr -d '\r\n' </etc/machine-id | sha256sum | awk '{print $1}')
if [ "$MACHINE_ID_SHA256" != "$EXPECTED_MACHINE_ID" ]; then
  echo "ERROR: machine-id mismatch" >&2
  exit 1
fi

cd "$STAGING_PATH"
ARCHIVE="baby-quirt-${VERSION}.tar.gz"
SHA_FILE="baby-quirt-${VERSION}.sha256"
MANIFEST="baby-quirt-${VERSION}.manifest.json"
EXTRACTOR="bootstrap-safe-extract.py"
GATEWAY_PUBLIC_KEY="gateway-authority-public.pem"

for required in "$ARCHIVE" "$SHA_FILE" "$MANIFEST" "$EXTRACTOR" "$GATEWAY_PUBLIC_KEY"; do
  if [ ! -f "$required" ] || [ -L "$required" ]; then
    echo "ERROR: required regular staging file is missing: $required" >&2
    exit 1
  fi
done

echo "==> Verifying release archive"
ACTUAL_DIGEST=$(sha256sum "$ARCHIVE" | awk '{print $1}')
FILE_DIGEST=$(awk 'NF {print $1; exit}' "$SHA_FILE")
MANIFEST_DIGEST=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['sha256'])")
MANIFEST_VERSION=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['version'])")
MANIFEST_COMMIT=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['commit'])")

if [ "$MANIFEST_VERSION" != "$VERSION" ]; then
  echo "ERROR: manifest version mismatch" >&2
  exit 1
fi
if [ "$ACTUAL_DIGEST" != "$MANIFEST_DIGEST" ] || [ "$ACTUAL_DIGEST" != "$FILE_DIGEST" ]; then
  echo "ERROR: release digest mismatch" >&2
  exit 1
fi
if [ "$MANIFEST_COMMIT" != "$EXPECTED_COMMIT" ]; then
  echo "ERROR: manifest commit does not match expected commit" >&2
  exit 1
fi

GATEWAY_KEY_SHA256=$(sha256sum "$GATEWAY_PUBLIC_KEY" | awk '{print $1}')
if [ "$GATEWAY_KEY_SHA256" != "$EXPECTED_GATEWAY_KEY_SHA256" ]; then
  echo "ERROR: gateway public-key digest mismatch" >&2
  exit 1
fi
if ! grep -q '^-----BEGIN PUBLIC KEY-----$' "$GATEWAY_PUBLIC_KEY" || \
   grep -q 'PRIVATE KEY' "$GATEWAY_PUBLIC_KEY"; then
  echo "ERROR: staged gateway authority material is not a public key" >&2
  exit 1
fi

TARGET="$RELEASE_ROOT/$VERSION"
if sudo test -e "$TARGET"; then
  echo "ERROR: immutable release target already exists: $TARGET" >&2
  exit 1
fi

STAGE_EXTRACT="$STAGING_PATH/extracted-$VERSION"
rm -rf "$STAGE_EXTRACT"
mkdir -p "$STAGE_EXTRACT"
echo "==> Extracting release with bootstrap-safe extractor"
python3 "$EXTRACTOR" "$ARCHIVE" "$STAGE_EXTRACT" "baby-quirt-$VERSION"
EXTRACTED_DIR="$STAGE_EXTRACT/baby-quirt-$VERSION"

for required in \
  "$EXTRACTED_DIR/bin/baby-quirt-daemon" \
  "$EXTRACTED_DIR/lib/dist/cli/install.js" \
  "$EXTRACTED_DIR/lib/dist/cli/verify.js" \
  "$EXTRACTED_DIR/ops/systemd/baby-quirt.socket" \
  "$EXTRACTED_DIR/ops/systemd/baby-quirt.service" \
  "$EXTRACTED_DIR/ops/tmpfiles/baby-quirt.conf" \
  "$EXTRACTED_DIR/manifest.json"; do
  if [ ! -f "$required" ] || [ -L "$required" ]; then
    echo "ERROR: extracted release file is missing or unsafe: $required" >&2
    exit 1
  fi
done

INTERNAL_VERSION=$(python3 -c "import json; print(json.load(open('$EXTRACTED_DIR/manifest.json'))['version'])")
INTERNAL_COMMIT=$(python3 -c "import json; print(json.load(open('$EXTRACTED_DIR/manifest.json'))['commit'])")
if [ "$INTERNAL_VERSION" != "$VERSION" ] || [ "$INTERNAL_COMMIT" != "$EXPECTED_COMMIT" ]; then
  echo "ERROR: internal release manifest mismatch" >&2
  exit 1
fi

echo "==> Installing gateway authority public key"
sudo mkdir -p "$CONFIG_ROOT"
if sudo test -f "$CONFIG_ROOT/gateway-authority-public.pem"; then
  INSTALLED_GATEWAY_SHA256=$(sudo sha256sum "$CONFIG_ROOT/gateway-authority-public.pem" | awk '{print $1}')
  if [ "$INSTALLED_GATEWAY_SHA256" != "$EXPECTED_GATEWAY_KEY_SHA256" ]; then
    echo "ERROR: installed gateway authority public key differs from the pinned key" >&2
    exit 1
  fi
else
  sudo install -o root -g root -m 0644 "$GATEWAY_PUBLIC_KEY" "$CONFIG_ROOT/gateway-authority-public.pem"
fi

echo "==> Installing immutable release"
sudo env \
  BABY_QUIRT_RELEASE_ROOT="$RELEASE_ROOT" \
  BABY_QUIRT_CURRENT_LINK="$CURRENT_LINK" \
  BABY_QUIRT_PREVIOUS_LINK="$PREVIOUS_LINK" \
  BABY_QUIRT_CONFIG_ROOT="$CONFIG_ROOT" \
  BABY_QUIRT_STATE_ROOT="$STATE_ROOT" \
  BABY_QUIRT_EXPECTED_HOSTNAME="$EXPECTED_HOSTNAME" \
  BABY_QUIRT_EXPECTED_MACHINE_ID_SHA256="$EXPECTED_MACHINE_ID" \
  BABY_QUIRT_OWNER_PRINCIPAL_FINGERPRINT="$EXPECTED_GATEWAY_KEY_SHA256" \
  "$NODE_PATH" "$EXTRACTED_DIR/lib/dist/cli/install.js" \
  --release-dir "$EXTRACTED_DIR" \
  --version "$VERSION"

if [ "$(readlink -f "$CURRENT_LINK")" != "$TARGET" ]; then
  echo "ERROR: current release pointer did not activate the expected target" >&2
  exit 1
fi

echo "==> Installing systemd units"
sudo cp "$TARGET/ops/systemd/baby-quirt.socket" /etc/systemd/system/
sudo cp "$TARGET/ops/systemd/baby-quirt.service" /etc/systemd/system/
sudo cp "$TARGET/ops/tmpfiles/baby-quirt.conf" /etc/tmpfiles.d/baby-quirt.conf
sudo systemd-tmpfiles --create /etc/tmpfiles.d/baby-quirt.conf
sudo systemctl daemon-reload
sudo systemctl enable baby-quirt.socket
sudo systemctl restart baby-quirt.socket baby-quirt.service

echo "==> Verifying installation"
sleep 2
sudo env \
  BABY_QUIRT_EXPECTED_MACHINE_ID_SHA256="$EXPECTED_MACHINE_ID" \
  "$NODE_PATH" "$TARGET/lib/dist/cli/verify.js"

echo "==> Installation complete"
echo "DEPLOY_VERSION=$VERSION"
echo "DEPLOY_DIGEST=$ACTUAL_DIGEST"
echo "DEPLOY_COMMIT=$MANIFEST_COMMIT"
