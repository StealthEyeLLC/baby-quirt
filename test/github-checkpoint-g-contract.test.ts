import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { OPERATION_DEFINITIONS } from '../src/operations/definitions.js';

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const requiredDocs = [
  'README.md',
  'docs/ARCHITECTURE.md',
  'docs/SECURITY.md',
  'docs/USING_WITH_CHATGPT.md',
  'docs/RUNBOOK.md',
  'docs/GITHUB_AUTHORITY_CHECKPOINT_G_V1.md',
  'docs/GITHUB_AUTHORITY_OPERATION_REFERENCE_V1.md',
  'docs/GITHUB_AUTHORITY_CREDENTIALS_V1.md',
  'docs/GITHUB_AUTHORITY_RUNBOOK_V1.md',
];

function trackedFiles(): string[] {
  const result = spawnSync('/usr/bin/git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\0').filter(Boolean);
}

describe('Universal GitHub Authority Checkpoint G completion contract', () => {
  it('documents operations, credentials, authorization, GitHub App, deploy key, recovery, limits, CI, and future batch deployment', () => {
    const combined = requiredDocs.map(read).join('\n');
    for (const phrase of [
      'Operation Reference', 'credential reference', 'Repository authorization', 'GitHub App',
      'deploy key', 'Response loss', 'Rate-limit', 'Draft PR', 'exact-head CI',
      'batch-of-five', 'undeployed', 'call_quirt',
    ]) assert.match(combined, new RegExp(phrase, 'i'), phrase);
  });

  it('defines a source-only machine-readable batch entry', () => {
    const entry = JSON.parse(read('contracts/github-authority-batch-entry-v1.json')) as Record<string, unknown>;
    assert.equal(entry.capabilityId, 'universal-github-authority-v1');
    assert.equal(entry.checkpoint, 'G');
    assert.equal(entry.deploymentState, 'undeployed');
    assert.equal(entry.operationRegistration, 'deferred');
    assert.equal(entry.productionMutationAuthorized, false);
    assert.ok(Array.isArray(entry.requiredActivationGates));
  });

  it('adds explicit signed three-cycle nspawn evidence and real encrypted-credential injection', () => {
    const harness = read('ops/rehearsal/baby-quirt-host-certification.mjs');
    assert.match(harness, /github-authority-cycles\.json/);
    assert.match(harness, /successful-publication/);
    assert.match(harness, /response-loss-restart-reconciliation/);
    assert.match(harness, /failure-truth/);
    assert.match(harness, /LoadCredentialEncrypted=github-cert/);
    assert.match(harness, /reconciles lost response across database restart/);
  });

  it('keeps GitHub operations unregistered and does not create or modify a public tool file', () => {
    const runtime = OPERATION_DEFINITIONS.map((definition) => definition.operation);
    assert.equal(runtime.some((operation) => operation.startsWith('baby.github.')), false);
    assert.equal(runtime.some((operation) => operation.startsWith('baby.git.')), false);
    assert.equal(trackedFiles().some((path) => basename(path) === 'tool.js'), false);
  });
});
