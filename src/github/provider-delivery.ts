/** Durable GitHub provider operations and compound publication for Checkpoint F. */

import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, sha256Hex } from '../crypto/canonical.js';
import { GitHubAuthorityRegistry } from './authority-registry.js';
import type {
  GitHubArtifactIdentity,
  GitHubRateLimitState,
  GitHubRepositoryAuthority,
  GitHubWorkflowIdentity,
  GitPushPlan,
} from './contracts.js';
import { GitSafePublication } from './safe-publication.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{8,256}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const OBJECT = /^[a-f0-9]{40}$/u;
const MAX_LOG_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

type SqlRow = Record<string, unknown>;

export const GITHUB_PROVIDER_DELIVERY_MIGRATION = {
  version: 6,
  name: 'github_provider_delivery_v1',
  sql: `
CREATE TABLE github_provider_runs (
  run_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  semantic_digest TEXT NOT NULL CHECK (length(semantic_digest) = 64),
  operation TEXT NOT NULL,
  authority_id TEXT NOT NULL REFERENCES github_repository_authorities(authority_id),
  state TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT,
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  error_code TEXT,
  error_message TEXT,
  partial_success INTEGER NOT NULL CHECK (partial_success IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64)
) STRICT;

CREATE TABLE github_provider_events (
  run_id TEXT NOT NULL REFERENCES github_provider_runs(run_id),
  cursor INTEGER NOT NULL CHECK (cursor > 0),
  state TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail_digest TEXT NOT NULL CHECK (length(detail_digest) = 64),
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (run_id, cursor)
) STRICT;

CREATE INDEX github_provider_runs_authority_idx
  ON github_provider_runs(authority_id, operation, state, updated_at);

CREATE TRIGGER github_provider_runs_identity_immutable
BEFORE UPDATE ON github_provider_runs
WHEN OLD.run_id != NEW.run_id
  OR OLD.idempotency_key != NEW.idempotency_key
  OR OLD.semantic_digest != NEW.semantic_digest
  OR OLD.operation != NEW.operation
  OR OLD.authority_id != NEW.authority_id
  OR OLD.request_json != NEW.request_json
  OR OLD.created_at != NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'GitHub provider run identity is immutable');
END;
CREATE TRIGGER github_provider_runs_no_delete
BEFORE DELETE ON github_provider_runs BEGIN
  SELECT RAISE(ABORT, 'GitHub provider runs are durable records');
END;
CREATE TRIGGER github_provider_events_no_update
BEFORE UPDATE ON github_provider_events BEGIN
  SELECT RAISE(ABORT, 'GitHub provider events are append-only');
END;
CREATE TRIGGER github_provider_events_no_delete
BEFORE DELETE ON github_provider_events BEGIN
  SELECT RAISE(ABORT, 'GitHub provider events are append-only');
END;
`,
} as const;

export type GitHubProviderRunState =
  | 'intent_persisted'
  | 'remote_attempted'
  | 'remote_reconciled'
  | 'push_verified'
  | 'pr_verified'
  | 'workflow_verified'
  | 'artifacts_verified'
  | 'verified'
  | 'completed'
  | 'failed'
  | 'ambiguous'
  | 'cancelled';

export interface GitHubProviderRun {
  runId: string;
  idempotencyKey: string;
  semanticDigest: string;
  operation: string;
  authorityId: string;
  state: GitHubProviderRunState;
  request: Record<string, unknown>;
  result?: unknown;
  attempt: number;
  errorCode?: string;
  errorMessage?: string;
  partialSuccess: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubProviderEvent {
  runId: string;
  cursor: number;
  state: GitHubProviderRunState;
  kind: string;
  detailDigest: string;
  occurredAt: string;
}

export interface GitHubPullRequestReadback {
  repositoryId: string;
  number: number;
  nodeId: string;
  baseBranch: string;
  headBranch: string;
  headCommit: string;
  headTree: string;
  title: string;
  body: string;
  draft: boolean;
  state: 'open' | 'closed' | 'merged';
  changedPathsDigest: string;
  observedAt: string;
  evidenceReferences: string[];
}

export interface GitHubWorkflowJobReadback {
  jobId: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out' | 'action_required' | 'neutral' | 'skipped';
}

export interface GitHubWorkflowRunReadback {
  workflow: GitHubWorkflowIdentity;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out' | 'action_required' | 'neutral' | 'skipped';
  jobs: GitHubWorkflowJobReadback[];
  rateLimit: GitHubRateLimitState;
  observedAt: string;
  evidenceReferences: string[];
}

export interface GitHubWorkflowArtifactDescriptor {
  artifactId: number;
  name: string;
  size: number;
  sourceCommit: string;
  sourceTree: string;
  expired: boolean;
}

export interface GitHubContentReference {
  reference: string;
  digest: string;
  size: number;
}

export interface GitHubArtifactSink {
  put(input: {
    kind: 'workflow_log' | 'workflow_artifact';
    name: string;
    bytes: Buffer;
    metadata: Record<string, unknown>;
  }): GitHubContentReference;
}

export interface GitHubProviderTransport {
  findPullRequest(input: { authority: GitHubRepositoryAuthority; baseBranch: string; headBranch: string }): GitHubPullRequestReadback | undefined;
  getPullRequest(input: { authority: GitHubRepositoryAuthority; pullRequestNumber: number }): GitHubPullRequestReadback;
  upsertPullRequest(input: {
    requestId: string;
    authority: GitHubRepositoryAuthority;
    previous?: GitHubPullRequestReadback;
    baseBranch: string;
    headBranch: string;
    headCommit: string;
    headTree: string;
    title: string;
    body: string;
    draft: true;
  }): { outcome: 'completed' | 'failed' | 'unknown'; readback?: GitHubPullRequestReadback; evidenceReferences: string[] };
  findWorkflow(input: { authority: GitHubRepositoryAuthority; exactCommit: string; workflowId?: string; event?: string }): GitHubWorkflowRunReadback | undefined;
  getWorkflow(input: { authority: GitHubRepositoryAuthority; workflow: GitHubWorkflowIdentity }): GitHubWorkflowRunReadback;
  getWorkflowLogs(input: { authority: GitHubRepositoryAuthority; workflow: GitHubWorkflowIdentity; jobId: number }): Buffer;
  listWorkflowArtifacts(input: { authority: GitHubRepositoryAuthority; workflow: GitHubWorkflowIdentity }): GitHubWorkflowArtifactDescriptor[];
  downloadWorkflowArtifact(input: { authority: GitHubRepositoryAuthority; workflow: GitHubWorkflowIdentity; artifactId: number }): Buffer;
}

export class GitHubProviderError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'GitHubProviderError';
  }
}

function asString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new GitHubProviderError('provider_integrity_failed', `${key} is invalid`);
  return value;
}

function asOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  return asString(row, key);
}

