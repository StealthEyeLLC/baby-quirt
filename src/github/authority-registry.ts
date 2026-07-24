/** Durable metadata-only GitHub repository authority and credential registry. */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { canonicalJson, sha256Hex } from '../crypto/canonical.js';
import type {
  GitHubCredentialEnrollmentRecord,
  GitHubPermissionSnapshot,
  GitHubRepositoryAuthority,
} from './contracts.js';

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const HEALTH = new Set(['healthy', 'degraded', 'unavailable', 'unknown']);

export const GITHUB_AUTHORITY_REGISTRY_MIGRATION = {
  version: 3,
  name: 'github_authority_registry_v1',
  sql: `
CREATE TABLE github_permission_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL UNIQUE CHECK (length(digest) = 64),
  repository_permissions_json TEXT NOT NULL,
  organization_permissions_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64)
) STRICT;

CREATE TABLE github_credential_enrollments (
  credential_reference_id TEXT PRIMARY KEY,
  enrollment_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  owner_principal TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'github'),
  credential_type TEXT NOT NULL,
  account_or_installation_id TEXT NOT NULL,
  repository_authority_ids_json TEXT NOT NULL,
  allowed_operation_families_json TEXT NOT NULL,
  permission_snapshot_digest TEXT NOT NULL REFERENCES github_permission_snapshots(digest),
  encrypted_credential_name TEXT NOT NULL,
  encrypted_credential_digest TEXT NOT NULL CHECK (length(encrypted_credential_digest) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked INTEGER NOT NULL CHECK (revoked IN (0, 1)),
  plaintext_persisted INTEGER NOT NULL CHECK (plaintext_persisted = 0),
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64)
) STRICT;

CREATE TABLE github_repository_authorities (
  authority_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  principal TEXT NOT NULL,
  repository_id TEXT NOT NULL UNIQUE,
  repository_json TEXT NOT NULL,
  credential_reference_id TEXT NOT NULL REFERENCES github_credential_enrollments(credential_reference_id),
  credential_type TEXT NOT NULL,
  read_write_classification TEXT NOT NULL CHECK (read_write_classification IN ('read_only', 'read_write')),
  allowed_branch_patterns_json TEXT NOT NULL,
  allowed_operation_families_json TEXT NOT NULL,
  permission_snapshot_digest TEXT NOT NULL REFERENCES github_permission_snapshots(digest),
  pinned_ssh_host_key_digest TEXT CHECK (pinned_ssh_host_key_digest IS NULL OR length(pinned_ssh_host_key_digest) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked INTEGER NOT NULL CHECK (revoked IN (0, 1)),
  last_verified_at TEXT,
  health TEXT NOT NULL CHECK (health IN ('healthy', 'degraded', 'unavailable', 'unknown')),
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64)
) STRICT;

CREATE INDEX github_repository_authorities_credential_idx
  ON github_repository_authorities(credential_reference_id, repository_id);
CREATE INDEX github_repository_authorities_health_idx
  ON github_repository_authorities(health, revoked, authority_id);

CREATE TRIGGER github_permission_snapshots_no_update
BEFORE UPDATE ON github_permission_snapshots BEGIN
  SELECT RAISE(ABORT, 'permission snapshots are immutable');
END;
CREATE TRIGGER github_permission_snapshots_no_delete
BEFORE DELETE ON github_permission_snapshots BEGIN
  SELECT RAISE(ABORT, 'permission snapshots are append-only');
END;

CREATE TRIGGER github_credential_enrollments_identity_immutable
BEFORE UPDATE ON github_credential_enrollments
WHEN OLD.credential_reference_id != NEW.credential_reference_id
  OR OLD.enrollment_id != NEW.enrollment_id
  OR OLD.schema_version != NEW.schema_version
  OR OLD.owner_principal != NEW.owner_principal
  OR OLD.provider != NEW.provider
  OR OLD.credential_type != NEW.credential_type
  OR OLD.account_or_installation_id != NEW.account_or_installation_id
  OR OLD.encrypted_credential_name != NEW.encrypted_credential_name
  OR OLD.encrypted_credential_digest != NEW.encrypted_credential_digest
  OR OLD.created_at != NEW.created_at
  OR OLD.plaintext_persisted != NEW.plaintext_persisted
BEGIN
  SELECT RAISE(ABORT, 'credential enrollment identity is immutable');
END;
CREATE TRIGGER github_credential_enrollments_no_delete
BEFORE DELETE ON github_credential_enrollments BEGIN
  SELECT RAISE(ABORT, 'credential enrollments are durable references');
END;

CREATE TRIGGER github_repository_authorities_identity_immutable
BEFORE UPDATE ON github_repository_authorities
WHEN OLD.authority_id != NEW.authority_id
  OR OLD.schema_version != NEW.schema_version
  OR OLD.principal != NEW.principal
  OR OLD.repository_id != NEW.repository_id
  OR OLD.repository_json != NEW.repository_json
  OR OLD.credential_reference_id != NEW.credential_reference_id
  OR OLD.credential_type != NEW.credential_type
  OR OLD.read_write_classification != NEW.read_write_classification
  OR OLD.created_at != NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'repository authority identity is immutable');
END;
CREATE TRIGGER github_repository_authorities_no_delete
BEFORE DELETE ON github_repository_authorities BEGIN
  SELECT RAISE(ABORT, 'repository authorities are durable references');
END;
`,
} as const;

