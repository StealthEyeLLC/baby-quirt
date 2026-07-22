import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { sha256Hex } from '../src/crypto/canonical.js';
import {
  generateEd25519KeyPair,
  loadPrivateKey,
  loadPublicKey,
} from '../src/crypto/signing.js';
import {
  buildSignedGuardRecord,
  buildSignedSuccessMarker,
  verifySignedControllerEvidence,
} from '../src/controller/contract.js';
import { FixedDeploymentController } from '../src/controller/controller.js';
import { FixtureGuardHost } from '../src/controller/fixture-host.js';
import {
  CONTROLLER_RECORD_VERSION,
  ControllerError,
  type DeploymentGuardPayload,
  type ExpectedPointers,
} from '../src/controller/types.js';

const digest = (label: string): string => sha256Hex(label);

const expectedPointers: ExpectedPointers = {
  baby: {
    current: { link: '/opt/baby-quirt/current', target: '/opt/baby-quirt/releases/0.1.3' },
    previous: { link: '/opt/baby-quirt/previous', target: '/opt/baby-quirt/releases/0.1.2' },
  },
  gateway: {
    current: { link: '/opt/baby-quirt-mcp/current', target: '/opt/baby-quirt-mcp/releases/0.1.0' },
    previous: { link: '/opt/baby-quirt-mcp/previous', target: null },
  },
};

const candidatePointers: ExpectedPointers = {
  baby: {
    current: { link: '/opt/baby-quirt/current', target: '/opt/baby-quirt/releases/0.3.0' },
    previous: { link: '/opt/baby-quirt/previous', target: '/opt/baby-quirt/releases/0.1.3' },
  },
  gateway: {
    current: { link: '/opt/baby-quirt-mcp/current', target: '/opt/baby-quirt-mcp/releases/0.3.0' },
    previous: { link: '/opt/baby-quirt-mcp/previous', target: '/opt/baby-quirt-mcp/releases/0.1.0' },
  },
};

interface Harness {
  root: string;
  hostRoot: string;
  controllerRoot: string;
  lockPath: string;
  machineId: string;
  now: { value: Date };
  host: FixtureGuardHost;
  babyPrivate: ReturnType<typeof loadPrivateKey>;
  controllerPublic: ReturnType<typeof loadPublicKey>;
  controller(): FixedDeploymentController;
  guard(generation?: number, deploymentId?: string): ReturnType<typeof buildSignedGuardRecord>;
  cleanup(): void;
}

