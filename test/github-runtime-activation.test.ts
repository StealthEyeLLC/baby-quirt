import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RuntimeConfig } from '../src/config.js';
import { OPERATION_DEFINITIONS } from '../src/operations/definitions.js';
import { GitHubRuntimeService, PRODUCTION_GITHUB_AUTHORITY_ID } from '../src/github/runtime-service.js';

describe('production GitHub runtime activation', () => {
  it('advertises only the production-enabled read surface', () => {
    const names = new Set(OPERATION_DEFINITIONS.map((definition) => definition.operation));
    assert.equal(names.has('baby.github.describe'), true);
    assert.equal(names.has('baby.github.remote.verify'), true);
    assert.equal(names.has('baby.github.pr.upsert'), false);
  });

  it('describes the registered authority and dispatches remote verification', () => {
    const expected = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
    const service = new GitHubRuntimeService({ stateRoot: '/tmp/baby-github-runtime-test' } as RuntimeConfig, {
      verifyRemote: (_requestId, input) => ({ ...expected, branch: input.branch }),
    });
    const description = service.execute('baby.github.describe', 'describe-1', {});
    assert.equal(description.supportState, 'production_enabled');
    assert.deepEqual(description.supportedOperations, ['baby.github.describe', 'baby.github.remote.verify']);
    const result = service.execute('baby.github.remote.verify', 'verify-1', {
      repositoryAuthorityId: PRODUCTION_GITHUB_AUTHORITY_ID,
      branch: 'main',
      expectedCommit: expected.commit,
      expectedTree: expected.tree,
    });
    assert.deepEqual(result, { ...expected, branch: 'main' });
  });
});
