#!/usr/bin/env node

import { assertExactOptions, parseLongOptions, requiredOption } from '../release/args.js';
import {
  createTestEvidence,
  readGateResults,
  writeTestEvidence,
} from '../release/test-evidence.js';

function main(): void {
  const options = parseLongOptions(process.argv.slice(2));
  assertExactOptions(options, ['--gate-results', '--output', '--source-commit', '--source-tree']);
  const evidence = createTestEvidence({
    sourceCommit: requiredOption(options, '--source-commit'),
    sourceTree: requiredOption(options, '--source-tree'),
    suites: readGateResults(requiredOption(options, '--gate-results')),
  });
  writeTestEvidence(requiredOption(options, '--output'), evidence);
  process.stdout.write(`${evidence.requiredGateDigest}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
