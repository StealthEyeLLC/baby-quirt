/** Delivery persistence projected into the existing Baby deployment SQLite ledger. */

import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, sha256Hex } from '../crypto/canonical.js';
import { isDeploymentState } from '../deployment/state-machine.js';
import type { DeploymentState } from '../deployment/types.js';
import { canonicalizeDeliveryPlan } from './plan.js';
import {
  DELIVERY_STATES,
  DeliveryError,
  type CanonicalDeliveryPlan,
  type DeliveryArtifactReference,
  type DeliveryChildJobReference,
  type DeliveryEventRecord,
  type DeliveryEvidenceRecord,
  type DeliveryRunRecord,
  type DeliveryState,
} from './types.js';

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,256}$/u;
const DELIVERY_STATE_SQL = DELIVERY_STATES.map((state) => `'${state}'`).join(', ');
const MAX_EVENTS_PER_RUN = 100_000;

const TERMINAL_DELIVERY_STATES = new Set<DeliveryState>([
  'SUCCEEDED',
  'REJECTED',
  'FAILED',
  'CANCELLED_PRE_ARM',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
  'MANUAL_RECOVERY_REQUIRED',
  'PARTIAL',
  'AMBIGUOUS',
  'UNKNOWN',
]);

const DELIVERY_LEDGER_SQL = `
CREATE TABLE delivery_plans (
  delivery_id TEXT PRIMARY KEY,
  plan_digest TEXT NOT NULL UNIQUE CHECK (length(plan_digest) = 64),
  plan_json TEXT NOT NULL CHECK (length(plan_json) > 0 AND length(plan_json) <= 1048576),
  owner_principal TEXT NOT NULL,
  authorization_reference TEXT NOT NULL,
  target_hostname TEXT NOT NULL,
  target_machine_identity TEXT NOT NULL CHECK (length(target_machine_identity) = 64),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE delivery_runs (
  delivery_id TEXT PRIMARY KEY REFERENCES delivery_plans(delivery_id),
  plan_digest TEXT NOT NULL REFERENCES delivery_plans(plan_digest),
  generation INTEGER NOT NULL CHECK (generation > 0),
  state TEXT NOT NULL CHECK (state IN (${DELIVERY_STATE_SQL})),
  state_sequence INTEGER NOT NULL CHECK (state_sequence >= 0),
  deployment_id TEXT REFERENCES deployments(deployment_id),
  deployment_state TEXT,
  active_controller_lease TEXT,
  terminal INTEGER NOT NULL CHECK (terminal IN (0, 1)),
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE TABLE delivery_child_jobs (
  delivery_id TEXT NOT NULL REFERENCES delivery_runs(delivery_id),
  generation INTEGER NOT NULL CHECK (generation > 0),
  phase TEXT NOT NULL,
  job_id TEXT NOT NULL,
  result_digest TEXT CHECK (result_digest IS NULL OR length(result_digest) = 64),
  receipt_id TEXT,
  stdout_offset INTEGER NOT NULL CHECK (stdout_offset >= 0),
  stderr_offset INTEGER NOT NULL CHECK (stderr_offset >= 0),
  terminal INTEGER NOT NULL CHECK (terminal IN (0, 1)),
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64),
  PRIMARY KEY (delivery_id, job_id)
) STRICT;

CREATE TABLE delivery_artifacts (
  delivery_id TEXT NOT NULL REFERENCES delivery_runs(delivery_id),
  generation INTEGER NOT NULL CHECK (generation > 0),
  phase TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  size INTEGER NOT NULL CHECK (size >= 0),
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  PRIMARY KEY (delivery_id, artifact_id),
  UNIQUE (delivery_id, phase, sha256)
) STRICT;

CREATE TABLE delivery_events (
  delivery_id TEXT NOT NULL REFERENCES delivery_runs(delivery_id),
  offset INTEGER NOT NULL CHECK (offset >= 0),
  generation INTEGER NOT NULL CHECK (generation > 0),
  plan_digest TEXT NOT NULL CHECK (length(plan_digest) = 64),
  state TEXT NOT NULL CHECK (state IN (${DELIVERY_STATE_SQL})),
  phase TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL CHECK (length(message) > 0 AND length(message) <= 4096),
  child_job_id TEXT,
  artifact_reference TEXT,
  receipt_id TEXT,
  occurred_at TEXT NOT NULL,
  prior_event_digest TEXT CHECK (prior_event_digest IS NULL OR length(prior_event_digest) = 64),
  event_digest TEXT NOT NULL CHECK (length(event_digest) = 64),
  idempotency_key TEXT NOT NULL,
  semantic_digest TEXT NOT NULL CHECK (length(semantic_digest) = 64),
  result_json TEXT NOT NULL,
  result_digest TEXT NOT NULL CHECK (length(result_digest) = 64),
  PRIMARY KEY (delivery_id, offset),
  UNIQUE (delivery_id, event_digest),
  UNIQUE (delivery_id, idempotency_key)
) STRICT;

CREATE TABLE delivery_evidence (
  delivery_id TEXT NOT NULL REFERENCES delivery_runs(delivery_id),
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  generation INTEGER NOT NULL CHECK (generation > 0),
  plan_digest TEXT NOT NULL CHECK (length(plan_digest) = 64),
  deployment_id TEXT REFERENCES deployments(deployment_id),
  kind TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  artifact_reference TEXT NOT NULL,
  receipt_id TEXT,
  redacted INTEGER NOT NULL CHECK (redacted = 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (delivery_id, sequence),
  UNIQUE (delivery_id, kind, digest)
) STRICT;

CREATE TABLE delivery_controller_leases (
  delivery_id TEXT NOT NULL REFERENCES delivery_runs(delivery_id),
  lease_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  holder TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'released', 'expired')),
  released_at TEXT,
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64),
  PRIMARY KEY (delivery_id, lease_id)
) STRICT;

ALTER TABLE request_intents
  ADD COLUMN delivery_id TEXT REFERENCES delivery_runs(delivery_id);

CREATE INDEX delivery_runs_state_idx
  ON delivery_runs(state, generation, delivery_id);
CREATE INDEX delivery_events_time_idx
  ON delivery_events(delivery_id, occurred_at, offset);
CREATE INDEX delivery_evidence_kind_idx
  ON delivery_evidence(delivery_id, kind, sequence);
CREATE UNIQUE INDEX delivery_one_active_controller_idx
  ON delivery_controller_leases(delivery_id)
  WHERE status = 'active';

CREATE TRIGGER delivery_plans_no_update
BEFORE UPDATE ON delivery_plans BEGIN
  SELECT RAISE(ABORT, 'delivery plans are immutable');
END;
CREATE TRIGGER delivery_plans_no_delete
BEFORE DELETE ON delivery_plans BEGIN
  SELECT RAISE(ABORT, 'delivery plans are append-only');
END;

CREATE TRIGGER delivery_runs_identity_immutable
BEFORE UPDATE ON delivery_runs
WHEN OLD.delivery_id != NEW.delivery_id
  OR OLD.plan_digest != NEW.plan_digest
  OR OLD.created_at != NEW.created_at
  OR OLD.expires_at != NEW.expires_at
BEGIN
  SELECT RAISE(ABORT, 'delivery identity is immutable');
END;
CREATE TRIGGER delivery_runs_state_sequence_cas
BEFORE UPDATE ON delivery_runs
WHEN (
    OLD.generation != NEW.generation
    OR OLD.state != NEW.state
    OR OLD.deployment_id IS NOT NEW.deployment_id
    OR OLD.deployment_state IS NOT NEW.deployment_state
    OR OLD.terminal != NEW.terminal
  )
  AND NEW.state_sequence != OLD.state_sequence + 1
BEGIN
  SELECT RAISE(ABORT, 'delivery sequence must increment exactly once');
END;
CREATE TRIGGER delivery_runs_terminal_state_immutable
BEFORE UPDATE ON delivery_runs
WHEN OLD.terminal = 1 AND (
  OLD.generation != NEW.generation
  OR OLD.state != NEW.state
  OR OLD.state_sequence != NEW.state_sequence
  OR OLD.deployment_id IS NOT NEW.deployment_id
  OR OLD.deployment_state IS NOT NEW.deployment_state
  OR OLD.terminal != NEW.terminal
)
BEGIN
  SELECT RAISE(ABORT, 'terminal delivery state is immutable');
END;
CREATE TRIGGER delivery_runs_no_delete
BEFORE DELETE ON delivery_runs BEGIN
  SELECT RAISE(ABORT, 'delivery runs are append-only');
END;

CREATE TRIGGER delivery_child_jobs_identity_immutable
BEFORE UPDATE ON delivery_child_jobs
WHEN OLD.delivery_id != NEW.delivery_id
  OR OLD.generation != NEW.generation
  OR OLD.phase != NEW.phase
  OR OLD.job_id != NEW.job_id
BEGIN
  SELECT RAISE(ABORT, 'delivery child job identity is immutable');
END;
CREATE TRIGGER delivery_child_jobs_no_delete
BEFORE DELETE ON delivery_child_jobs BEGIN
  SELECT RAISE(ABORT, 'delivery child jobs are durable references');
END;

CREATE TRIGGER delivery_artifacts_no_update
BEFORE UPDATE ON delivery_artifacts BEGIN
  SELECT RAISE(ABORT, 'delivery artifact references are immutable');
END;
CREATE TRIGGER delivery_artifacts_no_delete
BEFORE DELETE ON delivery_artifacts BEGIN
  SELECT RAISE(ABORT, 'delivery artifact references are append-only');
END;

CREATE TRIGGER delivery_events_no_update
BEFORE UPDATE ON delivery_events BEGIN
  SELECT RAISE(ABORT, 'delivery events are immutable');
END;
CREATE TRIGGER delivery_events_no_delete
BEFORE DELETE ON delivery_events BEGIN
  SELECT RAISE(ABORT, 'delivery events are append-only');
END;

CREATE TRIGGER delivery_evidence_no_update
BEFORE UPDATE ON delivery_evidence BEGIN
  SELECT RAISE(ABORT, 'delivery evidence is immutable');
END;
CREATE TRIGGER delivery_evidence_no_delete
BEFORE DELETE ON delivery_evidence BEGIN
  SELECT RAISE(ABORT, 'delivery evidence is append-only');
END;

CREATE TRIGGER delivery_controller_leases_identity_immutable
BEFORE UPDATE ON delivery_controller_leases
WHEN OLD.delivery_id != NEW.delivery_id
  OR OLD.lease_id != NEW.lease_id
  OR OLD.generation != NEW.generation
  OR OLD.holder != NEW.holder
  OR OLD.acquired_at != NEW.acquired_at
BEGIN
  SELECT RAISE(ABORT, 'delivery controller lease identity is immutable');
END;
CREATE TRIGGER delivery_controller_leases_no_delete
BEFORE DELETE ON delivery_controller_leases BEGIN
  SELECT RAISE(ABORT, 'delivery controller leases are durable');
END;

CREATE TRIGGER request_intents_delivery_identity_immutable
BEFORE UPDATE ON request_intents
WHEN OLD.delivery_id IS NOT NEW.delivery_id
BEGIN
  SELECT RAISE(ABORT, 'request intent delivery identity is immutable');
END;
`;

