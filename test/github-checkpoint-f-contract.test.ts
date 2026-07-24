import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { OPERATION_DEFINITIONS } from '../src/operations/definitions.js';

const contractPath = join(import.meta.dirname, '..', 'contracts', 'github-authority-checkpoint-f-v1.json');
const documentPath = join(import.meta.dirname, '..', 'docs', 'GITHUB_AUTHORITY_CHECKPOINT_F_V1.md');

describe('Universal GitHub Authority Checkpoint F contract', () => {
  it('records the exact source-only provider and compound publication boundary', () => {
    const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as {
      checkpoint: string;
      checkpointBaseCommit: string;
      implementationStatus: string;
      persistence: { migrationVersion: number; tables: string[] };
      focusedVerification: { tests: number; passed: number; failed: number };
      boundaries: Record<string, boolean>;
    };
    assert.equal(contract.checkpoint, 'F');
    assert.equal(contract.checkpointBaseCommit, '9302c444c7a44ca7ecb29e8f403a05ae205451b8');
    assert.equal(contract.implementationStatus, 'source_complete_unregistered');
    assert.equal(contract.persistence.migrationVersion, 6);
    assert.deepEqual(contract.persistence.tables, ['github_provider_runs', 'github_provider_events']);
    assert.deepEqual(contract.focusedVerification, { tests: 6, suites: 1, passed: 6, failed: 0, cases: [
      'immutable intent replay and changed-intent rejection',
      'lost pull-request response reconciliation without duplicate write',
      'workflow completion replay and exact-source artifact capture',
      'complete push/PR/workflow/artifact publication replay',
      'partial success after verified push without duplicate push',
      'active runtime registry remains unchanged',
    ], testFile: 'test/github-provider-delivery.test.ts' });
    assert.equal(contract.boundaries.sourceOnly, true);
    assert.equal(contract.boundaries.runtimeOperationsRegistered, false);
    assert.equal(contract.boundaries.publicToolChanged, false);
    assert.equal(contract.boundaries.toolJsChanged, false);
    assert.equal(contract.boundaries.providerDeployed, false);
    assert.equal(contract.boundaries.productionStateMutated, false);
    assert.equal(contract.boundaries.merged, false);
    const runtime = new Set(OPERATION_DEFINITIONS.map((definition) => definition.operation));
    assert.equal([...runtime].some((operation) => operation.startsWith('baby.github.')), false);
  });

  it('documents durable replay, partial success, and the unchanged G3 boundary', () => {
    const document = readFileSync(documentPath, 'utf8');
    assert.match(document, /source-complete, unregistered, and undeployed/u);
    assert.match(document, /partialSuccess: true/u);
    assert.match(document, /does not repeat the already verified push/u);
    assert.match(document, /G3 coverage ledger remains scoped to local Git/u);
  });
});
