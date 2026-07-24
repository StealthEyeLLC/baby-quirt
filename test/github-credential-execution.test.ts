import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { sha256Hex } from '../src/crypto/canonical.js';
import { createEncryptedCredentialExecutionPlan } from '../src/github/credential-execution.js';
import {
  GITHUB_AUTHORITY_CONTRACT_VERSION,
  type GitHubCredentialEnrollmentRecord,
  type GitHubPermissionSnapshot,
  type GitHubRepositoryAuthority,
} from '../src/github/contracts.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtures() {
  const root = mkdtempSync(join(tmpdir(), 'bq-encrypted-credential-'));
  roots.push(root);
  const credentialName = 'github-baby-quirt-ssh';
  const credentialPath = join(root, `${credentialName}.cred`);
  const encrypted = Buffer.from('systemd-encrypted-credential-fixture');
  writeFileSync(credentialPath, encrypted, { mode: 0o600 });
  chmodSync(credentialPath, 0o600);
  const knownHosts = 'github.com ssh-ed25519 AAAAC3NzaFixturePinnedHostKey\n';
  const permissionSnapshot: GitHubPermissionSnapshot = {
    snapshotId: 'permission-snapshot-plan',
    digest: sha256Hex('permission-snapshot-plan'),
    repositoryPermissions: { contents: 'write' },
    organizationPermissions: {},
    capturedAt: '2026-07-24T08:00:00.000Z',
  };
  const credential: GitHubCredentialEnrollmentRecord = {
    enrollmentId: 'enrollment-plan',
    schemaVersion: GITHUB_AUTHORITY_CONTRACT_VERSION,
    ownerPrincipal: 'stealtheye-owner',
    provider: 'github',
    credentialType: 'ssh_deploy_key',
    credentialReferenceId: 'credential-plan-ref',
    accountOrInstallationId: 'StealthEyeLLC/baby-quirt',
    repositoryAuthorityIds: ['authority-plan'],
    allowedOperationFamilies: ['git_write'],
    permissionSnapshotDigest: permissionSnapshot.digest,
    encryptedCredentialName: credentialName,
    encryptedCredentialDigest: sha256Hex(encrypted),
    createdAt: '2026-07-24T08:00:00.000Z',
    revoked: false,
    plaintextPersisted: false,
  };
  const authority: GitHubRepositoryAuthority = {
    authorityId: 'authority-plan',
    schemaVersion: GITHUB_AUTHORITY_CONTRACT_VERSION,
    principal: 'stealtheye-owner',
    repository: {
      repositoryId: 'StealthEyeLLC-baby-quirt-plan',
      canonicalRemote: 'git@github.com:StealthEyeLLC/baby-quirt.git',
      host: 'github.com', owner: 'StealthEyeLLC', name: 'baby-quirt',
    },
    credentialReferenceId: credential.credentialReferenceId,
    credentialType: credential.credentialType,
    readWriteClassification: 'read_write',
    allowedBranchPatterns: ['refs/heads/build/*'],
    allowedOperationFamilies: ['git_write'],
    permissionSnapshot,
    pinnedSshHostKeyDigest: sha256Hex(knownHosts),
    createdAt: '2026-07-24T08:00:00.000Z',
    revoked: false,
    health: 'healthy',
  };
  return { root, credentialPath, knownHosts, credential, authority };
}

describe('encrypted credential execution planning', () => {
  it('builds a noninteractive systemd credential plan without plaintext material', () => {
    const value = fixtures();
    const plan = createEncryptedCredentialExecutionPlan({
      requestId: 'credential-plan-request-001',
      authority: value.authority,
      credential: value.credential,
      encryptedCredentialRoot: value.root,
      encryptedCredentialPath: value.credentialPath,
      knownHosts: value.knownHosts,
      git: {
        kind: 'push',
        remote: 'git@github.com:StealthEyeLLC/baby-quirt.git',
        refspecs: ['0857bc9fc2af88c529044515c2b5bbf1f478042a:refs/heads/build/universal-github-authority-v1'],
      },
      expectedOwnerUid: process.getuid?.(),
    });
    assert.equal(plan.nonInteractive, true);
    assert.equal(plan.plaintextPersisted, false);
    assert.equal(plan.encryptedCredentialMode, 0o600);
    assert.ok(plan.systemdRunArgv.includes('/usr/local/libexec/baby-quirt/baby-github'));
    assert.ok(plan.systemdRunArgv.some((arg) => arg.startsWith('--property=LoadCredentialEncrypted=github-baby-quirt-ssh:')));
    assert.doesNotMatch(JSON.stringify(plan), /PRIVATE KEY|systemd-encrypted-credential-fixture/u);
    const helperRequest = JSON.parse(plan.stdin) as { operation: string; credentialName: string };
    assert.deepEqual({ operation: helperRequest.operation, credentialName: helperRequest.credentialName }, {
      operation: 'git', credentialName: 'github-baby-quirt-ssh',
    });
  });

  it('rejects pinned host-key mismatch, broad permissions, and symlink credentials', () => {
    const value = fixtures();
    const base = {
      requestId: 'credential-plan-request-002',
      authority: value.authority,
      credential: value.credential,
      encryptedCredentialRoot: value.root,
      encryptedCredentialPath: value.credentialPath,
      knownHosts: value.knownHosts,
      git: { kind: 'ls-remote' as const, remote: 'git@github.com:StealthEyeLLC/baby-quirt.git' },
    };
    assert.throws(() => createEncryptedCredentialExecutionPlan({ ...base, knownHosts: `${value.knownHosts}changed` }), /host-key digest mismatch/iu);
    chmodSync(value.credentialPath, 0o644);
    assert.throws(() => createEncryptedCredentialExecutionPlan(base), /permissions are too broad/iu);
    chmodSync(value.credentialPath, 0o600);
    unlinkSync(value.credentialPath);
    writeFileSync(join(value.root, 'target.cred'), 'systemd-encrypted-credential-fixture', { mode: 0o600 });
    symlinkSync(join(value.root, 'target.cred'), value.credentialPath);
    assert.throws(() => createEncryptedCredentialExecutionPlan(base), /non-symlink/iu);
  });
});
