/** Durable fast-forward-only Git publication with exact external reconciliation. */

import { spawnSync } from 'node:child_process';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { canonicalJson, sha256Hex } from '../crypto/canonical.js';
import { GitHubAuthorityRegistry } from './authority-registry.js';
import {
  createEncryptedCredentialExecutionPlan,
  type EncryptedCredentialExecutionPlan,
} from './credential-execution.js';
import type {
  GitHubCredentialEnrollmentRecord,
  GitHubRepositoryAuthority,
  GitPushPlan,
  GitRemoteReadback,
  GitWorkspaceIdentity,
} from './contracts.js';
import type { GitHubHelperGitOperation, GitHubHelperResult } from './helper.js';
import { GitWorkspaceRegistry, type GitWorkspaceRecord } from './repository-truth.js';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,256}$/u;
const OBJECT_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_REF_PATTERN = /^refs\/(?:heads|tags)\/(?!-)(?!.*(?:\.\.|@\{|\\|\s|[~^:?*\[]))(?!.*\/$)(?!.*\/\.)[^\u0000-\u001f\u007f]+$/u;
const MAX_OBJECTS_TO_TRANSFER = 100_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export const GITHUB_SAFE_PUBLICATION_MIGRATION = {
  version: 5,
  name: 'github_safe_publication_v1',
  sql: `
CREATE TABLE github_git_push_plans (
  plan_id TEXT PRIMARY KEY,
  plan_digest TEXT NOT NULL UNIQUE CHECK (length(plan_digest) = 64),
  semantic_digest TEXT NOT NULL CHECK (length(semantic_digest) = 64),
  repository_authority_id TEXT NOT NULL REFERENCES github_repository_authorities(authority_id),
  workspace_id TEXT NOT NULL REFERENCES github_git_workspaces(workspace_id),
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64)
) STRICT;

CREATE TABLE github_git_push_runs (
  mutation_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  semantic_digest TEXT NOT NULL CHECK (length(semantic_digest) = 64),
  plan_id TEXT NOT NULL REFERENCES github_git_push_plans(plan_id),
  principal TEXT NOT NULL,
  authorization_reference TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'intent_persisted', 'remote_attempted', 'remote_reconciled',
    'verified', 'failed', 'ambiguous', 'unknown'
  )),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  git_observation_id TEXT,
  github_observation_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64)
) STRICT;

CREATE TABLE github_git_remote_observations (
  observation_id TEXT PRIMARY KEY,
  mutation_id TEXT REFERENCES github_git_push_runs(mutation_id),
  source TEXT NOT NULL CHECK (source IN ('git_transport', 'github_api')),
  observation_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64)
) STRICT;

CREATE TABLE github_git_push_events (
  mutation_id TEXT NOT NULL REFERENCES github_git_push_runs(mutation_id),
  cursor INTEGER NOT NULL CHECK (cursor > 0),
  state TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail_digest TEXT NOT NULL CHECK (length(detail_digest) = 64),
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (mutation_id, cursor)
) STRICT;

CREATE INDEX github_git_push_plans_authority_idx
  ON github_git_push_plans(repository_authority_id, workspace_id, created_at);
CREATE INDEX github_git_push_runs_plan_idx
  ON github_git_push_runs(plan_id, state, updated_at);
CREATE INDEX github_git_remote_observations_mutation_idx
  ON github_git_remote_observations(mutation_id, source, observed_at);

CREATE TRIGGER github_git_push_plans_no_update
BEFORE UPDATE ON github_git_push_plans BEGIN
  SELECT RAISE(ABORT, 'Git push plans are immutable');
END;
CREATE TRIGGER github_git_push_plans_no_delete
BEFORE DELETE ON github_git_push_plans BEGIN
  SELECT RAISE(ABORT, 'Git push plans are durable records');
END;
CREATE TRIGGER github_git_push_runs_identity_immutable
BEFORE UPDATE ON github_git_push_runs
WHEN OLD.mutation_id != NEW.mutation_id
  OR OLD.idempotency_key != NEW.idempotency_key
  OR OLD.semantic_digest != NEW.semantic_digest
  OR OLD.plan_id != NEW.plan_id
  OR OLD.principal != NEW.principal
  OR OLD.authorization_reference != NEW.authorization_reference
  OR OLD.created_at != NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'Git push run identity is immutable');
END;
CREATE TRIGGER github_git_push_runs_no_delete
BEFORE DELETE ON github_git_push_runs BEGIN
  SELECT RAISE(ABORT, 'Git push runs are durable records');
END;
CREATE TRIGGER github_git_remote_observations_no_update
BEFORE UPDATE ON github_git_remote_observations BEGIN
  SELECT RAISE(ABORT, 'Git remote observations are immutable');
END;
CREATE TRIGGER github_git_remote_observations_no_delete
BEFORE DELETE ON github_git_remote_observations BEGIN
  SELECT RAISE(ABORT, 'Git remote observations are durable records');
END;
CREATE TRIGGER github_git_push_events_no_update
BEFORE UPDATE ON github_git_push_events BEGIN
  SELECT RAISE(ABORT, 'Git push events are append-only');
END;
CREATE TRIGGER github_git_push_events_no_delete
BEFORE DELETE ON github_git_push_events BEGIN
  SELECT RAISE(ABORT, 'Git push events are append-only');
END;
`,
} as const;

type SqlRow = Record<string, unknown>;

export type GitPushRunState =
  | 'intent_persisted'
  | 'remote_attempted'
  | 'remote_reconciled'
  | 'verified'
  | 'failed'
  | 'ambiguous'
  | 'unknown';

export interface GitPushRunRecord {
  mutationId: string;
  idempotencyKey: string;
  semanticDigest: string;
  planId: string;
  principal: string;
  authorizationReference: string;
  state: GitPushRunState;
  attempt: number;
  gitObservationId?: string;
  githubObservationId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitPushEvent {
  mutationId: string;
  cursor: number;
  state: GitPushRunState;
  kind: string;
  detailDigest: string;
  occurredAt: string;
}

export interface GitHubApiReadbackInput {
  authority: GitHubRepositoryAuthority;
  destinationRef: string;
  expectedCommit: string;
  expectedTree: string;
}

export interface GitTransportObservation {
  object?: string;
  evidenceReferences: string[];
}

export interface GitTransportPushResult {
  outcome: 'completed' | 'failed' | 'unknown';
  exitCode?: number;
  evidenceReferences: string[];
}

export interface GitPublicationTransport {
  observeRef(input: {
    requestId: string;
    authority: GitHubRepositoryAuthority;
    credentialReferenceId: string;
    remote: string;
    destinationRef: string;
  }): GitTransportObservation;
  push(input: {
    requestId: string;
    authority: GitHubRepositoryAuthority;
    credentialReferenceId: string;
    remote: string;
    workspace: GitWorkspaceIdentity;
    sourceCommit: string;
    destinationRef: string;
    expectedOldObject?: string;
  }): GitTransportPushResult;
}

export interface GitHubApiRemoteReadback {
  repositoryId: string;
  destinationRef: string;
  observedCommit?: string;
  observedTree?: string;
  evidenceReferences: string[];
  observedAt: string;
}

export interface GitHubApiReadbackProvider {
  verifyRemote(input: GitHubApiReadbackInput): GitHubApiRemoteReadback;
}

export interface GitSafePublicationOptions {
  authorityRegistry: GitHubAuthorityRegistry;
  workspaceRegistry: GitWorkspaceRegistry;
  publicationRegistry: GitSafePublicationRegistry;
  encryptedCredentialPath?: (credential: GitHubCredentialEnrollmentRecord) => string;
  knownHosts?: (authority: GitHubRepositoryAuthority) => string;
  githubApiReadback?: (input: GitHubApiReadbackInput) => GitRemoteReadback;
  transport?: GitPublicationTransport;
  apiReadback?: GitHubApiReadbackProvider;
  executeCredentialPlan?: (plan: EncryptedCredentialExecutionPlan) => GitHubHelperResult;
  helperPath?: string;
  gitPath?: string;
  now?: () => string;
  timeoutMs?: number;
}

export interface GitPushApplyResult {
  mutationId: string;
  state: 'verified';
  readback: GitRemoteReadback;
  githubApiReadback: GitRemoteReadback;
  evidenceReferences: string[];
  events: GitPushEvent[];
}

export class GitSafePublicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'GitSafePublicationError';
  }
}

function asString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new GitSafePublicationError('publication_integrity_failed', `${key} is invalid`);
  return value;
}

function asOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  return asString(row, key);
}

function asNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new GitSafePublicationError('publication_integrity_failed', `${key} is invalid`);
  }
  return value;
}

function parameters(values: SQLInputValue[]): SQLInputValue[] {
  return values;
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) throw new GitSafePublicationError('invalid_request', `${label} is invalid`);
}

function assertIdempotencyKey(value: string): void {
  if (!IDEMPOTENCY_PATTERN.test(value)) throw new GitSafePublicationError('invalid_request', 'idempotencyKey is invalid');
}

function assertObject(value: string | undefined, label: string): void {
  if (value !== undefined && !OBJECT_PATTERN.test(value)) {
    throw new GitSafePublicationError('invalid_request', `${label} is not a SHA-1 Git object ID`);
  }
}

function assertDigest(value: string, label: string): void {
  if (!DIGEST_PATTERN.test(value)) throw new GitSafePublicationError('invalid_request', `${label} is not a SHA-256 digest`);
}

function assertRef(value: string, label: string): void {
  if (!SAFE_REF_PATTERN.test(value) || value.endsWith('.lock')) {
    throw new GitSafePublicationError('invalid_request', `${label} is not an allowed exact ref`);
  }
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new GitSafePublicationError('invalid_request', `${label} is invalid`);
}

function runDigest(record: GitPushRunRecord): string {
  return sha256Hex(canonicalJson(record));
}

function mapRun(row: SqlRow): GitPushRunRecord {
  return {
    mutationId: asString(row, 'mutation_id'),
    idempotencyKey: asString(row, 'idempotency_key'),
    semanticDigest: asString(row, 'semantic_digest'),
    planId: asString(row, 'plan_id'),
    principal: asString(row, 'principal'),
    authorizationReference: asString(row, 'authorization_reference'),
    state: asString(row, 'state') as GitPushRunState,
    attempt: asNumber(row, 'attempt'),
    ...(asOptionalString(row, 'git_observation_id') ? { gitObservationId: asOptionalString(row, 'git_observation_id') } : {}),
    ...(asOptionalString(row, 'github_observation_id') ? { githubObservationId: asOptionalString(row, 'github_observation_id') } : {}),
    ...(asOptionalString(row, 'error_code') ? { errorCode: asOptionalString(row, 'error_code') } : {}),
    ...(asOptionalString(row, 'error_message') ? { errorMessage: asOptionalString(row, 'error_message') } : {}),
    createdAt: asString(row, 'created_at'),
    updatedAt: asString(row, 'updated_at'),
  };
}

function planRecordDigest(plan: GitPushPlan, semanticDigest: string): string {
  return sha256Hex(canonicalJson({ plan, semanticDigest }));
}

export class GitSafePublicationRegistry {
  constructor(private readonly database: DatabaseSync) {}

