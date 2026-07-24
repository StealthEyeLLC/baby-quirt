import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';
import { sha256Hex } from '../src/crypto/canonical.js';
import { DeploymentDatabase } from '../src/deployment/database.js';
import { computePermissionSnapshotDigest } from '../src/github/authority-registry.js';
import {
  GITHUB_AUTHORITY_CONTRACT_VERSION,
  type GitHubCredentialEnrollmentRecord,
  type GitHubPermissionSnapshot,
  type GitHubRepositoryAuthority,
} from '../src/github/contracts.js';
import { GitRepositoryTruth } from '../src/github/repository-truth.js';
import {
  GitSafePublication,
  GitSafePublicationError,
  type GitHubApiReadbackProvider,
  type GitHubApiRemoteReadback,
  type GitPublicationTransport,
  type GitTransportObservation,
  type GitTransportPushResult,
} from '../src/github/safe-publication.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[], allowed: number[] = [0]): string {
  const result = spawnSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: cwd, GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Fixture Author', GIT_AUTHOR_EMAIL: 'fixture-author@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture Committer', GIT_COMMITTER_EMAIL: 'fixture-committer@example.invalid',
    },
  });
  assert.ok(allowed.includes(result.status ?? 128), result.stderr);
  return result.stdout.trim();
}

class LocalTransport implements GitPublicationTransport {
  pushCount = 0;
  responseLoss = false;

  constructor(private readonly remote: string) {}

  observeRef(input: Parameters<GitPublicationTransport['observeRef']>[0]): GitTransportObservation {
    const result = spawnSync('/usr/bin/git', [`--git-dir=${this.remote}`, 'rev-parse', '--verify', `${input.destinationRef}^{commit}`], {
      encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    });
    const object = result.status === 0 ? result.stdout.trim() : undefined;
    return {
      ...(object ? { object } : {}),
      evidenceReferences: [`git-read:${input.requestId}:${object ?? 'absent'}`],
    };
  }

  push(input: Parameters<GitPublicationTransport['push']>[0]): GitTransportPushResult {
    this.pushCount += 1;
    const lease = `${input.destinationRef}:${input.expectedOldObject ?? ''}`;
    const result = spawnSync('/usr/bin/git', [
      'push', `--force-with-lease=${lease}`, '--porcelain', '--', this.remote,
      `${input.sourceCommit}:${input.destinationRef}`,
    ], {
      cwd: input.workspace.worktreePath,
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: input.workspace.worktreePath, GIT_CONFIG_NOSYSTEM: '1' },
    });
    if (this.responseLoss && result.status === 0) {
      return { outcome: 'unknown', evidenceReferences: [`git-push-response-lost:${input.requestId}`] };
    }
    return {
      outcome: result.status === 0 ? 'completed' : 'failed',
      exitCode: result.status ?? 128,
      evidenceReferences: [`git-push:${input.requestId}:${result.status ?? 128}`],
    };
  }
}

class LocalApiReadback implements GitHubApiReadbackProvider {
  disagree = false;

  constructor(private readonly remote: string) {}

  verifyRemote(input: Parameters<GitHubApiReadbackProvider['verifyRemote']>[0]): GitHubApiRemoteReadback {
    const commit = git(this.remote, [`--git-dir=${this.remote}`, 'rev-parse', `${input.destinationRef}^{commit}`]);
    const tree = git(this.remote, [`--git-dir=${this.remote}`, 'rev-parse', `${commit}^{tree}`]);
    return {
      repositoryId: input.authority.repository.repositoryId,
      destinationRef: input.destinationRef,
      observedCommit: commit,
      observedTree: this.disagree ? '0'.repeat(40) : tree,
      evidenceReferences: [`github-api-readback:${commit}`],
      observedAt: '2026-07-24T10:00:00.000Z',
    };
  }
}

