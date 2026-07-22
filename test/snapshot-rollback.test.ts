import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { buildSignedGuardRecord } from '../src/controller/contract.js';
import { FixedDeploymentController } from '../src/controller/controller.js';
import {
  FilesystemGuardHost,
  type FixedServiceControl,
} from '../src/controller/filesystem-host.js';
import { CONTROLLER_RECORD_VERSION, type ExpectedPointers } from '../src/controller/types.js';
import { canonicalJson, sha256Hex } from '../src/crypto/canonical.js';
import {
  generateEd25519KeyPair,
  loadPrivateKey,
  loadPublicKey,
} from '../src/crypto/signing.js';
import {
  activateBabyCandidate,
  activateGatewayCandidate,
} from '../src/deployment/activation.js';
import {
  FIXTURE_EMPTY_EXTENDED_METADATA,
  SnapshotManager,
  mapHostPath,
  type SnapshotObservations,
} from '../src/deployment/snapshot.js';

const digest = (label: string): string => sha256Hex(label);

class FixtureServices implements FixedServiceControl {
  readonly events: string[] = [];
  stopCandidateServices(): void { this.events.push('stop'); }
  recreateRuntimeDirectories(): void { this.events.push('tmpfiles'); }
  validateAndReloadCaddy(): void { this.events.push('caddy'); }
  startKnownGoodServices(): void { this.events.push('start'); }
  verifyKnownGood(): Record<string, unknown> {
    this.events.push('verify');
    return { signedPrivateHealth: true, publicHealth: true, fixture: true };
  }
}

function writeLogical(root: string, path: string, contents: string): void {
  const physical = mapHostPath(root, path);
  mkdirSync(dirname(physical), { recursive: true, mode: 0o700 });
  writeFileSync(physical, contents, { mode: 0o600 });
}

function observations(): SnapshotObservations {
  return {
    machineIdentityDigest: digest('machine'),
    releaseInventoryDigest: digest('releases'),
    serviceInventoryDigest: digest('services'),
    processInventoryDigest: digest('processes'),
    listenerInventoryDigest: digest('listeners'),
    permissionInventoryDigest: digest('permissions'),
    knownGoodHealthDigest: digest('health'),
    publicMetadataDigest: digest('public-metadata'),
    keyFingerprintInventoryDigest: digest('key-fingerprints'),
  };
}

