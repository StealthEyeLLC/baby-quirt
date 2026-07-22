#!/usr/bin/env node
/** Strictly extract and verify one fixed-controller candidate package. */

import { loadControllerBuildRecord, verifyControllerCandidate } from '../src/controller/package.js';

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const result = await verifyControllerCandidate({
  archivePath: option('--archive'),
  buildRecord: loadControllerBuildRecord(option('--build-record')),
});
process.stdout.write(`${JSON.stringify({ verified: true, product: 'baby-quirt-controller', ...result })}\n`);
