import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  G3_CAPABILITY_COVERAGE,
  G3_CAPABILITY_COVERAGE_BUNDLE,
  G3_CAPABILITY_GROUPS,
  G3_COVERAGE_STATUSES,
} from '../src/github/g3-capability-catalog.js';
import {
  G3_WORKING_TREE_CONTRACT_BUNDLE,
  G3_WORKING_TREE_OPERATION_NAMES,
} from '../src/github/working-tree-contracts.js';
import { OPERATION_DEFINITIONS } from '../src/operations/definitions.js';

const ledgerPath = join(import.meta.dirname, '..', 'contracts', 'github-authority-g3-coverage-v1.json');

describe('Universal GitHub Authority G3 coverage', () => {
  it('covers every canonical section 6.1 through 6.17 operation exactly once', () => {
    assert.equal(Object.keys(G3_CAPABILITY_GROUPS).length, 17);
    assert.ok(G3_CAPABILITY_COVERAGE.length > 150);
    const operations = G3_CAPABILITY_COVERAGE.map((entry) => entry.operation);
    assert.equal(new Set(operations).size, operations.length);
    assert.ok(operations.every((operation) => /^baby\.git\.[a-z0-9._-]+$/u.test(operation)));
    assert.ok(G3_CAPABILITY_COVERAGE.every((entry) => G3_COVERAGE_STATUSES.includes(entry.status)));
    assert.ok(G3_CAPABILITY_COVERAGE.every((entry) => entry.registered === false && entry.deployed === false));
    assert.equal(G3_CAPABILITY_COVERAGE_BUNDLE.complete, false);
    assert.equal(G3_CAPABILITY_COVERAGE_BUNDLE.publicToolChanged, false);
    assert.equal(G3_CAPABILITY_COVERAGE_BUNDLE.toolJsChanged, false);
    assert.equal(G3_CAPABILITY_COVERAGE_BUNDLE.providerDeployed, false);
  });

  it('matches the committed deterministic machine-readable ledger exactly', () => {
    const committed = JSON.parse(readFileSync(ledgerPath, 'utf8')) as unknown;
    assert.deepEqual(committed, G3_CAPABILITY_COVERAGE_BUNDLE);
  });

  it('truthfully classifies the working-tree checkpoint as implemented but unregistered', () => {
    const entries = new Map(G3_CAPABILITY_COVERAGE.map((entry) => [entry.operation, entry]));
    for (const operation of G3_WORKING_TREE_OPERATION_NAMES) {
      assert.equal(entries.get(operation)?.status, 'implemented_but_not_registered');
    }
    assert.equal(entries.get('baby.git.add.patch')?.status, 'intentionally_deferred');
    assert.equal(entries.get('baby.git.force_with_lease.apply')?.status, 'partially_implemented');
    assert.equal(entries.get('baby.git.describe')?.status, 'contract_only');
  });

  it('keeps the stable public tool and active runtime registry unchanged', () => {
    assert.equal(G3_WORKING_TREE_CONTRACT_BUNDLE.publicTool, 'call_quirt');
    assert.deepEqual(G3_WORKING_TREE_CONTRACT_BUNDLE.publicArguments, [
      'operation', 'payload', 'idempotencyKey',
    ]);
    assert.equal(G3_WORKING_TREE_CONTRACT_BUNDLE.publicToolChanged, false);
    assert.equal(G3_WORKING_TREE_CONTRACT_BUNDLE.toolJsChanged, false);
    assert.equal(G3_WORKING_TREE_CONTRACT_BUNDLE.deployed, false);
    const runtime = new Set(OPERATION_DEFINITIONS.map((definition) => definition.operation));
    for (const operation of G3_WORKING_TREE_OPERATION_NAMES) assert.equal(runtime.has(operation), false);
  });

  it('provides strict input schemas and observed-state safety for staging', () => {
    assert.equal(G3_WORKING_TREE_OPERATION_NAMES.length, 7);
    for (const contract of G3_WORKING_TREE_CONTRACT_BUNDLE.operations) {
      assert.equal(contract.inputSchema.additionalProperties, false);
      assert.equal(contract.executable, false);
      assert.equal(contract.support, 'implemented_but_not_registered');
    }
    const add = G3_WORKING_TREE_CONTRACT_BUNDLE.operations.find(
      (contract) => contract.operation === 'baby.git.add',
    );
    assert.ok(add);
    assert.equal(add.idempotency, 'observed_state_precondition');
    assert.ok(add.safety.includes('exact_observed_head'));
    assert.ok(add.safety.includes('exact_observed_status_digest'));
    assert.ok(add.safety.includes('post_stage_readback'));
  });
});
