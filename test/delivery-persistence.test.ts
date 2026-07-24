import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sha256Hex } from '../src/crypto/canonical.js';
import { DeploymentDatabase } from '../src/deployment/database.js';
import { canonicalizeDeliveryPlan } from '../src/delivery/plan.js';
import { DeliveryError, DELIVERY_PLAN_SCHEMA_VERSION } from '../src/delivery/types.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'bq-delivery-db-'));
  roots.push(root);
  return join(root, 'state', 'deployment-state.sqlite');
}

function hash(value: string): string {
  return sha256Hex(value);
}

function plan(deliveryId = 'delivery-persistence-001') {
  const now = new Date('2026-07-23T20:00:00.000Z');
  return canonicalizeDeliveryPlan({
    schemaVersion: DELIVERY_PLAN_SCHEMA_VERSION,
    deliveryId,
    ownerPrincipal: 'stealtheye-owner',
    authorizationReference: 'owner-confirmation:delivery-persistence-001',
    targetHostname: 'vps-c9f04f5e',
    targetMachineIdentity: 'a'.repeat(64),
    products: [
      {
        product: 'baby-quirt-mcp',
        repository: 'StealthEyeLLC/baby-quirt-mcp',
        commit: '2'.repeat(40),
        tree: '3'.repeat(40),
        adapter: 'baby_selfhost',
        immutableDigest: '4'.repeat(64),
      },
      {
        product: 'baby-quirt',
        repository: 'StealthEyeLLC/baby-quirt',
        commit: '5'.repeat(40),
        tree: '6'.repeat(40),
        adapter: 'immutable_source_artifact',
        immutableDigest: '7'.repeat(64),
      },
    ],
    buildProfile: {
      name: 'baby-release',
      version: '1.0.0',
      commands: ['npm ci', 'npm run build'],
      toolchains: [{ name: 'node', version: '24.18.0' }],
      lockfiles: [{ path: 'package-lock.json', sha256: '8'.repeat(64) }],
      cleanEnvironment: true,
      reproducibleBuilds: 2,
    },
    testProfile: {
      name: 'complete',
      version: '1.0.0',
      commands: ['npm run test:all', 'npm run test:contracts'],
      requireZeroSkips: true,
      requireStableCounts: true,
    },
    certificationProfile: {
      name: 'stock-nspawn',
      version: '1.0.0',
      requiredNspawnProperties: ['systemd-pid1', 'native-so-peercred', 'private-unix-socket'],
      cycles: ['success', 'automatic_rollback', 'restart_or_reboot_recovery'],
      requireSystemdPid1: true,
      requireUid0Supervisor: true,
      requireGatewayUid997: true,
      destroyAfterCertification: true,
    },
    targetReleaseIdentifiers: {
      'baby-quirt': '0.1.1-fixture',
      'baby-quirt-mcp': '0.1.1-fixture',
    },
    protectedReleases: ['0.1.0'],
    protectedPaths: ['/opt/baby-quirt/current', '/opt/baby-quirt/previous'],
    candidateVerificationProfile: {
      name: 'candidate-v1',
      version: '1.0.0',
      checks: ['manifest', 'signature', 'socket'],
    },
    activationOrder: ['baby-quirt-mcp', 'baby-quirt'],
    acceptanceProfile: {
      privateChecks: ['health', 'receipt'],
      publicChecks: ['oauth', 'call-quirt'],
      requireAll: true,
    },
    soakProfile: {
      durationSeconds: 60,
      checkpointSeconds: [10, 30, 60],
      checks: ['health', 'receipt'],
    },
    rollbackPolicy: {
      automaticOnAcceptanceFailure: true,
      automaticOnSoakFailure: true,
      automaticOnDeadline: true,
      cancellationAfterArm: 'rollback',
      unknownDisposition: 'repair_required',
      rollbackFailureDisposition: 'manual_recovery_required',
    },
    timeBounds: {
      notBefore: now.toISOString(),
      guardDeadline: new Date(now.valueOf() + 300_000).toISOString(),
      expiresAt: new Date(now.valueOf() + 600_000).toISOString(),
    },
    allowedExternalSideEffects: [],
    resourceBounds: {
      maxWallSeconds: 3600,
      maxCpuSeconds: 1800,
      maxMemoryBytes: 4_294_967_296,
      maxDiskBytes: 10_737_418_240,
      maxInodes: 500_000,
      maxOutputBytes: 67_108_864,
      maxArtifacts: 128,
    },
    costBounds: { currency: 'USD', maximumMinorUnits: 0 },
    evidenceRequirements: [
      'source.identity',
      'test.result',
      'nspawn.certification',
      'receipt.bundle',
    ],
    retentionPolicy: {
      eventDays: 90,
      evidenceDays: 365,
      artifactDays: 90,
      retainTerminalRuns: 20,
    },
  });
}