type SqlRow = Record<string, unknown>;

export class GitHubAuthorityRegistryError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'GitHubAuthorityRegistryError';
  }
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) throw new GitHubAuthorityRegistryError('github_authority_invalid', `${label} is invalid`);
}

function assertDigest(value: string, label: string): void {
  if (!DIGEST_PATTERN.test(value)) throw new GitHubAuthorityRegistryError('github_authority_invalid', `${label} must be a lowercase SHA-256`);
}

function assertTimestamp(value: string | undefined, label: string): void {
  if (value !== undefined && !Number.isFinite(Date.parse(value))) {
    throw new GitHubAuthorityRegistryError('github_authority_invalid', `${label} must be an ISO timestamp`);
  }
}

function asString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new GitHubAuthorityRegistryError('github_authority_integrity_failed', `${key} is invalid`);
  return value;
}

function asOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  return asString(row, key);
}

function asBoolean(row: SqlRow, key: string): boolean {
  const value = row[key];
  if (value !== 0 && value !== 1) throw new GitHubAuthorityRegistryError('github_authority_integrity_failed', `${key} is invalid`);
  return value === 1;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new GitHubAuthorityRegistryError('github_authority_integrity_failed', `${label} is invalid JSON`);
  }
}

function parameters(values: SQLInputValue[]): SQLInputValue[] {
  return values;
}

function branchMatches(pattern: string, branch: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*');
  return new RegExp(`^${escaped}$`, 'u').test(branch);
}

export function computePermissionSnapshotDigest(snapshot: Omit<GitHubPermissionSnapshot, 'digest'>): string {
  return sha256Hex(canonicalJson(snapshot));
}

function permissionSnapshotRecordDigest(snapshot: GitHubPermissionSnapshot): string {
  return sha256Hex(canonicalJson(snapshot));
}

function credentialRecordDigest(record: GitHubCredentialEnrollmentRecord): string {
  return sha256Hex(canonicalJson(record));
}

function authorityRecordDigest(record: GitHubRepositoryAuthority): string {
  return sha256Hex(canonicalJson(record));
}

function mapSnapshot(row: SqlRow): GitHubPermissionSnapshot {
  return {
    snapshotId: asString(row, 'snapshot_id'),
    digest: asString(row, 'digest'),
    repositoryPermissions: parseJson(asString(row, 'repository_permissions_json'), 'repository permissions'),
    organizationPermissions: parseJson(asString(row, 'organization_permissions_json'), 'organization permissions'),
    capturedAt: asString(row, 'captured_at'),
  };
}