export const DELIVERY_LEDGER_MIGRATION = Object.freeze({
  version: 2,
  name: 'automated_delivery_projection',
  sql: DELIVERY_LEDGER_SQL,
});

type SqlRow = Record<string, unknown>;

export interface DeliveryTransitionInput {
  deliveryId: string;
  planDigest: string;
  generation: number;
  expectedState: DeliveryState;
  expectedSequence: number;
  nextState: DeliveryState;
  phase: string;
  kind: string;
  message: string;
  idempotencyKey: string;
  occurredAt: string;
  deploymentId?: string;
  deploymentState?: DeploymentState;
  childJobId?: string;
  artifactReference?: string;
  receiptId?: string;
}

export interface DeliveryTransitionResult {
  run: DeliveryRunRecord;
  event: DeliveryEventRecord;
  replayed: boolean;
}

export interface DeliveryControllerLeaseRecord {
  deliveryId: string;
  leaseId: string;
  generation: number;
  holder: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  status: 'active' | 'released' | 'expired';
  releasedAt?: string;
  recordDigest: string;
}

export type DeliveryIntentReservation =
  | { state: 'reserved' }
  | { state: 'pending' }
  | { state: 'completed'; resultDigest: string; result: unknown }
  | { state: 'conflict'; existingSemanticDigest: string };

function asString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new DeliveryError('delivery_unknown', `Invalid ${key} in delivery ledger`);
  }
  return value;
}

function asNullableString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new DeliveryError('delivery_unknown', `Invalid ${key} in delivery ledger`);
  }
  return value;
}

function asNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new DeliveryError('delivery_unknown', `Invalid ${key} in delivery ledger`);
  }
  return value;
}

function asBoolean(row: SqlRow, key: string): boolean {
  const value = asNumber(row, key);
  if (value !== 0 && value !== 1) {
    throw new DeliveryError('delivery_unknown', `Invalid ${key} boolean in delivery ledger`);
  }
  return value === 1;
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new DeliveryError('delivery_invalid', `${label} is invalid`);
  }
}

function assertIdempotencyKey(value: string): void {
  if (!IDEMPOTENCY_PATTERN.test(value)) {
    throw new DeliveryError('delivery_invalid', 'idempotencyKey is invalid');
  }
}

function assertDigest(value: string, label: string): void {
  if (!DIGEST_PATTERN.test(value)) {
    throw new DeliveryError('delivery_invalid', `${label} must be a lowercase SHA-256`);
  }
}

function assertTimestamp(value: string, label: string): void {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new DeliveryError('delivery_invalid', `${label} must be canonical ISO-8601`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DeliveryError('delivery_invalid', `${label} must be a positive integer`);
  }
}

function assertNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DeliveryError('delivery_invalid', `${label} must be a nonnegative integer`);
  }
}

function assertDeliveryState(value: string): asserts value is DeliveryState {
  if (!(DELIVERY_STATES as readonly string[]).includes(value)) {
    throw new DeliveryError('delivery_unknown', `Unknown delivery state ${value}`);
  }
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new DeliveryError('delivery_unknown', `Invalid ${label} JSON in delivery ledger`);
  }
}

function canonicalPlan(plan: CanonicalDeliveryPlan): CanonicalDeliveryPlan {
  const { planDigest, ...body } = plan;
  const canonical = canonicalizeDeliveryPlan(body);
  if (canonical.planDigest !== planDigest) {
    throw new DeliveryError('delivery_plan_changed', 'Delivery plan digest does not match canonical content', {
      expected: canonical.planDigest,
      actual: planDigest,
    });
  }
  return canonical;
}

