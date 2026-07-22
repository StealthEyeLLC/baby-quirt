#!/usr/bin/env node
/** CLI wrapper used by the one-shot bootstrap/certification lane. */

import { prepareNspawnInput } from '../src/rehearsal/nspawn-input.js';

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`${name} is required`);
  return value;
}

function main(): void {
  const known = new Set([
    '--run-id', '--requested-at', '--deadline', '--baby-repo', '--baby-commit',
    '--gateway-repo', '--gateway-commit', '--dependency-cache', '--bootstrap-record',
    '--output-root',
  ]);
  const args = process.argv.slice(2);
  if (args.length !== known.size * 2) throw new Error('exact nspawn input options are required');
  for (let index = 0; index < args.length; index += 2) {
    if (!known.has(args[index]!)) throw new Error(`unknown nspawn input option: ${args[index]}`);
  }
  const plan = prepareNspawnInput({
    runId: option('--run-id'),
    requestedAt: option('--requested-at'),
    deadline: option('--deadline'),
    babyRepositoryPath: option('--baby-repo'),
    babyCommit: option('--baby-commit'),
    gatewayRepositoryPath: option('--gateway-repo'),
    gatewayCommit: option('--gateway-commit'),
    dependencyCachePath: option('--dependency-cache'),
    bootstrapRecordPath: option('--bootstrap-record'),
    outputRoot: option('--output-root'),
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    runId: plan.runId,
    planDigest: plan.planDigest,
    babyCommit: plan.inputs.baby.commit,
    babyTree: plan.inputs.baby.tree,
    gatewayCommit: plan.inputs.gateway.commit,
    gatewayTree: plan.inputs.gateway.tree,
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: 'nspawn_input_invalid',
    message: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exitCode = 1;
}
