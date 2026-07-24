import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  GITHUB_AUTHORITY_CAPABILITY_MATRIX,
  GITHUB_AUTHORITY_CONTRACT_BUNDLE,
  GITHUB_AUTHORITY_EXCLUSIONS,
  GITHUB_AUTHORITY_MODEL_SCHEMAS,
  GITHUB_AUTHORITY_OPERATION_CONTRACTS,
  GITHUB_AUTHORITY_OPERATION_NAMES,
  GITHUB_AUTHORITY_TYPED_ERRORS,
  GITHUB_MUTATION_STATES,
  GITHUB_MUTATION_TRANSITIONS,
} from '../src/github/contracts.js';
import { OPERATIONS } from '../src/operations/registry.js';

const root = join(import.meta.dirname, '..');
const generated = JSON.parse(
  readFileSync(join(root, 'contracts/github-authority-contracts-v1.json'), 'utf8'),
) as unknown;

const expectedOperations = [
  'baby.git.describe',
  'baby.git.repository.materialize',
  'baby.git.repository.verify',
  'baby.git.repository.status',
  'baby.git.fetch',
  'baby.git.branch.create',
  'baby.git.commit.create',
  'baby.git.commit.verify',
  'baby.git.push.preview',
  'baby.git.push.apply',
  'baby.git.push.verify',
  'baby.github.describe',
  'baby.github.auth.status',
  'baby.github.repo.authority.get',
  'baby.github.repo.authority.list',
  'baby.github.remote.verify',
  'baby.github.pr.upsert',
  'baby.github.pr.get',
  'baby.github.pr.verify',
  'baby.github.workflow.find',
  'baby.github.workflow.wait',
  'baby.github.workflow.get',
  'baby.github.workflow.logs',
  'baby.github.workflow.artifacts',
  'baby.github.artifact.verify',
  'baby.github.delivery.publish',
] as const;

const expectedModels = [
  'GitRepositoryIdentity',
  'GitSourceIdentity',
  'GitCredentialReference',
  'GitWorkspaceIdentity',
  'GitRefExpectation',
  'GitPushPlan',
  'GitCommitEvidence',
  'GitTreeEvidence',
  'GitRemoteReadback',
  'GitHubProviderAccount',
  'GitHubRepositoryAuthority',
  'GitHubPermissionSnapshot',
  'GitHubRateLimitState',
  'GitHubMutationIntent',
  'GitHubMutationReadback',
  'GitHubWorkflowIdentity',
  'GitHubArtifactIdentity',
  'GitHubCredentialEnrollmentRecord',
] as const;

describe('Universal GitHub Authority Checkpoint A contracts', () => {
  it('freezes the exact 26-operation catalog in normative order', () => {
    assert.deepEqual(GITHUB_AUTHORITY_OPERATION_NAMES, expectedOperations);
    assert.equal(new Set(GITHUB_AUTHORITY_OPERATION_NAMES).size, 26);
    assert.deepEqual(
      GITHUB_AUTHORITY_OPERATION_CONTRACTS.map((entry) => entry.operation),
      expectedOperations,
    );
  });

  it('freezes every required normative model schema', () => {
    assert.deepEqual(Object.keys(GITHUB_AUTHORITY_MODEL_SCHEMAS), expectedModels);
  });

  it('keeps Checkpoint A truthful and out of the executable registry', () => {
    const executable = new Set(OPERATIONS);
    for (const contract of GITHUB_AUTHORITY_OPERATION_CONTRACTS) {
      assert.equal(contract.support, 'contract_only');
      assert.equal(contract.executable, false);
      assert.equal(executable.has(contract.operation), false, contract.operation);
      assert.equal(contract.idempotency, contract.mutation ? 'semantic_replay_or_conflict' : 'read_only');
      assert.equal(contract.restartBehavior, contract.mutation ? 'durable_reconcile' : 'read_only');
    }
  });

  it('freezes the durable mutation lifecycle and recovery truth', () => {
    assert.deepEqual(GITHUB_MUTATION_STATES, [
      'intent_persisted',
      'local_prepared',
      'remote_attempted',
      'remote_reconciled',
      'verified',
      'failed',
      'ambiguous',
      'unknown',
    ]);
    assert.deepEqual(GITHUB_MUTATION_TRANSITIONS.intent_persisted, ['local_prepared', 'failed', 'unknown']);
    assert.deepEqual(GITHUB_MUTATION_TRANSITIONS.local_prepared, ['remote_attempted', 'failed', 'unknown']);
    assert.deepEqual(GITHUB_MUTATION_TRANSITIONS.remote_attempted, ['remote_reconciled', 'ambiguous', 'unknown']);
    assert.deepEqual(GITHUB_MUTATION_TRANSITIONS.remote_reconciled, ['verified', 'failed', 'ambiguous', 'unknown']);
    assert.deepEqual(GITHUB_MUTATION_TRANSITIONS.verified, []);
  });

  it('defines one typed error model with required provider and recovery errors', () => {
    for (const code of [
      'unsupported',
      'not_configured',
      'authority_missing',
      'credential_unavailable',
      'permission_drift',
      'workspace_dirty',
      'non_fast_forward',
      'push_result_unknown',
      'workflow_timed_out',
      'artifact_mismatch',
      'rate_limited',
      'recovery_required',
      'manual_recovery_required',
      'ambiguous',
      'unknown',
    ]) assert.ok(GITHUB_AUTHORITY_TYPED_ERRORS.includes(code as never), code);
    assert.equal(new Set(GITHUB_AUTHORITY_TYPED_ERRORS).size, GITHUB_AUTHORITY_TYPED_ERRORS.length);
  });

  it('freezes explicit v1 exclusions', () => {
    for (const excluded of [
      'unconstrained_force_push',
      'remote_ref_deletion',
      'repository_deletion',
      'repository_visibility_change',
      'actions_secret_change',
      'branch_protection_change',
      'pull_request_merge',
      'release_publication',
      'package_publication',
      'arbitrary_github_admin_api',
    ]) assert.ok(GITHUB_AUTHORITY_EXCLUSIONS.includes(excluded as never), excluded);
  });

  it('publishes a deterministic machine-readable contract bundle', () => {
    assert.deepEqual(generated, GITHUB_AUTHORITY_CONTRACT_BUNDLE);
    assert.equal(GITHUB_AUTHORITY_CAPABILITY_MATRIX.length, 26);
    assert.deepEqual(GITHUB_AUTHORITY_CONTRACT_BUNDLE.publicArguments, [
      'operation',
      'payload',
      'idempotencyKey',
    ]);
  });

  it('persists credential references and digests, never credential values', () => {
    assert.deepEqual(GITHUB_AUTHORITY_CONTRACT_BUNDLE.credentialPolicy, {
      valuesPersisted: false,
      referencesOnly: true,
      plaintextInSqlite: false,
      plaintextInReleaseDirectories: false,
      plaintextInGitWorkspaces: false,
      currentBuildTransport: 'repository_scoped_encrypted_ssh_deploy_key',
      permanentApiModel: 'github_app_installation_credential_reference',
    });
    const encoded = JSON.stringify(GITHUB_AUTHORITY_CONTRACT_BUNDLE);
    for (const forbiddenProperty of ['"privateKey"', '"accessToken"', '"password"', '"secretValue"']) {
      assert.equal(encoded.includes(forbiddenProperty), false, forbiddenProperty);
    }
  });
});
