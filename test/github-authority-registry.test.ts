import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';
import { sha256Hex } from '../src/crypto/canonical.js';
import { DeploymentDatabase } from '../src/deployment/database.js';
import {
  computePermissionSnapshotDigest,
  GitHubAuthorityRegistryError,
} from '../src/github/authority-registry.js';
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

function makeDatabasePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'bq-github-authority-'));
  roots.push(root);
  return join(root, 'state', 'deployment.sqlite');
}

const knownHosts = 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n';

function snapshot(): GitHubPermissionSnapshot {
  const value = {
    snapshotId: 'permission-snapshot-001',
    repositoryPermissions: { contents: 'write', pull_requests: 'write', actions: 'read' } as const,
    organizationPermissions: { members: 'none' } as const,
    capturedAt: '2026-07-24T08:00:00.000Z',
  };
  return { ...value, digest: computePermissionSnapshotDigest(value) };
}

function credential(permissionSnapshot: GitHubPermissionSnapshot): GitHubCredentialEnrollmentRecord {
  return {
    enrollmentId: 'credential-enrollment-001',
    schemaVersion: GITHUB_AUTHORITY_CONTRACT_VERSION,
    ownerPrincipal: 'stealtheye-owner',
    provider: 'github',
    credentialType: 'ssh_deploy_key',
    credentialReferenceId: 'github-baby-quirt-ssh-ref',
    accountOrInstallationId: 'StealthEyeLLC/baby-quirt',
    repositoryAuthorityIds: ['baby-quirt-authority-001'],
    allowedOperationFamilies: ['git_read', 'git_write'],
    permissionSnapshotDigest: permissionSnapshot.digest,
    encryptedCredentialName: 'github-baby-quirt-ssh',
    encryptedCredentialDigest: sha256Hex('encrypted-credential-blob'),
    createdAt: '2026-07-24T08:01:00.000Z',
    expiresAt: '2027-07-24T08:01:00.000Z',
    revoked: false,
    plaintextPersisted: false,
  };
}

function authority(permissionSnapshot: GitHubPermissionSnapshot): GitHubRepositoryAuthority {
  return {
    authorityId: 'baby-quirt-authority-001',
    schemaVersion: GITHUB_AUTHORITY_CONTRACT_VERSION,
    principal: 'stealtheye-owner',
    repository: {
      repositoryId: 'StealthEyeLLC-baby-quirt',
      canonicalRemote: 'git@github.com:StealthEyeLLC/baby-quirt.git',
      host: 'github.com',
      owner: 'StealthEyeLLC',
      name: 'baby-quirt',
    },
    credentialReferenceId: 'github-baby-quirt-ssh-ref',
    credentialType: 'ssh_deploy_key',
    readWriteClassification: 'read_write',
    allowedBranchPatterns: ['refs/heads/build/*'],
    allowedOperationFamilies: ['git_read', 'git_write'],
    permissionSnapshot,
    pinnedSshHostKeyDigest: sha256Hex(knownHosts),
    createdAt: '2026-07-24T08:02:00.000Z',
    expiresAt: '2027-07-24T08:02:00.000Z',
    revoked: false,
    lastVerifiedAt: '2026-07-24T08:03:00.000Z',
    health: 'healthy',
  };
}

function assertCode(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof GitHubAuthorityRegistryError);
    assert.equal(error.code, code);
    return true;
  });
}

