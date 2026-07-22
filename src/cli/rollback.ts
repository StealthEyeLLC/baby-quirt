#!/usr/bin/env node
/** Retired product-owned rollback entrypoint. */

process.stderr.write(
  'Product-owned rollback is disabled. Use the fixed standalone Baby deployment controller with an exact signed deployment and snapshot identifier.\n',
);
process.exitCode = 64;
