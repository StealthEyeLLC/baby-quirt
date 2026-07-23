#!/usr/bin/env python3
"""Retired v1 bootstrap entrypoint; v2 uses the fixed Baby controller."""

import sys

print(
    "ERROR: standalone v2 candidates must be verified by the fixed Baby deployment controller",
    file=sys.stderr,
)
raise SystemExit(64)