function asInteger(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new GitHubProviderError('provider_integrity_failed', `${key} is invalid`);
  }
  return value;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new GitHubProviderError('provider_integrity_failed', `${label} is invalid JSON`);
  }
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) throw new GitHubProviderError('invalid_request', `${label} is invalid`);
}

function assertIdempotency(value: string): void {
  if (!IDEMPOTENCY.test(value)) throw new GitHubProviderError('invalid_request', 'idempotencyKey is invalid');
}

function assertDigest(value: string, label: string): void {
  if (!DIGEST.test(value)) throw new GitHubProviderError('invalid_request', `${label} is invalid`);
}

function assertObject(value: string, label: string): void {
  if (!OBJECT.test(value)) throw new GitHubProviderError('invalid_request', `${label} is invalid`);
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new GitHubProviderError('invalid_request', `${label} is invalid`);
}

function runBody(record: GitHubProviderRun): Record<string, unknown> {
  return {
    runId: record.runId,
    idempotencyKey: record.idempotencyKey,
    semanticDigest: record.semanticDigest,
    operation: record.operation,
    authorityId: record.authorityId,
    state: record.state,
    request: record.request,
    result: record.result ?? null,
    attempt: record.attempt,
    errorCode: record.errorCode ?? null,
    errorMessage: record.errorMessage ?? null,
    partialSuccess: record.partialSuccess,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function recordDigest(record: GitHubProviderRun): string {
  return sha256Hex(canonicalJson(runBody(record)));
}

function mapRun(row: SqlRow): GitHubProviderRun {
  const resultJson = asOptionalString(row, 'result_json');
  const errorCode = asOptionalString(row, 'error_code');
  const errorMessage = asOptionalString(row, 'error_message');
  return {
    runId: asString(row, 'run_id'),
    idempotencyKey: asString(row, 'idempotency_key'),
    semanticDigest: asString(row, 'semantic_digest'),
    operation: asString(row, 'operation'),
    authorityId: asString(row, 'authority_id'),
    state: asString(row, 'state') as GitHubProviderRunState,
    request: parseJson<Record<string, unknown>>(asString(row, 'request_json'), 'request_json'),
    ...(resultJson ? { result: parseJson<unknown>(resultJson, 'result_json') } : {}),
    attempt: asInteger(row, 'attempt'),
    ...(errorCode ? { errorCode } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    partialSuccess: asInteger(row, 'partial_success') === 1,
    createdAt: asString(row, 'created_at'),
    updatedAt: asString(row, 'updated_at'),
  };
}

export class GitHubProviderRegistry {
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

  reserve(record: GitHubProviderRun): { created: boolean; record: GitHubProviderRun } {
    assertIdentifier(record.runId, 'runId');
    assertIdempotency(record.idempotencyKey);
    assertDigest(record.semanticDigest, 'semanticDigest');
    return this.transaction(() => {
      const row = this.database.prepare(
        'SELECT * FROM github_provider_runs WHERE idempotency_key = ?',
      ).get(record.idempotencyKey) as SqlRow | undefined;
      if (row) {
        const existing = this.checked(row);
        if (existing.runId !== record.runId || existing.semanticDigest !== record.semanticDigest) {
          throw new GitHubProviderError('idempotency_conflict', 'Idempotency key has changed intent');
        }
        return { created: false, record: existing };
      }
      this.database.prepare(`INSERT INTO github_provider_runs(
        run_id, idempotency_key, semantic_digest, operation, authority_id, state,
        request_json, result_json, attempt, error_code, error_message, partial_success,
        created_at, updated_at, record_digest
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`)
        .run(
          record.runId,
          record.idempotencyKey,
          record.semanticDigest,
          record.operation,
          record.authorityId,
          record.state,
          canonicalJson(record.request),
          record.result === undefined ? null : canonicalJson(record.result),
          record.attempt,
          record.partialSuccess ? 1 : 0,
          record.createdAt,
          record.updatedAt,
          recordDigest(record),
        );
      return { created: true, record: this.getRequired(record.runId) };
    });
  }

  get(runId: string): GitHubProviderRun | undefined {
    assertIdentifier(runId, 'runId');
    const row = this.database.prepare('SELECT * FROM github_provider_runs WHERE run_id = ?').get(runId) as SqlRow | undefined;
    return row ? this.checked(row) : undefined;
  }

  getRequired(runId: string): GitHubProviderRun {
    const record = this.get(runId);
    if (!record) throw new GitHubProviderError('provider_run_not_found', 'Provider run does not exist');
    return record;
  }

  update(input: {
    runId: string;
    state: GitHubProviderRunState;
    result?: unknown;
    attempt?: number;
    errorCode?: string;
    errorMessage?: string;
    clearError?: boolean;
    partialSuccess?: boolean;
    updatedAt: string;
  }): GitHubProviderRun {
    const current = this.getRequired(input.runId);
    const next: GitHubProviderRun = {
      ...current,
      state: input.state,
      ...(input.result === undefined ? {} : { result: input.result }),
      attempt: input.attempt ?? current.attempt,
      ...(input.clearError
        ? { errorCode: undefined, errorMessage: undefined }
        : {
            ...(input.errorCode ? { errorCode: input.errorCode } : {}),
            ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
          }),
      partialSuccess: input.partialSuccess ?? current.partialSuccess,
      updatedAt: input.updatedAt,
    };
    this.database.prepare(`UPDATE github_provider_runs SET
      state = ?, result_json = ?, attempt = ?, error_code = ?, error_message = ?,
      partial_success = ?, updated_at = ?, record_digest = ? WHERE run_id = ?`)
      .run(
        next.state,
        next.result === undefined ? null : canonicalJson(next.result),
        next.attempt,
        next.errorCode ?? null,
        next.errorMessage ?? null,
        next.partialSuccess ? 1 : 0,
        next.updatedAt,
        recordDigest(next),
        next.runId,
      );
    return this.getRequired(next.runId);
  }

  appendEvent(input: {
    runId: string;
    state: GitHubProviderRunState;
    kind: string;
    detail: unknown;
    occurredAt: string;
  }): GitHubProviderEvent {
    return this.transaction(() => {
      this.getRequired(input.runId);
      const row = this.database.prepare(
        'SELECT COALESCE(MAX(cursor), 0) AS cursor FROM github_provider_events WHERE run_id = ?',
      ).get(input.runId) as SqlRow;
      const event: GitHubProviderEvent = {
        runId: input.runId,
        cursor: asInteger(row, 'cursor') + 1,
        state: input.state,
        kind: input.kind,
        detailDigest: sha256Hex(canonicalJson(input.detail)),
        occurredAt: input.occurredAt,
      };
      this.database.prepare(`INSERT INTO github_provider_events(
        run_id, cursor, state, kind, detail_digest, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(event.runId, event.cursor, event.state, event.kind, event.detailDigest, event.occurredAt);
      return event;
    });
  }

  events(runId: string, afterCursor = 0, limit = 200): GitHubProviderEvent[] {
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new GitHubProviderError('invalid_request', 'Event cursor or limit is invalid');
    }
    return (this.database.prepare(`SELECT * FROM github_provider_events
      WHERE run_id = ? AND cursor > ? ORDER BY cursor LIMIT ?`).all(runId, afterCursor, limit) as SqlRow[])
      .map((row) => ({
        runId: asString(row, 'run_id'),
        cursor: asInteger(row, 'cursor'),
        state: asString(row, 'state') as GitHubProviderRunState,
        kind: asString(row, 'kind'),
        detailDigest: asString(row, 'detail_digest'),
        occurredAt: asString(row, 'occurred_at'),
      }));
  }

  private checked(row: SqlRow): GitHubProviderRun {
    const record = mapRun(row);
    if (recordDigest(record) !== asString(row, 'record_digest')) {
      throw new GitHubProviderError('provider_integrity_failed', 'Provider run digest mismatch');
    }
    return record;
  }
}

export interface GitHubProviderOptions {
  authorityRegistry: GitHubAuthorityRegistry;
  registry: GitHubProviderRegistry;
  transport: GitHubProviderTransport;
  artifactSink: GitHubArtifactSink;
  now?: () => string;
  onPoll?: (attempt: number) => void;
}

export class GitHubProvider {
  private readonly now: () => string;
  private readonly onPoll: (attempt: number) => void;

  constructor(private readonly options: GitHubProviderOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.onPoll = options.onPoll ?? (() => undefined);
  }

  upsertPullRequest(input: {
    runId: string;
    idempotencyKey: string;
    semanticIdempotencyFingerprint: string;
    repositoryAuthorityId: string;
    headBranch: string;
    headCommit: string;
    headTree: string;
    baseBranch: string;
    expectedPreviousStateDigest?: string;
    title: string;
    body: string;
    draft: true;
    authorizationReference: string;
  }): { state: 'verified'; readback: GitHubPullRequestReadback; events: GitHubProviderEvent[] } {
    assertIdentifier(input.runId, 'runId');
    assertIdempotency(input.idempotencyKey);
    assertDigest(input.semanticIdempotencyFingerprint, 'semanticIdempotencyFingerprint');
    assertIdentifier(input.repositoryAuthorityId, 'repositoryAuthorityId');
    assertIdentifier(input.authorizationReference, 'authorizationReference');
    assertObject(input.headCommit, 'headCommit');
    assertObject(input.headTree, 'headTree');
    if (input.expectedPreviousStateDigest !== undefined) assertDigest(input.expectedPreviousStateDigest, 'expectedPreviousStateDigest');
    if (input.title.length < 1 || input.title.length > 256 || input.body.length > 65_536 || input.draft !== true) {
      throw new GitHubProviderError('invalid_request', 'Pull request title, body, or draft state is invalid');
    }
    const authority = this.authorize(input.repositoryAuthorityId, 'github.pull_requests.write', true, input.headBranch);
    const request = {
      operation: 'baby.github.pr.upsert',
      repositoryAuthorityId: input.repositoryAuthorityId,
      headBranch: input.headBranch,
      headCommit: input.headCommit,
      headTree: input.headTree,
      baseBranch: input.baseBranch,
      expectedPreviousStateDigest: input.expectedPreviousStateDigest ?? null,
      title: input.title,
      body: input.body,
      draft: true,
      authorizationReference: input.authorizationReference,
    };
    const semanticDigest = sha256Hex(canonicalJson(request));
    if (semanticDigest !== input.semanticIdempotencyFingerprint) {
      throw new GitHubProviderError('idempotency_conflict', 'Semantic fingerprint does not match pull request intent');
    }
    const reserved = this.reserve(input.runId, input.idempotencyKey, semanticDigest, 'baby.github.pr.upsert', input.repositoryAuthorityId, request);
    if (reserved.state === 'verified') return this.completedPullRequest(reserved);
    if (reserved.state === 'failed') throw new GitHubProviderError(reserved.errorCode ?? 'pull_request_failed', reserved.errorMessage ?? 'Pull request failed');

    const previous = this.options.transport.findPullRequest({ authority, baseBranch: input.baseBranch, headBranch: input.headBranch });
    if (input.expectedPreviousStateDigest !== undefined) {
      const observed = sha256Hex(canonicalJson(previous ?? null));
      if (observed !== input.expectedPreviousStateDigest) {
        return this.fail(input.runId, 'provider_precondition_failed', 'Pull request state changed after observation');
      }
    }
    if (previous && this.pullRequestMatches(previous, input)) {
      return this.finishPullRequest(input.runId, previous, 'existing_pull_request_reconciled');
    }

    const attempted = this.transition(input.runId, 'remote_attempted', 'pull_request_write_attempted', {
      previousNumber: previous?.number ?? null,
    }, { attempt: reserved.attempt + 1 });
    let outcome: ReturnType<GitHubProviderTransport['upsertPullRequest']>;
    try {
      outcome = this.options.transport.upsertPullRequest({
        requestId: `${input.runId}-attempt-${attempted.attempt}`,
        authority,
        ...(previous ? { previous } : {}),
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        headCommit: input.headCommit,
        headTree: input.headTree,
        title: input.title,
        body: input.body,
        draft: true,
      });
    } catch (error) {
      outcome = { outcome: 'unknown', evidenceReferences: [`provider-exception:${sha256Hex(String(error))}`] };
    }
    const reconciled = outcome.readback ?? this.options.transport.findPullRequest({
      authority,
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
    });
    if (reconciled && this.pullRequestMatches(reconciled, input)) {
      return this.finishPullRequest(
        input.runId,
        reconciled,
        outcome.outcome === 'unknown' ? 'pull_request_response_loss_reconciled' : 'pull_request_remote_reconciled',
      );
    }
    if (outcome.outcome === 'failed') return this.fail(input.runId, 'pull_request_write_failed', 'GitHub pull request write failed');
    this.transition(input.runId, 'ambiguous', 'pull_request_result_unknown', { evidenceReferences: outcome.evidenceReferences }, {
      errorCode: 'pull_request_result_unknown',
      errorMessage: 'Pull request result could not be reconciled',
    });
    throw new GitHubProviderError('pull_request_result_unknown', 'Pull request result requires reconciliation');
  }

  getPullRequest(input: { repositoryAuthorityId: string; pullRequestNumber: number }): GitHubPullRequestReadback {
    if (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber < 1) {
      throw new GitHubProviderError('invalid_request', 'pullRequestNumber is invalid');
    }
    const authority = this.authorize(input.repositoryAuthorityId, 'github.pull_requests.read', false);
    return this.options.transport.getPullRequest({ authority, pullRequestNumber: input.pullRequestNumber });
  }

  verifyPullRequest(input: {
    repositoryAuthorityId: string;
    pullRequestNumber: number;
    expectedBaseBranch: string;
    expectedHeadBranch: string;
    expectedHeadCommit: string;
    expectedHeadTree: string;
    expectedDraft: boolean;
    expectedChangedPathsDigest: string;
  }): GitHubPullRequestReadback {
    assertObject(input.expectedHeadCommit, 'expectedHeadCommit');
    assertObject(input.expectedHeadTree, 'expectedHeadTree');
    assertDigest(input.expectedChangedPathsDigest, 'expectedChangedPathsDigest');
    const readback = this.getPullRequest(input);
    if (
      readback.baseBranch !== input.expectedBaseBranch ||
      readback.headBranch !== input.expectedHeadBranch ||
      readback.headCommit !== input.expectedHeadCommit ||
      readback.headTree !== input.expectedHeadTree ||
      readback.draft !== input.expectedDraft ||
      readback.changedPathsDigest !== input.expectedChangedPathsDigest
    ) {
      throw new GitHubProviderError('pull_request_mismatch', 'Pull request readback differs from expected state');
    }
    return readback;
  }

  status(runId: string): GitHubProviderRun {
    return this.options.registry.getRequired(runId);
  }

  events(runId: string, afterCursor = 0, limit = 200): GitHubProviderEvent[] {
    return this.options.registry.events(runId, afterCursor, limit);
  }

  private authorize(authorityId: string, operationFamily: string, requireWrite: boolean, branch?: string): GitHubRepositoryAuthority {
    const authority = this.options.authorityRegistry.getRepositoryAuthority(authorityId);
    if (!authority) throw new GitHubProviderError('authority_missing', 'Repository authority does not exist');
    this.options.authorityRegistry.resolveAuthorizedCredential({
      authorityId,
      credentialReferenceId: authority.credentialReferenceId,
      operationFamily,
      ...(branch ? { branch } : {}),
      requireWrite,
      now: this.now(),
    });
    return authority;
  }

  private reserve(
    runId: string,
    idempotencyKey: string,
    semanticDigest: string,
    operation: string,
    authorityId: string,
    request: Record<string, unknown>,
  ): GitHubProviderRun {
    const now = this.now();
    const reservation = this.options.registry.reserve({
      runId,
      idempotencyKey,
      semanticDigest,
      operation,
      authorityId,
      state: 'intent_persisted',
      request,
      attempt: 0,
      partialSuccess: false,
      createdAt: now,
      updatedAt: now,
    });
    if (reservation.created) {
      this.options.registry.appendEvent({ runId, state: 'intent_persisted', kind: 'intent_persisted', detail: request, occurredAt: now });
    }
    return reservation.record;
  }

  private transition(
    runId: string,
    state: GitHubProviderRunState,
    kind: string,
    detail: unknown,
    update: Omit<Parameters<GitHubProviderRegistry['update']>[0], 'runId' | 'state' | 'updatedAt'> = {},
  ): GitHubProviderRun {
    const now = this.now();
    const record = this.options.registry.update({ runId, state, ...update, updatedAt: now });
    this.options.registry.appendEvent({ runId, state, kind, detail, occurredAt: now });
    return record;
  }

  private fail(runId: string, code: string, message: string): never {
    this.transition(runId, 'failed', 'provider_run_failed', { code, message }, { errorCode: code, errorMessage: message });
    throw new GitHubProviderError(code, message);
  }

  private pullRequestMatches(readback: GitHubPullRequestReadback, input: {
    baseBranch: string;
    headBranch: string;
    headCommit: string;
    headTree: string;
    title: string;
    body: string;
  }): boolean {
    return readback.baseBranch === input.baseBranch && readback.headBranch === input.headBranch &&
      readback.headCommit === input.headCommit && readback.headTree === input.headTree &&
      readback.title === input.title && readback.body === input.body && readback.draft && readback.state === 'open';
  }

  private finishPullRequest(
    runId: string,
    readback: GitHubPullRequestReadback,
    kind: string,
  ): { state: 'verified'; readback: GitHubPullRequestReadback; events: GitHubProviderEvent[] } {
    this.transition(runId, 'remote_reconciled', kind, { number: readback.number, headCommit: readback.headCommit }, { result: readback });
    const verified = this.transition(runId, 'verified', 'pull_request_verified', {
      number: readback.number,
      changedPathsDigest: readback.changedPathsDigest,
    }, { result: readback, clearError: true });
    return this.completedPullRequest(verified);
  }

  private completedPullRequest(record: GitHubProviderRun): {
    state: 'verified';
    readback: GitHubPullRequestReadback;
    events: GitHubProviderEvent[];
  } {
    if (!record.result) throw new GitHubProviderError('provider_integrity_failed', 'Verified pull request lacks readback');
    return { state: 'verified', readback: record.result as GitHubPullRequestReadback, events: this.events(record.runId) };
  }

  findWorkflow(input: {
    repositoryAuthorityId: string;
    exactCommit: string;
    workflowId?: string;
    event?: string;
  }): GitHubWorkflowRunReadback {
    assertObject(input.exactCommit, 'exactCommit');
    const authority = this.authorize(input.repositoryAuthorityId, 'github.actions.read', false);
    const readback = this.options.transport.findWorkflow({
      authority,
      exactCommit: input.exactCommit,
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      ...(input.event ? { event: input.event } : {}),
    });
    if (!readback || readback.workflow.headSha !== input.exactCommit) {
      throw new GitHubProviderError('workflow_not_found', 'No workflow run matches the exact commit');
    }
    this.assertRateLimit(readback.rateLimit);
    return readback;
  }

  getWorkflow(input: {
    repositoryAuthorityId: string;
    workflow: GitHubWorkflowIdentity;
  }): GitHubWorkflowRunReadback {
    const authority = this.authorize(input.repositoryAuthorityId, 'github.actions.read', false);
    const readback = this.options.transport.getWorkflow({ authority, workflow: input.workflow });
    if (
      readback.workflow.runId !== input.workflow.runId ||
      readback.workflow.attempt !== input.workflow.attempt ||
      readback.workflow.headSha !== input.workflow.headSha
    ) {
      throw new GitHubProviderError('workflow_mismatch', 'Workflow readback identity changed');
    }
    this.assertRateLimit(readback.rateLimit);
    return readback;
  }

  waitWorkflow(input: {
    runId: string;
    idempotencyKey: string;
    semanticIdempotencyFingerprint: string;
    repositoryAuthorityId: string;
    workflow: GitHubWorkflowIdentity;
    selectedJobIds?: number[];
    deadline: string;
    maximumAttempts: number;
  }): GitHubWorkflowRunReadback {
    assertIdentifier(input.runId, 'runId');
    assertIdempotency(input.idempotencyKey);
    assertDigest(input.semanticIdempotencyFingerprint, 'semanticIdempotencyFingerprint');
    assertTimestamp(input.deadline, 'deadline');
    if (!Number.isSafeInteger(input.maximumAttempts) || input.maximumAttempts < 1 || input.maximumAttempts > 100) {
      throw new GitHubProviderError('invalid_request', 'maximumAttempts must be between 1 and 100');
    }
    const selectedJobIds = [...new Set(input.selectedJobIds ?? [])].sort((left, right) => left - right);
    const request = {
      operation: 'baby.github.workflow.wait',
      repositoryAuthorityId: input.repositoryAuthorityId,
      workflow: input.workflow,
      selectedJobIds,
      deadline: input.deadline,
      maximumAttempts: input.maximumAttempts,
    };
    const semanticDigest = sha256Hex(canonicalJson(request));
    if (semanticDigest !== input.semanticIdempotencyFingerprint) {
      throw new GitHubProviderError('idempotency_conflict', 'Semantic fingerprint does not match workflow wait intent');
    }
    let current = this.reserve(
      input.runId,
      input.idempotencyKey,
      semanticDigest,
      'baby.github.workflow.wait',
      input.repositoryAuthorityId,
      request,
    );
    if (current.state === 'verified') return current.result as GitHubWorkflowRunReadback;
    if (current.state === 'failed') throw new GitHubProviderError(current.errorCode ?? 'workflow_failed', current.errorMessage ?? 'Workflow failed');

    while (current.attempt < input.maximumAttempts) {
      if (Date.parse(this.now()) > Date.parse(input.deadline)) {
        return this.fail(input.runId, 'workflow_timeout', 'Workflow deadline elapsed');
      }
      const attempt = current.attempt + 1;
      this.onPoll(attempt);
      const readback = this.getWorkflow({ repositoryAuthorityId: input.repositoryAuthorityId, workflow: input.workflow });
      current = this.transition(input.runId, 'remote_reconciled', 'workflow_polled', {
        attempt,
        status: readback.status,
        conclusion: readback.conclusion ?? null,
      }, { attempt, result: readback });
      if (readback.status !== 'completed') continue;
      const selected = selectedJobIds.length === 0
        ? readback.jobs
        : readback.jobs.filter((job) => selectedJobIds.includes(job.jobId));
      if (selectedJobIds.length > 0 && selected.length !== selectedJobIds.length) {
        return this.fail(input.runId, 'workflow_job_missing', 'A selected workflow job is missing');
      }
      if (readback.conclusion !== 'success' || selected.some((job) => job.conclusion !== 'success')) {
        return this.fail(input.runId, 'workflow_failed', 'Workflow or selected job did not succeed');
      }
      const verified = this.transition(input.runId, 'verified', 'workflow_verified', {
        runId: readback.workflow.runId,
        attempt: readback.workflow.attempt,
        headSha: readback.workflow.headSha,
      }, { result: readback, clearError: true });
      return verified.result as GitHubWorkflowRunReadback;
    }
    return this.fail(input.runId, 'workflow_timeout', 'Workflow polling attempt limit reached');
  }

  captureWorkflowLogs(input: {
    runId: string;
    idempotencyKey: string;
    semanticIdempotencyFingerprint: string;
    repositoryAuthorityId: string;
    workflow: GitHubWorkflowIdentity;
    jobId: number;
    maximumBytes?: number;
    redactionProfile: string;
  }): GitHubContentReference {
    const maximumBytes = input.maximumBytes ?? MAX_LOG_BYTES;
    if (!Number.isSafeInteger(input.jobId) || input.jobId < 1 || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_LOG_BYTES) {
      throw new GitHubProviderError('invalid_request', 'Log job or size bound is invalid');
    }
    const request = {
      operation: 'baby.github.workflow.logs.capture',
      repositoryAuthorityId: input.repositoryAuthorityId,
      workflow: input.workflow,
      jobId: input.jobId,
      maximumBytes,
      redactionProfile: input.redactionProfile,
    };
    const semanticDigest = sha256Hex(canonicalJson(request));
    if (semanticDigest !== input.semanticIdempotencyFingerprint) {
      throw new GitHubProviderError('idempotency_conflict', 'Semantic fingerprint does not match log capture intent');
    }
    const reserved = this.reserve(input.runId, input.idempotencyKey, semanticDigest, request.operation, input.repositoryAuthorityId, request);
    if (reserved.state === 'verified') return reserved.result as GitHubContentReference;
    const authority = this.authorize(input.repositoryAuthorityId, 'github.actions.read', false);
    this.authorize(input.repositoryAuthorityId, 'artifact.write', true);
    const bytes = this.options.transport.getWorkflowLogs({ authority, workflow: input.workflow, jobId: input.jobId });
    if (bytes.length > maximumBytes) return this.fail(input.runId, 'artifact_limit_exceeded', 'Workflow logs exceed the configured bound');
    const content = this.options.artifactSink.put({
      kind: 'workflow_log',
      name: `workflow-${input.workflow.runId}-attempt-${input.workflow.attempt}-job-${input.jobId}.log`,
      bytes,
      metadata: { repositoryId: authority.repository.repositoryId, workflow: input.workflow, jobId: input.jobId, redactionProfile: input.redactionProfile },
    });
    if (content.size !== bytes.length || content.digest !== sha256Hex(bytes)) {
      return this.fail(input.runId, 'artifact_store_mismatch', 'Stored log content differs from provider bytes');
    }
    const verified = this.transition(input.runId, 'verified', 'workflow_logs_captured', content, { result: content, clearError: true });
    return verified.result as GitHubContentReference;
  }

  captureWorkflowArtifacts(input: {
    runId: string;
    idempotencyKey: string;
    semanticIdempotencyFingerprint: string;
    repositoryAuthorityId: string;
    workflow: GitHubWorkflowIdentity;
    artifactNames?: string[];
    maximumArchiveBytes?: number;
    expectedSourceCommit: string;
    expectedSourceTree: string;
    expectedDigests?: Record<string, string>;
  }): Array<{ identity: GitHubArtifactIdentity; content: GitHubContentReference }> {
    assertObject(input.expectedSourceCommit, 'expectedSourceCommit');
    assertObject(input.expectedSourceTree, 'expectedSourceTree');
    const maximumArchiveBytes = input.maximumArchiveBytes ?? MAX_ARTIFACT_BYTES;
    if (!Number.isSafeInteger(maximumArchiveBytes) || maximumArchiveBytes < 1 || maximumArchiveBytes > MAX_ARTIFACT_BYTES) {
      throw new GitHubProviderError('invalid_request', 'Artifact size bound is invalid');
    }
    for (const digest of Object.values(input.expectedDigests ?? {})) assertDigest(digest, 'expectedArtifactDigest');
    const artifactNames = input.artifactNames ? [...new Set(input.artifactNames)].sort() : undefined;
    const request = {
      operation: 'baby.github.workflow.artifacts.capture',
      repositoryAuthorityId: input.repositoryAuthorityId,
      workflow: input.workflow,
      artifactNames: artifactNames ?? null,
      maximumArchiveBytes,
      expectedSourceCommit: input.expectedSourceCommit,
      expectedSourceTree: input.expectedSourceTree,
      expectedDigests: input.expectedDigests ?? null,
    };
    const semanticDigest = sha256Hex(canonicalJson(request));
    if (semanticDigest !== input.semanticIdempotencyFingerprint) {
      throw new GitHubProviderError('idempotency_conflict', 'Semantic fingerprint does not match artifact capture intent');
    }
    const reserved = this.reserve(input.runId, input.idempotencyKey, semanticDigest, request.operation, input.repositoryAuthorityId, request);
    if (reserved.state === 'verified') return reserved.result as Array<{ identity: GitHubArtifactIdentity; content: GitHubContentReference }>;
    const authority = this.authorize(input.repositoryAuthorityId, 'github.actions.read', false);
    this.authorize(input.repositoryAuthorityId, 'artifact.write', true);
    const names = artifactNames ? new Set(artifactNames) : undefined;
    const descriptors = this.options.transport.listWorkflowArtifacts({ authority, workflow: input.workflow })
      .filter((artifact) => !names || names.has(artifact.name));
    if (names && descriptors.length !== names.size) return this.fail(input.runId, 'artifact_missing', 'A requested workflow artifact is missing');
    const captured = descriptors.map((descriptor) => {
      if (descriptor.expired) return this.fail(input.runId, 'artifact_expired', `Artifact expired: ${descriptor.name}`);
      if (descriptor.sourceCommit !== input.expectedSourceCommit || descriptor.sourceTree !== input.expectedSourceTree) {
        return this.fail(input.runId, 'artifact_source_mismatch', `Artifact source identity differs: ${descriptor.name}`);
      }
      const bytes = this.options.transport.downloadWorkflowArtifact({ authority, workflow: input.workflow, artifactId: descriptor.artifactId });
      if (bytes.length !== descriptor.size || bytes.length > maximumArchiveBytes) {
        return this.fail(input.runId, 'artifact_limit_exceeded', `Artifact size differs or exceeds bound: ${descriptor.name}`);
      }
      const digest = sha256Hex(bytes);
      if (input.expectedDigests?.[descriptor.name] !== undefined && input.expectedDigests[descriptor.name] !== digest) {
        return this.fail(input.runId, 'artifact_digest_mismatch', `Artifact digest differs: ${descriptor.name}`);
      }
      const content = this.options.artifactSink.put({
        kind: 'workflow_artifact',
        name: descriptor.name,
        bytes,
        metadata: { repositoryId: authority.repository.repositoryId, workflow: input.workflow, artifactId: descriptor.artifactId, sourceCommit: descriptor.sourceCommit, sourceTree: descriptor.sourceTree },
      });
      if (content.digest !== digest || content.size !== bytes.length) {
        return this.fail(input.runId, 'artifact_store_mismatch', `Stored artifact differs: ${descriptor.name}`);
      }
      const identity: GitHubArtifactIdentity = {
        repository: authority.repository,
        workflow: input.workflow,
        artifactId: descriptor.artifactId,
        name: descriptor.name,
        archiveDigest: digest,
        size: bytes.length,
        sourceCommit: descriptor.sourceCommit,
        sourceTree: descriptor.sourceTree,
      };
      return { identity, content };
    });
    const verified = this.transition(input.runId, 'verified', 'workflow_artifacts_captured', {
      count: captured.length,
      names: captured.map((entry) => entry.identity.name),
    }, { result: captured, clearError: true });
    return verified.result as Array<{ identity: GitHubArtifactIdentity; content: GitHubContentReference }>;
  }

  private assertRateLimit(rateLimit: GitHubRateLimitState): void {
    if (rateLimit.limit < 0 || rateLimit.remaining < 0 || rateLimit.remaining > rateLimit.limit) {
      throw new GitHubProviderError('rate_limit_invalid', 'GitHub rate-limit readback is invalid');
    }
    if (rateLimit.secondaryLimited || rateLimit.remaining === 0) {
      throw new GitHubProviderError('rate_limited', 'GitHub provider is rate limited', {
        resetsAt: rateLimit.resetsAt,
        retryAfterSeconds: rateLimit.retryAfterSeconds ?? null,
      });
    }
  }
}

export interface GitHubDeliveryPublicationResult {
  deliveryId: string;
  state: GitHubProviderRunState;
  push?: {
    plan: GitPushPlan;
    mutationId: string;
    commit: string;
    tree: string;
    destinationRef: string;
    evidenceReferences: string[];
  };
  pullRequest?: GitHubPullRequestReadback;
  workflow?: GitHubWorkflowRunReadback;
  artifacts?: Array<{ identity: GitHubArtifactIdentity; content: GitHubContentReference }>;
  evidenceReferences: string[];
}

export interface GitHubDeliveryPublisherOptions {
  safePublication: GitSafePublication;
  provider: GitHubProvider;
  registry: GitHubProviderRegistry;
  now?: () => string;
}

export class GitHubDeliveryPublisher {
  private readonly now: () => string;

  constructor(private readonly options: GitHubDeliveryPublisherOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  publish(input: {
    deliveryId: string;
    idempotencyKey: string;
    semanticIdempotencyFingerprint: string;
    repositoryAuthorityId: string;
    workspaceId: string;
    credentialReferenceId: string;
    sourceRef: string;
    destinationRef: string;
    expectedRemoteOldObject?: string;
    expiresAt: string;
    authorizationReference: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
    draft: true;
    expectedChangedPathsDigest: string;
    workflowId?: string;
    workflowEvent?: string;
    workflowDeadline: string;
    maximumWorkflowAttempts: number;
    selectedJobIds?: number[];
    artifactNames?: string[];
    expectedArtifactDigests?: Record<string, string>;
    maximumArtifactBytes?: number;
  }): GitHubDeliveryPublicationResult {
    assertIdentifier(input.deliveryId, 'deliveryId');
    assertIdempotency(input.idempotencyKey);
    assertDigest(input.semanticIdempotencyFingerprint, 'semanticIdempotencyFingerprint');
    assertIdentifier(input.repositoryAuthorityId, 'repositoryAuthorityId');
    assertIdentifier(input.workspaceId, 'workspaceId');
    assertIdentifier(input.credentialReferenceId, 'credentialReferenceId');
    assertIdentifier(input.authorizationReference, 'authorizationReference');
    assertTimestamp(input.expiresAt, 'expiresAt');
    assertTimestamp(input.workflowDeadline, 'workflowDeadline');
    assertDigest(input.expectedChangedPathsDigest, 'expectedChangedPathsDigest');
    if (input.expectedRemoteOldObject !== undefined) assertObject(input.expectedRemoteOldObject, 'expectedRemoteOldObject');
    for (const digest of Object.values(input.expectedArtifactDigests ?? {})) assertDigest(digest, 'expectedArtifactDigest');
    if (input.draft !== true) throw new GitHubProviderError('invalid_request', 'Checkpoint F delivery only permits draft pull requests');

    const selectedJobIds = [...new Set(input.selectedJobIds ?? [])].sort((left, right) => left - right);
    const artifactNames = input.artifactNames ? [...new Set(input.artifactNames)].sort() : undefined;
    const maximumArtifactBytes = input.maximumArtifactBytes ?? MAX_ARTIFACT_BYTES;
    const request = {
      operation: 'baby.github.delivery.publish',
      repositoryAuthorityId: input.repositoryAuthorityId,
      workspaceId: input.workspaceId,
      credentialReferenceId: input.credentialReferenceId,
      sourceRef: input.sourceRef,
      destinationRef: input.destinationRef,
      expectedRemoteOldObject: input.expectedRemoteOldObject ?? null,
      expiresAt: input.expiresAt,
      authorizationReference: input.authorizationReference,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
      title: input.title,
      body: input.body,
      draft: true,
      expectedChangedPathsDigest: input.expectedChangedPathsDigest,
      workflowId: input.workflowId ?? null,
      workflowEvent: input.workflowEvent ?? null,
      workflowDeadline: input.workflowDeadline,
      maximumWorkflowAttempts: input.maximumWorkflowAttempts,
      selectedJobIds,
      artifactNames: artifactNames ?? null,
      expectedArtifactDigests: input.expectedArtifactDigests ?? null,
      maximumArtifactBytes,
    };
    const semanticDigest = sha256Hex(canonicalJson(request));
    if (semanticDigest !== input.semanticIdempotencyFingerprint) {
      throw new GitHubProviderError('idempotency_conflict', 'Semantic fingerprint does not match delivery intent');
    }
    const createdAt = this.now();
    const reservation = this.options.registry.reserve({
      runId: input.deliveryId,
      idempotencyKey: input.idempotencyKey,
      semanticDigest,
      operation: 'baby.github.delivery.publish',
      authorityId: input.repositoryAuthorityId,
      state: 'intent_persisted',
      request,
      result: { deliveryId: input.deliveryId, state: 'intent_persisted', evidenceReferences: [] },
      attempt: 0,
      partialSuccess: false,
      createdAt,
      updatedAt: createdAt,
    });
    if (reservation.created) {
      this.options.registry.appendEvent({
        runId: input.deliveryId,
        state: 'intent_persisted',
        kind: 'delivery_intent_persisted',
        detail: request,
        occurredAt: createdAt,
      });
    }
    if (reservation.record.state === 'completed') return reservation.record.result as GitHubDeliveryPublicationResult;
    if (reservation.record.state === 'failed' || reservation.record.state === 'cancelled') {
      throw new GitHubProviderError(
        reservation.record.errorCode ?? 'delivery_terminal',
        reservation.record.errorMessage ?? 'Delivery is terminal',
        { partialSuccess: reservation.record.partialSuccess },
      );
    }

    let result = (reservation.record.result ?? {
      deliveryId: input.deliveryId,
      state: reservation.record.state,
      evidenceReferences: [],
    }) as GitHubDeliveryPublicationResult;

    try {
      if (!result.push) {
        const plan = this.options.safePublication.preview({
          repositoryAuthorityId: input.repositoryAuthorityId,
          workspaceId: input.workspaceId,
          credentialReferenceId: input.credentialReferenceId,
          sourceRef: input.sourceRef,
          destinationRef: input.destinationRef,
          ...(input.expectedRemoteOldObject ? { expectedRemoteOldObject: input.expectedRemoteOldObject } : {}),
          expiresAt: input.expiresAt,
        });
        const pushMutationId = this.childId(input.deliveryId, 'push');
        const pushFingerprint = sha256Hex(canonicalJson({
          operation: 'baby.github.delivery.publish.push',
          deliveryId: input.deliveryId,
          planId: plan.planId,
          planDigest: plan.planDigest,
        }));
        const push = this.options.safePublication.apply({
          mutationId: pushMutationId,
          semanticIdempotencyFingerprint: pushFingerprint,
          repositoryAuthorityId: input.repositoryAuthorityId,
          planId: plan.planId,
          planDigest: plan.planDigest,
          expectedLocalHead: plan.expectation.newObject,
          expectedLocalTree: plan.expectation.newTree,
          ...(plan.expectation.expectedOldObject ? { expectedRemoteOldObject: plan.expectation.expectedOldObject } : {}),
          authorizationReference: input.authorizationReference,
        });
        const commit = push.readback.observedCommit;
        const tree = push.readback.observedTree;
        if (!commit || !tree || commit !== plan.expectation.newObject || tree !== plan.expectation.newTree) {
          throw new GitHubProviderError('push_readback_mismatch', 'Verified push readback differs from planned commit or tree');
        }
        result = this.transition(input.deliveryId, 'push_verified', 'delivery_push_verified', {
          planId: plan.planId,
          mutationId: pushMutationId,
          commit,
          tree,
        }, {
          ...result,
          state: 'push_verified',
          push: {
            plan,
            mutationId: pushMutationId,
            commit,
            tree,
            destinationRef: input.destinationRef,
            evidenceReferences: push.evidenceReferences,
          },
          evidenceReferences: [...new Set([...result.evidenceReferences, ...push.evidenceReferences])],
        });
      }

      if (!result.pullRequest) {
        const push = result.push as NonNullable<GitHubDeliveryPublicationResult['push']>;
        const prRequest = {
          operation: 'baby.github.pr.upsert',
          repositoryAuthorityId: input.repositoryAuthorityId,
          headBranch: input.headBranch,
          headCommit: push.commit,
          headTree: push.tree,
          baseBranch: input.baseBranch,
          expectedPreviousStateDigest: null,
          title: input.title,
          body: input.body,
          draft: true,
          authorizationReference: input.authorizationReference,
        };
        const prRunId = this.childId(input.deliveryId, 'pr');
        const pr = this.options.provider.upsertPullRequest({
          runId: prRunId,
          idempotencyKey: this.childKey(input.idempotencyKey, 'pr'),
          semanticIdempotencyFingerprint: sha256Hex(canonicalJson(prRequest)),
          repositoryAuthorityId: input.repositoryAuthorityId,
          headBranch: input.headBranch,
          headCommit: push.commit,
          headTree: push.tree,
          baseBranch: input.baseBranch,
          title: input.title,
          body: input.body,
          draft: true,
          authorizationReference: input.authorizationReference,
        });
        const verifiedPr = this.options.provider.verifyPullRequest({
          repositoryAuthorityId: input.repositoryAuthorityId,
          pullRequestNumber: pr.readback.number,
          expectedBaseBranch: input.baseBranch,
          expectedHeadBranch: input.headBranch,
          expectedHeadCommit: push.commit,
          expectedHeadTree: push.tree,
          expectedDraft: true,
          expectedChangedPathsDigest: input.expectedChangedPathsDigest,
        });
        result = this.transition(input.deliveryId, 'pr_verified', 'delivery_pull_request_verified', {
          number: verifiedPr.number,
          headCommit: verifiedPr.headCommit,
        }, {
          ...result,
          state: 'pr_verified',
          pullRequest: verifiedPr,
          evidenceReferences: [...new Set([...result.evidenceReferences, ...verifiedPr.evidenceReferences])],
        });
      }

      if (!result.workflow) {
        const push = result.push as NonNullable<GitHubDeliveryPublicationResult['push']>;
        const discovered = this.options.provider.findWorkflow({
          repositoryAuthorityId: input.repositoryAuthorityId,
          exactCommit: push.commit,
          ...(input.workflowId ? { workflowId: input.workflowId } : {}),
          ...(input.workflowEvent ? { event: input.workflowEvent } : {}),
        });
        const waitRequest = {
          operation: 'baby.github.workflow.wait',
          repositoryAuthorityId: input.repositoryAuthorityId,
          workflow: discovered.workflow,
          selectedJobIds,
          deadline: input.workflowDeadline,
          maximumAttempts: input.maximumWorkflowAttempts,
        };
        const workflow = this.options.provider.waitWorkflow({
          runId: this.childId(input.deliveryId, 'workflow'),
          idempotencyKey: this.childKey(input.idempotencyKey, 'workflow'),
          semanticIdempotencyFingerprint: sha256Hex(canonicalJson(waitRequest)),
          repositoryAuthorityId: input.repositoryAuthorityId,
          workflow: discovered.workflow,
          selectedJobIds,
          deadline: input.workflowDeadline,
          maximumAttempts: input.maximumWorkflowAttempts,
        });
        result = this.transition(input.deliveryId, 'workflow_verified', 'delivery_workflow_verified', {
          workflowRunId: workflow.workflow.runId,
          attempt: workflow.workflow.attempt,
          headSha: workflow.workflow.headSha,
        }, {
          ...result,
          state: 'workflow_verified',
          workflow,
          evidenceReferences: [...new Set([...result.evidenceReferences, ...workflow.evidenceReferences])],
        });
      }

      if (!result.artifacts) {
        const push = result.push as NonNullable<GitHubDeliveryPublicationResult['push']>;
        const workflow = result.workflow as GitHubWorkflowRunReadback;
        const artifactRequest = {
          operation: 'baby.github.workflow.artifacts.capture',
          repositoryAuthorityId: input.repositoryAuthorityId,
          workflow: workflow.workflow,
          artifactNames: artifactNames ?? null,
          maximumArchiveBytes: maximumArtifactBytes,
          expectedSourceCommit: push.commit,
          expectedSourceTree: push.tree,
          expectedDigests: input.expectedArtifactDigests ?? null,
        };
        const artifacts = this.options.provider.captureWorkflowArtifacts({
          runId: this.childId(input.deliveryId, 'artifacts'),
          idempotencyKey: this.childKey(input.idempotencyKey, 'artifacts'),
          semanticIdempotencyFingerprint: sha256Hex(canonicalJson(artifactRequest)),
          repositoryAuthorityId: input.repositoryAuthorityId,
          workflow: workflow.workflow,
          artifactNames,
          maximumArchiveBytes: maximumArtifactBytes,
          expectedSourceCommit: push.commit,
          expectedSourceTree: push.tree,
          ...(input.expectedArtifactDigests ? { expectedDigests: input.expectedArtifactDigests } : {}),
        });
        result = this.transition(input.deliveryId, 'artifacts_verified', 'delivery_artifacts_verified', {
          count: artifacts.length,
          names: artifacts.map((entry) => entry.identity.name),
        }, { ...result, state: 'artifacts_verified', artifacts });
      }

      result = this.transition(input.deliveryId, 'completed', 'delivery_completed', {
        commit: result.push?.commit,
        pullRequestNumber: result.pullRequest?.number,
        workflowRunId: result.workflow?.workflow.runId,
        artifactCount: result.artifacts?.length ?? 0,
      }, { ...result, state: 'completed' });
      return result;
    } catch (error) {
      const latest = this.options.registry.getRequired(input.deliveryId);
      const latestResult = (latest.result ?? result) as GitHubDeliveryPublicationResult;
      const partialSuccess = Boolean(latestResult.push);
      const code = error instanceof GitHubProviderError ? error.code : 'delivery_failed';
      const message = error instanceof Error ? error.message : 'Delivery failed';
      const terminalState: GitHubProviderRunState = partialSuccess ? 'cancelled' : 'failed';
      const terminalResult = { ...latestResult, state: terminalState };
      const occurredAt = this.now();
      this.options.registry.update({
        runId: input.deliveryId,
        state: terminalState,
        result: terminalResult,
        errorCode: partialSuccess ? 'delivery_partial_failure' : code,
        errorMessage: message,
        partialSuccess,
        updatedAt: occurredAt,
      });
      this.options.registry.appendEvent({
        runId: input.deliveryId,
        state: terminalState,
        kind: partialSuccess ? 'delivery_cancelled_after_partial_success' : 'delivery_failed',
        detail: { code, message, partialSuccess },
        occurredAt,
      });
      throw new GitHubProviderError(
        partialSuccess ? 'delivery_partial_failure' : code,
        message,
        { causeCode: code, deliveryId: input.deliveryId, partialSuccess },
      );
    }
  }

  status(deliveryId: string): GitHubProviderRun {
    return this.options.registry.getRequired(deliveryId);
  }

  events(deliveryId: string, afterCursor = 0, limit = 200): GitHubProviderEvent[] {
    return this.options.registry.events(deliveryId, afterCursor, limit);
  }

  private transition(
    deliveryId: string,
    state: GitHubProviderRunState,
    kind: string,
    detail: unknown,
    result: GitHubDeliveryPublicationResult,
  ): GitHubDeliveryPublicationResult {
    const occurredAt = this.now();
    this.options.registry.update({
      runId: deliveryId,
      state,
      result,
      clearError: true,
      updatedAt: occurredAt,
    });
    this.options.registry.appendEvent({ runId: deliveryId, state, kind, detail, occurredAt });
    return result;
  }

  private childId(deliveryId: string, child: string): string {
    return `github-delivery-${child}-${sha256Hex(`${deliveryId}:${child}`).slice(0, 32)}`;
  }

  private childKey(idempotencyKey: string, child: string): string {
    return `github-delivery:${child}:${sha256Hex(`${idempotencyKey}:${child}`).slice(0, 40)}`;
  }
}
