#!/usr/bin/env node
/** Read-only repair assessment. All mutations are delegated to fixed Fix broker operations. */

import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULTS } from '../config.js';
import { readReleasePointer, POINTER_MUTATION_AUTHORITY } from '../install/symlinks.js';

interface Observation {
  path: string;
  exists: boolean;
  kind: 'file' | 'directory' | 'symlink' | 'other' | 'missing';
}

function observe(path: string): Observation {
  if (!existsSync(path)) return { path, exists: false, kind: 'missing' };
  const stat = lstatSync(path);
  return {
    path,
    exists: true,
    kind: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'other',
  };
}

function main(): void {
  const configRoot = process.env.BABY_QUIRT_CONFIG_ROOT ?? DEFAULTS.configRoot;
  const stateRoot = process.env.BABY_QUIRT_STATE_ROOT ?? DEFAULTS.stateRoot;
  const releaseRoot = process.env.BABY_QUIRT_RELEASE_ROOT ?? DEFAULTS.releaseRoot;
  const currentLink = process.env.BABY_QUIRT_CURRENT_LINK ?? DEFAULTS.currentLink;
  const observations = [
    observe(configRoot),
    observe(join(configRoot, 'runtime.json')),
    observe(join(configRoot, 'gateway-authority-public.pem')),
    observe(join(configRoot, 'supervisor-receipt-public.pem')),
    observe(join(configRoot, 'supervisor-receipt-private.pem')),
    observe(stateRoot),
    observe(releaseRoot),
  ];
  process.stdout.write(`${JSON.stringify({
    schemaVersion: '1.0.0',
    action: 'repair_assessment',
    apply: false,
    mutationAuthority: POINTER_MUTATION_AUTHORITY,
    observations,
    currentPointer: readReleasePointer(currentLink),
    requiredBrokerOperations: observations.filter((item) => !item.exists || item.kind === 'other').map((item) => ({
      operation: 'deployment.permissions.enforce',
      path: item.path,
    })),
  }, null, 2)}\n`);
}

main();