function mapCredential(row: SqlRow): GitHubCredentialEnrollmentRecord {
  return {
    enrollmentId: asString(row, 'enrollment_id'),
    schemaVersion: asString(row, 'schema_version') as GitHubCredentialEnrollmentRecord['schemaVersion'],
    ownerPrincipal: asString(row, 'owner_principal'),
    provider: 'github',
    credentialType: asString(row, 'credential_type') as GitHubCredentialEnrollmentRecord['credentialType'],
    credentialReferenceId: asString(row, 'credential_reference_id'),
    accountOrInstallationId: asString(row, 'account_or_installation_id'),
    repositoryAuthorityIds: parseJson(asString(row, 'repository_authority_ids_json'), 'repository authority IDs'),
    allowedOperationFamilies: parseJson(asString(row, 'allowed_operation_families_json'), 'allowed operation families'),
    permissionSnapshotDigest: asString(row, 'permission_snapshot_digest'),
    encryptedCredentialName: asString(row, 'encrypted_credential_name'),
    encryptedCredentialDigest: asString(row, 'encrypted_credential_digest'),
    createdAt: asString(row, 'created_at'),
    ...(asOptionalString(row, 'expires_at') ? { expiresAt: asOptionalString(row, 'expires_at') } : {}),
    revoked: asBoolean(row, 'revoked'),
    plaintextPersisted: false,
  };
}

function mapAuthority(row: SqlRow, snapshot: GitHubPermissionSnapshot): GitHubRepositoryAuthority {
  return {
    authorityId: asString(row, 'authority_id'),
    schemaVersion: asString(row, 'schema_version') as GitHubRepositoryAuthority['schemaVersion'],
    principal: asString(row, 'principal'),
    repository: parseJson(asString(row, 'repository_json'), 'repository'),
    credentialReferenceId: asString(row, 'credential_reference_id'),
    credentialType: asString(row, 'credential_type') as GitHubRepositoryAuthority['credentialType'],
    readWriteClassification: asString(row, 'read_write_classification') as GitHubRepositoryAuthority['readWriteClassification'],
    allowedBranchPatterns: parseJson(asString(row, 'allowed_branch_patterns_json'), 'allowed branch patterns'),
    allowedOperationFamilies: parseJson(asString(row, 'allowed_operation_families_json'), 'allowed operation families'),
    permissionSnapshot: snapshot,
    ...(asOptionalString(row, 'pinned_ssh_host_key_digest') ? { pinnedSshHostKeyDigest: asOptionalString(row, 'pinned_ssh_host_key_digest') } : {}),
    createdAt: asString(row, 'created_at'),
    ...(asOptionalString(row, 'expires_at') ? { expiresAt: asOptionalString(row, 'expires_at') } : {}),
    revoked: asBoolean(row, 'revoked'),
    ...(asOptionalString(row, 'last_verified_at') ? { lastVerifiedAt: asOptionalString(row, 'last_verified_at') } : {}),
    health: asString(row, 'health') as GitHubRepositoryAuthority['health'],
  };
}

export class GitHubAuthorityRegistry {
  constructor(private readonly database: DatabaseSync) {}

  registerPermissionSnapshot(snapshot: GitHubPermissionSnapshot): GitHubPermissionSnapshot {
    assertIdentifier(snapshot.snapshotId, 'snapshotId');
    assertDigest(snapshot.digest, 'snapshot digest');
    assertTimestamp(snapshot.capturedAt, 'capturedAt');
    const expected = computePermissionSnapshotDigest({
      snapshotId: snapshot.snapshotId,
      repositoryPermissions: snapshot.repositoryPermissions,
      organizationPermissions: snapshot.organizationPermissions,
      capturedAt: snapshot.capturedAt,
    });
    if (snapshot.digest !== expected) {
      throw new GitHubAuthorityRegistryError('github_permission_snapshot_mismatch', 'Permission snapshot digest does not match content');
    }
    const recordDigest = permissionSnapshotRecordDigest(snapshot);
    this.database.prepare(`INSERT OR IGNORE INTO github_permission_snapshots(
      snapshot_id, digest, repository_permissions_json, organization_permissions_json, captured_at, record_digest
    ) VALUES (?, ?, ?, ?, ?, ?)`).run(...parameters([
      snapshot.snapshotId,
      snapshot.digest,
      canonicalJson(snapshot.repositoryPermissions),
      canonicalJson(snapshot.organizationPermissions),
      snapshot.capturedAt,
      recordDigest,
    ]));
    const stored = this.getPermissionSnapshotByDigest(snapshot.digest);
    if (!stored || permissionSnapshotRecordDigest(stored) !== recordDigest) {
      throw new GitHubAuthorityRegistryError('github_authority_conflict', 'Permission snapshot identity conflicts with existing state');
    }
    return stored;
  }

