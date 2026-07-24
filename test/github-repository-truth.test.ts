import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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
import {
  GitRepositoryTruth,
  GitRepositoryTruthError,
} from '../src/github/repository-truth.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  const result = spawnSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Fixture Author',
      GIT_AUTHOR_EMAIL: 'fixture-author@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture Committer',
      GIT_COMMITTER_EMAIL: 'fixture-committer@example.invalid',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

interface Fixture {
  root: string;
  remote: string;
  commit: string;
  tree: string;
  database: DeploymentDatabase;
  truth: GitRepositoryTruth;
  authorityId: string;
  credentialReferenceId: string;
  workspaceId: string;
  storageRoot: string;
}

function permissionSnapshot(): GitHubPermissionSnapshot {
  const value = {
    snapshotId: 'checkpoint-c-permissions',
    repositoryPermissions: { contents: 'write' } as const,
    organizationPermissions: { members: 'none' } as const,
    capturedAt: '2026-07-24T09:30:00.000Z',
  };
  return { ...value, digest: computePermissionSnapshotDigest(value) };
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'bq-git-truth-'));
  roots.push(root);
  const seed = join(root, 'seed');
  const remote = join(root, 'remote.git');
  const storageRoot = join(root, 'storage');
  mkdirSync(seed, { recursive: true });
  git(seed, ['init', '--initial-branch=main']);
  writeFileSync(join(seed, 'README.md'), '# fixture\n', 'utf8');
  writeFileSync(join(seed, '.gitattributes'), 'assets/** filter=lfs diff=lfs merge=lfs -text\n', 'utf8');
  git(seed, ['add', '--', 'README.md', '.gitattributes']);
  git(seed, ['commit', '-m', 'fixture base']);
  const commit = git(seed, ['rev-parse', 'HEAD^{commit}']);
  const tree = git(seed, ['rev-parse', 'HEAD^{tree}']);
  git(root, ['clone', '--bare', '--', seed, remote]);

  const database = new DeploymentDatabase(join(root, 'state', 'deployment.sqlite'));
  const permissions = permissionSnapshot();
  const credentialReferenceId = 'checkpoint-c-credential';
  const authorityId = 'checkpoint-c-authority';
  const operationFamilies = [
    'git.transport',
    'git.repository.read',
    'git.repository.write',
    'git.commit',
  ];
  const credential: GitHubCredentialEnrollmentRecord = {
    enrollmentId: 'checkpoint-c-enrollment',
    schemaVersion: GITHUB_AUTHORITY_CONTRACT_VERSION,
    ownerPrincipal: 'stealtheye-owner',
    provider: 'github',
    credentialType: 'ssh_deploy_key',
    credentialReferenceId,
    accountOrInstallationId: 'fixture/repository',
    repositoryAuthorityIds: [authorityId],
    allowedOperationFamilies: operationFamilies,
    permissionSnapshotDigest: permissions.digest,
    encryptedCredentialName: 'checkpoint-c-fixture-credential',
    encryptedCredentialDigest: sha256Hex('fixture-encrypted-credential'),
    createdAt: '2026-07-24T09:30:01.000Z',
    expiresAt: '2027-07-24T09:30:01.000Z',
    revoked: false,
    plaintextPersisted: false,
  };
  const authority: GitHubRepositoryAuthority = {
    authorityId,
    schemaVersion: GITHUB_AUTHORITY_CONTRACT_VERSION,
    principal: 'stealtheye-owner',
    repository: {
      repositoryId: 'fixture-repository',
      canonicalRemote: remote,
      host: 'fixture.local',
      owner: 'fixture',
      name: 'repository',
    },
    credentialReferenceId,
    credentialType: 'ssh_deploy_key',
    readWriteClassification: 'read_write',
    allowedBranchPatterns: ['refs/heads/build/*'],
    allowedOperationFamilies: operationFamilies,
    permissionSnapshot: permissions,
    createdAt: '2026-07-24T09:30:02.000Z',
    expiresAt: '2027-07-24T09:30:02.000Z',
    revoked: false,
    lastVerifiedAt: '2026-07-24T09:30:03.000Z',
    health: 'healthy',
  };
  database.githubAuthorities.registerPermissionSnapshot(permissions);
  database.githubAuthorities.registerCredentialEnrollment(credential);
  database.githubAuthorities.registerRepositoryAuthority(authority);

  const truth = new GitRepositoryTruth({
    storageRoot,
    authorityRegistry: database.githubAuthorities,
    workspaceRegistry: database.githubGitWorkspaces,
    identityResolver: (reference) => {
      if (reference === 'author-ref') return { name: 'Baby Author', email: 'baby-author@example.invalid' };
      if (reference === 'committer-ref') return { name: 'Baby Committer', email: 'baby-committer@example.invalid' };
      throw new Error(`Unknown identity reference ${reference}`);
    },
    now: () => '2026-07-24T09:31:00.000Z',
  });
  return {
    root,
    remote,
    commit,
    tree,
    database,
    truth,
    authorityId,
    credentialReferenceId,
    workspaceId: 'checkpoint-c-workspace',
    storageRoot,
  };
}

