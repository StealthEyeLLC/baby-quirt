#!/usr/bin/env node
/** Baby Quirt cannot roll back its own production deployment. */

process.stderr.write(
  'ERROR: production rollback is owned by the generation-bound StealthEye deployment guard through the Fix privilege broker\n',
);
process.exitCode = 2;
