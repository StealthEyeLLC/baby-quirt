#!/usr/bin/env bash
# Remote installation script — executed on VPS during deployment
set -euo pipefail

VERSION="${BABY_QUIRT_VERSION:?BABY_QUIRT_VERSION required}"
STAGING_PATH="${BABY_QUIRT_STAGING_PATH:?BABY_QUIRT_STAGING_PATH required}"
RELEASE_ROOT="${BABY_QUIRT_RELEASE_ROOT:-/opt/baby-quirt/releases}"
CURRENT_LINK="${BABY_QUIRT_CURRENT_LINK:-/opt/baby-quirt/current}"
PREVIOUS_LINK="${BABY_QUIRT_PREVIOUS_LINK:-/opt/baby-quirt/previous}"
CONFIG_ROOT="${BABY_QUIRT_CONFIG_ROOT:-/etc/baby-quirt}"
STATE_ROOT="${BABY_QUIRT_STATE_ROOT:-/var/lib/baby-quirt}"
NODE_PATH="${BABY_QUIRT_NODE_PATH:-/opt/node-v24.18.0-linux-x64/bin/node}"

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
if [ ! -f "$ARCHIVE" ]; then
  echo "ERROR: archive not found: $ARCHIVE"
  exit 1
fi

ACTUAL_DIGEST=$(sha256sum "$ARCHIVE" | awk '{print $1}')
EXPECTED_DIGEST=$(cat "baby-quirt-${VERSION}.sha256" | awk '{print $1}')
if [ "$ACTUAL_DIGEST" != "$EXPECTED_DIGEST" ]; then
  echo "ERROR: digest mismatch"
  exit 1
fi

echo "==> Extracting release"
TARGET="$RELEASE_ROOT/$VERSION"
sudo mkdir -p "$RELEASE_ROOT" "$CONFIG_ROOT" "$STATE_ROOT"
sudo rm -rf "$TARGET"
sudo tar -xzf "$ARCHIVE" -C "$RELEASE_ROOT"
sudo mv "$RELEASE_ROOT/baby-quirt-${VERSION}" "$TARGET" 2>/dev/null || true

# Generate signing keys on first install
if [ ! -f "$CONFIG_ROOT/signing-public.pem" ]; then
  echo "==> Generating signing keys"
  sudo "$NODE_PATH" "$TARGET/lib/dist/cli/install.js" --release-dir "$TARGET" --version "$VERSION"
else
  echo "==> Signing keys already exist, updating release pointer"
  if [ -L "$CURRENT_LINK" ]; then
    PREV=$(readlink -f "$CURRENT_LINK")
    sudo ln -sfn "$PREV" "$PREVIOUS_LINK"
  fi
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

echo "==> Installation complete: $VERSION"
