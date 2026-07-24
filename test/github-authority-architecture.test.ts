import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import {
  GITHUB_AUTHORITY_CONTRACT_BUNDLE,
  GITHUB_AUTHORITY_NON_DUPLICATION_RULES,
  GITHUB_AUTHORITY_OPERATION_NAMES,
} from '../src/github/contracts.js';
import {
  CANONICAL_BBY_ACTION_DESCRIPTION,
  CANONICAL_BBY_TOOL,
} from '../src/operations/definitions.js';
import { OPERATIONS } from '../src/operations/registry.js';

const root = join(import.meta.dirname, '..');
const checkpointPaths = [
  'src/github/contracts.ts',
  'scripts/export-github-authority-contracts.ts',
  'contracts/github-authority-contracts-v1.json',
  'schemas/github-authority-contracts-v1.schema.json',
  'docs/adr/0002-universal-github-authority-v1.md',
  'docs/GITHUB_AUTHORITY_CAPABILITY_MATRIX_V1.md',
];

function allFilesBelow(path: string): string[] {
  const absolute = join(root, path);
  if (!statSync(absolute).isDirectory()) return [absolute];
  const result: string[] = [];
  for (const name of readdirSync(absolute)) {
    const child = join(absolute, name);
    if (statSync(child).isDirectory()) result.push(...allFilesBelow(relative(root, child)));
    else result.push(child);
  }
  return result;
}

describe('Universal GitHub Authority architecture boundary', () => {
  it('preserves exactly one public call_quirt tool contract', () => {
    assert.equal(CANONICAL_BBY_TOOL, 'bbyquirt.call_quirt');
    assert.ok(CANONICAL_BBY_ACTION_DESCRIPTION.includes('single authenticated Baby Quirt interface'));
    assert.equal(GITHUB_AUTHORITY_CONTRACT_BUNDLE.publicTool, 'call_quirt');
    assert.deepEqual(GITHUB_AUTHORITY_CONTRACT_BUNDLE.publicArguments, [
      'operation',
      'payload',
      'idempotencyKey',
    ]);
  });

  it('does not advertise contract-only operations in runtime discovery', () => {
    const executable = new Set(OPERATIONS);
    for (const operation of GITHUB_AUTHORITY_OPERATION_NAMES) {
      assert.equal(executable.has(operation), false, operation);
    }
  });

  it('does not add or modify a tool.js file', () => {
    const exactToolBasenames = allFilesBelow('.').filter((file) => file.endsWith('/tool.js'));
    assert.deepEqual(exactToolBasenames, []);
  });

  it('freezes all non-duplication rules', () => {
    assert.deepEqual(GITHUB_AUTHORITY_NON_DUPLICATION_RULES, [
      'one_public_call_quirt_tool',
      'existing_baby_scheduler_only',
      'existing_baby_job_database_only',
      'existing_baby_artifact_store_only',
      'receipt_v2_only',
      'existing_private_unix_socket_only',
      'no_gateway_owned_git_controller',
      'no_fix_dependency',
      'no_old_operator_dependency',
      'no_routine_ssh_or_termius_dependency',
    ]);
  });

  it('introduces no second execution, persistence, artifact, receipt, service, or socket lane', () => {
    const forbiddenPathPatterns = [
      /(?:^|\/)git-state\.sqlite$/u,
      /(?:^|\/)github-state\.sqlite$/u,
      /(?:^|\/)scheduler(?:\.|\/)/u,
      /(?:^|\/)artifact-store(?:\.|\/)/u,
      /(?:^|\/)receipt-v3(?:\.|\/)/u,
      /(?:^|\/)systemd(?:\.|\/)/u,
      /\.service$/u,
      /\.socket$/u,
    ];
    for (const path of checkpointPaths) {
      for (const pattern of forbiddenPathPatterns) assert.doesNotMatch(path, pattern, `${path}: ${pattern}`);
    }
  });

  it('contains no executable dependency on Fix or the old operator', () => {
    const executableCheckpointFiles = [
      join(root, 'src/github/contracts.ts'),
      join(root, 'scripts/export-github-authority-contracts.ts'),
    ];
    const forbidden = [
      /StealthEyeLLC\/(?:fix|stealtheye-fix-operator)/iu,
      /privilege-broker\.sock/iu,
      /\/run\/fix\//u,
    ];
    for (const file of executableCheckpointFiles) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbidden) assert.doesNotMatch(content, pattern, `${relative(root, file)}: ${pattern}`);
    }
  });

  it('requires external readback instead of trusting local push exit status', () => {
    const pushApply = GITHUB_AUTHORITY_CONTRACT_BUNDLE.operations.find(
      (entry) => entry.operation === 'baby.git.push.apply',
    );
    const pushVerify = GITHUB_AUTHORITY_CONTRACT_BUNDLE.operations.find(
      (entry) => entry.operation === 'baby.git.push.verify',
    );
    const compound = GITHUB_AUTHORITY_CONTRACT_BUNDLE.operations.find(
      (entry) => entry.operation === 'baby.github.delivery.publish',
    );
    assert.ok(pushApply?.mutation);
    assert.ok(pushVerify && !pushVerify.mutation);
    assert.ok(compound?.permissionFamilies.includes('github.repository.metadata'));
    assert.equal(GITHUB_AUTHORITY_CONTRACT_BUNDLE.ownership.externalStateVerification, 'baby_quirt_provider_readback');
  });
});
