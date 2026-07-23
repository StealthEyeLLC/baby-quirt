#!/usr/bin/env node
/** Retired unfenced repair entrypoint. */

process.stderr.write(
  'Unfenced product-owned repair is disabled. Use baby.release.repair through the fixed standalone controller.\n',
);
process.exitCode = 64;