function mapChildJob(row: SqlRow): DeliveryChildJobReference {
  return {
    phase: asString(row, 'phase'),
    jobId: asString(row, 'job_id'),
    ...(asNullableString(row, 'result_digest') === undefined
      ? {}
      : { resultDigest: asString(row, 'result_digest') }),
    ...(asNullableString(row, 'receipt_id') === undefined
      ? {}
      : { receiptId: asString(row, 'receipt_id') }),
    stdoutOffset: asNumber(row, 'stdout_offset'),
    stderrOffset: asNumber(row, 'stderr_offset'),
    terminal: asBoolean(row, 'terminal'),
  };
}

function mapArtifact(row: SqlRow): DeliveryArtifactReference {
  return {
    phase: asString(row, 'phase'),
    artifactId: asString(row, 'artifact_id'),
    sha256: asString(row, 'sha256'),
    size: asNumber(row, 'size'),
    immutable: asBoolean(row, 'immutable'),
  };
}

function mapEvent(row: SqlRow): DeliveryEventRecord {
  const state = asString(row, 'state');
  assertDeliveryState(state);
  return {
    deliveryId: asString(row, 'delivery_id'),
    offset: asNumber(row, 'offset'),
    generation: asNumber(row, 'generation'),
    planDigest: asString(row, 'plan_digest'),
    state,
    phase: asString(row, 'phase'),
    kind: asString(row, 'kind'),
    message: asString(row, 'message'),
    ...(asNullableString(row, 'child_job_id') === undefined
      ? {}
      : { childJobId: asString(row, 'child_job_id') }),
    ...(asNullableString(row, 'artifact_reference') === undefined
      ? {}
      : { artifactReference: asString(row, 'artifact_reference') }),
    ...(asNullableString(row, 'receipt_id') === undefined
      ? {}
      : { receiptId: asString(row, 'receipt_id') }),
    occurredAt: asString(row, 'occurred_at'),
    eventDigest: asString(row, 'event_digest'),
  };
}

function mapEvidence(row: SqlRow): DeliveryEvidenceRecord {
  return {
    deliveryId: asString(row, 'delivery_id'),
    generation: asNumber(row, 'generation'),
    planDigest: asString(row, 'plan_digest'),
    ...(asNullableString(row, 'deployment_id') === undefined
      ? {}
      : { deploymentId: asString(row, 'deployment_id') }),
    kind: asString(row, 'kind'),
    digest: asString(row, 'digest'),
    artifactReference: asString(row, 'artifact_reference'),
    ...(asNullableString(row, 'receipt_id') === undefined
      ? {}
      : { receiptId: asString(row, 'receipt_id') }),
    redacted: true,
    createdAt: asString(row, 'created_at'),
  };
}

function mapLease(row: SqlRow): DeliveryControllerLeaseRecord {
  const status = asString(row, 'status');
  if (status !== 'active' && status !== 'released' && status !== 'expired') {
    throw new DeliveryError('delivery_unknown', `Unknown controller lease status ${status}`);
  }
  return {
    deliveryId: asString(row, 'delivery_id'),
    leaseId: asString(row, 'lease_id'),
    generation: asNumber(row, 'generation'),
    holder: asString(row, 'holder'),
    acquiredAt: asString(row, 'acquired_at'),
    heartbeatAt: asString(row, 'heartbeat_at'),
    expiresAt: asString(row, 'expires_at'),
    status,
    ...(asNullableString(row, 'released_at') === undefined
      ? {}
      : { releasedAt: asString(row, 'released_at') }),
    recordDigest: asString(row, 'record_digest'),
  };
}

export class DeliveryPersistence {
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

