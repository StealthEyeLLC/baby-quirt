import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, sha256Hex } from '../src/crypto/canonical.js';
import { DELIVERY_OPERATION_CONTRACTS, DELIVERY_OPERATION_NAMES } from '../src/delivery/contracts.js';
import { assertAuthorizedPlan, canonicalizeDeliveryPlan } from '../src/delivery/plan.js';
import { DeliveryError, DELIVERY_PLAN_SCHEMA_VERSION } from '../src/delivery/types.js';

function fixture() {
  const now = new Date('2026-07-23T20:00:00.000Z');
  return {
    schemaVersion: DELIVERY_PLAN_SCHEMA_VERSION,
    deliveryId: 'delivery-contract-001',
    ownerPrincipal: 'stealtheye-owner',
    authorizationReference: 'owner-confirmation:001',
    targetHostname: 'vps-c9f04f5e',
    targetMachineIdentity: 'a'.repeat(64),
    products: [
      {
        product: 'baby-quirt-mcp', repository: 'StealthEyeLLC/baby-quirt-mcp',
        commit: '2'.repeat(40), tree: '3'.repeat(40), adapter: 'baby_selfhost',
        immutableDigest: '4'.repeat(64),
      },
      {
        product: 'baby-quirt', repository: 'StealthEyeLLC/baby-quirt',
        commit: '5'.repeat(40), tree: '6'.repeat(40), adapter: 'immutable_source_artifact',
        immutableDigest: '7'.repeat(64),
      },
    ],
    buildProfile: {
      name: 'baby-release', version: '1.0.0', commands: ['npm ci', 'npm run build'],
      toolchains: [{ name: 'node', version: '24.18.0' }],
      lockfiles: [{ path: 'package-lock.json', sha256: '8'.repeat(64) }],
      cleanEnvironment: true, reproducibleBuilds: 2,
    },
    testProfile: {
      name: 'complete', version: '1.0.0', commands: ['npm run test:all', 'npm run test:contracts'],
      requireZeroSkips: true, requireStableCounts: true,
    },
    certificationProfile: {
      name: 'stock-nspawn', version: '1.0.0',
      requiredNspawnProperties: ['systemd-pid1', 'native-so-peercred', 'private-unix-socket'],
      cycles: ['success', 'automatic_rollback', 'restart_or_reboot_recovery'],
      requireSystemdPid1: true, requireUid0Supervisor: true, requireGatewayUid997: true,
      destroyAfterCertification: true,
    },
    targetReleaseIdentifiers: { 'baby-quirt': '0.1.1-fixture', 'baby-quirt-mcp': '0.1.1-fixture' },
    protectedReleases: ['0.1.0'],
    protectedPaths: ['/opt/baby-quirt/current', '/opt/baby-quirt/previous'],
    candidateVerificationProfile: { name: 'candidate-v1', version: '1.0.0', checks: ['manifest', 'signature', 'socket'] },
    activationOrder: ['baby-quirt-mcp', 'baby-quirt'],
    acceptanceProfile: { privateChecks: ['health', 'receipt'], publicChecks: ['oauth', 'call-quirt'], requireAll: true },
    soakProfile: { durationSeconds: 60, checkpointSeconds: [10, 30, 60], checks: ['health', 'receipt'] },
    rollbackPolicy: {
      automaticOnAcceptanceFailure: true, automaticOnSoakFailure: true, automaticOnDeadline: true,
      cancellationAfterArm: 'rollback', unknownDisposition: 'repair_required',
      rollbackFailureDisposition: 'manual_recovery_required',
    },
    timeBounds: {
      notBefore: now.toISOString(),
      guardDeadline: new Date(now.valueOf() + 300_000).toISOString(),
      expiresAt: new Date(now.valueOf() + 600_000).toISOString(),
    },
    allowedExternalSideEffects: [],
    resourceBounds: {
      maxWallSeconds: 3600, maxCpuSeconds: 1800, maxMemoryBytes: 4_294_967_296,
      maxDiskBytes: 10_737_418_240, maxInodes: 500_000, maxOutputBytes: 67_108_864,
      maxArtifacts: 128,
    },
    costBounds: { currency: 'USD', maximumMinorUnits: 0 },
    evidenceRequirements: ['source.identity', 'test.result', 'nspawn.certification', 'receipt.bundle'],
    retentionPolicy: { eventDays: 90, evidenceDays: 365, artifactDays: 90, retainTerminalRuns: 20 },
  };
}

