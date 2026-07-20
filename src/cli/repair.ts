#!/usr/bin/env node
/** Baby Quirt repair — fixes permissions, state dirs, and socket. */

import { mkdirSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DEFAULTS } from '../config.js';

function main(): void {
  const repairs: string[] = [];
  const configRoot = process.env.BABY_QUIRT_CONFIG_ROOT ?? DEFAULTS.configRoot;
  const stateRoot = process.env.BABY_QUIRT_STATE_ROOT ?? DEFAULTS.stateRoot;
  const releaseRoot = process.env.BABY_QUIRT_RELEASE_ROOT ?? DEFAULTS.releaseRoot;
  const currentLink = process.env.BABY_QUIRT_CURRENT_LINK ?? DEFAULTS.currentLink;
  const socketPath = process.env.BABY_QUIRT_SOCKET_PATH ?? DEFAULTS.socketPath;

  // Ensure directories
  for (const dir of [
    configRoot,
    stateRoot,
    releaseRoot,
    join(stateRoot, 'jobs'),
    join(stateRoot, 'streams'),
    join(stateRoot, 'pty'),
    join(stateRoot, 'artifacts'),
    dirname(socketPath),
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o750 });
      repairs.push(`Created directory: ${dir}`);
    }
  }

  const pubKey = join(configRoot, 'gateway-authority-public.pem');
  const receiptPub = join(configRoot, 'supervisor-receipt-public.pem');
  const receiptPriv = join(configRoot, 'supervisor-receipt-private.pem');
  if (existsSync(pubKey)) {
    chmodSync(pubKey, 0o644);
    repairs.push('Fixed gateway authority public key permissions');
  }
  if (existsSync(receiptPub)) {
    chmodSync(receiptPub, 0o644);
    repairs.push('Fixed supervisor receipt public key permissions');
  }
  if (existsSync(receiptPriv)) {
    chmodSync(receiptPriv, 0o600);
    repairs.push('Fixed supervisor receipt private key permissions');
  }

  // Verify current release link
  if (!existsSync(currentLink)) {
    repairs.push('WARNING: current release link missing — manual intervention required');
  }

  // Check runtime config
  const configPath = join(configRoot, 'runtime.json');
  if (existsSync(configPath)) {
    try {
      JSON.parse(readFileSync(configPath, 'utf8'));
      repairs.push('Runtime config valid');
    } catch {
      repairs.push('WARNING: runtime config is corrupt');
    }
  } else {
    repairs.push('WARNING: runtime config missing');
  }

  console.log(JSON.stringify({
    action: 'repair',
    repairs,
    timestamp: new Date().toISOString(),
  }, null, 2));
}

main();