  createRun(planInput: CanonicalDeliveryPlan, generation: number, createdAt: string): DeliveryRunRecord {
    const plan = canonicalPlan(planInput);
    assertPositiveInteger(generation, 'generation');
    assertTimestamp(createdAt, 'createdAt');
    if (new Date(createdAt) > new Date(plan.timeBounds.expiresAt)) {
      throw new DeliveryError('delivery_expired', 'Delivery plan is already expired');
    }
    const recordDigest = sha256Hex(
      canonicalJson({
        deliveryId: plan.deliveryId,
        planDigest: plan.planDigest,
        generation,
        state: 'PLANNED',
        stateSequence: 0,
        deploymentId: null,
        deploymentState: null,
        activeControllerLease: null,
        terminal: false,
        createdAt,
        expiresAt: plan.timeBounds.expiresAt,
      }),
    );

    return this.transaction(() => {
      const existing = this.getRun(plan.deliveryId);
      if (existing) {
        if (existing.planDigest !== plan.planDigest) {
          throw new DeliveryError('delivery_plan_changed', 'Delivery ID is already bound to another plan');
        }
        if (existing.generation !== generation) {
          throw new DeliveryError('delivery_generation_conflict', 'Delivery generation changed', {
            expected: generation,
            actual: existing.generation,
          });
        }
        return existing;
      }
      this.database
        .prepare(
          `INSERT INTO delivery_plans(
            delivery_id, plan_digest, plan_json, owner_principal, authorization_reference,
            target_hostname, target_machine_identity, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          plan.deliveryId,
          plan.planDigest,
          canonicalJson(plan),
          plan.ownerPrincipal,
          plan.authorizationReference,
          plan.targetHostname,
          plan.targetMachineIdentity,
          plan.timeBounds.expiresAt,
          createdAt,
        );
      this.database
        .prepare(
          `INSERT INTO delivery_runs(
            delivery_id, plan_digest, generation, state, state_sequence,
            deployment_id, deployment_state, active_controller_lease, terminal,
            record_digest, created_at, updated_at, expires_at
          ) VALUES (?, ?, ?, 'PLANNED', 0, NULL, NULL, NULL, 0, ?, ?, ?, ?)`,
        )
        .run(
          plan.deliveryId,
          plan.planDigest,
          generation,
          recordDigest,
          createdAt,
          createdAt,
          plan.timeBounds.expiresAt,
        );
      return this.getRunRequired(plan.deliveryId);
    });
  }

  getPlan(deliveryId: string): CanonicalDeliveryPlan | undefined {
    assertIdentifier(deliveryId, 'deliveryId');
    const row = this.database
      .prepare('SELECT plan_json, plan_digest FROM delivery_plans WHERE delivery_id = ?')
      .get(deliveryId) as SqlRow | undefined;
    if (!row) return undefined;
    const parsed = parseJson(asString(row, 'plan_json'), 'delivery plan') as CanonicalDeliveryPlan;
    const plan = canonicalPlan(parsed);
    if (plan.planDigest !== asString(row, 'plan_digest')) {
      throw new DeliveryError('delivery_unknown', 'Stored delivery plan digest is inconsistent');
    }
    return plan;
  }

  getRun(deliveryId: string): DeliveryRunRecord | undefined {
    assertIdentifier(deliveryId, 'deliveryId');
    const row = this.database
      .prepare('SELECT * FROM delivery_runs WHERE delivery_id = ?')
      .get(deliveryId) as SqlRow | undefined;
    if (!row) return undefined;
    const plan = this.getPlan(deliveryId);
    if (!plan) {
      throw new DeliveryError('delivery_unknown', 'Delivery run has no immutable plan');
    }
    const state = asString(row, 'state');
    assertDeliveryState(state);
    const deploymentStateValue = asNullableString(row, 'deployment_state');
    let deploymentState: DeploymentState | undefined;
    if (deploymentStateValue !== undefined) {
      if (!isDeploymentState(deploymentStateValue)) {
        throw new DeliveryError('delivery_unknown', 'Stored deployment projection is invalid');
      }
      deploymentState = deploymentStateValue;
    }
    const childJobs = (
      this.database
        .prepare('SELECT * FROM delivery_child_jobs WHERE delivery_id = ? ORDER BY phase, job_id')
        .all(deliveryId) as SqlRow[]
    ).map(mapChildJob);
    const artifacts = (
      this.database
        .prepare('SELECT * FROM delivery_artifacts WHERE delivery_id = ? ORDER BY phase, artifact_id')
        .all(deliveryId) as SqlRow[]
    ).map(mapArtifact);
    return {
      deliveryId,
      planDigest: asString(row, 'plan_digest'),
      ownerPrincipal: plan.ownerPrincipal,
      authorizationReference: plan.authorizationReference,
      targetHostname: plan.targetHostname,
      targetMachineIdentity: plan.targetMachineIdentity,
      generation: asNumber(row, 'generation'),
      state,
      stateSequence: asNumber(row, 'state_sequence'),
      ...(asNullableString(row, 'deployment_id') === undefined
        ? {}
        : { deploymentId: asString(row, 'deployment_id') }),
      ...(deploymentState === undefined ? {} : { deploymentState }),
      ...(asNullableString(row, 'active_controller_lease') === undefined
        ? {}
        : { activeControllerLease: asString(row, 'active_controller_lease') }),
      childJobs,
      artifacts,
      createdAt: asString(row, 'created_at'),
      updatedAt: asString(row, 'updated_at'),
      expiresAt: asString(row, 'expires_at'),
      terminal: asBoolean(row, 'terminal'),
    };
  }

  private getRunRequired(deliveryId: string): DeliveryRunRecord {
    const run = this.getRun(deliveryId);
    if (!run) throw new DeliveryError('delivery_not_found', `Delivery ${deliveryId} not found`);
    return run;
  }

  listRuns(options: { offset?: number; limit?: number; state?: DeliveryState } = {}): DeliveryRunRecord[] {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    assertNonnegativeInteger(offset, 'offset');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new DeliveryError('delivery_invalid', 'limit must be between 1 and 200');
    }
    if (options.state !== undefined) assertDeliveryState(options.state);
    const rows = (options.state === undefined
      ? this.database
          .prepare('SELECT delivery_id FROM delivery_runs ORDER BY created_at DESC, delivery_id LIMIT ? OFFSET ?')
          .all(limit, offset)
      : this.database
          .prepare(
            'SELECT delivery_id FROM delivery_runs WHERE state = ? ORDER BY created_at DESC, delivery_id LIMIT ? OFFSET ?',
          )
          .all(options.state, limit, offset)) as SqlRow[];
    return rows.map((row) => this.getRunRequired(asString(row, 'delivery_id')));
  }

  transition(input: DeliveryTransitionInput): DeliveryTransitionResult {
    this.validateTransition(input);
    const semanticDigest = sha256Hex(
      canonicalJson({
        deliveryId: input.deliveryId,
        planDigest: input.planDigest,
        generation: input.generation,
        expectedState: input.expectedState,
        expectedSequence: input.expectedSequence,
        nextState: input.nextState,
        phase: input.phase,
        kind: input.kind,
        message: input.message,
        occurredAt: input.occurredAt,
        deploymentId: input.deploymentId ?? null,
        deploymentState: input.deploymentState ?? null,
        childJobId: input.childJobId ?? null,
        artifactReference: input.artifactReference ?? null,
        receiptId: input.receiptId ?? null,
      }),
    );

    return this.transaction(() => {
      const prior = this.database
        .prepare('SELECT * FROM delivery_events WHERE delivery_id = ? AND idempotency_key = ?')
        .get(input.deliveryId, input.idempotencyKey) as SqlRow | undefined;
      if (prior) {
        if (asString(prior, 'semantic_digest') !== semanticDigest) {
          throw new DeliveryError('idempotency_conflict', 'Delivery transition changed semantic intent');
        }
        const resultJson = asString(prior, 'result_json');
        if (sha256Hex(resultJson) !== asString(prior, 'result_digest')) {
          throw new DeliveryError('delivery_unknown', 'Stored transition result digest is invalid');
        }
        const result = parseJson(resultJson, 'delivery transition result') as DeliveryTransitionResult;
        return { ...result, replayed: true };
      }

      const current = this.getRunRequired(input.deliveryId);
      if (current.planDigest !== input.planDigest) {
        throw new DeliveryError('delivery_plan_changed', 'Delivery plan digest compare-and-swap failed');
      }
      if (current.generation !== input.generation) {
        throw new DeliveryError('delivery_generation_conflict', 'Delivery generation compare-and-swap failed', {
          expected: input.generation,
          actual: current.generation,
        });
      }
      if (current.terminal) {
        throw new DeliveryError('delivery_state_conflict', 'Terminal delivery state is immutable');
      }
      if (current.state !== input.expectedState || current.stateSequence !== input.expectedSequence) {
        throw new DeliveryError('delivery_state_conflict', 'Delivery state compare-and-swap failed', {
          expectedState: input.expectedState,
          actualState: current.state,
          expectedSequence: input.expectedSequence,
          actualSequence: current.stateSequence,
        });
      }
      if (new Date(input.occurredAt) > new Date(current.expiresAt)) {
        throw new DeliveryError('delivery_expired', 'Delivery transition occurred after plan expiry');
      }
      const deploymentId = input.deploymentId ?? current.deploymentId;
      if (current.deploymentId !== undefined && input.deploymentId !== undefined && current.deploymentId !== input.deploymentId) {
        throw new DeliveryError('delivery_conflict', 'Authoritative deployment binding is immutable');
      }
      const deploymentState = input.deploymentState ?? current.deploymentState;
      if (deploymentState !== undefined && deploymentId === undefined) {
        throw new DeliveryError('delivery_invalid', 'deploymentState requires an authoritative deploymentId');
      }
      const countRow = this.database
        .prepare('SELECT COUNT(*) AS count FROM delivery_events WHERE delivery_id = ?')
        .get(input.deliveryId) as SqlRow;
      const count = asNumber(countRow, 'count');
      if (count >= MAX_EVENTS_PER_RUN) {
        throw new DeliveryError('delivery_conflict', 'Delivery event bound has been reached');
      }
      const last = this.database
        .prepare('SELECT offset, event_digest FROM delivery_events WHERE delivery_id = ? ORDER BY offset DESC LIMIT 1')
        .get(input.deliveryId) as SqlRow | undefined;
      const offset = last === undefined ? 0 : asNumber(last, 'offset') + 1;
      const priorEventDigest = last === undefined ? undefined : asString(last, 'event_digest');
      const terminal = TERMINAL_DELIVERY_STATES.has(input.nextState);
      const nextSequence = current.stateSequence + 1;
      const eventDigest = sha256Hex(
        canonicalJson({
          priorEventDigest: priorEventDigest ?? null,
          semanticDigest,
          offset,
          generation: input.generation,
          planDigest: input.planDigest,
          state: input.nextState,
          stateSequence: nextSequence,
        }),
      );
      const event: DeliveryEventRecord = {
        deliveryId: input.deliveryId,
        offset,
        generation: input.generation,
        planDigest: input.planDigest,
        state: input.nextState,
        phase: input.phase,
        kind: input.kind,
        message: input.message,
        ...(input.childJobId === undefined ? {} : { childJobId: input.childJobId }),
        ...(input.artifactReference === undefined
          ? {}
          : { artifactReference: input.artifactReference }),
        ...(input.receiptId === undefined ? {} : { receiptId: input.receiptId }),
        occurredAt: input.occurredAt,
        eventDigest,
      };
      const nextRun: DeliveryRunRecord = {
        ...current,
        state: input.nextState,
        stateSequence: nextSequence,
        ...(deploymentId === undefined ? {} : { deploymentId }),
        ...(deploymentState === undefined ? {} : { deploymentState }),
        updatedAt: input.occurredAt,
        terminal,
      };
      const result: DeliveryTransitionResult = { run: nextRun, event, replayed: false };
      const resultJson = canonicalJson(result);
      const resultDigest = sha256Hex(resultJson);
      const priorRecord = this.database
        .prepare('SELECT record_digest FROM delivery_runs WHERE delivery_id = ?')
        .get(input.deliveryId) as SqlRow;
      const recordDigest = sha256Hex(
        canonicalJson({
          priorRecordDigest: asString(priorRecord, 'record_digest'),
          eventDigest,
          state: input.nextState,
          stateSequence: nextSequence,
          deploymentId: deploymentId ?? null,
          deploymentState: deploymentState ?? null,
          terminal,
        }),
      );

      this.database
        .prepare(
          `INSERT INTO delivery_events(
            delivery_id, offset, generation, plan_digest, state, phase, kind, message,
            child_job_id, artifact_reference, receipt_id, occurred_at, prior_event_digest,
            event_digest, idempotency_key, semantic_digest, result_json, result_digest
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.deliveryId,
          offset,
          input.generation,
          input.planDigest,
          input.nextState,
          input.phase,
          input.kind,
          input.message,
          input.childJobId ?? null,
          input.artifactReference ?? null,
          input.receiptId ?? null,
          input.occurredAt,
          priorEventDigest ?? null,
          eventDigest,
          input.idempotencyKey,
          semanticDigest,
          resultJson,
          resultDigest,
        );
      const updated = this.database
        .prepare(
          `UPDATE delivery_runs SET
            state = ?, state_sequence = ?, deployment_id = ?, deployment_state = ?,
            terminal = ?, record_digest = ?, updated_at = ?
          WHERE delivery_id = ? AND plan_digest = ? AND generation = ?
            AND state = ? AND state_sequence = ? AND terminal = 0`,
        )
        .run(
          input.nextState,
          nextSequence,
          deploymentId ?? null,
          deploymentState ?? null,
          terminal ? 1 : 0,
          recordDigest,
          input.occurredAt,
          input.deliveryId,
          input.planDigest,
          input.generation,
          input.expectedState,
          input.expectedSequence,
        );
      if (updated.changes !== 1) {
        throw new DeliveryError('delivery_state_conflict', 'Delivery transition CAS update failed');
      }
      return result;
    });
  }

  private validateTransition(input: DeliveryTransitionInput): void {
    assertIdentifier(input.deliveryId, 'deliveryId');
    assertDigest(input.planDigest, 'planDigest');
    assertPositiveInteger(input.generation, 'generation');
    assertDeliveryState(input.expectedState);
    assertNonnegativeInteger(input.expectedSequence, 'expectedSequence');
    assertDeliveryState(input.nextState);
    assertIdentifier(input.phase, 'phase');
    assertIdentifier(input.kind, 'kind');
    if (input.message.length < 1 || input.message.length > 4096) {
      throw new DeliveryError('delivery_invalid', 'message must be a nonempty bounded string');
    }
    assertIdempotencyKey(input.idempotencyKey);
    assertTimestamp(input.occurredAt, 'occurredAt');
    if (input.deploymentId !== undefined) assertIdentifier(input.deploymentId, 'deploymentId');
    if (input.deploymentState !== undefined && !isDeploymentState(input.deploymentState)) {
      throw new DeliveryError('delivery_invalid', 'deploymentState is invalid');
    }
    if (input.childJobId !== undefined) assertIdentifier(input.childJobId, 'childJobId');
    if (input.receiptId !== undefined) assertIdentifier(input.receiptId, 'receiptId');
    if (input.artifactReference !== undefined && input.artifactReference.length > 4096) {
      throw new DeliveryError('delivery_invalid', 'artifactReference is too long');
    }
  }

  listEvents(deliveryId: string, offset = 0, limit = 50): {
    deliveryId: string;
    offset: number;
    nextOffset: number;
    items: DeliveryEventRecord[];
  } {
    this.getRunRequired(deliveryId);
    assertNonnegativeInteger(offset, 'offset');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new DeliveryError('delivery_invalid', 'limit must be between 1 and 200');
    }
    const items = (
      this.database
        .prepare(
          'SELECT * FROM delivery_events WHERE delivery_id = ? AND offset >= ? ORDER BY offset LIMIT ?',
        )
        .all(deliveryId, offset, limit) as SqlRow[]
    ).map(mapEvent);
    return {
      deliveryId,
      offset,
      nextOffset: items.length === 0 ? offset : items.at(-1)!.offset + 1,
      items,
    };
  }