describe('signed snapshot, gateway-first CAS activation, and independent rollback', () => {
  it('restores exact private bytes, metadata, pointers, and fixed service order', () => {
    const root = mkdtempSync(join(tmpdir(), 'baby-quirt-snapshot-'));
    try {
      const hostRoot = join(root, 'host');
      mkdirSync(hostRoot, { mode: 0o700 });
      for (const path of [
        '/opt/baby-quirt/releases/0.1.3',
        '/opt/baby-quirt/releases/0.1.2',
        '/opt/baby-quirt/releases/0.3.0',
        '/opt/baby-quirt-mcp/releases/0.1.0',
        '/opt/baby-quirt-mcp/releases/0.3.0',
      ]) mkdirSync(mapHostPath(hostRoot, path), { recursive: true });
      mkdirSync(mapHostPath(hostRoot, '/opt/baby-quirt'), { recursive: true });
      mkdirSync(mapHostPath(hostRoot, '/opt/baby-quirt-mcp'), { recursive: true });
      symlinkSync('/opt/baby-quirt/releases/0.1.3', mapHostPath(hostRoot, '/opt/baby-quirt/current'));
      symlinkSync('/opt/baby-quirt/releases/0.1.2', mapHostPath(hostRoot, '/opt/baby-quirt/previous'));
      symlinkSync('/opt/baby-quirt-mcp/releases/0.1.0', mapHostPath(hostRoot, '/opt/baby-quirt-mcp/current'));

      writeLogical(hostRoot, '/etc/systemd/system/baby-quirt.service', 'known-good baby unit\n');
      writeLogical(hostRoot, '/etc/systemd/system/baby-quirt.socket', 'known-good baby socket\n');
      writeLogical(hostRoot, '/etc/systemd/system/baby-quirt-mcp.service', 'known-good gateway unit\n');
      writeLogical(hostRoot, '/etc/tmpfiles.d/baby-quirt.conf', 'known-good baby tmpfiles\n');
      writeLogical(hostRoot, '/etc/tmpfiles.d/baby-quirt-mcp.conf', 'known-good gateway tmpfiles\n');
      writeLogical(hostRoot, '/etc/baby-quirt/runtime.json', '{"release":"0.1.3"}\n');
      writeLogical(hostRoot, '/etc/baby-quirt/supervisor-receipt-private.pem', 'PRIVATE_FIXTURE_BYTES\n');
      writeLogical(hostRoot, '/etc/baby-quirt-mcp/environment', 'GITHUB_CLIENT_SECRET_FILE=/run/credentials/github\n');
      writeLogical(hostRoot, '/var/lib/baby-quirt/deployment-state.sqlite', 'fixture sqlite bytes\n');
      writeLogical(hostRoot, '/var/lib/baby-quirt-mcp/oauth-state.json', 'OAUTH_PRIVATE_FIXTURE_BYTES\n');
      writeLogical(hostRoot, '/etc/caddy/Caddyfile', 'known-good caddy\n');
      writeLogical(hostRoot, '/etc/caddy/sites-enabled/baby-quirt-mcp.Caddyfile', 'known-good site\n');

      const keyRoot = join(root, 'keys');
      const babyPublicPath = join(keyRoot, 'baby-public.pem');
      const babyPrivatePath = join(keyRoot, 'baby-private.pem');
      const evidencePublicPath = join(keyRoot, 'evidence-public.pem');
      const evidencePrivatePath = join(keyRoot, 'evidence-private.pem');
      generateEd25519KeyPair({
        publicKeyPath: babyPublicPath,
        privateKeyPath: babyPrivatePath,
        keyId: 'baby-deployment-authority-v2',
      });
      generateEd25519KeyPair({
        publicKeyPath: evidencePublicPath,
        privateKeyPath: evidencePrivatePath,
        keyId: 'controller-evidence-v2',
      });
      const babyPrivate = loadPrivateKey(babyPrivatePath);
      const babyPublic = loadPublicKey(babyPublicPath);
      const evidencePrivate = loadPrivateKey(evidencePrivatePath);
      const evidencePublic = loadPublicKey(evidencePublicPath);
      const machineId = 'fixture-machine:snapshot-v2';
      const snapshots = new SnapshotManager({
        hostRoot,
        recoveryRoot: join(root, 'recovery'),
        machineId,
        snapshotPrivateKey: babyPrivate,
        snapshotPublicKey: babyPublic,
        signingKeyId: 'baby-deployment-authority-v2',
        extendedMetadata: FIXTURE_EMPTY_EXTENDED_METADATA,
      });
      const snapshot = snapshots.capture({
        deploymentId: 'deployment:snapshot-v2',
        generation: 1,
        capturedAt: '2026-07-22T17:00:00.000Z',
        observations: observations(),
      });
      const redacted = readFileSync(
        join(root, 'recovery', snapshot.snapshotDigest, 'redacted-evidence.json'),
        'utf8',
      );
      assert.doesNotMatch(redacted, /PRIVATE_FIXTURE_BYTES|OAUTH_PRIVATE_FIXTURE_BYTES/u);
      assert.match(redacted, /privatePayloadReference/u);

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
      const guard = buildSignedGuardRecord({
        recordVersion: CONTROLLER_RECORD_VERSION,
        recordType: 'baby-quirt-deployment-guard',
        deploymentId: snapshot.deploymentId,
        generation: snapshot.generation,
        machineId,
        planDigest: digest('plan'),
        snapshotDigest: snapshot.snapshotDigest,
        candidateManifestDigests: { baby: digest('baby-manifest'), gateway: digest('gateway-manifest') },
        candidatePointerTargets: {
          baby: '/opt/baby-quirt/releases/0.3.0',
          gateway: '/opt/baby-quirt-mcp/releases/0.3.0',
        },
        expectedPointers,
        deadline: '2026-07-22T18:00:00.000Z',
        evidenceDigest: digest('acceptance-evidence'),
        signingKeyId: 'baby-deployment-authority-v2',
        signatureAlgorithm: 'ed25519',
      }, babyPrivate);
      const services = new FixtureServices();
      const host = new FilesystemGuardHost({ hostRoot, machineId, snapshots, services });
      let now = new Date('2026-07-22T17:10:00.000Z');
      const controller = new FixedDeploymentController({
        root: join(root, 'controller-state'),
        lockPath: join(root, 'run', 'deploy.lock'),
        machineId,
        babyAuthorityPublicKey: babyPublic,
        controllerEvidencePrivateKey: evidencePrivate,
        controllerEvidencePublicKey: evidencePublic,
        controllerSigningKeyId: 'controller-evidence-v2',
        host,
        now: () => new Date(now),
      });
      const armed = controller.arm(guard);
      assert.equal(armed.disposition, 'armed');

      const gateway = activateGatewayCandidate({ hostRoot, guard, guardStatus: armed });
      assert.equal(gateway.currentTarget, guard.candidatePointerTargets.gateway);
      assert.throws(() => activateBabyCandidate({
        hostRoot,
        guard,
        guardStatus: armed,
        gatewayAcceptedLegacy: false,
      }));
      const baby = activateBabyCandidate({
        hostRoot,
        guard,
        guardStatus: armed,
        gatewayAcceptedLegacy: true,
      });
      assert.equal(baby.currentTarget, guard.candidatePointerTargets.baby);

      writeLogical(hostRoot, '/etc/baby-quirt/runtime.json', '{"release":"candidate"}\n');
      writeLogical(hostRoot, '/var/lib/baby-quirt-mcp/oauth-state.json', 'candidate oauth bytes\n');
      writeLogical(hostRoot, '/etc/caddy/Caddyfile', 'candidate caddy\n');
      writeLogical(hostRoot, '/etc/baby-quirt/candidate-only', 'must be removed\n');

      now = new Date('2026-07-22T18:00:01.000Z');
      const rolledBack = controller.evaluate(guard.deploymentId);
      assert.equal(rolledBack.disposition, 'rolled_back');
      assert.deepEqual(services.events, ['stop', 'tmpfiles', 'caddy', 'start', 'verify']);
      assert.equal(
        readFileSync(mapHostPath(hostRoot, '/etc/baby-quirt/runtime.json'), 'utf8'),
        '{"release":"0.1.3"}\n',
      );
      assert.equal(
        readFileSync(mapHostPath(hostRoot, '/etc/baby-quirt/supervisor-receipt-private.pem'), 'utf8'),
        'PRIVATE_FIXTURE_BYTES\n',
      );
      assert.equal(
        readFileSync(mapHostPath(hostRoot, '/var/lib/baby-quirt-mcp/oauth-state.json'), 'utf8'),
        'OAUTH_PRIVATE_FIXTURE_BYTES\n',
      );
      assert.equal(readFileSync(mapHostPath(hostRoot, '/etc/caddy/Caddyfile'), 'utf8'), 'known-good caddy\n');
      assert.equal(existsSync(mapHostPath(hostRoot, '/etc/baby-quirt/candidate-only')), false);
      assert.equal(readlinkSync(mapHostPath(hostRoot, '/opt/baby-quirt/current')), expectedPointers.baby.current.target);
      assert.equal(readlinkSync(mapHostPath(hostRoot, '/opt/baby-quirt/previous')), expectedPointers.baby.previous.target);
      assert.equal(readlinkSync(mapHostPath(hostRoot, '/opt/baby-quirt-mcp/current')), expectedPointers.gateway.current.target);
      assert.equal(existsSync(mapHostPath(hostRoot, '/opt/baby-quirt-mcp/previous')), false);
      assert.ok(rolledBack.evidence);
      assert.doesNotMatch(canonicalJson(rolledBack.evidence), /PRIVATE_FIXTURE_BYTES|OAUTH_PRIVATE_FIXTURE_BYTES/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when a private recovery payload is corrupt', () => {
    const root = mkdtempSync(join(tmpdir(), 'baby-quirt-snapshot-corrupt-'));
    try {
      const hostRoot = join(root, 'host');
      mkdirSync(hostRoot, { recursive: true });
      writeLogical(hostRoot, '/etc/baby-quirt/runtime.json', 'known-good\n');
      const publicPath = join(root, 'public.pem');
      const privatePath = join(root, 'private.pem');
      generateEd25519KeyPair({ publicKeyPath: publicPath, privateKeyPath: privatePath, keyId: 'snapshot' });
      const snapshots = new SnapshotManager({
        hostRoot,
        recoveryRoot: join(root, 'recovery'),
        machineId: 'fixture-machine:corrupt',
        snapshotPrivateKey: loadPrivateKey(privatePath),
        snapshotPublicKey: loadPublicKey(publicPath),
        signingKeyId: 'snapshot',
        extendedMetadata: FIXTURE_EMPTY_EXTENDED_METADATA,
      });
      const snapshot = snapshots.capture({
        deploymentId: 'deployment:corrupt',
        generation: 1,
        capturedAt: '2026-07-22T17:00:00.000Z',
        observations: observations(),
      });
      const entry = snapshot.entries.find((item) => item.path === '/etc/baby-quirt/runtime.json');
      assert.ok(entry?.payloadReference);
      const blobDigest = entry.payloadReference.split(':').at(-1)!;
      writeFileSync(join(root, 'recovery', snapshot.snapshotDigest, 'payload', `${blobDigest}.blob`), 'corrupt');
      assert.throws(
        () => snapshots.restoreNonPointerTargets(snapshot.snapshotDigest, ['/etc/baby-quirt']),
        /payload digest mismatch/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