describe('delivery normative contracts', () => {
  it('canonicalizes a complete exact plan and binds authorization to its digest', () => {
    const plan = canonicalizeDeliveryPlan(fixture());
    assert.match(plan.planDigest, /^[a-f0-9]{64}$/u);
    assert.equal(plan.products[0]?.product, 'baby-quirt');
    assert.doesNotThrow(() => assertAuthorizedPlan(plan, plan.planDigest));
  });

  it('rejects unknown fields, missing credential references, and weakened rollback truth', () => {
    assert.throws(() => canonicalizeDeliveryPlan({ ...fixture(), surprise: true }), DeliveryError);
    const missingCredential = fixture();
    missingCredential.products[0] = { ...missingCredential.products[0]!, adapter: 'authenticated_git' };
    assert.throws(
      () => canonicalizeDeliveryPlan(missingCredential),
      (error: unknown) => error instanceof DeliveryError && error.code === 'delivery_credential_unavailable',
    );
    const weak = fixture();
    weak.rollbackPolicy = { ...weak.rollbackPolicy, unknownDisposition: 'success' } as never;
    assert.throws(() => canonicalizeDeliveryPlan(weak), DeliveryError);
  });

  it('invalidates authorization when any plan field changes', () => {
    const original = canonicalizeDeliveryPlan(fixture());
    const changed = canonicalizeDeliveryPlan({ ...fixture(), soakProfile: { ...fixture().soakProfile, durationSeconds: 61, checkpointSeconds: [10, 30, 61] } });
    assert.notEqual(changed.planDigest, original.planDigest);
    assert.throws(
      () => assertAuthorizedPlan(changed, original.planDigest),
      (error: unknown) => error instanceof DeliveryError && error.code === 'delivery_authorization_invalid',
    );
  });

  it('normalizes set-like ordering without changing semantic digest', () => {
    const left = fixture();
    const right = fixture();
    right.protectedPaths = [...right.protectedPaths].reverse();
    right.evidenceRequirements = [...right.evidenceRequirements].reverse();
    right.products = [...right.products].reverse();
    assert.equal(canonicalizeDeliveryPlan(left).planDigest, canonicalizeDeliveryPlan(right).planDigest);
  });

  it('defines exactly the ten runtime-native operations with strict metadata', () => {
    assert.deepEqual(DELIVERY_OPERATION_CONTRACTS.map((item) => item.operation), DELIVERY_OPERATION_NAMES);
    for (const contract of DELIVERY_OPERATION_CONTRACTS) {
      assert.equal(contract.version, '1.0.0');
      assert.equal(contract.input.additionalProperties, false);
      assert.equal(contract.output.additionalProperties, false);
    }
  });

  it('contains no duplicate authority or forbidden dependency in delivery source', () => {
    const root = join(process.cwd(), 'src', 'delivery');
    const source = readdirSync(root)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => readFileSync(join(root, name), 'utf8'))
      .join('\n');
    const forbidden = [
      'new DatabaseSync', 'createServer(', 'listen(', 'child_process.fork',
      'Fix dependency', 'old operator dependency', 'ssh ', 'Termius',
      '.github/workflows', 'gateway-owned-controller',
    ];
    for (const token of forbidden) assert.equal(source.includes(token), false, token);
    assert.equal(readFileSync(join(process.cwd(), 'docs', 'adr', '0001-automated-delivery-lane.md'), 'utf8').includes('existing Baby deployment SQLite ledger'), true);
  });

  it('uses deterministic canonical JSON and SHA-256 for plan identity', () => {
    const plan = canonicalizeDeliveryPlan(fixture());
    const { planDigest: _ignored, ...body } = plan;
    assert.equal(plan.planDigest, sha256Hex(canonicalJson(body)));
  });
});