  private transaction<T>(callback: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  registerPlan(plan: GitPushPlan, semanticDigest: string): GitPushPlan {
    assertIdentifier(plan.planId, 'planId');
    assertDigest(plan.planDigest, 'planDigest');
    assertDigest(semanticDigest, 'semanticDigest');
    const recordDigest = planRecordDigest(plan, semanticDigest);
    this.database.prepare(`INSERT OR IGNORE INTO github_git_push_plans(
      plan_id, plan_digest, semantic_digest, repository_authority_id, workspace_id,
      plan_json, created_at, expires_at, record_digest
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...parameters([
      plan.planId,
      plan.planDigest,
      semanticDigest,
      plan.repositoryAuthorityId,
      plan.workspace.workspaceId,
      canonicalJson(plan),
      plan.createdAt,
      plan.expiresAt,
      recordDigest,
    ]));
    const stored = this.getPlan(plan.planId);
    if (!stored || planRecordDigest(stored.plan, stored.semanticDigest) !== recordDigest) {
      throw new GitSafePublicationError('publication_plan_conflict', 'Plan ID has changed intent');
    }
    return stored.plan;
  }

  getPlan(planId: string): { plan: GitPushPlan; semanticDigest: string } | undefined {
    assertIdentifier(planId, 'planId');
    const row = this.database.prepare('SELECT * FROM github_git_push_plans WHERE plan_id = ?').get(planId) as SqlRow | undefined;
    if (!row) return undefined;
    const plan = JSON.parse(asString(row, 'plan_json')) as GitPushPlan;
    const semanticDigest = asString(row, 'semantic_digest');
    if (planRecordDigest(plan, semanticDigest) !== asString(row, 'record_digest')) {
      throw new GitSafePublicationError('publication_integrity_failed', 'Plan record digest mismatch');
    }
    return { plan, semanticDigest };
  }

  reserveRun(record: GitPushRunRecord): { created: boolean; record: GitPushRunRecord } {
    assertIdentifier(record.mutationId, 'mutationId');
    assertIdempotencyKey(record.idempotencyKey);
    assertDigest(record.semanticDigest, 'semanticDigest');
    return this.transaction(() => {
      const existingRow = this.database.prepare('SELECT * FROM github_git_push_runs WHERE idempotency_key = ?').get(record.idempotencyKey) as SqlRow | undefined;
      if (existingRow) {
        const existing = mapRun(existingRow);
        if (existing.semanticDigest !== record.semanticDigest || existing.mutationId !== record.mutationId) {
          throw new GitSafePublicationError('idempotency_conflict', 'Idempotency key has changed publication intent');
        }
        if (runDigest(existing) !== asString(existingRow, 'record_digest')) {
          throw new GitSafePublicationError('publication_integrity_failed', 'Push run digest mismatch');
        }
        return { created: false, record: existing };
      }
      this.database.prepare(`INSERT INTO github_git_push_runs(
        mutation_id, idempotency_key, semantic_digest, plan_id, principal,
        authorization_reference, state, attempt, git_observation_id,
        github_observation_id, error_code, error_message, created_at, updated_at,
        record_digest
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`).run(...parameters([
        record.mutationId,
        record.idempotencyKey,
        record.semanticDigest,
        record.planId,
        record.principal,
        record.authorizationReference,
        record.state,
        record.attempt,
        record.createdAt,
        record.updatedAt,
        runDigest(record),
      ]));
      return { created: true, record };
    });
  }

  getRun(mutationId: string): GitPushRunRecord | undefined {
    assertIdentifier(mutationId, 'mutationId');
    const row = this.database.prepare('SELECT * FROM github_git_push_runs WHERE mutation_id = ?').get(mutationId) as SqlRow | undefined;
    if (!row) return undefined;
    const record = mapRun(row);
    if (runDigest(record) !== asString(row, 'record_digest')) {
      throw new GitSafePublicationError('publication_integrity_failed', 'Push run digest mismatch');
    }
    return record;
  }

  updateRun(input: {
    mutationId: string;
    state: GitPushRunState;
    attempt?: number;
    gitObservationId?: string;
    githubObservationId?: string;
    errorCode?: string;
    errorMessage?: string;
    clearError?: boolean;
    updatedAt: string;
  }): GitPushRunRecord {
    const current = this.getRun(input.mutationId);
    if (!current) throw new GitSafePublicationError('publication_run_not_found', 'Push run does not exist');
    const updated: GitPushRunRecord = {
      ...current,
      state: input.state,
      attempt: input.attempt ?? current.attempt,
      ...(input.gitObservationId ? { gitObservationId: input.gitObservationId } : {}),
      ...(input.githubObservationId ? { githubObservationId: input.githubObservationId } : {}),
      ...(input.clearError
        ? { errorCode: undefined, errorMessage: undefined }
        : {
            ...(input.errorCode ? { errorCode: input.errorCode } : {}),
            ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
          }),
      updatedAt: input.updatedAt,
    };
    this.database.prepare(`UPDATE github_git_push_runs SET
      state = ?, attempt = ?, git_observation_id = ?, github_observation_id = ?,
      error_code = ?, error_message = ?, updated_at = ?, record_digest = ?
      WHERE mutation_id = ?`).run(
      updated.state,
      updated.attempt,
      updated.gitObservationId ?? null,
      updated.githubObservationId ?? null,
      updated.errorCode ?? null,
      updated.errorMessage ?? null,
      updated.updatedAt,
      runDigest(updated),
      updated.mutationId,
    );
    return this.getRun(updated.mutationId) as GitPushRunRecord;
  }

  recordObservation(input: {
    mutationId?: string;
    source: 'git_transport' | 'github_api';
    readback: GitRemoteReadback;
  }): string {
    const observationId = `git-remote-${sha256Hex(canonicalJson(input)).slice(0, 32)}`;
    const record = {
      observationId,
      mutationId: input.mutationId ?? null,
      source: input.source,
      readback: input.readback,
      observedAt: input.readback.observedAt,
    };
    const digest = sha256Hex(canonicalJson(record));
    this.database.prepare(`INSERT OR IGNORE INTO github_git_remote_observations(
      observation_id, mutation_id, source, observation_json, observed_at, record_digest
    ) VALUES (?, ?, ?, ?, ?, ?)`).run(
      observationId,
      input.mutationId ?? null,
      input.source,
      canonicalJson(input.readback),
      input.readback.observedAt,
      digest,
    );
    const row = this.database.prepare('SELECT * FROM github_git_remote_observations WHERE observation_id = ?').get(observationId) as SqlRow;
    const stored = {
      observationId: asString(row, 'observation_id'),
      mutationId: asOptionalString(row, 'mutation_id') ?? null,
      source: asString(row, 'source'),
      readback: JSON.parse(asString(row, 'observation_json')) as GitRemoteReadback,
      observedAt: asString(row, 'observed_at'),
    };
    if (sha256Hex(canonicalJson(stored)) !== asString(row, 'record_digest')) {
      throw new GitSafePublicationError('publication_integrity_failed', 'Remote observation digest mismatch');
    }
    return observationId;
  }

  getObservation(observationId: string): GitRemoteReadback | undefined {
    assertIdentifier(observationId, 'observationId');
    const row = this.database.prepare('SELECT observation_json FROM github_git_remote_observations WHERE observation_id = ?').get(observationId) as SqlRow | undefined;
    return row ? JSON.parse(asString(row, 'observation_json')) as GitRemoteReadback : undefined;
  }

  appendEvent(input: {
    mutationId: string;
    state: GitPushRunState;
    kind: string;
    detail: unknown;
    occurredAt: string;
  }): GitPushEvent {
    return this.transaction(() => {
      const row = this.database.prepare('SELECT COALESCE(MAX(cursor), 0) AS cursor FROM github_git_push_events WHERE mutation_id = ?').get(input.mutationId) as SqlRow;
      const cursor = asNumber(row, 'cursor') + 1;
      const event: GitPushEvent = {
        mutationId: input.mutationId,
        cursor,
        state: input.state,
        kind: input.kind,
        detailDigest: sha256Hex(canonicalJson(input.detail)),
        occurredAt: input.occurredAt,
      };
      this.database.prepare(`INSERT INTO github_git_push_events(
        mutation_id, cursor, state, kind, detail_digest, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?)`).run(
        event.mutationId,
        event.cursor,
        event.state,
        event.kind,
        event.detailDigest,
        event.occurredAt,
      );
      return event;
    });
  }

  listEvents(mutationId: string, afterCursor = 0, limit = 200): GitPushEvent[] {
    assertIdentifier(mutationId, 'mutationId');
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new GitSafePublicationError('invalid_request', 'Event pagination is invalid');
    }
    return (this.database.prepare(`SELECT * FROM github_git_push_events
      WHERE mutation_id = ? AND cursor > ? ORDER BY cursor LIMIT ?`).all(mutationId, afterCursor, limit) as SqlRow[])
      .map((row) => ({
        mutationId: asString(row, 'mutation_id'),
        cursor: asNumber(row, 'cursor'),
        state: asString(row, 'state') as GitPushRunState,
        kind: asString(row, 'kind'),
        detailDigest: asString(row, 'detail_digest'),
        occurredAt: asString(row, 'occurred_at'),
      }));
  }
}

export class GitSafePublication {
  private readonly gitPath: string;
  private readonly timeoutMs: number;
  private readonly now: () => string;
  private readonly executeCredentialPlan: (plan: EncryptedCredentialExecutionPlan) => GitHubHelperResult;

  constructor(private readonly options: GitSafePublicationOptions) {
    this.gitPath = options.gitPath ?? '/usr/bin/git';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date().toISOString());
    this.executeCredentialPlan = options.executeCredentialPlan ?? ((plan) => this.executeSystemdPlan(plan));
  }

  preview(input: {
    principal?: string;
    repositoryAuthorityId: string;
    workspaceId: string;
    credentialReferenceId: string;
    sourceRef: string;
    destinationRef: string;
    expectedRemoteOldObject?: string;
    expiresAt: string;
  }): GitPushPlan {
    if (input.principal !== undefined) assertIdentifier(input.principal, 'principal');
    assertIdentifier(input.repositoryAuthorityId, 'repositoryAuthorityId');
    assertIdentifier(input.workspaceId, 'workspaceId');
    assertIdentifier(input.credentialReferenceId, 'credentialReferenceId');
    assertRef(input.sourceRef, 'sourceRef');
    assertRef(input.destinationRef, 'destinationRef');
    assertObject(input.expectedRemoteOldObject, 'expectedRemoteOldObject');
    assertTimestamp(input.expiresAt, 'expiresAt');
    const createdAt = this.now();
    if (Date.parse(input.expiresAt) <= Date.parse(createdAt)) {
      throw new GitSafePublicationError('plan_expired', 'Push plan expiration must be in the future');
    }
    const { authority, credential } = this.options.authorityRegistry.resolveAuthorizedCredential({
      authorityId: input.repositoryAuthorityId,
      credentialReferenceId: input.credentialReferenceId,
      operationFamily: 'git.transport',
      branch: input.destinationRef,
      requireWrite: true,
      now: createdAt,
    });
    if (input.principal !== undefined && authority.principal !== input.principal) {
      throw new GitSafePublicationError('authority_missing', 'Principal does not own repository authority');
    }
    const principal = authority.principal;
    const workspaceRecord = this.requireWorkspace(input.repositoryAuthorityId, input.workspaceId);
    const workspace = this.readWorkspaceIdentity(workspaceRecord);
    if (!workspace.clean) throw new GitSafePublicationError('dirty_worktree', 'Publication requires a clean worktree');
    const sourceObject = this.git(['rev-parse', `${input.sourceRef}^{commit}`], workspaceRecord.worktreePath).stdout.trim();
    if (sourceObject !== workspace.head) {
      throw new GitSafePublicationError('local_identity_mismatch', 'Source ref does not equal workspace HEAD', { sourceObject });
    }
    const observedRemoteObject = this.readRemoteObject({
      requestId: `preview-${sha256Hex(canonicalJson(input)).slice(0, 24)}`,
      authority,
      credential,
      destinationRef: input.destinationRef,
    });
    if (observedRemoteObject !== input.expectedRemoteOldObject) {
      throw new GitSafePublicationError('remote_base_mismatch', 'Observed remote object differs from expected precondition', {
        observedRemoteObject: observedRemoteObject ?? null,
        expectedRemoteOldObject: input.expectedRemoteOldObject ?? null,
      });
    }
    let mergeBase: string | undefined;
    if (observedRemoteObject) {
      const available = this.git(['cat-file', '-e', `${observedRemoteObject}^{commit}`], workspaceRecord.worktreePath, [0, 1, 128]);
      if (available.status !== 0) {
        throw new GitSafePublicationError('remote_object_missing', 'Observed remote commit is unavailable locally');
      }
      const ancestry = this.git(['merge-base', '--is-ancestor', observedRemoteObject, workspace.head], workspaceRecord.worktreePath, [0, 1]);
      if (ancestry.status !== 0) throw new GitSafePublicationError('non_fast_forward', 'Publication is not a fast-forward');
      mergeBase = this.git(['merge-base', observedRemoteObject, workspace.head], workspaceRecord.worktreePath).stdout.trim();
    }
    const revList = this.git([
      'rev-list', '--objects', workspace.head,
      ...(observedRemoteObject ? [`^${observedRemoteObject}`] : []),
      '--',
    ], workspaceRecord.worktreePath).stdout;
    const objectsToTransfer = [...new Set(revList.split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u)[0])
      .filter((value): value is string => Boolean(value && OBJECT_PATTERN.test(value))))].sort();
    if (objectsToTransfer.length > MAX_OBJECTS_TO_TRANSFER) {
      throw new GitSafePublicationError('repository_limit_exceeded', 'Publication object set exceeds limit');
    }
    const semantic = {
      operation: 'baby.git.push.preview',
      principal,
      repositoryAuthorityId: input.repositoryAuthorityId,
      workspace,
      credentialReferenceId: input.credentialReferenceId,
      sourceRef: input.sourceRef,
      destinationRef: input.destinationRef,
      expectedRemoteOldObject: input.expectedRemoteOldObject ?? null,
      observedRemoteObject: observedRemoteObject ?? null,
      mergeBase: mergeBase ?? null,
      objectsToTransfer,
      expiresAt: input.expiresAt,
    };
    const semanticDigest = sha256Hex(canonicalJson(semantic));
    const planId = `git-push-plan-${semanticDigest.slice(0, 32)}`;
    const body: Omit<GitPushPlan, 'planDigest'> = {
      planId,
      principal,
      repositoryAuthorityId: input.repositoryAuthorityId,
      workspace,
      credentialReferenceId: input.credentialReferenceId,
      sourceRef: input.sourceRef,
      expectation: {
        remote: authority.repository.canonicalRemote,
        destinationRef: input.destinationRef,
        ...(observedRemoteObject ? { expectedOldObject: observedRemoteObject } : {}),
        newObject: workspace.head,
        newTree: workspace.tree,
        fastForwardOnly: true,
      },
      ...(mergeBase ? { mergeBase } : {}),
      objectsToTransfer,
      createdAt,
      expiresAt: input.expiresAt,
    };
    const plan: GitPushPlan = { ...body, planDigest: sha256Hex(canonicalJson(body)) };
    return this.options.publicationRegistry.registerPlan(plan, semanticDigest);
  }

  apply(input: {
    principal?: string;
    mutationId: string;
    semanticIdempotencyFingerprint: string;
    repositoryAuthorityId: string;
    planId: string;
    planDigest: string;
    expectedLocalHead: string;
    expectedLocalTree: string;
    expectedRemoteOldObject?: string;
    authorizationReference: string;
  }): GitPushApplyResult {
    if (input.principal !== undefined) assertIdentifier(input.principal, 'principal');
    assertIdempotencyKey(input.mutationId);
    assertDigest(input.semanticIdempotencyFingerprint, 'semanticIdempotencyFingerprint');
    assertIdentifier(input.repositoryAuthorityId, 'repositoryAuthorityId');
    assertIdentifier(input.planId, 'planId');
    assertDigest(input.planDigest, 'planDigest');
    assertObject(input.expectedLocalHead, 'expectedLocalHead');
    assertObject(input.expectedLocalTree, 'expectedLocalTree');
    assertObject(input.expectedRemoteOldObject, 'expectedRemoteOldObject');
    assertIdentifier(input.authorizationReference, 'authorizationReference');
    const stored = this.options.publicationRegistry.getPlan(input.planId);
    if (!stored) throw new GitSafePublicationError('publication_plan_not_found', 'Push plan does not exist');
    const plan = stored.plan;
    if (
      plan.planDigest !== input.planDigest ||
      plan.repositoryAuthorityId !== input.repositoryAuthorityId ||
      (input.principal !== undefined && plan.principal !== input.principal) ||
      plan.workspace.head !== input.expectedLocalHead ||
      plan.workspace.tree !== input.expectedLocalTree ||
      plan.expectation.expectedOldObject !== input.expectedRemoteOldObject
    ) {
      throw new GitSafePublicationError('publication_plan_mismatch', 'Apply request does not exactly match push plan');
    }
    const principal = plan.principal;
    const now = this.now();
    if (Date.parse(plan.expiresAt) <= Date.parse(now)) throw new GitSafePublicationError('plan_expired', 'Push plan is expired');
    const { authority, credential } = this.options.authorityRegistry.resolveAuthorizedCredential({
      authorityId: plan.repositoryAuthorityId,
      credentialReferenceId: plan.credentialReferenceId,
      operationFamily: 'git.transport',
      branch: plan.expectation.destinationRef,
      requireWrite: true,
      now,
    });
    const workspaceRecord = this.requireWorkspace(plan.repositoryAuthorityId, plan.workspace.workspaceId);
    const workspace = this.readWorkspaceIdentity(workspaceRecord);
    if (!workspace.clean) throw new GitSafePublicationError('dirty_worktree', 'Publication requires a clean worktree');
    if (workspace.head !== plan.expectation.newObject || workspace.tree !== plan.expectation.newTree) {
      throw new GitSafePublicationError('local_identity_mismatch', 'Workspace moved after push preview');
    }
    const semanticDigest = input.semanticIdempotencyFingerprint;
    const mutationId = input.mutationId;
    // Ordering invariant: reserveRun({ persists durable intent before transport.push({ can mutate the remote.
    const reservation = this.options.publicationRegistry.reserveRun({
      mutationId,
      idempotencyKey: input.mutationId,
      semanticDigest,
      planId: plan.planId,
      principal,
      authorizationReference: input.authorizationReference,
      state: 'intent_persisted',
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    });
    if (reservation.created) {
      this.options.publicationRegistry.appendEvent({
        mutationId,
        state: 'intent_persisted',
        kind: 'intent_persisted',
        detail: { planId: plan.planId, planDigest: plan.planDigest },
        occurredAt: now,
      });
    }
    if (reservation.record.state === 'verified') return this.completedResult(reservation.record);
    if (reservation.created) {
      this.options.publicationRegistry.appendEvent({
        mutationId,
        state: 'intent_persisted',
        kind: 'local_prepared',
        detail: { head: workspace.head, tree: workspace.tree, clean: workspace.clean },
        occurredAt: now,
      });
    }

    const initial = this.readback(plan, authority, credential, mutationId);
    if (initial.observedObject === plan.expectation.newObject) {
      return this.finishVerified(plan, mutationId, initial);
    }
    if (initial.observedObject !== plan.expectation.expectedOldObject) {
      this.failRun(mutationId, 'failed', 'remote_base_mismatch', 'Remote ref moved after the approved preview');
      throw new GitSafePublicationError('remote_base_mismatch', 'Remote ref moved after the approved preview');
    }

    const attemptedAt = this.now();
    const attempted = this.options.publicationRegistry.updateRun({
      mutationId,
      state: 'remote_attempted',
      attempt: reservation.record.attempt + 1,
      updatedAt: attemptedAt,
    });
    this.options.publicationRegistry.appendEvent({
      mutationId,
      state: 'remote_attempted',
      kind: 'push_attempted',
      detail: { attempt: attempted.attempt, expectedOldObject: plan.expectation.expectedOldObject ?? null },
      occurredAt: attemptedAt,
    });

    let helperFailure: string | undefined;
    let pushEvidenceReferences: string[] = [];
    try {
      if (this.options.transport) {
        const transport = this.options.transport;
        const result = transport.push({
          requestId: `${mutationId}-push-${attempted.attempt}`,
          authority,
          credentialReferenceId: credential.credentialReferenceId,
          remote: plan.expectation.remote,
          workspace,
          sourceCommit: plan.expectation.newObject,
          destinationRef: plan.expectation.destinationRef,
          ...(plan.expectation.expectedOldObject
            ? { expectedOldObject: plan.expectation.expectedOldObject }
            : {}),
        });
        pushEvidenceReferences = [...result.evidenceReferences];
        if (result.outcome === 'unknown') {
          pushEvidenceReferences.push('push-outcome:response-lost-reconciled');
          helperFailure = `outcome=${result.outcome};exit=${result.exitCode ?? 'unknown'}`;
        } else if (result.outcome !== 'completed') {
          helperFailure = `outcome=${result.outcome};exit=${result.exitCode ?? 'unknown'}`;
        }
      } else {
        const forceWithLease = `${plan.expectation.destinationRef}:${plan.expectation.expectedOldObject ?? ''}`;
        const result = this.executeGitOperation({
          requestId: `${mutationId}-push-${attempted.attempt}`,
          authority,
          credential,
          git: {
            kind: 'push',
            remote: plan.expectation.remote,
            refspecs: [`${plan.expectation.newObject}:${plan.expectation.destinationRef}`],
            forceWithLease,
          },
        });
        if (result.status !== 'completed' || result.exitCode !== 0 || result.cleanup !== 'completed' || result.redacted !== true) {
          helperFailure = `status=${result.status};exit=${result.exitCode};cleanup=${result.cleanup}`;
        }
      }
    } catch (error) {
      helperFailure = error instanceof Error ? error.message : 'Unknown encrypted helper failure';
    }

    const reconciled = this.readback(plan, authority, credential, mutationId);
    if (reconciled.observedObject === plan.expectation.newObject) {
      return this.finishVerified(plan, mutationId, reconciled, pushEvidenceReferences);
    }
    if (reconciled.observedObject === plan.expectation.expectedOldObject) {
      this.failRun(mutationId, 'failed', 'push_failed', helperFailure ?? 'Remote mutation was not applied');
      throw new GitSafePublicationError('push_failed', 'Remote mutation was not applied', {
        helperFailure: helperFailure ?? null,
      });
    }
    this.failRun(mutationId, 'ambiguous', 'push_result_unknown', helperFailure ?? 'Remote state is neither old nor intended object');
    throw new GitSafePublicationError('push_result_unknown', 'Push result requires manual recovery');
  }

  verify(input: {
    repositoryAuthorityId: string;
    credentialReferenceId: string;
    destinationRef: string;
    expectedCommit: string;
    expectedTree: string;
  }): GitRemoteReadback {
    assertIdentifier(input.repositoryAuthorityId, 'repositoryAuthorityId');
    assertIdentifier(input.credentialReferenceId, 'credentialReferenceId');
    assertRef(input.destinationRef, 'destinationRef');
    assertObject(input.expectedCommit, 'expectedCommit');
    assertObject(input.expectedTree, 'expectedTree');
    const { authority, credential } = this.options.authorityRegistry.resolveAuthorizedCredential({
      authorityId: input.repositoryAuthorityId,
      credentialReferenceId: input.credentialReferenceId,
      operationFamily: 'git.transport',
      branch: input.destinationRef,
      now: this.now(),
    });
    const object = this.readRemoteObject({
      requestId: `verify-${sha256Hex(canonicalJson(input)).slice(0, 24)}`,
      authority,
      credential,
      destinationRef: input.destinationRef,
    });
    const readback: GitRemoteReadback = {
      repository: authority.repository,
      remote: authority.repository.canonicalRemote,
      destinationRef: input.destinationRef,
      ...(object ? { observedObject: object, observedCommit: object } : {}),
      ...(object === input.expectedCommit ? { observedTree: input.expectedTree } : {}),
      expectedObject: input.expectedCommit,
      expectedTree: input.expectedTree,
      ancestryVerified: object === input.expectedCommit,
      observedAt: this.now(),
    };
    if (object !== input.expectedCommit) throw new GitSafePublicationError('remote_mismatch', 'Remote commit does not match expected commit');
    this.options.publicationRegistry.recordObservation({ source: 'git_transport', readback });
    return readback;
  }

  status(mutationId: string): GitPushRunRecord {
    const record = this.options.publicationRegistry.getRun(mutationId);
    if (!record) throw new GitSafePublicationError('publication_run_not_found', 'Push run does not exist');
    return record;
  }

  events(mutationId: string, afterCursor = 0, limit = 200): GitPushEvent[] {
    return this.options.publicationRegistry.listEvents(mutationId, afterCursor, limit);
  }

  private finishVerified(
    plan: GitPushPlan,
    mutationId: string,
    gitReadback: GitRemoteReadback,
    additionalEvidenceReferences: string[] = [],
  ): GitPushApplyResult {
    const gitReadbackWithEvidence = {
      ...gitReadback,
      evidenceReferences: [
        ...(((gitReadback as GitRemoteReadback & { evidenceReferences?: string[] }).evidenceReferences) ?? []),
        ...additionalEvidenceReferences,
      ],
    } as GitRemoteReadback & { evidenceReferences: string[] };
    const gitObservationId = this.options.publicationRegistry.recordObservation({
      mutationId,
      source: 'git_transport',
      readback: gitReadbackWithEvidence,
    });
    const gitReconciledAt = this.now();
    this.options.publicationRegistry.updateRun({
      mutationId,
      state: 'remote_reconciled',
      gitObservationId,
      updatedAt: gitReconciledAt,
    });
    this.options.publicationRegistry.appendEvent({
      mutationId,
      state: 'remote_reconciled',
      kind: 'remote_git_reconciled',
      detail: { gitObservationId, commit: plan.expectation.newObject, tree: plan.expectation.newTree },
      occurredAt: gitReconciledAt,
    });

    const apiInput: GitHubApiReadbackInput = {
      authority: this.requireAuthority(plan.repositoryAuthorityId),
      destinationRef: plan.expectation.destinationRef,
      expectedCommit: plan.expectation.newObject,
      expectedTree: plan.expectation.newTree,
    };
    let githubReadback: GitRemoteReadback & { evidenceReferences?: string[] };
    if (this.options.apiReadback) {
      const observed = this.options.apiReadback.verifyRemote(apiInput);
      githubReadback = {
        repository: apiInput.authority.repository,
        remote: `github-api://${apiInput.authority.repository.host}/${apiInput.authority.repository.owner}/${apiInput.authority.repository.name}`,
        destinationRef: observed.destinationRef,
        ...(observed.observedCommit ? { observedObject: observed.observedCommit, observedCommit: observed.observedCommit } : {}),
        ...(observed.observedTree ? { observedTree: observed.observedTree } : {}),
        expectedObject: plan.expectation.newObject,
        expectedTree: plan.expectation.newTree,
        ancestryVerified: observed.observedCommit === plan.expectation.newObject,
        observedAt: observed.observedAt,
        evidenceReferences: [...observed.evidenceReferences],
      };
    } else if (this.options.githubApiReadback) {
      githubReadback = this.options.githubApiReadback(apiInput);
    } else {
      throw new GitSafePublicationError('github_api_not_configured', 'GitHub API readback is not configured');
    }
    if (
      githubReadback.observedCommit !== plan.expectation.newObject ||
      githubReadback.observedTree !== plan.expectation.newTree ||
      githubReadback.destinationRef !== plan.expectation.destinationRef
    ) {
      const observedAt = this.now();
      this.options.publicationRegistry.updateRun({
        mutationId,
        state: 'remote_reconciled',
        gitObservationId,
        errorCode: 'git_api_disagreement',
        errorMessage: 'Git transport and GitHub API readback disagree',
        updatedAt: observedAt,
      });
      this.options.publicationRegistry.appendEvent({
        mutationId,
        state: 'remote_reconciled',
        kind: 'github_api_disagreement',
        detail: { gitObservationId },
        occurredAt: observedAt,
      });
      throw new GitSafePublicationError('git_api_disagreement', 'Git transport and GitHub API readback disagree');
    }
    const githubObservationId = this.options.publicationRegistry.recordObservation({
      mutationId,
      source: 'github_api',
      readback: githubReadback,
    });
    const verifiedAt = this.now();
    const verified = this.options.publicationRegistry.updateRun({
      mutationId,
      state: 'verified',
      gitObservationId,
      githubObservationId,
      clearError: true,
      updatedAt: verifiedAt,
    });
    this.options.publicationRegistry.appendEvent({
      mutationId,
      state: 'verified',
      kind: 'publication_verified',
      detail: { commit: plan.expectation.newObject, tree: plan.expectation.newTree, githubObservationId },
      occurredAt: verifiedAt,
    });
    return this.completedResult(verified);
  }

  private completedResult(record: GitPushRunRecord): GitPushApplyResult {
    if (!record.gitObservationId || !record.githubObservationId) {
      throw new GitSafePublicationError('publication_integrity_failed', 'Verified push run lacks external observations');
    }
    const readback = this.options.publicationRegistry.getObservation(record.gitObservationId);
    const githubApiReadback = this.options.publicationRegistry.getObservation(record.githubObservationId);
    if (!readback || !githubApiReadback) {
      throw new GitSafePublicationError('publication_integrity_failed', 'Verified push observations are unavailable');
    }
    return {
      mutationId: record.mutationId,
      state: 'verified',
      readback,
      githubApiReadback,
      evidenceReferences: [
        ...(((readback as GitRemoteReadback & { evidenceReferences?: string[] }).evidenceReferences) ?? []),
        ...(((githubApiReadback as GitRemoteReadback & { evidenceReferences?: string[] }).evidenceReferences) ?? []),
        record.gitObservationId,
        record.githubObservationId,
      ],
      events: this.options.publicationRegistry.listEvents(record.mutationId),
    };
  }

  private readback(
    plan: GitPushPlan,
    authority: GitHubRepositoryAuthority,
    credential: GitHubCredentialEnrollmentRecord,
    mutationId: string,
  ): GitRemoteReadback {
    const observedObject = this.readRemoteObject({
      requestId: `${mutationId}-readback-${Date.now()}`,
      authority,
      credential,
      destinationRef: plan.expectation.destinationRef,
    });
    let observedTree: string | undefined;
    let ancestryVerified = false;
    if (observedObject === plan.expectation.newObject) {
      const workspaceRecord = this.requireWorkspace(plan.repositoryAuthorityId, plan.workspace.workspaceId);
      observedTree = this.git(['rev-parse', `${observedObject}^{tree}`], workspaceRecord.worktreePath).stdout.trim();
      ancestryVerified = observedTree === plan.expectation.newTree;
      if (!ancestryVerified) throw new GitSafePublicationError('remote_mismatch', 'Remote commit tree differs from approved tree');
    }
    return {
      repository: authority.repository,
      remote: plan.expectation.remote,
      destinationRef: plan.expectation.destinationRef,
      ...(observedObject ? { observedObject, observedCommit: observedObject } : {}),
      ...(observedTree ? { observedTree } : {}),
      expectedObject: plan.expectation.newObject,
      expectedTree: plan.expectation.newTree,
      ancestryVerified,
      observedAt: this.now(),
    };
  }

  private readRemoteObject(input: {
    requestId: string;
    authority: GitHubRepositoryAuthority;
    credential: GitHubCredentialEnrollmentRecord;
    destinationRef: string;
  }): string | undefined {
    if (this.options.transport) {
      const transport = this.options.transport;
      const observation = transport.observeRef({
        requestId: input.requestId,
        authority: input.authority,
        credentialReferenceId: input.credential.credentialReferenceId,
        remote: input.authority.repository.canonicalRemote,
        destinationRef: input.destinationRef,
      });
      if (observation.object !== undefined && !OBJECT_PATTERN.test(observation.object)) {
        throw new GitSafePublicationError('remote_read_failed', 'Transport returned an invalid object ID');
      }
      return observation.object;
    }
    const result = this.executeGitOperation({
      requestId: input.requestId,
      authority: input.authority,
      credential: input.credential,
      git: {
        kind: 'ls-remote',
        remote: input.authority.repository.canonicalRemote,
        refs: [input.destinationRef],
      },
    });
    if (result.status !== 'completed' || result.exitCode !== 0 || result.redacted !== true || result.cleanup !== 'completed') {
      throw new GitSafePublicationError('remote_read_failed', 'Encrypted Git remote readback failed', {
        status: result.status,
        exitCode: result.exitCode,
        cleanup: result.cleanup,
      });
    }
    const line = result.stdout.split(/\r?\n/u).find((entry) => entry.endsWith(`\t${input.destinationRef}`));
    if (!line) return undefined;
    const object = line.split('\t', 1)[0];
    if (!object || !OBJECT_PATTERN.test(object)) throw new GitSafePublicationError('remote_read_failed', 'Remote returned an invalid object ID');
    return object;
  }

  private executeGitOperation(input: {
    requestId: string;
    authority: GitHubRepositoryAuthority;
    credential: GitHubCredentialEnrollmentRecord;
    git: GitHubHelperGitOperation;
  }): GitHubHelperResult {
    if (!this.options.encryptedCredentialPath || !this.options.knownHosts) {
      throw new GitSafePublicationError('credential_execution_not_configured', 'Encrypted Git transport is not configured');
    }
    const plan = createEncryptedCredentialExecutionPlan({
      requestId: input.requestId,
      authority: input.authority,
      credential: input.credential,
      encryptedCredentialPath: this.options.encryptedCredentialPath(input.credential),
      knownHosts: this.options.knownHosts(input.authority),
      git: input.git,
      ...(this.options.helperPath ? { helperPath: this.options.helperPath } : {}),
      expectedOwnerUid: process.getuid?.() ?? 0,
    });
    return this.executeCredentialPlan(plan);
  }

  private executeSystemdPlan(plan: EncryptedCredentialExecutionPlan): GitHubHelperResult {
    const result = spawnSync(plan.systemdRunArgv[0] as string, plan.systemdRunArgv.slice(1), {
      input: plan.stdin,
      encoding: 'utf8',
      timeout: this.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      },
    });
    const stdout = result.stdout ?? '';
    const line = stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
    if (!line) throw new GitSafePublicationError('credential_execution_failed', 'Encrypted helper produced no structured result');
    try {
      return JSON.parse(line) as GitHubHelperResult;
    } catch {
      throw new GitSafePublicationError('credential_execution_failed', 'Encrypted helper result is not valid JSON');
    }
  }