function materialize(fixture: Fixture) {
  return fixture.truth.materialize({
    repositoryAuthorityId: fixture.authorityId,
    credentialReferenceId: fixture.credentialReferenceId,
    canonicalRemote: fixture.remote,
    expectedCommit: fixture.commit,
    expectedTree: fixture.tree,
    sourceRef: 'refs/heads/main',
    workspaceId: fixture.workspaceId,
  });
}

function assertTruthCode(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof GitRepositoryTruthError);
    assert.equal(error.code, code);
    return true;
  });
}

describe('Git repository truth', () => {
  it('materializes and verifies exact repository identity, commit, tree, ancestry, and declarations', () => {
    const fixture = makeFixture();
    const result = materialize(fixture);
    assert.equal(result.workspace.head, fixture.commit);
    assert.equal(result.workspace.tree, fixture.tree);
    assert.equal(result.workspace.clean, true);
    assert.equal(result.source.commit, fixture.commit);
    assert.equal(result.source.tree, fixture.tree);
    assert.match(result.resultDigest, /^[a-f0-9]{64}$/u);

    const verification = fixture.truth.verify({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
    });
    assert.equal(verification.canonicalRemoteVerified, true);
    assert.equal(verification.ancestryVerified, true);
    assert.equal(verification.objectAvailabilityVerified, true);
    assert.equal(verification.submodulesDeclared, false);
    assert.equal(verification.lfsDeclared, true);

    const replay = materialize(fixture);
    assert.equal(replay.workspace.head, fixture.commit);
    assert.equal(replay.workspace.tree, fixture.tree);
    const status = fixture.truth.status({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
    });
    assert.equal(status.workspace.clean, true);
    assert.deepEqual(status.stagedPaths, []);
    assert.deepEqual(status.unstagedPaths, []);
    assert.deepEqual(status.untrackedPaths, []);
    fixture.database.close();
  });

  it('fetches exact refs and creates and verifies an exact declared-path commit', () => {
    const fixture = makeFixture();
    const materialized = materialize(fixture);
    const fetched = fixture.truth.fetch({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      credentialReferenceId: fixture.credentialReferenceId,
      exactRefs: ['refs/heads/main'],
      prune: false,
    });
    assert.equal(fetched.fetched['refs/heads/main'], fixture.commit);

    const branch = fixture.truth.createBranch({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      branch: 'build/checkpoint-c',
      expectedCommit: fixture.commit,
      expectedTree: fixture.tree,
    });
    assert.equal(branch.branch, 'build/checkpoint-c');
    writeFileSync(join(materialized.workspace.worktreePath, 'README.md'), '# fixture\ncheckpoint c\n', 'utf8');
    const dirty = fixture.truth.status({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
    });
    assert.deepEqual(dirty.unstagedPaths, ['README.md']);
    assert.equal(dirty.workspace.clean, false);

    const evidence = fixture.truth.createCommit({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      expectedParent: fixture.commit,
      declaredPaths: ['README.md'],
      authorIdentityReference: 'author-ref',
      committerIdentityReference: 'committer-ref',
      message: 'checkpoint c fixture commit',
    });
    assert.deepEqual(evidence.parents, [fixture.commit]);
    assert.deepEqual(evidence.changedPaths, ['README.md']);
    assert.equal(evidence.authorIdentityReference, 'author-ref');
    assert.equal(evidence.committerIdentityReference, 'committer-ref');
    assert.equal(evidence.signatureStatus, 'not_configured');
    assert.notEqual(evidence.commit, fixture.commit);

    const verified = fixture.truth.verifyCommit({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      expectedCommit: evidence.commit,
      expectedTree: evidence.tree,
      expectedBase: fixture.commit,
      authorIdentityReference: 'author-ref',
      committerIdentityReference: 'committer-ref',
    });
    assert.deepEqual(verified, evidence);
    assert.equal(fixture.truth.status({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
    }).workspace.clean, true);
    fixture.database.close();
  });

  it('rejects remote object mismatches, dirty branch creation, undeclared paths, and wrong ancestry', () => {
    const mismatch = makeFixture();
    assertTruthCode(() => mismatch.truth.materialize({
      repositoryAuthorityId: mismatch.authorityId,
      credentialReferenceId: mismatch.credentialReferenceId,
      canonicalRemote: mismatch.remote,
      expectedCommit: mismatch.commit,
      expectedTree: '0'.repeat(40),
      sourceRef: 'refs/heads/main',
      workspaceId: mismatch.workspaceId,
    }), 'repository_mismatch');
    mismatch.database.close();

    const fixture = makeFixture();
    const result = materialize(fixture);
    writeFileSync(join(result.workspace.worktreePath, 'dirty.txt'), 'dirty\n', 'utf8');
    assertTruthCode(() => fixture.truth.createBranch({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      branch: 'build/dirty',
      expectedCommit: fixture.commit,
      expectedTree: fixture.tree,
    }), 'workspace_dirty');
    unlinkSync(join(result.workspace.worktreePath, 'dirty.txt'));
    fixture.truth.createBranch({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      branch: 'build/checkpoint-c-errors',
      expectedCommit: fixture.commit,
      expectedTree: fixture.tree,
    });
    writeFileSync(join(result.workspace.worktreePath, 'one.txt'), 'one\n', 'utf8');
    writeFileSync(join(result.workspace.worktreePath, 'two.txt'), 'two\n', 'utf8');
    assertTruthCode(() => fixture.truth.createCommit({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      expectedParent: fixture.commit,
      declaredPaths: ['one.txt'],
      authorIdentityReference: 'author-ref',
      committerIdentityReference: 'committer-ref',
      message: 'must fail',
    }), 'undeclared_path_change');
    assertTruthCode(() => fixture.truth.verifyCommit({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      expectedCommit: fixture.commit,
      expectedTree: fixture.tree,
      expectedBase: '1'.repeat(40),
    }), 'object_missing');
    fixture.database.close();
  });

  it('rejects symlinked worktree paths and workspace path traversal', () => {
    const fixture = makeFixture();
    const outside = join(fixture.root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(fixture.storageRoot, 'worktrees', fixture.workspaceId));
    assertTruthCode(() => materialize(fixture), 'workspace_outside_root');
    assertTruthCode(() => fixture.truth.materialize({
      repositoryAuthorityId: fixture.authorityId,
      credentialReferenceId: fixture.credentialReferenceId,
      canonicalRemote: fixture.remote,
      expectedCommit: fixture.commit,
      expectedTree: fixture.tree,
      sourceRef: 'refs/heads/main',
      workspaceId: '../escape',
    }), 'invalid_request');
    fixture.database.close();
  });
});