  getPermissionSnapshotByDigest(digest: string): GitHubPermissionSnapshot | undefined {
    assertDigest(digest, 'permission snapshot digest');
    const row = this.database.prepare('SELECT * FROM github_permission_snapshots WHERE digest = ?').get(digest) as SqlRow | undefined;
    if (!row) return undefined;
    const snapshot = mapSnapshot(row);
    if (permissionSnapshotRecordDigest(snapshot) !== asString(row, 'record_digest')) {
      throw new GitHubAuthorityRegistryError('github_authority_integrity_failed', 'Permission snapshot record digest mismatch');
    }
    return snapshot;
  }

  registerCredentialEnrollment(record: GitHubCredentialEnrollmentRecord): GitHubCredentialEnrollmentRecord {
    assertIdentifier(record.enrollmentId, 'enrollmentId');
    assertIdentifier(record.credentialReferenceId, 'credentialReferenceId');
    assertIdentifier(record.encryptedCredentialName, 'encryptedCredentialName');
    assertDigest(record.permissionSnapshotDigest, 'permissionSnapshotDigest');
    assertDigest(record.encryptedCredentialDigest, 'encryptedCredentialDigest');
    assertTimestamp(record.createdAt, 'createdAt');
    assertTimestamp(record.expiresAt, 'expiresAt');
    if (record.provider !== 'github' || record.plaintextPersisted !== false) {
      throw new GitHubAuthorityRegistryError('github_credential_invalid', 'Credential enrollment must be GitHub metadata with plaintextPersisted=false');
    }
    if (!this.getPermissionSnapshotByDigest(record.permissionSnapshotDigest)) {
      throw new GitHubAuthorityRegistryError('github_permission_snapshot_not_found', 'Credential permission snapshot does not exist');
    }
    const digest = credentialRecordDigest(record);
    this.database.prepare(`INSERT OR IGNORE INTO github_credential_enrollments(
      credential_reference_id, enrollment_id, schema_version, owner_principal, provider, credential_type,
      account_or_installation_id, repository_authority_ids_json, allowed_operation_families_json,
      permission_snapshot_digest, encrypted_credential_name, encrypted_credential_digest, created_at,
      expires_at, revoked, plaintext_persisted, record_digest
    ) VALUES (?, ?, ?, ?, 'github', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(...parameters([
      record.credentialReferenceId,
      record.enrollmentId,
      record.schemaVersion,
      record.ownerPrincipal,
      record.credentialType,
      record.accountOrInstallationId,
      canonicalJson(record.repositoryAuthorityIds),
      canonicalJson(record.allowedOperationFamilies),
      record.permissionSnapshotDigest,
      record.encryptedCredentialName,
      record.encryptedCredentialDigest,
      record.createdAt,
      record.expiresAt ?? null,
      record.revoked ? 1 : 0,
      digest,
    ]));
    const stored = this.getCredentialEnrollment(record.credentialReferenceId);
    if (!stored || credentialRecordDigest(stored) !== digest) {
      throw new GitHubAuthorityRegistryError('github_authority_conflict', 'Credential enrollment identity conflicts with existing state');
    }
    return stored;
  }

  getCredentialEnrollment(credentialReferenceId: string): GitHubCredentialEnrollmentRecord | undefined {
    assertIdentifier(credentialReferenceId, 'credentialReferenceId');
    const row = this.database.prepare('SELECT * FROM github_credential_enrollments WHERE credential_reference_id = ?').get(credentialReferenceId) as SqlRow | undefined;
    if (!row) return undefined;
    const record = mapCredential(row);
    if (credentialRecordDigest(record) !== asString(row, 'record_digest')) {
      throw new GitHubAuthorityRegistryError('github_authority_integrity_failed', 'Credential enrollment record digest mismatch');
    }
    return record;
  }

  registerRepositoryAuthority(authority: GitHubRepositoryAuthority): GitHubRepositoryAuthority {
    assertIdentifier(authority.authorityId, 'authorityId');
    assertIdentifier(authority.repository.repositoryId, 'repositoryId');
    assertIdentifier(authority.credentialReferenceId, 'credentialReferenceId');
    assertTimestamp(authority.createdAt, 'createdAt');
    assertTimestamp(authority.expiresAt, 'expiresAt');
    assertTimestamp(authority.lastVerifiedAt, 'lastVerifiedAt');
    if (!HEALTH.has(authority.health)) throw new GitHubAuthorityRegistryError('github_authority_invalid', 'health is invalid');
    if (authority.pinnedSshHostKeyDigest) assertDigest(authority.pinnedSshHostKeyDigest, 'pinnedSshHostKeyDigest');
    if (/^[a-z][a-z0-9+.-]*:\/\/[^/@]+:[^/@]+@/iu.test(authority.repository.canonicalRemote)) {
      throw new GitHubAuthorityRegistryError('github_authority_invalid', 'Repository remote must not contain embedded credentials');
    }
    const credential = this.getCredentialEnrollment(authority.credentialReferenceId);
    if (!credential) throw new GitHubAuthorityRegistryError('github_credential_not_found', 'Credential reference does not exist');
    if (credential.credentialType !== authority.credentialType) {
      throw new GitHubAuthorityRegistryError('github_authority_invalid', 'Authority credential type does not match enrollment');
    }
    if (credential.permissionSnapshotDigest !== authority.permissionSnapshot.digest) {
      throw new GitHubAuthorityRegistryError('github_permission_snapshot_mismatch', 'Authority and credential permission snapshots differ');
    }
    this.registerPermissionSnapshot(authority.permissionSnapshot);
    const digest = authorityRecordDigest(authority);
    this.database.prepare(`INSERT OR IGNORE INTO github_repository_authorities(
      authority_id, schema_version, principal, repository_id, repository_json, credential_reference_id,
      credential_type, read_write_classification, allowed_branch_patterns_json,
      allowed_operation_families_json, permission_snapshot_digest, pinned_ssh_host_key_digest,
      created_at, expires_at, revoked, last_verified_at, health, record_digest
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...parameters([
      authority.authorityId,
      authority.schemaVersion,
      authority.principal,
      authority.repository.repositoryId,
      canonicalJson(authority.repository),
      authority.credentialReferenceId,
      authority.credentialType,
      authority.readWriteClassification,
      canonicalJson(authority.allowedBranchPatterns),
      canonicalJson(authority.allowedOperationFamilies),
      authority.permissionSnapshot.digest,
      authority.pinnedSshHostKeyDigest ?? null,
      authority.createdAt,
      authority.expiresAt ?? null,
      authority.revoked ? 1 : 0,
      authority.lastVerifiedAt ?? null,
      authority.health,
      digest,
    ]));
    const stored = this.getRepositoryAuthority(authority.authorityId);
    if (!stored || authorityRecordDigest(stored) !== digest) {
      throw new GitHubAuthorityRegistryError('github_authority_conflict', 'Repository authority identity conflicts with existing state');
    }
    return stored;
  }

  getRepositoryAuthority(authorityId: string): GitHubRepositoryAuthority | undefined {
    assertIdentifier(authorityId, 'authorityId');
    const row = this.database.prepare('SELECT * FROM github_repository_authorities WHERE authority_id = ?').get(authorityId) as SqlRow | undefined;
    if (!row) return undefined;
    const snapshot = this.getPermissionSnapshotByDigest(asString(row, 'permission_snapshot_digest'));
    if (!snapshot) throw new GitHubAuthorityRegistryError('github_authority_integrity_failed', 'Authority permission snapshot is missing');
    const authority = mapAuthority(row, snapshot);
    if (authorityRecordDigest(authority) !== asString(row, 'record_digest')) {
      throw new GitHubAuthorityRegistryError('github_authority_integrity_failed', 'Repository authority record digest mismatch');
    }
    return authority;
  }

  listRepositoryAuthorities(input: { limit?: number; offset?: number } = {}): GitHubRepositoryAuthority[] {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) {
      throw new GitHubAuthorityRegistryError('github_authority_invalid', 'Pagination is invalid');
    }
    const rows = this.database.prepare('SELECT authority_id FROM github_repository_authorities ORDER BY authority_id LIMIT ? OFFSET ?').all(limit, offset) as SqlRow[];
    return rows.map((row) => this.getRepositoryAuthority(asString(row, 'authority_id')) as GitHubRepositoryAuthority);
  }