  private requireWorkspace(repositoryAuthorityId: string, workspaceId: string): GitWorkspaceRecord {
    const record = this.options.workspaceRegistry.get(workspaceId);
    if (!record) throw new GitSafePublicationError('workspace_not_found', 'Workspace does not exist');
    if (record.repositoryAuthorityId !== repositoryAuthorityId) {
      throw new GitSafePublicationError('repository_mismatch', 'Workspace belongs to another repository authority');
    }
    return record;
  }

  private requireAuthority(authorityId: string): GitHubRepositoryAuthority {
    const authority = this.options.authorityRegistry.getRepositoryAuthority(authorityId);
    if (!authority) throw new GitSafePublicationError('authority_missing', 'Repository authority does not exist');
    return authority;
  }

  private readWorkspaceIdentity(record: GitWorkspaceRecord): GitWorkspaceIdentity {
    const status = this.git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], record.worktreePath).stdout;
    const head = this.git(['rev-parse', 'HEAD^{commit}'], record.worktreePath).stdout.trim();
    const tree = this.git(['rev-parse', 'HEAD^{tree}'], record.worktreePath).stdout.trim();
    const branchResult = this.git(['symbolic-ref', '--quiet', '--short', 'HEAD'], record.worktreePath, [0, 1]);
    const branch = branchResult.status === 0 ? branchResult.stdout.trim() : undefined;
    return {
      workspaceId: record.workspaceId,
      repositoryId: record.repositoryId,
      mirrorPath: record.mirrorPath,
      worktreePath: record.worktreePath,
      ...(branch ? { branch } : {}),
      head,
      tree,
      clean: status.length === 0,
    };
  }

  private failRun(
    mutationId: string,
    state: 'failed' | 'ambiguous' | 'unknown',
    errorCode: string,
    errorMessage: string,
  ): void {
    const occurredAt = this.now();
    this.options.publicationRegistry.updateRun({
      mutationId,
      state,
      errorCode,
      errorMessage,
      updatedAt: occurredAt,
    });
    this.options.publicationRegistry.appendEvent({
      mutationId,
      state,
      kind: 'publication_failed',
      detail: { errorCode, errorMessage },
      occurredAt,
    });
  }

  private git(args: string[], cwd: string, allowedStatuses: readonly number[] = [0]): { stdout: string; stderr: string; status: number } {
    const result = spawnSync(this.gitPath, args, {
      cwd,
      encoding: 'utf8',
      timeout: this.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
        HOME: cwd,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '/bin/false',
        SSH_ASKPASS: '/bin/false',
      },
    });
    const status = typeof result.status === 'number' ? result.status : 70;
    const stdout = result.stdout ?? '';
    const stderr = `${result.stderr ?? ''}${result.error ? `${result.error.message}\n` : ''}`;
    if (!allowedStatuses.includes(status)) {
      throw new GitSafePublicationError('git_failed', `Git command failed: ${args[0] ?? 'unknown'}`, { status, stderr });
    }
    return { stdout, stderr, status };
  }
}
