#!/usr/bin/env node
/** Baby Quirt rollback — restores previous release pointer. */

import { existsSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { DEFAULTS } from '../config.js';

function main(): void {
  const currentLink = DEFAULTS.currentLink;
  const previousLink = DEFAULTS.previousLink;

  if (!existsSync(previousLink)) {
    console.error('No previous release to roll back to');
    process.exit(1);
  }

  const previousTarget = readlinkSync(previousLink);
  const currentTarget = existsSync(currentLink) ? readlinkSync(currentLink) : null;

  if (existsSync(currentLink)) {
    unlinkSync(currentLink);
  }
  symlinkSync(previousTarget, currentLink);

  if (currentTarget) {
    if (existsSync(previousLink)) unlinkSync(previousLink);
    symlinkSync(currentTarget, previousLink);
  }

  console.log(JSON.stringify({
    action: 'rollback',
    current: previousTarget,
    previous: currentTarget,
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log('Run: systemctl restart baby-quirt.service');
}

main();