  resolveAuthorizedCredential(input: {
    authorityId: string;
    credentialReferenceId: string;
    operationFamily: string;
    branch?: string;
    now?: string;
    requireWrite?: boolean;
  }): { authority: GitHubRepositoryAuthority; credential: GitHubCredentialEnrollmentRecord } {
    const authority = this.getRepositoryAuthority(input.authorityId);
    if (!authority) throw new GitHubAuthorityRegistryError('github_authority_not_found', 'Repository authority does not exist');
    if (authority.credentialReferenceId !== input.credentialReferenceId) {
      throw new GitHubAuthorityRegistryError('github_cross_repository_credential_denied', 'Credential reference is not authorized for this repository authority');
    }
    const credential = this.getCredentialEnrollment(input.credentialReferenceId);
    if (!credential) throw new GitHubAuthorityRegistryError('github_credential_not_found', 'Credential reference does not exist');
    const now = Date.parse(input.now ?? new Date().toISOString());
    if (authority.revoked || credential.revoked) throw new GitHubAuthorityRegistryError('github_credential_revoked', 'Authority or credential is revoked');
    if ((authority.expiresAt && Date.parse(authority.expiresAt) <= now) || (credential.expiresAt && Date.parse(credential.expiresAt) <= now)) {
      throw new GitHubAuthorityRegistryError('github_credential_expired', 'Authority or credential is expired');
    }
    if (!authority.allowedOperationFamilies.includes(input.operationFamily) || !credential.allowedOperationFamilies.includes(input.operationFamily)) {
      throw new GitHubAuthorityRegistryError('github_operation_not_authorized', 'Operation family is not authorized');
    }
    if (input.requireWrite && authority.readWriteClassification !== 'read_write') {
      throw new GitHubAuthorityRegistryError('github_write_not_authorized', 'Repository authority is read-only');
    }
    if (input.branch && !authority.allowedBranchPatterns.some((pattern) => branchMatches(pattern, input.branch as string))) {
      throw new GitHubAuthorityRegistryError('github_branch_not_authorized', 'Branch is outside the repository authority');
    }
    return { authority, credential };
  }

