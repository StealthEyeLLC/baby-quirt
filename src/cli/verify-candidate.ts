#!/usr/bin/env node

import { assertExactOptions, parseLongOptions, requiredOption } from '../release/args.js';
import { verifyReleaseCandidate } from '../release/candidate.js';

async function main(): Promise<void> {
  const options = parseLongOptions(process.argv.slice(2));
  assertExactOptions(options, [
    '--candidate-root', '--archive', '--manifest', '--sbom', '--test-evidence',
    '--signing-public-key', '--expected-version', '--expected-commit', '--expected-tree',
  ]);
  const report = await verifyReleaseCandidate({
    candidateRoot: requiredOption(options, '--candidate-root'),
    archivePath: requiredOption(options, '--archive'),
    manifestPath: requiredOption(options, '--manifest'),
    sbomPath: requiredOption(options, '--sbom'),
    testEvidencePath: requiredOption(options, '--test-evidence'),
    signingPublicKeyPath: requiredOption(options, '--signing-public-key'),
    expectedVersion: requiredOption(options, '--expected-version'),
    expectedCommit: requiredOption(options, '--expected-commit'),
    expectedTree: requiredOption(options, '--expected-tree'),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
