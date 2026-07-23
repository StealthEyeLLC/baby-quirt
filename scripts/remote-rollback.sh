#!/usr/bin/env bash
# Retired v1 SSH rollback. Standalone v2 uses the reboot-persistent Baby guard.
set -euo pipefail
echo "ERROR: remote rollback is superseded by the standalone Baby deployment guard" >&2
exit 64
