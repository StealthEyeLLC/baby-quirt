#!/usr/bin/env bash
# Rollback script — executed on the authorized VPS after a failed deployment.
set -euo pipefail

NODE_PATH="${BABY_QUIRT_NODE_PATH:-/opt/node-v24.18.0-linux-x64/bin/node}"
CURRENT_LINK="${BABY_QUIRT_CURRENT_LINK:-/opt/baby-quirt/current}"
PREVIOUS_LINK="${BABY_QUIRT_PREVIOUS_LINK:-/opt/baby-quirt/previous}"

if [ -L "$PREVIOUS_LINK" ] && [ -e "$(readlink -f "$PREVIOUS_LINK")" ]; then
  sudo "$NODE_PATH" "$(readlink -f "$CURRENT_LINK")/lib/dist/cli/rollback.js"
  sudo systemctl restart baby-quirt.socket baby-quirt.service
  sudo "$NODE_PATH" "$(readlink -f "$CURRENT_LINK")/lib/dist/cli/verify.js"
  echo "==> Rollback complete"
  exit 0
fi

# A first installation has no previous release. Leave the host fail-closed by
# stopping Baby Quirt and removing only the active pointer created by the failed run.
sudo systemctl stop baby-quirt.service baby-quirt.socket 2>/dev/null || true
sudo rm -f "$CURRENT_LINK"
echo "==> No previous release existed; failed first activation was disabled"
