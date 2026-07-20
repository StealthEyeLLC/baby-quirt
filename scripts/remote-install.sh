#!/usr/bin/env bash
# Remote installation script — executed on VPS during deployment
set -euo pipefail

VERSION="${BABY_QUIRT_VERSION:?BABY_QUIRT_VERSION required}"
STAGING_PATH="${BABY_QUIRT_STAGING_PATH:?BABY_QUIRT_STAGING_PATH required}"
EXPECTED_COMMIT="${BABY_QUIRT_EXPECTED_COMMIT:?BABY_QUIRT_EXPECTED_COMMIT required}"
RELEASE_ROOT="${BABY_QUIRT_RELEASE_ROOT:-/opt/baby-quirt/releases}"
CURRENT_LINK="${BABY_QUIRT_CURRENT_LINK:-/opt/baby-quirt/current}"
PREVIOUS_LINK="${BABY_QUIRT_PREVIOUS_LINK:-/opt/baby-quirt/previous}"
CONFIG_ROOT="${BABY_QUIRT_CONFIG_ROOT:-/etc/baby-quirt}"
STATE_ROOT="${BABY_QUIRT_STATE_ROOT:-/var/lib/baby-quirt}"
NODE_PATH="${BABY_QUIRT_NODE_PATH:-/opt/node-v24.18.0-linux-x64/bin/node}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "ERROR: invalid version format: $VERSION"
  exit 1
fi

if [ "${#EXPECTED_COMMIT}" -ne 40 ]; then
  echo "ERROR: BABY_QUIRT_EXPECTED_COMMIT must be a 40-character SHA"
  exit 1
fi

echo "==> Verifying machine identity"
HOSTNAME=$(hostname)
EXPECTED_HOSTNAME="${BABY_QUIRT_EXPECTED_HOSTNAME:?}"
if [ "$HOSTNAME" != "$EXPECTED_HOSTNAME" ]; then
  echo "ERROR: hostname mismatch: got $HOSTNAME, expected $EXPECTED_HOSTNAME"
  exit 1
fi

MACHINE_ID_SHA256=$(sha256sum /etc/machine-id | awk '{print $1}')
EXPECTED_MACHINE_ID="${BABY_QUIRT_EXPECTED_MACHINE_ID_SHA256:?}"
if [ "$MACHINE_ID_SHA256" != "$EXPECTED_MACHINE_ID" ]; then
  echo "ERROR: machine-id mismatch"
  exit 1
fi

echo "==> Verifying release archive"
cd "$STAGING_PATH"
ARCHIVE="baby-quirt-${VERSION}.tar.gz"
MANIFEST="baby-quirt-${VERSION}.manifest.json"
if [ ! -f "$ARCHIVE" ]; then
  echo "ERROR: archive not found: $ARCHIVE"
  exit 1
fi
if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: manifest not found: $MANIFEST"
  exit 1
fi

ACTUAL_DIGEST=$(sha256sum "$ARCHIVE" | awk '{print $1}')
MANIFEST_DIGEST=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['sha256'])")
MANIFEST_VERSION=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['version'])")
MANIFEST_COMMIT=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['commit'])")

if [ "$MANIFEST_VERSION" != "$VERSION" ]; then
  echo "ERROR: manifest version mismatch"
  exit 1
fi
if [ "$ACTUAL_DIGEST" != "$MANIFEST_DIGEST" ]; then
  echo "ERROR: archive digest does not match manifest"
  exit 1
fi
if [ "$MANIFEST_COMMIT" != "$EXPECTED_COMMIT" ]; then
  echo "ERROR: manifest commit does not match expected commit"
  exit 1
fi

SHA_FILE="baby-quirt-${VERSION}.sha256"
if [ -f "$SHA_FILE" ]; then
  FILE_DIGEST=$(awk '{print $1}' "$SHA_FILE")
  if [ "$FILE_DIGEST" != "$ACTUAL_DIGEST" ]; then
    echo "ERROR: sidecar digest does not match archive"
    exit 1
  fi
fi

echo "==> Extracting release with safe extractor"
STAGE_EXTRACT="$STAGING_PATH/extracted-${VERSION}"
rm -rf "$STAGE_EXTRACT"
mkdir -p "$STAGE_EXTRACT"
"$NODE_PATH" -e "
import { safeExtractTarGz } from './lib/dist/install/safe-extract.js';
await safeExtractTarGz('$ARCHIVE', '$STAGE_EXTRACT', 'baby-quirt-${VERSION}');
" 2>/dev/null || sudo "$NODE_PATH" "$CURRENT_LINK/lib/dist/cli/install.js" --archive "$STAGING_PATH/$ARCHIVE" --version "$VERSION"

EXTRACTED_DIR="$STAGE_EXTRACT/baby-quirt-${VERSION}"
if [ ! -d "$EXTRACTED_DIR" ]; then
  echo "ERROR: extracted release directory missing"
  exit 1
fi

TARGET="$RELEASE_ROOT/$VERSION"
sudo mkdir -p "$RELEASE_ROOT" "$CONFIG_ROOT" "$STATE_ROOT"
sudo rm -rf "$TARGET"
sudo cp -a "$EXTRACTED_DIR" "$TARGET"

if [ ! -f "$CONFIG_ROOT/gateway-authority-public.pem" ]; then
  echo "ERROR: gateway authority public key must be installed before deployment"
  exit 1
fi

if [ ! -f "$CONFIG_ROOT/supervisor-receipt-public.pem" ]; then
  echo "==> Generating supervisor receipt keys on host"
  sudo "$NODE_PATH" "$TARGET/lib/dist/cli/install.js" --release-dir "$TARGET" --version "$VERSION"
else
  echo "==> Supervisor receipt keys already exist, updating release pointer"
  if [ -L "$CURRENT_LINK" ]; then
    PREV=$(readlink -f "$CURRENT_LINK")
    sudo rm -f "$PREVIOUS_LINK"
    sudo ln -sfn "$PREV" "$PREVIOUS_LINK"
  fi
  sudo rm -f "$CURRENT_LINK"
  sudo ln -sfn "$TARGET" "$CURRENT_LINK"
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
sudo "$NODE_PATH" "$TARGET/lib/dist/cli/verify.js"

echo "==> Installation complete"
echo "DEPLOY_VERSION=$VERSION"
echo "DEPLOY_DIGEST=$ACTUAL_DIGEST"
echo "DEPLOY_COMMIT=$MANIFEST_COMMIT"
