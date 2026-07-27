import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RuntimeConfig } from '../src/config.js';
import { OPERATION_DEFINITIONS } from '../src/operations/definitions.js';
import { GitHubRuntimeService, PRODUCTION_GITHUB_AUTHORITY_ID } from '../src/github/runtime-service.js';

const APP_OPERATIONS = ['baby.github.app.verify', 'baby.github.app.proof'] as const;

describe('production GitHub runtime activation', () => {
  it('advertises the production read surface and minimal GitHub App authority', () => {
    const names = new Set(OPERATION_DEFINITIONS.map((definition) => definition.operation));
    assert.equal(names.has('baby.github.describe'), true);
    assert.equal(names.has('baby.github.remote.verify'), true);
    assert.equal(names.has('baby.github.app.verify'), true);
    assert.equal(names.has('baby.github.app.proof'), true);
    assert.equal(names.has('baby.github.pr.upsert'), false);
  });

  it('describes registered authorities and dispatches SSH and GitHub App operations', async () => {
    const expected = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
    const service = new GitHubRuntimeService({ stateRoot: '/tmp/baby-github-runtime-test' } as RuntimeConfig, {
      verifyRemote: (_requestId, input) => ({ ...expected, branch: input.branch }),
      verifyApp: async () => ({ verified: true, appId: 4_380_878 }),
      runAppProof: async () => ({ exactReadback: true, branchDeleted: true }),
    });
    const description = service.execute('baby.github.describe', 'describe-1', {}) as Record<string, unknown>;
    assert.equal(description.supportState, 'production_enabled');
    assert.deepEqual(description.supportedOperations, [
      'baby.github.describe',
      'baby.github.remote.verify',
      ...APP_OPERATIONS,
    ]);
    const remoteResult = service.execute('baby.github.remote.verify', 'verify-1', {
      repositoryAuthorityId: PRODUCTION_GITHUB_AUTHORITY_ID,
      branch: 'main',
      expectedCommit: expected.commit,
      expectedTree: expected.tree,
    });
    assert.deepEqual(remoteResult, { ...expected, branch: 'main' });
    assert.deepEqual(await service.execute('baby.github.app.verify', 'app-verify-1', {}), {
      verified: true,
      appId: 4_380_878,
    });
    assert.deepEqual(await service.execute('baby.github.app.proof', 'app-proof-1', {}), {
      exactReadback: true,
      branchDeleted: true,
    });
  });
});
