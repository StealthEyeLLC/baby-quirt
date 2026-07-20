#!/usr/bin/env bash
# Rollback script — executed on VPS
set -euo pipefail

NODE_PATH="${BABY_QUIRT_NODE_PATH:-/opt/node-v24.18.0-linux-x64/bin/node}"
CURRENT_LINK="${BABY_QUIRT_CURRENT_LINK:-/opt/baby-quirt/current}"

sudo "$NODE_PATH" "$(readlink -f "$CURRENT_LINK")/lib/dist/cli/rollback.js"
sudo systemctl restart baby-quirt.service
sudo "$NODE_PATH" "$(readlink -f "$CURRENT_LINK")/lib/dist/cli/verify.js"

echo "==> Rollback complete"