  recordChildJob(input: {
    deliveryId: string;
    planDigest: string;
    generation: number;
    reference: DeliveryChildJobReference;
  }): DeliveryChildJobReference {
    assertIdentifier(input.deliveryId, 'deliveryId');
    assertDigest(input.planDigest, 'planDigest');
    assertPositiveInteger(input.generation, 'generation');
    assertIdentifier(input.reference.phase, 'phase');
    assertIdentifier(input.reference.jobId, 'jobId');
    if (input.reference.resultDigest !== undefined) assertDigest(input.reference.resultDigest, 'resultDigest');
    if (input.reference.receiptId !== undefined) assertIdentifier(input.reference.receiptId, 'receiptId');
    assertNonnegativeInteger(input.reference.stdoutOffset, 'stdoutOffset');
    assertNonnegativeInteger(input.reference.stderrOffset, 'stderrOffset');

    return this.transaction(() => {
      const run = this.assertRunFence(input.deliveryId, input.planDigest, input.generation);
      const existingRow = this.database
        .prepare('SELECT * FROM delivery_child_jobs WHERE delivery_id = ? AND job_id = ?')
        .get(input.deliveryId, input.reference.jobId) as SqlRow | undefined;
      if (!existingRow) {
        const recordDigest = sha256Hex(canonicalJson({ generation: input.generation, ...input.reference }));
        this.database
          .prepare(
            `INSERT INTO delivery_child_jobs(
              delivery_id, generation, phase, job_id, result_digest, receipt_id,
              stdout_offset, stderr_offset, terminal, record_digest
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.deliveryId,
            input.generation,
            input.reference.phase,
            input.reference.jobId,
            input.reference.resultDigest ?? null,
            input.reference.receiptId ?? null,
            input.reference.stdoutOffset,
            input.reference.stderrOffset,
            input.reference.terminal ? 1 : 0,
            recordDigest,
          );
        return input.reference;
      }
      const existing = mapChildJob(existingRow);
      if (existing.phase !== input.reference.phase) {
        throw new DeliveryError('delivery_conflict', 'Child job phase is immutable');
      }
      if (existing.terminal) {
        if (canonicalJson(existing) === canonicalJson(input.reference)) return existing;
        throw new DeliveryError('delivery_conflict', 'Terminal child job reference is immutable');
      }
      if (
        input.reference.stdoutOffset < existing.stdoutOffset ||
        input.reference.stderrOffset < existing.stderrOffset
      ) {
        throw new DeliveryError('delivery_conflict', 'Child job stream offsets cannot move backward');
      }
      if (
        existing.resultDigest !== undefined &&
        input.reference.resultDigest !== existing.resultDigest
      ) {
        throw new DeliveryError('delivery_conflict', 'Child job result digest changed');
      }
      if (existing.receiptId !== undefined && input.reference.receiptId !== existing.receiptId) {
        throw new DeliveryError('delivery_receipt_invalid', 'Child job receipt identity changed');
      }
      const recordDigest = sha256Hex(
        canonicalJson({
          priorRecordDigest: asString(existingRow, 'record_digest'),
          generation: run.generation,
          reference: input.reference,
        }),
      );
      this.database
        .prepare(
          `UPDATE delivery_child_jobs SET
            result_digest = ?, receipt_id = ?, stdout_offset = ?, stderr_offset = ?,
            terminal = ?, record_digest = ?
          WHERE delivery_id = ? AND job_id = ? AND terminal = 0`,
        )
        .run(
          input.reference.resultDigest ?? null,
          input.reference.receiptId ?? null,
          input.reference.stdoutOffset,
          input.reference.stderrOffset,
          input.reference.terminal ? 1 : 0,
          recordDigest,
          input.deliveryId,
          input.reference.jobId,
        );
      return input.reference;
    });
  }

  recordArtifact(input: {
    deliveryId: string;
    planDigest: string;
    generation: number;
    reference: DeliveryArtifactReference;
  }): DeliveryArtifactReference {
    assertIdentifier(input.deliveryId, 'deliveryId');
    assertDigest(input.planDigest, 'planDigest');
    assertPositiveInteger(input.generation, 'generation');
    assertIdentifier(input.reference.phase, 'phase');
    assertIdentifier(input.reference.artifactId, 'artifactId');
    assertDigest(input.reference.sha256, 'artifact sha256');
    assertNonnegativeInteger(input.reference.size, 'artifact size');
    if (!input.reference.immutable) {
      throw new DeliveryError('delivery_invalid', 'Delivery artifacts must be finalized and immutable');
    }
    return this.transaction(() => {
      this.assertRunFence(input.deliveryId, input.planDigest, input.generation);
      const existingRow = this.database
        .prepare('SELECT * FROM delivery_artifacts WHERE delivery_id = ? AND artifact_id = ?')
        .get(input.deliveryId, input.reference.artifactId) as SqlRow | undefined;
      if (existingRow) {
        const existing = mapArtifact(existingRow);
        if (canonicalJson(existing) === canonicalJson(input.reference)) return existing;
        throw new DeliveryError('delivery_conflict', 'Artifact reference is immutable');
      }
      this.database
        .prepare(
          `INSERT INTO delivery_artifacts(
            delivery_id, generation, phase, artifact_id, sha256, size, immutable
          ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(
          input.deliveryId,
          input.generation,
          input.reference.phase,
          input.reference.artifactId,
          input.reference.sha256,
          input.reference.size,
        );
      return input.reference;
    });
  }

  appendEvidence(record: DeliveryEvidenceRecord): DeliveryEvidenceRecord {
    assertIdentifier(record.deliveryId, 'deliveryId');
    assertPositiveInteger(record.generation, 'generation');
    assertDigest(record.planDigest, 'planDigest');
    if (record.deploymentId !== undefined) assertIdentifier(record.deploymentId, 'deploymentId');
    assertIdentifier(record.kind, 'evidence kind');
    assertDigest(record.digest, 'evidence digest');
    if (record.artifactReference.length < 1 || record.artifactReference.length > 4096) {
      throw new DeliveryError('delivery_invalid', 'artifactReference must be nonempty and bounded');
    }
    if (record.receiptId !== undefined) assertIdentifier(record.receiptId, 'receiptId');
    if (record.redacted !== true) {
      throw new DeliveryError('delivery_invalid', 'Durable delivery evidence must be redacted');
    }
    assertTimestamp(record.createdAt, 'createdAt');
    return this.transaction(() => {
      const run = this.assertRunFence(record.deliveryId, record.planDigest, record.generation);
      if (record.deploymentId !== undefined && run.deploymentId !== record.deploymentId) {
        throw new DeliveryError('delivery_conflict', 'Evidence deployment binding does not match the run');
      }
      const existingRow = this.database
        .prepare(
          'SELECT * FROM delivery_evidence WHERE delivery_id = ? AND kind = ? AND digest = ?',
        )
        .get(record.deliveryId, record.kind, record.digest) as SqlRow | undefined;
      if (existingRow) {
        const existing = mapEvidence(existingRow);
        if (canonicalJson(existing) === canonicalJson(record)) return existing;
        throw new DeliveryError('delivery_conflict', 'Evidence reference is immutable');
      }
      const last = this.database
        .prepare('SELECT sequence FROM delivery_evidence WHERE delivery_id = ? ORDER BY sequence DESC LIMIT 1')
        .get(record.deliveryId) as SqlRow | undefined;
      const sequence = last === undefined ? 0 : asNumber(last, 'sequence') + 1;
      this.database
        .prepare(
          `INSERT INTO delivery_evidence(
            delivery_id, sequence, generation, plan_digest, deployment_id, kind, digest,
            artifact_reference, receipt_id, redacted, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          record.deliveryId,
          sequence,
          record.generation,
          record.planDigest,
          record.deploymentId ?? null,
          record.kind,
          record.digest,
          record.artifactReference,
          record.receiptId ?? null,
          record.createdAt,
        );
      return record;
    });
  }

  listEvidence(deliveryId: string, options: { kind?: string; offset?: number; limit?: number } = {}): {
    deliveryId: string;
    offset: number;
    nextOffset: number;
    items: DeliveryEvidenceRecord[];
  } {
    this.getRunRequired(deliveryId);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    assertNonnegativeInteger(offset, 'offset');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new DeliveryError('delivery_invalid', 'limit must be between 1 and 200');
    }
    if (options.kind !== undefined) assertIdentifier(options.kind, 'kind');
    const rows = (options.kind === undefined
      ? this.database
          .prepare(
            'SELECT * FROM delivery_evidence WHERE delivery_id = ? AND sequence >= ? ORDER BY sequence LIMIT ?',
          )
          .all(deliveryId, offset, limit)
      : this.database
          .prepare(
            `SELECT * FROM delivery_evidence
             WHERE delivery_id = ? AND kind = ? AND sequence >= ? ORDER BY sequence LIMIT ?`,
          )
          .all(deliveryId, options.kind, offset, limit)) as SqlRow[];
    const items = rows.map(mapEvidence);
    return {
      deliveryId,
      offset,
      nextOffset: rows.length === 0 ? offset : asNumber(rows.at(-1)!, 'sequence') + 1,
      items,
    };
  }

  acquireControllerLease(input: {
    deliveryId: string;
    planDigest: string;
    generation: number;
    leaseId: string;
    holder: string;
    acquiredAt: string;
    expiresAt: string;
  }): DeliveryControllerLeaseRecord {
    this.validateLeaseIdentity(input);
    if (new Date(input.expiresAt) <= new Date(input.acquiredAt)) {
      throw new DeliveryError('delivery_invalid', 'Controller lease expiry must follow acquisition');
    }
    return this.transaction(() => {
      const run = this.assertRunFence(input.deliveryId, input.planDigest, input.generation);
      if (run.terminal) {
        throw new DeliveryError('delivery_state_conflict', 'Cannot acquire a controller lease for a terminal delivery');
      }
      const sameRow = this.database
        .prepare('SELECT * FROM delivery_controller_leases WHERE delivery_id = ? AND lease_id = ?')
        .get(input.deliveryId, input.leaseId) as SqlRow | undefined;
      if (sameRow) {
        const same = mapLease(sameRow);
        if (
          same.generation === input.generation &&
          same.holder === input.holder &&
          same.acquiredAt === input.acquiredAt &&
          same.expiresAt === input.expiresAt &&
          same.status === 'active'
        ) return same;
        throw new DeliveryError('delivery_controller_conflict', 'Controller lease ID changed intent');
      }
      const activeRow = this.database
        .prepare("SELECT * FROM delivery_controller_leases WHERE delivery_id = ? AND status = 'active'")
        .get(input.deliveryId) as SqlRow | undefined;
      if (activeRow) {
        const active = mapLease(activeRow);
        if (new Date(active.expiresAt) > new Date(input.acquiredAt)) {
          throw new DeliveryError('delivery_controller_conflict', 'Another controller lease is active', {
            leaseId: active.leaseId,
            holder: active.holder,
            expiresAt: active.expiresAt,
          });
        }
        const expiredDigest = sha256Hex(
          canonicalJson({ priorRecordDigest: active.recordDigest, status: 'expired', at: input.acquiredAt }),
        );
        this.database
          .prepare(
            `UPDATE delivery_controller_leases SET
              heartbeat_at = ?, status = 'expired', released_at = ?, record_digest = ?
             WHERE delivery_id = ? AND lease_id = ? AND status = 'active'`,
          )
          .run(
            input.acquiredAt,
            input.acquiredAt,
            expiredDigest,
            input.deliveryId,
            active.leaseId,
          );
      }
      const recordDigest = sha256Hex(
        canonicalJson({
          deliveryId: input.deliveryId,
          leaseId: input.leaseId,
          generation: input.generation,
          holder: input.holder,
          acquiredAt: input.acquiredAt,
          expiresAt: input.expiresAt,
          status: 'active',
        }),
      );
      this.database
        .prepare(
          `INSERT INTO delivery_controller_leases(
            delivery_id, lease_id, generation, holder, acquired_at, heartbeat_at,
            expires_at, status, released_at, record_digest
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?)`,
        )
        .run(
          input.deliveryId,
          input.leaseId,
          input.generation,
          input.holder,
          input.acquiredAt,
          input.acquiredAt,
          input.expiresAt,
          recordDigest,
        );
      this.updateLeasePointer(run, input.leaseId, input.acquiredAt);
      return mapLease(
        this.database
          .prepare('SELECT * FROM delivery_controller_leases WHERE delivery_id = ? AND lease_id = ?')
          .get(input.deliveryId, input.leaseId) as SqlRow,
      );
    });
  }

  renewControllerLease(input: {
    deliveryId: string;
    planDigest: string;
    generation: number;
    leaseId: string;
    holder: string;
    heartbeatAt: string;
    expiresAt: string;
  }): DeliveryControllerLeaseRecord {
    assertIdentifier(input.deliveryId, 'deliveryId');
    assertDigest(input.planDigest, 'planDigest');
    assertPositiveInteger(input.generation, 'generation');
    assertIdentifier(input.leaseId, 'leaseId');
    assertIdentifier(input.holder, 'holder');
    assertTimestamp(input.heartbeatAt, 'heartbeatAt');
    assertTimestamp(input.expiresAt, 'expiresAt');
    if (new Date(input.expiresAt) <= new Date(input.heartbeatAt)) {
      throw new DeliveryError('delivery_invalid', 'Controller lease expiry must follow heartbeat');
    }
    return this.transaction(() => {
      const run = this.assertRunFence(input.deliveryId, input.planDigest, input.generation);
      const row = this.database
        .prepare('SELECT * FROM delivery_controller_leases WHERE delivery_id = ? AND lease_id = ?')
        .get(input.deliveryId, input.leaseId) as SqlRow | undefined;
      if (!row) throw new DeliveryError('delivery_controller_conflict', 'Controller lease does not exist');
      const lease = mapLease(row);
      if (
        lease.status !== 'active' ||
        lease.holder !== input.holder ||
        run.activeControllerLease !== input.leaseId
      ) {
        throw new DeliveryError('delivery_controller_conflict', 'Controller lease is not active for this holder');
      }
      if (new Date(input.heartbeatAt) < new Date(lease.heartbeatAt)) {
        throw new DeliveryError('delivery_controller_conflict', 'Controller heartbeat cannot move backward');
      }
      if (input.heartbeatAt === lease.heartbeatAt && input.expiresAt === lease.expiresAt) return lease;
      if (new Date(input.expiresAt) < new Date(lease.expiresAt)) {
        throw new DeliveryError('delivery_controller_conflict', 'Controller lease expiry cannot move backward');
      }
      const recordDigest = sha256Hex(
        canonicalJson({
          priorRecordDigest: lease.recordDigest,
          heartbeatAt: input.heartbeatAt,
          expiresAt: input.expiresAt,
          status: 'active',
        }),
      );
      this.database
        .prepare(
          `UPDATE delivery_controller_leases SET
            heartbeat_at = ?, expires_at = ?, record_digest = ?
           WHERE delivery_id = ? AND lease_id = ? AND status = 'active'`,
        )
        .run(input.heartbeatAt, input.expiresAt, recordDigest, input.deliveryId, input.leaseId);
      this.updateLeasePointer(run, input.leaseId, input.heartbeatAt);
      return mapLease(
        this.database
          .prepare('SELECT * FROM delivery_controller_leases WHERE delivery_id = ? AND lease_id = ?')
          .get(input.deliveryId, input.leaseId) as SqlRow,
      );
    });
  }

  releaseControllerLease(input: {
    deliveryId: string;
    planDigest: string;
    generation: number;
    leaseId: string;
    holder: string;
    releasedAt: string;
  }): DeliveryControllerLeaseRecord {
    assertIdentifier(input.deliveryId, 'deliveryId');
    assertDigest(input.planDigest, 'planDigest');
    assertPositiveInteger(input.generation, 'generation');
    assertIdentifier(input.leaseId, 'leaseId');
    assertIdentifier(input.holder, 'holder');
    assertTimestamp(input.releasedAt, 'releasedAt');
    return this.transaction(() => {
      const run = this.assertRunFence(input.deliveryId, input.planDigest, input.generation);
      const row = this.database
        .prepare('SELECT * FROM delivery_controller_leases WHERE delivery_id = ? AND lease_id = ?')
        .get(input.deliveryId, input.leaseId) as SqlRow | undefined;
      if (!row) throw new DeliveryError('delivery_controller_conflict', 'Controller lease does not exist');
      const lease = mapLease(row);
      if (lease.holder !== input.holder) {
        throw new DeliveryError('delivery_controller_conflict', 'Controller lease holder changed');
      }
      if (lease.status === 'released') {
        if (lease.releasedAt === input.releasedAt) return lease;
        throw new DeliveryError('delivery_controller_conflict', 'Controller lease release changed intent');
      }
      if (lease.status !== 'active') {
        throw new DeliveryError('delivery_controller_conflict', 'Expired controller lease cannot be released as active');
      }
      const recordDigest = sha256Hex(
        canonicalJson({ priorRecordDigest: lease.recordDigest, status: 'released', at: input.releasedAt }),
      );
      this.database
        .prepare(
          `UPDATE delivery_controller_leases SET
            heartbeat_at = ?, status = 'released', released_at = ?, record_digest = ?
           WHERE delivery_id = ? AND lease_id = ? AND status = 'active'`,
        )
        .run(
          input.releasedAt,
          input.releasedAt,
          recordDigest,
          input.deliveryId,
          input.leaseId,
        );
      if (run.activeControllerLease === input.leaseId) {
        this.updateLeasePointer(run, undefined, input.releasedAt);
      }
      return mapLease(
        this.database
          .prepare('SELECT * FROM delivery_controller_leases WHERE delivery_id = ? AND lease_id = ?')
          .get(input.deliveryId, input.leaseId) as SqlRow,
      );
    });
  }

  getActiveControllerLease(deliveryId: string): DeliveryControllerLeaseRecord | undefined {
    this.getRunRequired(deliveryId);
    const row = this.database
      .prepare("SELECT * FROM delivery_controller_leases WHERE delivery_id = ? AND status = 'active'")
      .get(deliveryId) as SqlRow | undefined;
    return row ? mapLease(row) : undefined;
  }

  reserveIntent(input: {
    idempotencyKey: string;
    semanticDigest: string;
    operation: string;
    deliveryId: string;
    createdAt: string;
  }): DeliveryIntentReservation {
    assertIdempotencyKey(input.idempotencyKey);
    assertDigest(input.semanticDigest, 'semanticDigest');
    assertIdentifier(input.operation, 'operation');
    if (!input.operation.startsWith('baby.delivery.')) {
      throw new DeliveryError('delivery_invalid', 'Delivery intent operation is not in the delivery family');
    }
    assertIdentifier(input.deliveryId, 'deliveryId');
    assertTimestamp(input.createdAt, 'createdAt');
    this.getRunRequired(input.deliveryId);
    return this.transaction(() => {
      const existing = this.database
        .prepare('SELECT * FROM request_intents WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as SqlRow | undefined;
      if (existing) {
        const existingDigest = asString(existing, 'semantic_digest');
        if (
          existingDigest !== input.semanticDigest ||
          asString(existing, 'operation') !== input.operation ||
          asNullableString(existing, 'delivery_id') !== input.deliveryId
        ) {
          return { state: 'conflict', existingSemanticDigest: existingDigest };
        }
        if (asString(existing, 'status') === 'pending') return { state: 'pending' };
        const resultJson = asNullableString(existing, 'result_json');
        const resultDigest = asNullableString(existing, 'result_digest');
        if (!resultJson || !resultDigest || sha256Hex(resultJson) !== resultDigest) {
          throw new DeliveryError('delivery_unknown', 'Completed delivery intent has no valid result');
        }
        return { state: 'completed', resultDigest, result: parseJson(resultJson, 'intent result') };
      }
      this.database
        .prepare(
          `INSERT INTO request_intents(
            idempotency_key, semantic_digest, operation, deployment_id, delivery_id,
            status, result_digest, result_json, created_at, completed_at
          ) VALUES (?, ?, ?, NULL, ?, 'pending', NULL, NULL, ?, NULL)`,
        )
        .run(
          input.idempotencyKey,
          input.semanticDigest,
          input.operation,
          input.deliveryId,
          input.createdAt,
        );
      return { state: 'reserved' };
    });
  }

  completeIntent(input: {
    idempotencyKey: string;
    semanticDigest: string;
    deliveryId: string;
    result: unknown;
    completedAt: string;
  }): { resultDigest: string } {
    assertIdempotencyKey(input.idempotencyKey);
    assertDigest(input.semanticDigest, 'semanticDigest');
    assertIdentifier(input.deliveryId, 'deliveryId');
    assertTimestamp(input.completedAt, 'completedAt');
    const resultJson = canonicalJson(input.result);
    const resultDigest = sha256Hex(resultJson);
    return this.transaction(() => {
      const row = this.database
        .prepare('SELECT * FROM request_intents WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as SqlRow | undefined;
      if (!row) throw new DeliveryError('delivery_not_found', 'Delivery intent was not reserved');
      if (
        asString(row, 'semantic_digest') !== input.semanticDigest ||
        asNullableString(row, 'delivery_id') !== input.deliveryId
      ) {
        throw new DeliveryError('idempotency_conflict', 'Delivery intent changed');
      }
      if (asString(row, 'status') === 'completed') {
        if (asNullableString(row, 'result_digest') === resultDigest) return { resultDigest };
        throw new DeliveryError('idempotency_conflict', 'Completed delivery result changed');
      }
      const updated = this.database
        .prepare(
          `UPDATE request_intents SET
            status = 'completed', result_digest = ?, result_json = ?, completed_at = ?
           WHERE idempotency_key = ? AND status = 'pending'`,
        )
        .run(resultDigest, resultJson, input.completedAt, input.idempotencyKey);
      if (updated.changes !== 1) {
        throw new DeliveryError('delivery_conflict', 'Delivery intent completion raced');
      }
      return { resultDigest };
    });
  }

  private assertRunFence(deliveryId: string, planDigest: string, generation: number): DeliveryRunRecord {
    const run = this.getRunRequired(deliveryId);
    if (run.planDigest !== planDigest) {
      throw new DeliveryError('delivery_plan_changed', 'Delivery plan digest compare-and-swap failed');
    }
    if (run.generation !== generation) {
      throw new DeliveryError('delivery_generation_conflict', 'Delivery generation compare-and-swap failed', {
        expected: generation,
        actual: run.generation,
      });
    }
    return run;
  }

  private validateLeaseIdentity(input: {
    deliveryId: string;
    planDigest: string;
    generation: number;
    leaseId: string;
    holder: string;
    acquiredAt: string;
    expiresAt: string;
  }): void {
    assertIdentifier(input.deliveryId, 'deliveryId');
    assertDigest(input.planDigest, 'planDigest');
    assertPositiveInteger(input.generation, 'generation');
    assertIdentifier(input.leaseId, 'leaseId');
    assertIdentifier(input.holder, 'holder');
    assertTimestamp(input.acquiredAt, 'acquiredAt');
    assertTimestamp(input.expiresAt, 'expiresAt');
  }

  private updateLeasePointer(
    run: DeliveryRunRecord,
    leaseId: string | undefined,
    occurredAt: string,
  ): void {
    const row = this.database
      .prepare('SELECT record_digest FROM delivery_runs WHERE delivery_id = ?')
      .get(run.deliveryId) as SqlRow;
    const recordDigest = sha256Hex(
      canonicalJson({
        priorRecordDigest: asString(row, 'record_digest'),
        activeControllerLease: leaseId ?? null,
        occurredAt,
      }),
    );
    const updated = this.database
      .prepare(
        `UPDATE delivery_runs SET active_controller_lease = ?, record_digest = ?, updated_at = ?
         WHERE delivery_id = ? AND generation = ? AND plan_digest = ?`,
      )
      .run(
        leaseId ?? null,
        recordDigest,
        occurredAt,
        run.deliveryId,
        run.generation,
        run.planDigest,
      );
    if (updated.changes !== 1) {
      throw new DeliveryError('delivery_generation_conflict', 'Controller lease run fence failed');
    }
  }
}