interface Fixture {
  root: string;
  seed: string;
  remote: string;
  databasePath: string;
  storageRoot: string;
  base: string;
  baseTree: string;
  head: string;
  headTree: string;
  database: DeploymentDatabase;
  truth: GitRepositoryTruth;
  publication: GitSafePublication;
  transport: LocalTransport;
  api: LocalApiReadback;
  authorityId: string;
  credentialReferenceId: string;
  workspaceId: string;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'bq-safe-publication-'));
  roots.push(root);
  const seed = join(root, 'seed');
  const remote = join(root, 'remote.git');
  const storageRoot = join(root, 'storage');
  mkdirSync(seed, { recursive: true });
  git(seed, ['init', '--initial-branch=main']);
  writeFileSync(join(seed, 'README.md'), '# base\n', 'utf8');
  git(seed, ['add', 'README.md']);
  git(seed, ['commit', '-m', 'base']);
  const base = git(seed, ['rev-parse', 'HEAD^{commit}']);
  const baseTree = git(seed, ['rev-parse', 'HEAD^{tree}']);
  git(seed, ['branch', 'build/target', base]);
  writeFileSync(join(seed, 'README.md'), '# head\n', 'utf8');
  writeFileSync(join(seed, 'FEATURE.md'), 'safe publication\n', 'utf8');
  git(seed, ['add', 'README.md', 'FEATURE.md']);
  git(seed, ['commit', '-m', 'head']);
  const head = git(seed, ['rev-parse', 'HEAD^{commit}']);
  const headTree = git(seed, ['rev-parse', 'HEAD^{tree}']);
  git(root, ['clone', '--bare', '--', seed, remote]);

  const databasePath = join(root, 'state', 'deployment.sqlite');
  const database = new DeploymentDatabase(databasePath);
  const snapshotBody = {
    snapshotId: 'checkpoint-d-permissions',
    repositoryPermissions: { contents: 'write' } as const,
    organizationPermissions: {} as const,
    capturedAt: '2026-07-24T09:00:00.000Z',
  };
  const permissions: GitHubPermissionSnapshot = { ...snapshotBody, digest: computePermissionSnapshotDigest(snapshotBody) };
  const authorityId = 'checkpoint-d-authority';
  const credentialReferenceId = 'checkpoint-d-credential';
  const families = [
    'git.transport', 'git.repository.read', 'git.repository.write', 'git.commit',
    'git.remote.read', 'git.remote.write',
  ];
  const credential: GitHubCredentialEnrollmentRecord = {
    enrollmentId: 'checkpoint-d-enrollment', schemaVersion: GITHUB_AUTHORITY_CONTRACT_VERSION,
    ownerPrincipal: 'stealtheye-owner', provider: 'github', credentialType: 'ssh_deploy_key',
    credentialReferenceId, accountOrInstallationId: 'fixture/repository', repositoryAuthorityIds: [authorityId],
    allowedOperationFamilies: families, permissionSnapshotDigest: permissions.digest,
    encryptedCredentialName: 'checkpoint-d-fixture', encryptedCredentialDigest: sha256Hex('encrypted-fixture'),
    createdAt: '2026-07-24T09:00:01.000Z', expiresAt: '2027-07-24T09:00:01.000Z',
    revoked: false, plaintextPersisted: false,
  };
  const authority: GitHubRepositoryAuthority = {
    authorityId, schemaVersion: GITHUB_AUTHORITY_CONTRACT_VERSION, principal: 'stealtheye-owner',
    repository: { repositoryId: 'fixture-safe-publication', canonicalRemote: remote, host: 'fixture.local', owner: 'fixture', name: 'repository' },
    credentialReferenceId, credentialType: 'ssh_deploy_key', readWriteClassification: 'read_write',
    allowedBranchPatterns: ['refs/heads/build/*'], allowedOperationFamilies: families, permissionSnapshot: permissions,
    createdAt: '2026-07-24T09:00:02.000Z', expiresAt: '2027-07-24T09:00:02.000Z',
    revoked: false, lastVerifiedAt: '2026-07-24T09:00:03.000Z', health: 'healthy',
  };
  database.githubAuthorities.registerPermissionSnapshot(permissions);
  database.githubAuthorities.registerCredentialEnrollment(credential);
  database.githubAuthorities.registerRepositoryAuthority(authority);
  const truth = new GitRepositoryTruth({
    storageRoot, authorityRegistry: database.githubAuthorities, workspaceRegistry: database.githubGitWorkspaces,
    now: () => '2026-07-24T09:01:00.000Z',
  });
  const workspaceId = 'checkpoint-d-workspace';
  truth.materialize({
    repositoryAuthorityId: authorityId, credentialReferenceId, canonicalRemote: remote,
    expectedCommit: head, expectedTree: headTree, sourceRef: 'refs/heads/main', workspaceId,
  });
  const transport = new LocalTransport(remote);
  const api = new LocalApiReadback(remote);
  const publication = new GitSafePublication({
    authorityRegistry: database.githubAuthorities, workspaceRegistry: database.githubGitWorkspaces,
    publicationRegistry: database.githubSafePublications, repositoryTruth: truth, transport, apiReadback: api,
    now: () => '2026-07-24T10:00:00.000Z',
  });
  return { root, seed, remote, databasePath, storageRoot, base, baseTree, head, headTree, database, truth, publication, transport, api, authorityId, credentialReferenceId, workspaceId };
}

