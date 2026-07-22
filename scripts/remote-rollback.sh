#!/usr/bin/env bash
set -euo pipefail
echo "ERROR: Baby Quirt product scripts cannot roll back production; use the exact generation-bound deployment guard" >&2
exit 2