describe('Git working-tree truth', () => {
  it('returns bounded structured diffs, ignore and attribute truth, and stages exact observed paths', () => {
    const fixture = makeFixture();
    const materialized = materialize(fixture);
    fixture.truth.createBranch({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      branch: 'build/working-tree',
      expectedCommit: fixture.commit,
      expectedTree: fixture.tree,
    });

    writeFileSync(join(materialized.workspace.worktreePath, 'README.md'), '# fixture\nworking tree\n', 'utf8');
    writeFileSync(join(materialized.workspace.worktreePath, '.gitignore'), '*.ignored\n', 'utf8');
    writeFileSync(join(materialized.workspace.worktreePath, 'new.txt'), 'new\n', 'utf8');
    writeFileSync(join(materialized.workspace.worktreePath, 'fixture.ignored'), 'ignored\n', 'utf8');

    const observed = fixture.truth.status({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
    });
    assert.deepEqual(observed.unstagedPaths, ['README.md']);
    assert.deepEqual(observed.untrackedPaths, ['.gitignore', 'new.txt']);
    assert.match(observed.resultDigest, /^[a-f0-9]{64}$/u);

    const diff = fixture.truth.diff({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      scope: 'head',
      maximumBytes: 32,
    });
    assert.deepEqual(diff.paths, ['README.md']);
    assert.equal(diff.truncated, true);
    assert.ok(diff.bytes > diff.patch.length);
    assert.match(diff.contentDigest, /^[a-f0-9]{64}$/u);

    const stat = fixture.truth.diffStat({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      scope: 'head',
    });
    assert.deepEqual(stat.entries.map((entry) => entry.path), ['README.md']);
    assert.equal(stat.binaryPaths, 0);
    assert.ok(stat.additions > 0);

    const nameStatus = fixture.truth.diffNameStatus({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      scope: 'head',
    });
    assert.deepEqual(nameStatus.entries, [{ status: 'M', path: 'README.md' }]);

    const ignored = fixture.truth.checkIgnore({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      paths: ['fixture.ignored', 'README.md'],
    });
    assert.equal(ignored.items.find((item) => item.path === 'fixture.ignored')?.ignored, true);
    assert.equal(ignored.items.find((item) => item.path === 'README.md')?.ignored, false);

    const attributes = fixture.truth.checkAttributes({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      paths: ['assets/fixture.bin'],
    });
    assert.equal(attributes.items[0]?.attributes.filter, 'lfs');
    assert.equal(attributes.items[0]?.attributes.diff, 'lfs');
    assert.equal(attributes.items[0]?.attributes.text, 'unset');

    writeFileSync(join(materialized.workspace.worktreePath, 'later.txt'), 'later\n', 'utf8');
    assertTruthCode(() => fixture.truth.add({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      paths: ['README.md'],
      expectedHead: fixture.commit,
      expectedStatusDigest: observed.resultDigest,
    }), 'repository_mismatch');

    const current = fixture.truth.status({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
    });
    const staged = fixture.truth.add({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      paths: ['.gitignore', 'README.md', 'later.txt', 'new.txt'],
      expectedHead: fixture.commit,
      expectedStatusDigest: current.resultDigest,
    });
    assert.deepEqual(staged.stagedPaths, ['.gitignore', 'later.txt', 'new.txt', 'README.md']);
    assert.match(staged.statusDigest, /^[a-f0-9]{64}$/u);
    assertTruthCode(() => fixture.truth.checkIgnore({
      repositoryAuthorityId: fixture.authorityId,
      workspaceId: fixture.workspaceId,
      paths: ['../escape'],
    }), 'invalid_request');
    fixture.database.close();
  });
});