function expectCode(callback: () => unknown, code: DeliveryError['code']): void {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof DeliveryError);
    assert.equal(error.code, code);
    return true;
  });
}

describe('automated delivery persistence projection', () => {
  it('migrates inside the authoritative deployment database and survives reopen', () => {
    const path = makePath();
    const database = new DeploymentDatabase(path);
    const deliveryPlan = plan();
    const created = database.deliveries.createRun(
      deliveryPlan,
      1,
      '2026-07-23T20:00:01.000Z',
    );
    assert.equal(created.state, 'PLANNED');
    assert.equal(created.stateSequence, 0);
    assert.equal(created.generation, 1);
    assert.equal(created.planDigest, deliveryPlan.planDigest);
    assert.equal(created.terminal, false);
    database.assertIntegrity();
    database.close();

    const reopened = new DeploymentDatabase(path);
    assert.deepEqual(reopened.deliveries.getRun(deliveryPlan.deliveryId), created);
    assert.deepEqual(reopened.deliveries.getPlan(deliveryPlan.deliveryId), deliveryPlan);
    reopened.assertIntegrity();
    reopened.close();

    const raw = new DatabaseSync(path, { readOnly: true });
    const migration = raw
      .prepare('SELECT version, name FROM schema_migrations WHERE version = 2')
      .get() as { version: number; name: string };
    assert.deepEqual({ ...migration }, { version: 2, name: 'automated_delivery_projection' });
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'delivery_%' ORDER BY name")
      .all() as { name: string }[];
    assert.deepEqual(
      tables.map((entry) => entry.name),
      [
        'delivery_artifacts',
        'delivery_child_jobs',
        'delivery_controller_leases',
        'delivery_events',
        'delivery_evidence',
        'delivery_plans',
        'delivery_runs',
      ],
    );
    raw.close();
  });

  it('binds one immutable plan and generation to a delivery identity', () => {
    const database = new DeploymentDatabase(makePath());
    const deliveryPlan = plan();
    const created = database.deliveries.createRun(
      deliveryPlan,
      7,
      '2026-07-23T20:00:01.000Z',
    );
    assert.deepEqual(
      database.deliveries.createRun(deliveryPlan, 7, '2026-07-23T20:00:01.000Z'),
      created,
    );
    expectCode(
      () => database.deliveries.createRun(deliveryPlan, 8, '2026-07-23T20:00:01.000Z'),
      'delivery_generation_conflict',
    );
    const changed = plan(deliveryPlan.deliveryId);
    changed.planDigest = hash('changed-plan-digest-for-test');
    expectCode(
      () => database.deliveries.createRun(changed, 7, '2026-07-23T20:00:01.000Z'),
      'delivery_plan_changed',
    );
    database.close();
  });

  it('commits transitions under plan/generation/state/sequence CAS and replays exact intent', () => {
    const database = new DeploymentDatabase(makePath());
    const deliveryPlan = plan();
    database.deliveries.createRun(deliveryPlan, 3, '2026-07-23T20:00:01.000Z');
    const input = {
      deliveryId: deliveryPlan.deliveryId,
      planDigest: deliveryPlan.planDigest,
      generation: 3,
      expectedState: 'PLANNED' as const,
      expectedSequence: 0,
      nextState: 'SOURCE_VERIFIED' as const,
      phase: 'source',
      kind: 'source.verified',
      message: 'Exact source identity verified',
      idempotencyKey: 'delivery-transition-source-001',
      occurredAt: '2026-07-23T20:00:02.000Z',
    };
    const committed = database.deliveries.transition(input);
    assert.equal(committed.replayed, false);
    assert.equal(committed.run.state, 'SOURCE_VERIFIED');
    assert.equal(committed.run.stateSequence, 1);
    assert.equal(committed.event.offset, 0);
    assert.match(committed.event.eventDigest, /^[a-f0-9]{64}$/u);

    const replayed = database.deliveries.transition(input);
    assert.equal(replayed.replayed, true);
    assert.deepEqual(replayed.run, committed.run);
    assert.deepEqual(replayed.event, committed.event);
    expectCode(
      () => database.deliveries.transition({ ...input, nextState: 'FAILED' }),
      'idempotency_conflict',
    );
    expectCode(
      () =>
        database.deliveries.transition({
          ...input,
          idempotencyKey: 'delivery-transition-stale-001',
        }),
      'delivery_state_conflict',
    );
    expectCode(
      () =>
        database.deliveries.transition({
          ...input,
          generation: 4,
          idempotencyKey: 'delivery-transition-generation-001',
        }),
      'delivery_generation_conflict',
    );
    assert.deepEqual(database.deliveries.listEvents(deliveryPlan.deliveryId), {
      deliveryId: deliveryPlan.deliveryId,
      offset: 0,
      nextOffset: 1,
      items: [committed.event],
    });
    database.close();
  });

  it('fences controllers to one active generation and persists renewal and release', () => {
    const database = new DeploymentDatabase(makePath());
    const deliveryPlan = plan();
    database.deliveries.createRun(deliveryPlan, 5, '2026-07-23T20:00:01.000Z');
    const acquired = database.deliveries.acquireControllerLease({
      deliveryId: deliveryPlan.deliveryId,
      planDigest: deliveryPlan.planDigest,
      generation: 5,
      leaseId: 'controller-lease-001',
      holder: 'delivery-controller-a',
      acquiredAt: '2026-07-23T20:00:02.000Z',
      expiresAt: '2026-07-23T20:01:02.000Z',
    });
    assert.equal(acquired.status, 'active');
    assert.equal(
      database.deliveries.getRun(deliveryPlan.deliveryId)?.activeControllerLease,
      acquired.leaseId,
    );
    expectCode(
      () =>
        database.deliveries.acquireControllerLease({
          deliveryId: deliveryPlan.deliveryId,
          planDigest: deliveryPlan.planDigest,
          generation: 5,
          leaseId: 'controller-lease-002',
          holder: 'delivery-controller-b',
          acquiredAt: '2026-07-23T20:00:03.000Z',
          expiresAt: '2026-07-23T20:01:03.000Z',
        }),
      'delivery_controller_conflict',
    );
    expectCode(
      () =>
        database.deliveries.renewControllerLease({
          deliveryId: deliveryPlan.deliveryId,
          planDigest: deliveryPlan.planDigest,
          generation: 6,
          leaseId: acquired.leaseId,
          holder: acquired.holder,
          heartbeatAt: '2026-07-23T20:00:30.000Z',
          expiresAt: '2026-07-23T20:01:30.000Z',
        }),
      'delivery_generation_conflict',
    );
    const renewed = database.deliveries.renewControllerLease({
      deliveryId: deliveryPlan.deliveryId,
      planDigest: deliveryPlan.planDigest,
      generation: 5,
      leaseId: acquired.leaseId,
      holder: acquired.holder,
      heartbeatAt: '2026-07-23T20:00:30.000Z',
      expiresAt: '2026-07-23T20:01:30.000Z',
    });
    assert.equal(renewed.heartbeatAt, '2026-07-23T20:00:30.000Z');
    const released = database.deliveries.releaseControllerLease({
      deliveryId: deliveryPlan.deliveryId,
      planDigest: deliveryPlan.planDigest,
      generation: 5,
      leaseId: acquired.leaseId,
      holder: acquired.holder,
      releasedAt: '2026-07-23T20:00:40.000Z',
    });
    assert.equal(released.status, 'released');
    assert.equal(database.deliveries.getActiveControllerLease(deliveryPlan.deliveryId), undefined);
    assert.equal(
      database.deliveries.getRun(deliveryPlan.deliveryId)?.activeControllerLease,
      undefined,
    );
    database.close();
  });

  it('persists durable child jobs, immutable artifacts, and redacted evidence', () => {
    const database = new DeploymentDatabase(makePath());
    const deliveryPlan = plan();
    database.deliveries.createRun(deliveryPlan, 2, '2026-07-23T20:00:01.000Z');
    const child = {
      phase: 'build',
      jobId: 'child-job-001',
      stdoutOffset: 12,
      stderrOffset: 0,
      terminal: false,
    };
    assert.deepEqual(
      database.deliveries.recordChildJob({
        deliveryId: deliveryPlan.deliveryId,
        planDigest: deliveryPlan.planDigest,
        generation: 2,
        reference: child,
      }),
      child,
    );
    const completedChild = {
      ...child,
      resultDigest: hash('child-result'),
      receiptId: 'receipt-child-001',
      stdoutOffset: 42,
      stderrOffset: 4,
      terminal: true,
    };
    database.deliveries.recordChildJob({
      deliveryId: deliveryPlan.deliveryId,
      planDigest: deliveryPlan.planDigest,
      generation: 2,
      reference: completedChild,
    });
    expectCode(
      () =>
        database.deliveries.recordChildJob({
          deliveryId: deliveryPlan.deliveryId,
          planDigest: deliveryPlan.planDigest,
          generation: 2,
          reference: { ...completedChild, stdoutOffset: 43 },
        }),
      'delivery_conflict',
    );

    const artifact = {
      phase: 'build',
      artifactId: 'artifact-build-001',
      sha256: hash('artifact-bytes'),
      size: 1234,
      immutable: true as const,
    };
    assert.deepEqual(
      database.deliveries.recordArtifact({
        deliveryId: deliveryPlan.deliveryId,
        planDigest: deliveryPlan.planDigest,
        generation: 2,
        reference: artifact,
      }),
      artifact,
    );
    expectCode(
      () =>
        database.deliveries.recordArtifact({
          deliveryId: deliveryPlan.deliveryId,
          planDigest: deliveryPlan.planDigest,
          generation: 2,
          reference: { ...artifact, size: artifact.size + 1 },
        }),
      'delivery_conflict',
    );

    const evidence = {
      deliveryId: deliveryPlan.deliveryId,
      generation: 2,
      planDigest: deliveryPlan.planDigest,
      kind: 'build.result',
      digest: hash('build-result-evidence'),
      artifactReference: `artifact:sha256:${hash('build-result-evidence')}`,
      receiptId: 'receipt-evidence-001',
      redacted: true as const,
      createdAt: '2026-07-23T20:00:45.000Z',
    };
    assert.deepEqual(database.deliveries.appendEvidence(evidence), evidence);
    assert.deepEqual(database.deliveries.listEvidence(deliveryPlan.deliveryId).items, [evidence]);
    assert.deepEqual(database.deliveries.getRun(deliveryPlan.deliveryId)?.childJobs, [completedChild]);
    assert.deepEqual(database.deliveries.getRun(deliveryPlan.deliveryId)?.artifacts, [artifact]);
    database.close();
  });

  it('uses the shared request-intent ledger for delivery semantic idempotency', () => {
    const database = new DeploymentDatabase(makePath());
    const deliveryPlan = plan();
    database.deliveries.createRun(deliveryPlan, 1, '2026-07-23T20:00:01.000Z');
    const semanticDigest = hash('delivery semantic intent');
    const intent = {
      idempotencyKey: 'delivery-operation-intent-001',
      semanticDigest,
      operation: 'baby.delivery.run',
      deliveryId: deliveryPlan.deliveryId,
      createdAt: '2026-07-23T20:00:02.000Z',
    };
    assert.deepEqual(database.deliveries.reserveIntent(intent), { state: 'reserved' });
    assert.deepEqual(database.deliveries.reserveIntent(intent), { state: 'pending' });
    assert.deepEqual(
      database.deliveries.reserveIntent({ ...intent, semanticDigest: hash('changed intent') }),
      { state: 'conflict', existingSemanticDigest: semanticDigest },
    );
    const completion = database.deliveries.completeIntent({
      idempotencyKey: intent.idempotencyKey,
      semanticDigest,
      deliveryId: deliveryPlan.deliveryId,
      result: { state: 'SOURCE_VERIFIED', generation: 1 },
      completedAt: '2026-07-23T20:00:03.000Z',
    });
    assert.match(completion.resultDigest, /^[a-f0-9]{64}$/u);
    assert.deepEqual(database.deliveries.reserveIntent(intent), {
      state: 'completed',
      resultDigest: completion.resultDigest,
      result: { generation: 1, state: 'SOURCE_VERIFIED' },
    });
    database.close();
  });

  it('makes terminal delivery truth immutable and detects migration identity tampering', () => {
    const path = makePath();
    const database = new DeploymentDatabase(path);
    const deliveryPlan = plan();
    database.deliveries.createRun(deliveryPlan, 1, '2026-07-23T20:00:01.000Z');
    const failed = database.deliveries.transition({
      deliveryId: deliveryPlan.deliveryId,
      planDigest: deliveryPlan.planDigest,
      generation: 1,
      expectedState: 'PLANNED',
      expectedSequence: 0,
      nextState: 'FAILED',
      phase: 'planning',
      kind: 'delivery.failed',
      message: 'Terminal failure fixture',
      idempotencyKey: 'delivery-transition-terminal-001',
      occurredAt: '2026-07-23T20:00:02.000Z',
    });
    assert.equal(failed.run.terminal, true);
    expectCode(
      () =>
        database.deliveries.transition({
          deliveryId: deliveryPlan.deliveryId,
          planDigest: deliveryPlan.planDigest,
          generation: 1,
          expectedState: 'FAILED',
          expectedSequence: 1,
          nextState: 'PLANNED',
          phase: 'repair',
          kind: 'delivery.reopened',
          message: 'Forbidden terminal reopening',
          idempotencyKey: 'delivery-transition-after-terminal-001',
          occurredAt: '2026-07-23T20:00:03.000Z',
        }),
      'delivery_state_conflict',
    );
    database.close();

    const raw = new DatabaseSync(path);
    raw.exec("UPDATE schema_migrations SET checksum = '" + '0'.repeat(64) + "' WHERE version = 2");
    raw.close();
    assert.throws(() => new DeploymentDatabase(path));
  });
});
