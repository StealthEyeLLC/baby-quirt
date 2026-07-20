#!/usr/bin/env node
/** Baby Quirt rollback — restores previous release pointer. */

import { DEFAULTS } from '../config.js';
import { rollbackSymlinks } from '../install/symlinks.js';

function main(): void {
  const result = rollbackSymlinks(DEFAULTS.currentLink, DEFAULTS.previousLink);

  console.log(JSON.stringify({
    action: 'rollback',
    current: result.current,
    previous: result.previous,
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log('Run: systemctl restart baby-quirt.service');
}

main();