function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'baby-quirt-guard-'));
  const keyRoot = join(root, 'keys');
  mkdirSync(keyRoot, { mode: 0o700 });
  const babyPublicPath = join(keyRoot, 'baby-public.pem');
  const babyPrivatePath = join(keyRoot, 'baby-private.pem');
  const controllerPublicPath = join(keyRoot, 'controller-public.pem');
  const controllerPrivatePath = join(keyRoot, 'controller-private.pem');
  generateEd25519KeyPair({
    publicKeyPath: babyPublicPath,
    privateKeyPath: babyPrivatePath,
    keyId: 'baby-deployment-authority-v2',
  });
  generateEd25519KeyPair({
    publicKeyPath: controllerPublicPath,
    privateKeyPath: controllerPrivatePath,
    keyId: 'baby-controller-evidence-v2',
  });
  const babyPrivate = loadPrivateKey(babyPrivatePath);
  const babyPublic = loadPublicKey(babyPublicPath);
  const controllerPrivate = loadPrivateKey(controllerPrivatePath);
  const controllerPublic = loadPublicKey(controllerPublicPath);
  const machineId = 'fixture-machine:v2';
  const now = { value: new Date('2026-07-22T17:00:00.000Z') };
  const hostRoot = join(root, 'host');
  const controllerRoot = join(root, 'controller-state');
  const lockPath = join(root, 'run', 'deploy.lock');
  const host = new FixtureGuardHost(hostRoot, expectedPointers);

  const createController = (): FixedDeploymentController => new FixedDeploymentController({
    root: controllerRoot,
    lockPath,
    machineId,
    babyAuthorityPublicKey: babyPublic,
    controllerEvidencePrivateKey: controllerPrivate,
    controllerEvidencePublicKey: controllerPublic,
    controllerSigningKeyId: 'baby-controller-evidence-v2',
    host: new FixtureGuardHost(hostRoot),
    now: () => new Date(now.value),
  });

  const guard = (generation = 1, deploymentId = `deployment:${generation}`) => {
    const payload: DeploymentGuardPayload = {
      recordVersion: CONTROLLER_RECORD_VERSION,
      recordType: 'baby-quirt-deployment-guard',
      deploymentId,
      generation,
      machineId,
      planDigest: digest(`plan:${generation}`),
      snapshotDigest: digest(`snapshot:${generation}`),
      candidateManifestDigests: {
        baby: digest(`baby:${generation}`),
        gateway: digest(`gateway:${generation}`),
      },
      expectedPointers,
      deadline: '2026-07-22T18:00:00.000Z',
      evidenceDigest: digest(`evidence:${generation}`),
      signingKeyId: 'baby-deployment-authority-v2',
      signatureAlgorithm: 'ed25519',
    };
    return buildSignedGuardRecord(payload, babyPrivate);
  };

  return {
    root,
    hostRoot,
    controllerRoot,
    lockPath,
    machineId,
    now,
    host,
    babyPrivate,
    controllerPublic,
    controller: createController,
    guard,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function expectControllerCode(action: () => unknown, code: ControllerError['code']): void {
  assert.throws(action, (error: unknown) => error instanceof ControllerError && error.code === code);
}

describe('fixed standalone deployment controller and guard', () => {
  it('survives caller loss and restores the exact snapshot after the deadline', () => {
    const fixture = harness();
    try {
      const guard = fixture.guard();
      assert.equal(fixture.controller().arm(guard).disposition, 'armed');
      fixture.host.setPointersForTest(candidatePointers);

      // The arming caller is gone; a new controller instance represents the
      // persistent timer after process loss or reboot.
      fixture.now.value = new Date('2026-07-22T18:00:01.000Z');
      const afterRestart = fixture.controller();
      const result = afterRestart.evaluate(guard.deploymentId);
      assert.equal(result.disposition, 'rolled_back');
      assert.deepEqual(fixture.host.readFixtureStateForTest().pointers, expectedPointers);
      assert.equal(fixture.host.readFixtureStateForTest().restoreAttempts, 1);
      assert.ok(result.evidence);
      assert.equal(
        verifySignedControllerEvidence(result.evidence, fixture.controllerPublic).recordDigest,
        result.evidence.recordDigest,
      );

      // Lost rollback response is reconciled without a second restore.
      assert.equal(fixture.controller().evaluate(guard.deploymentId).disposition, 'rolled_back');
      assert.equal(fixture.host.readFixtureStateForTest().restoreAttempts, 1);
    } finally {
      fixture.cleanup();
    }
  });

  it('no-ops on the exact success marker and disarms idempotently', () => {
    const fixture = harness();
    try {
      const guard = fixture.guard();
      const controller = fixture.controller();
      controller.arm(guard);
      fixture.host.setPointersForTest(candidatePointers);
      const marker = buildSignedSuccessMarker({
        recordVersion: CONTROLLER_RECORD_VERSION,
        recordType: 'baby-quirt-deployment-success',
        deploymentId: guard.deploymentId,
        generation: guard.generation,
        machineId: guard.machineId,
        planDigest: guard.planDigest,
        snapshotDigest: guard.snapshotDigest,
        candidateManifestDigests: guard.candidateManifestDigests,
        evidenceDigest: guard.evidenceDigest,
        acceptedAt: '2026-07-22T17:30:00.000Z',
        signingKeyId: 'baby-deployment-authority-v2',
        signatureAlgorithm: 'ed25519',
      }, fixture.babyPrivate);
      fixture.now.value = new Date('2026-07-22T17:30:00.000Z');
      assert.equal(controller.commitSuccess(marker).disposition, 'success_marker_valid');
      fixture.now.value = new Date('2026-07-22T19:00:00.000Z');
      assert.equal(fixture.controller().evaluate(guard.deploymentId).disposition, 'success_marker_valid');
      assert.equal(fixture.host.readFixtureStateForTest().restoreAttempts, 0);
      assert.equal(fixture.controller().disarm(guard.deploymentId).disposition, 'disarmed');
      assert.equal(fixture.controller().disarm(guard.deploymentId).disposition, 'disarmed');
      assert.equal(fixture.controller().evaluate(guard.deploymentId).disposition, 'disarmed');
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects forged, wrong-machine, expired, and pointer-mismatched guards', () => {
    const fixture = harness();
    try {
      const forged = { ...fixture.guard(), planDigest: digest('forged') };
      expectControllerCode(() => fixture.controller().arm(forged), 'controller_integrity_failed');

      const wrongMachine = fixture.guard();
      const { recordDigest: _recordDigest, signature: _signature, ...wrongMachinePayload } = wrongMachine;
      const wrongMachineSigned = buildSignedGuardRecord(
        { ...wrongMachinePayload, machineId: 'another-machine' },
        fixture.babyPrivate,
      );
      expectControllerCode(() => fixture.controller().arm(wrongMachineSigned), 'controller_machine_mismatch');

      fixture.now.value = new Date('2026-07-22T18:00:00.000Z');
      expectControllerCode(() => fixture.controller().arm(fixture.guard()), 'controller_deadline_invalid');

      fixture.now.value = new Date('2026-07-22T17:00:00.000Z');
      fixture.host.setPointersForTest(candidatePointers);
      expectControllerCode(() => fixture.controller().arm(fixture.guard()), 'controller_pointer_mismatch');
    } finally {
      fixture.cleanup();
    }
  });

  it('fences stale timers after a newer generation is armed', () => {
    const fixture = harness();
    try {
      const first = fixture.guard(1);
      const controller = fixture.controller();
      controller.arm(first);
      const marker = buildSignedSuccessMarker({
        recordVersion: CONTROLLER_RECORD_VERSION,
        recordType: 'baby-quirt-deployment-success',
        deploymentId: first.deploymentId,
        generation: first.generation,
        machineId: first.machineId,
        planDigest: first.planDigest,
        snapshotDigest: first.snapshotDigest,
        candidateManifestDigests: first.candidateManifestDigests,
        evidenceDigest: first.evidenceDigest,
        acceptedAt: '2026-07-22T17:10:00.000Z',
        signingKeyId: 'baby-deployment-authority-v2',
        signatureAlgorithm: 'ed25519',
      }, fixture.babyPrivate);
      fixture.now.value = new Date('2026-07-22T17:10:00.000Z');
      controller.commitSuccess(marker);
      controller.disarm(first.deploymentId);

      const second = fixture.guard(2);
      fixture.controller().arm(second);
      fixture.host.setPointersForTest(candidatePointers);
      fixture.now.value = new Date('2026-07-22T19:00:00.000Z');
      assert.equal(fixture.controller().evaluate(first.deploymentId).disposition, 'stale_generation');
      assert.deepEqual(fixture.host.readFixtureStateForTest().pointers, candidatePointers);
      assert.equal(fixture.host.readFixtureStateForTest().restoreAttempts, 0);
    } finally {
      fixture.cleanup();
    }
  });

  it('terminalizes an injected rollback failure without blind replay', () => {
    const fixture = harness();
    try {
      const guard = fixture.guard();
      fixture.controller().arm(guard);
      fixture.host.setPointersForTest(candidatePointers);
      fixture.host.setRestoreFailureForTest(true);
      fixture.now.value = new Date('2026-07-22T18:00:01.000Z');
      assert.equal(fixture.controller().evaluate(guard.deploymentId).disposition, 'rollback_failed');
      assert.equal(fixture.controller().evaluate(guard.deploymentId).disposition, 'rollback_failed');
      assert.equal(fixture.host.readFixtureStateForTest().restoreAttempts, 1);
    } finally {
      fixture.cleanup();
    }
  });

  it('recovers a dead-process lock but refuses a live exact process identity', () => {
    const fixture = harness();
    try {
      mkdirSync(join(fixture.root, 'run'), { recursive: true });
      const procStat = readFileSync('/proc/self/stat', 'utf8');
      const fields = procStat.slice(procStat.lastIndexOf(')') + 2).trim().split(/\s+/u);
      writeFileSync(fixture.lockPath, `${JSON.stringify({
        token: 'live-lock',
        pid: process.pid,
        startTime: fields[19],
        executable: readlinkSync('/proc/self/exe'),
      })}\n`);
      expectControllerCode(() => fixture.controller().arm(fixture.guard()), 'controller_lock_busy');
      unlinkSync(fixture.lockPath);

      writeFileSync(fixture.lockPath, '{"pid":999999,"startTime":"0","executable":"/nope"}\n');
      assert.equal(fixture.controller().arm(fixture.guard()).disposition, 'armed');
    } finally {
      fixture.cleanup();
    }
  });
});
