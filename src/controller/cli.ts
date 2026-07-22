#!/usr/bin/env node
/** Root-only fixed controller CLI. It exposes no arbitrary path, unit, or argv. */

import { readFileSync } from 'node:fs';
import { getMachineIdSha256 } from '../config.js';
import { loadPrivateKey, loadPublicKey } from '../crypto/signing.js';
import { SnapshotManager } from '../deployment/snapshot.js';
import { FixedDeploymentController } from './controller.js';
import {
  FilesystemGuardHost,
  ProductionFixedServiceControl,
} from './filesystem-host.js';
import { ControllerError } from './types.js';

const PATHS = Object.freeze({
  controllerState: '/var/lib/baby-quirt/deployments/controller',
  snapshotRoot: '/var/lib/baby-quirt/deployments/snapshots',
  lock: '/run/baby-quirt/controller-state.lock',
  babyAuthorityPublic: '/etc/baby-quirt/deployment/baby-deployment-authority-public.pem',
  controllerEvidencePrivate: '/etc/baby-quirt/deployment/controller-evidence-private.pem',
  controllerEvidencePublic: '/etc/baby-quirt/deployment/controller-evidence-public.pem',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DIGEST = /^[a-f0-9]{64}$/;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredIdentifier(args: string[], name: string): string {
  const value = option(args, name);
  if (!value || !IDENTIFIER.test(value)) throw new Error(`${name} is required and must be canonical`);
  return value;
}

function stdinRecord(): unknown {
  const bytes = readFileSync(0);
  if (bytes.length === 0 || bytes.length > 1024 * 1024) throw new Error('Signed stdin record is empty or oversized');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

function controller(): FixedDeploymentController {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    throw new Error('Fixed deployment controller must run as root');
  }
  const machineId = getMachineIdSha256();
  if (!DIGEST.test(machineId)) throw new Error('Machine identity is unavailable');
  const babyAuthorityPublicKey = loadPublicKey(PATHS.babyAuthorityPublic);
  const controllerEvidencePrivateKey = loadPrivateKey(PATHS.controllerEvidencePrivate);
  const controllerEvidencePublicKey = loadPublicKey(PATHS.controllerEvidencePublic);
  const snapshots = new SnapshotManager({
    hostRoot: '/',
    recoveryRoot: PATHS.snapshotRoot,
    machineId,
    snapshotPublicKey: babyAuthorityPublicKey,
    signingKeyId: 'baby-deployment-authority-v2',
  });
  const host = new FilesystemGuardHost({
    hostRoot: '/',
    machineId,
    snapshots,
    services: new ProductionFixedServiceControl(),
  });
  return new FixedDeploymentController({
    root: PATHS.controllerState,
    lockPath: PATHS.lock,
    machineId,
    babyAuthorityPublicKey,
    controllerEvidencePrivateKey,
    controllerEvidencePublicKey,
    controllerSigningKeyId: 'baby-controller-evidence-v2',
    host,
  });
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  const knownOptions = new Set([
    '--deployment-id', '--snapshot-digest', '--reason',
  ]);
  for (let index = 0; index < args.length; index += 2) {
    if (!knownOptions.has(args[index]!)) throw new Error(`Unknown controller option ${args[index] ?? ''}`);
    if (args[index + 1] === undefined) throw new Error(`Missing value for ${args[index]}`);
  }
  const fixed = controller();
  let result: unknown;
  if (command === 'arm') {
    if (args.length !== 0) throw new Error('arm accepts one signed stdin record only');
    result = fixed.arm(stdinRecord());
  } else if (command === 'success') {
    if (args.length !== 0) throw new Error('success accepts one signed stdin record only');
    result = fixed.commitSuccess(stdinRecord());
  } else if (command === 'status') {
    result = fixed.read(requiredIdentifier(args, '--deployment-id'));
  } else if (command === 'evaluate') {
    result = fixed.evaluate(requiredIdentifier(args, '--deployment-id'));
  } else if (command === 'disarm') {
    result = fixed.disarm(requiredIdentifier(args, '--deployment-id'));
  } else if (command === 'manual-recover') {
    const snapshotDigest = option(args, '--snapshot-digest');
    const reason = option(args, '--reason');
    if (!snapshotDigest || !DIGEST.test(snapshotDigest) || !reason) {
      throw new Error('manual-recover requires exact deployment, snapshot digest, and reason');
    }
    result = fixed.manualRecover({
      deploymentId: requiredIdentifier(args, '--deployment-id'),
      snapshotDigest,
      reason,
    });
  } else {
    throw new Error('Unknown fixed controller command');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  main();
} catch (error) {
  const body = error instanceof ControllerError
    ? { ok: false, code: error.code, message: error.message }
    : { ok: false, code: 'controller_invalid_invocation', message: error instanceof Error ? error.message : String(error) };
  process.stderr.write(`${JSON.stringify(body)}\n`);
  process.exitCode = 1;
}
