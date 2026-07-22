#!/usr/bin/env node

import { chmodSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertExactOptions, integerOption, parseLongOptions, requiredOption } from '../release/args.js';
import { createInternalReleaseManifest } from '../release/internal-manifest.js';

function main(): void {
  const options = parseLongOptions(process.argv.slice(2));
  assertExactOptions(options, ['--release-root', '--version', '--commit', '--tree', '--source-date-epoch']);
  const releaseRoot = resolve(requiredOption(options, '--release-root'));
  const manifest = createInternalReleaseManifest({
    version: requiredOption(options, '--version'),
    commit: requiredOption(options, '--commit'),
    tree: requiredOption(options, '--tree'),
    sourceDateEpoch: integerOption(options, '--source-date-epoch'),
  });
  const path = join(releaseRoot, 'manifest.json');
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o444, flag: 'wx' });
  chmodSync(path, 0o444);
  process.stdout.write(`${manifest.identityDigest}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