function preview(fixture: Fixture) {
  return fixture.publication.preview({
    repositoryAuthorityId: fixture.authorityId,
    workspaceId: fixture.workspaceId,
    credentialReferenceId: fixture.credentialReferenceId,
    sourceRef: 'refs/heads/main',
    destinationRef: 'refs/heads/build/target',
    expectedRemoteOldObject: fixture.base,
    expiresAt: '2026-07-25T10:00:00.000Z',
  });
}

function apply(fixture: Fixture, plan: ReturnType<typeof preview>, mutationId = 'checkpoint-d-mutation-001') {
  return fixture.publication.apply({
    mutationId,
    semanticIdempotencyFingerprint: sha256Hex(`semantic:${plan.planDigest}`),
    repositoryAuthorityId: fixture.authorityId,
    planId: plan.planId,
    planDigest: plan.planDigest,
    expectedLocalHead: fixture.head,
    expectedLocalTree: fixture.headTree,
    expectedRemoteOldObject: fixture.base,
    authorizationReference: 'owner-authorization-d',
  });
}

function assertCode(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof GitSafePublicationError);
    assert.equal(error.code, code);
    return true;
  });
}

describe('safe Git publication', () => {
  it('previews, persists intent before push, performs exact CAS, verifies Git and API readback, and replays idempotently', () => {
    const fixture = makeFixture();
    const plan = preview(fixture);
    assert.equal(plan.expectation.expectedOldObject, fixture.base);
    assert.equal(plan.expectation.newObject, fixture.head);
    assert.equal(plan.expectation.newTree, fixture.headTree);
    assert.equal(plan.mergeBase, fixture.base);
    assert.equal(plan.expectation.fastForwardOnly, true);
    assert.ok(plan.objectsToTransfer.includes(fixture.head));
    assert.match(plan.planDigest, /^[a-f0-9]{64}$/u);

    const result = apply(fixture, plan);
    assert.equal(result.state, 'verified');
    assert.equal(result.readback?.observedCommit, fixture.head);
    assert.equal(result.readback?.observedTree, fixture.headTree);
    assert.equal(git(fixture.remote, [`--git-dir=${fixture.remote}`, 'rev-parse', 'refs/heads/build/target^{commit}']), fixture.head);
    assert.equal(fixture.transport.pushCount, 1);
    const events = fixture.database.githubSafePublications.listEvents(result.mutationId);
    assert.deepEqual(events.map((event) => event.kind), [
      'intent_persisted', 'local_prepared', 'push_attempted', 'remote_git_reconciled', 'publication_verified',
    ]);
    assert.equal(events[0]?.state, 'intent_persisted');
    assert.equal(events.at(-1)?.state, 'verified');

    const replay = apply(fixture, plan);
    assert.equal(replay.state, 'verified');
    assert.equal(fixture.transport.pushCount, 1);
    fixture.database.close();
  });

  it('reconciles a lost push response from exact remote readback without a duplicate push', () => {
    const fixture = makeFixture();
    fixture.transport.responseLoss = true;
    const plan = preview(fixture);
    const result = apply(fixture, plan, 'checkpoint-d-response-loss');
    assert.equal(result.state, 'verified');
    assert.equal(fixture.transport.pushCount, 1);
    assert.ok(result.evidenceReferences.includes('push-outcome:response-lost-reconciled'));
    assert.equal(apply(fixture, plan, 'checkpoint-d-response-loss').state, 'verified');
    assert.equal(fixture.transport.pushCount, 1);
    fixture.database.close();
  });

  it('reconciles lost response across database restart without a duplicate push', () => {
    const fixture = makeFixture();
    fixture.transport.responseLoss = true;
    const plan = preview(fixture);
    const mutationId = 'checkpoint-g-response-loss-restart';
    const result = apply(fixture, plan, mutationId);
    assert.equal(result.state, 'verified');
    assert.equal(fixture.transport.pushCount, 1);
    fixture.database.close();

    const reopened = new DeploymentDatabase(fixture.databasePath);
    const truth = new GitRepositoryTruth({
      storageRoot: fixture.storageRoot,
      authorityRegistry: reopened.githubAuthorities,
      workspaceRegistry: reopened.githubGitWorkspaces,
      now: () => '2026-07-24T10:01:00.000Z',
    });
    const publication = new GitSafePublication({
      authorityRegistry: reopened.githubAuthorities,
      workspaceRegistry: reopened.githubGitWorkspaces,
      publicationRegistry: reopened.githubSafePublications,
      repositoryTruth: truth,
      transport: fixture.transport,
      apiReadback: fixture.api,
      now: () => '2026-07-24T10:01:00.000Z',
    });
    const replay = publication.apply({
      mutationId,
      semanticIdempotencyFingerprint: sha256Hex(`semantic:${plan.planDigest}`),
      repositoryAuthorityId: fixture.authorityId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      expectedLocalHead: fixture.head,
      expectedLocalTree: fixture.headTree,
      expectedRemoteOldObject: fixture.base,
      authorizationReference: 'owner-authorization-d',
    });
    assert.equal(replay.state, 'verified');
    assert.equal(fixture.transport.pushCount, 1);
    assert.equal(reopened.githubSafePublications.getRun(mutationId)?.state, 'verified');
    reopened.close();
  });

  it('refuses mutation when the destination changes after preview', () => {
    const fixture = makeFixture();
    const plan = preview(fixture);
    writeFileSync(join(fixture.seed, 'EXTERNAL.md'), 'external\n', 'utf8');
    git(fixture.seed, ['add', 'EXTERNAL.md']);
    git(fixture.seed, ['commit', '-m', 'external']);
    const external = git(fixture.seed, ['rev-parse', 'HEAD^{commit}']);
    git(fixture.seed, ['push', '--force', fixture.remote, `${external}:refs/heads/build/target`]);
    assertCode(() => apply(fixture, plan, 'checkpoint-d-stale-plan'), 'remote_base_mismatch');
    assert.equal(fixture.transport.pushCount, 0);
    assert.equal(fixture.database.githubSafePublications.getRun('checkpoint-d-stale-plan')?.state, 'failed');
    fixture.database.close();
  });

  it('rejects non-fast-forward publication during preview', () => {
    const fixture = makeFixture();
    git(fixture.seed, ['switch', '--detach', fixture.base]);
    writeFileSync(join(fixture.seed, 'DIVERGENT.md'), 'divergent\n', 'utf8');
    git(fixture.seed, ['add', 'DIVERGENT.md']);
    git(fixture.seed, ['commit', '-m', 'divergent']);
    const divergent = git(fixture.seed, ['rev-parse', 'HEAD^{commit}']);
    git(fixture.seed, ['push', '--force', fixture.remote, `${divergent}:refs/heads/build/target`]);
    git(fixture.truth['options'].storageRoot, ['--version']);
    fixture.truth.fetch({
      repositoryAuthorityId: fixture.authorityId, workspaceId: fixture.workspaceId,
      credentialReferenceId: fixture.credentialReferenceId, exactRefs: ['refs/heads/build/target'], prune: false,
    });
    assertCode(() => fixture.publication.preview({
      repositoryAuthorityId: fixture.authorityId, workspaceId: fixture.workspaceId,
      credentialReferenceId: fixture.credentialReferenceId, sourceRef: 'refs/heads/main',
      destinationRef: 'refs/heads/build/target', expectedRemoteOldObject: divergent,
      expiresAt: '2026-07-25T10:00:00.000Z',
    }), 'non_fast_forward');
    fixture.database.close();
  });

  it('records Git/API disagreement durably and can reconcile on replay after the provider recovers', () => {
    const fixture = makeFixture();
    const plan = preview(fixture);
    fixture.api.disagree = true;
    assertCode(() => apply(fixture, plan, 'checkpoint-d-api-disagreement'), 'git_api_disagreement');
    assert.equal(fixture.transport.pushCount, 1);
    assert.equal(fixture.database.githubSafePublications.getRun('checkpoint-d-api-disagreement')?.state, 'remote_reconciled');
    fixture.api.disagree = false;
    const recovered = apply(fixture, plan, 'checkpoint-d-api-disagreement');
    assert.equal(recovered.state, 'verified');
    assert.equal(fixture.transport.pushCount, 1);
    fixture.database.close();
  });

  it('detects changed idempotency intent and verifies exact remote state independently', () => {
    const fixture = makeFixture();
    const plan = preview(fixture);
    const result = apply(fixture, plan);
    assert.equal(result.state, 'verified');
    const readback = fixture.publication.verify({
      repositoryAuthorityId: fixture.authorityId,
      credentialReferenceId: fixture.credentialReferenceId,
      destinationRef: 'refs/heads/build/target',
      expectedCommit: fixture.head,
      expectedTree: fixture.headTree,
    });
    assert.equal(readback.ancestryVerified, true);
    assertCode(() => fixture.publication.apply({
      mutationId: 'checkpoint-d-mutation-001',
      semanticIdempotencyFingerprint: sha256Hex('changed-intent'),
      repositoryAuthorityId: fixture.authorityId, planId: plan.planId, planDigest: plan.planDigest,
      expectedLocalHead: fixture.head, expectedLocalTree: fixture.headTree,
      expectedRemoteOldObject: fixture.base, authorizationReference: 'owner-authorization-d',
    }), 'idempotency_conflict');
    fixture.database.close();
  });
});