describe('GitHub authority registry', () => {
  it('preserves the authority migration while advancing the same Baby deployment database to version 6', () => {
    const path = makeDatabasePath();
    const database = new DeploymentDatabase(path);
    database.close();
    const raw = new DatabaseSync(path, { readOnly: true });
    const version = raw.prepare('PRAGMA user_version').get() as { user_version: number };
    const migration = raw.prepare('SELECT version, name FROM schema_migrations WHERE version = 3').get();
    raw.close();
    assert.equal(version.user_version, 6);
    assert.deepEqual({ ...migration }, { version: 3, name: 'github_authority_registry_v1' });
  });

  it('persists permission, credential-reference, and repository-authority metadata without plaintext credentials', () => {
    const path = makeDatabasePath();
    const database = new DeploymentDatabase(path);
    const permissions = snapshot();
    const enrollment = credential(permissions);
    const repositoryAuthority = authority(permissions);
    assert.deepEqual(database.githubAuthorities.registerPermissionSnapshot(permissions), permissions);
    assert.deepEqual(database.githubAuthorities.registerCredentialEnrollment(enrollment), enrollment);
    assert.deepEqual(database.githubAuthorities.registerRepositoryAuthority(repositoryAuthority), repositoryAuthority);
    assert.deepEqual(database.githubAuthorities.listRepositoryAuthorities(), [repositoryAuthority]);
    database.close();

    const raw = new DatabaseSync(path, { readOnly: true });
    const credentialRow = raw.prepare(`SELECT credential_reference_id, encrypted_credential_name,
      encrypted_credential_digest, plaintext_persisted FROM github_credential_enrollments`).get();
    const schema = raw.prepare(`SELECT group_concat(sql, '\n') AS sql FROM sqlite_master
      WHERE name LIKE 'github_%'`).get() as { sql: string };
    raw.close();
    assert.deepEqual({ ...credentialRow }, {
      credential_reference_id: enrollment.credentialReferenceId,
      encrypted_credential_name: enrollment.encryptedCredentialName,
      encrypted_credential_digest: enrollment.encryptedCredentialDigest,
      plaintext_persisted: 0,
    });
    assert.doesNotMatch(schema.sql, /private_key|secret_value|token_value|plaintext_value/iu);
    assert.doesNotMatch(readFileSync(path).toString('latin1'), /BEGIN OPENSSH PRIVATE KEY|ghp_[A-Za-z0-9]/u);
  });

  it('enforces exact credential, operation, branch, write, expiry, and revocation authority', () => {
    const database = new DeploymentDatabase(makeDatabasePath());
    const permissions = snapshot();
    const enrollment = credential(permissions);
    const repositoryAuthority = authority(permissions);
    database.githubAuthorities.registerPermissionSnapshot(permissions);
    database.githubAuthorities.registerCredentialEnrollment(enrollment);
    database.githubAuthorities.registerRepositoryAuthority(repositoryAuthority);

    const resolved = database.githubAuthorities.resolveAuthorizedCredential({
      authorityId: repositoryAuthority.authorityId,
      credentialReferenceId: enrollment.credentialReferenceId,
      operationFamily: 'git_write',
      branch: 'refs/heads/build/checkpoint-b',
      requireWrite: true,
      now: '2026-07-24T09:00:00.000Z',
    });
    assert.equal(resolved.credential.encryptedCredentialName, 'github-baby-quirt-ssh');
    assertCode(() => database.githubAuthorities.resolveAuthorizedCredential({
      authorityId: repositoryAuthority.authorityId,
      credentialReferenceId: 'other-repository-credential',
      operationFamily: 'git_write',
    }), 'github_cross_repository_credential_denied');
    assertCode(() => database.githubAuthorities.resolveAuthorizedCredential({
      authorityId: repositoryAuthority.authorityId,
      credentialReferenceId: enrollment.credentialReferenceId,
      operationFamily: 'workflow_admin',
    }), 'github_operation_not_authorized');
    assertCode(() => database.githubAuthorities.resolveAuthorizedCredential({
      authorityId: repositoryAuthority.authorityId,
      credentialReferenceId: enrollment.credentialReferenceId,
      operationFamily: 'git_write',
      branch: 'refs/heads/main',
    }), 'github_branch_not_authorized');
    assertCode(() => database.githubAuthorities.resolveAuthorizedCredential({
      authorityId: repositoryAuthority.authorityId,
      credentialReferenceId: enrollment.credentialReferenceId,
      operationFamily: 'git_write',
      now: '2028-01-01T00:00:00.000Z',
    }), 'github_credential_expired');

    const observed = database.githubAuthorities.updateRepositoryAuthorityObservation({
      authorityId: repositoryAuthority.authorityId,
      health: 'unavailable',
      lastVerifiedAt: '2026-07-24T09:01:00.000Z',
      revoked: true,
    });
    assert.equal(observed.revoked, true);
    assert.equal(observed.health, 'unavailable');
    assertCode(() => database.githubAuthorities.resolveAuthorizedCredential({
      authorityId: repositoryAuthority.authorityId,
      credentialReferenceId: enrollment.credentialReferenceId,
      operationFamily: 'git_read',
    }), 'github_credential_revoked');
    database.close();
  });

  it('detects migration checksum tampering', () => {
    const path = makeDatabasePath();
    const first = new DeploymentDatabase(path);
    first.close();
    chmodSync(path, 0o600);
    const raw = new DatabaseSync(path);
    raw.exec("UPDATE schema_migrations SET checksum = '" + '0'.repeat(64) + "' WHERE version = 3");
    raw.close();
    assert.throws(() => new DeploymentDatabase(path), /identity does not match|checksum/iu);
  });
});