  updateRepositoryAuthorityObservation(input: {
    authorityId: string;
    health: GitHubRepositoryAuthority['health'];
    lastVerifiedAt: string;
    revoked?: boolean;
  }): GitHubRepositoryAuthority {
    assertIdentifier(input.authorityId, 'authorityId');
    assertTimestamp(input.lastVerifiedAt, 'lastVerifiedAt');
    if (!HEALTH.has(input.health)) throw new GitHubAuthorityRegistryError('github_authority_invalid', 'health is invalid');
    const current = this.getRepositoryAuthority(input.authorityId);
    if (!current) throw new GitHubAuthorityRegistryError('github_authority_not_found', 'Repository authority does not exist');
    const updated: GitHubRepositoryAuthority = {
      ...current,
      health: input.health,
      lastVerifiedAt: input.lastVerifiedAt,
      revoked: input.revoked ?? current.revoked,
    };
    this.database.prepare(`UPDATE github_repository_authorities
      SET health = ?, last_verified_at = ?, revoked = ?, record_digest = ? WHERE authority_id = ?`).run(
      updated.health,
      updated.lastVerifiedAt ?? null,
      updated.revoked ? 1 : 0,
      authorityRecordDigest(updated),
      updated.authorityId,
    );
    return this.getRepositoryAuthority(updated.authorityId) as GitHubRepositoryAuthority;
  }
}
