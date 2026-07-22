/** Fixed finite host rollback adapter backed by one signed private snapshot. */

import { execFileSync } from 'node:child_process';
import { canonicalJson, sha256Hex } from '../crypto/canonical.js';
import {
  atomicCompareAndRemoveSymlink,
  atomicCompareAndSwapSymlink,
  readSymlinkTarget,
} from '../install/symlinks.js';
import {
  BABY_RESTORE_TARGETS,
  CADDY_RESTORE_TARGETS,
  GATEWAY_RESTORE_TARGETS,
  mapHostPath,
  SnapshotManager,
} from '../deployment/snapshot.js';
import type {
  ExpectedPointers,
  FixedGuardHostAdapter,
  GuardRollbackResult,
  PointerIdentity,
  SignedDeploymentGuardRecord,
} from './types.js';

export interface FixedServiceControl {
  stopCandidateServices(): void;
  recreateRuntimeDirectories(): void;
  validateAndReloadCaddy(): void;
  startKnownGoodServices(): void;
  verifyKnownGood(): Record<string, unknown>;
}

/** Exact commands only; there is no arbitrary unit, path, or argv parameter. */
export class ProductionFixedServiceControl implements FixedServiceControl {
  stopCandidateServices(): void {
    execFileSync('/usr/bin/systemctl', ['stop', 'baby-quirt-mcp.service']);
    execFileSync('/usr/bin/systemctl', ['stop', 'baby-quirt.service']);
  }

  recreateRuntimeDirectories(): void {
    execFileSync('/usr/bin/systemd-tmpfiles', [
      '--create',
      '/etc/tmpfiles.d/baby-quirt.conf',
      '/etc/tmpfiles.d/baby-quirt-mcp.conf',
    ]);
    execFileSync('/usr/bin/systemctl', ['daemon-reload']);
  }

  validateAndReloadCaddy(): void {
    execFileSync('/usr/bin/caddy', ['validate', '--config', '/etc/caddy/Caddyfile']);
    execFileSync('/usr/bin/systemctl', ['reload', 'caddy.service']);
  }

  startKnownGoodServices(): void {
    execFileSync('/usr/bin/systemctl', ['start', 'baby-quirt.socket']);
    execFileSync('/usr/bin/systemctl', ['start', 'baby-quirt-mcp.service']);
  }

  verifyKnownGood(): Record<string, unknown> {
    const babySocket = execFileSync('/usr/bin/systemctl', ['is-active', 'baby-quirt.socket'], {
      encoding: 'utf8',
    }).trim();
    const gateway = execFileSync('/usr/bin/systemctl', ['is-active', 'baby-quirt-mcp.service'], {
      encoding: 'utf8',
    }).trim();
    if (babySocket !== 'active' || gateway !== 'active') throw new Error('known-good services inactive');
    return { babySocket, gateway, exactUnits: true };
  }
}

export interface FilesystemGuardHostOptions {
  hostRoot: string;
  machineId: string;
  snapshots: SnapshotManager;
  services: FixedServiceControl;
}

export class FilesystemGuardHost implements FixedGuardHostAdapter {
  constructor(private readonly options: FilesystemGuardHostOptions) {}

  readPointers(record: SignedDeploymentGuardRecord): ExpectedPointers {
    return {
      baby: {
        current: this.readPointer(record.expectedPointers.baby.current),
        previous: this.readPointer(record.expectedPointers.baby.previous),
      },
      gateway: {
        current: this.readPointer(record.expectedPointers.gateway.current),
        previous: this.readPointer(record.expectedPointers.gateway.previous),
      },
    };
  }

  restoreSnapshot(record: SignedDeploymentGuardRecord): GuardRollbackResult {
    let stage = 'snapshot_validation';
    try {
      const snapshot = this.options.snapshots.load(record.snapshotDigest);
      if (
        snapshot.deploymentId !== record.deploymentId ||
        snapshot.generation !== record.generation ||
        snapshot.machineId !== record.machineId ||
        snapshot.machineId !== this.options.machineId
      ) throw new Error('snapshot identity mismatch');
      this.assertRollbackPointerFence(record);

      stage = 'candidate_stop';
      this.options.services.stopCandidateServices();
      stage = 'baby_restore';
      const babyRestored = this.options.snapshots.restoreNonPointerTargets(
        record.snapshotDigest,
        BABY_RESTORE_TARGETS,
      );
      this.restoreProductPointers(record.expectedPointers.baby, record.candidatePointerTargets.baby);
      stage = 'gateway_restore';
      const gatewayRestored = this.options.snapshots.restoreNonPointerTargets(
        record.snapshotDigest,
        GATEWAY_RESTORE_TARGETS,
      );
      this.restoreProductPointers(record.expectedPointers.gateway, record.candidatePointerTargets.gateway);
      stage = 'caddy_restore';
      const caddyRestored = this.options.snapshots.restoreNonPointerTargets(
        record.snapshotDigest,
        CADDY_RESTORE_TARGETS,
      );
      stage = 'runtime_recreate';
      this.options.services.recreateRuntimeDirectories();
      this.options.services.validateAndReloadCaddy();
      stage = 'known_good_start';
      this.options.services.startKnownGoodServices();
      stage = 'known_good_verify';
      const verification = this.options.services.verifyKnownGood();
      const pointerReadback = this.readPointers(record);
      if (canonicalJson(pointerReadback) !== canonicalJson(record.expectedPointers)) {
        throw new Error('rollback pointer readback mismatch');
      }
      return {
        completed: true,
        details: {
          stage: 'complete',
          restoredEntryCount:
            babyRestored.restoredEntryCount +
            gatewayRestored.restoredEntryCount +
            caddyRestored.restoredEntryCount,
          restoreReadbackDigest: sha256Hex(canonicalJson({
            baby: babyRestored.readbackDigest,
            gateway: gatewayRestored.readbackDigest,
            caddy: caddyRestored.readbackDigest,
          })),
          pointerReadbackDigest: sha256Hex(canonicalJson(pointerReadback)),
          verificationDigest: sha256Hex(canonicalJson(verification)),
        },
      };
    } catch (error) {
      return {
        completed: false,
        details: {
          stage,
          errorClass: error instanceof Error ? error.name : 'NonError',
        },
      };
    }
  }

  private readPointer(pointer: PointerIdentity): PointerIdentity {
    return {
      link: pointer.link,
      target: readSymlinkTarget(mapHostPath(this.options.hostRoot, pointer.link)),
    };
  }

  private assertRollbackPointerFence(record: SignedDeploymentGuardRecord): void {
    const actual = this.readPointers(record);
    for (const product of ['baby', 'gateway'] as const) {
      const expected = record.expectedPointers[product];
      const candidate = record.candidatePointerTargets[product];
      const currentAllowed = new Set([expected.current.target, candidate]);
      const previousAllowed = new Set([expected.previous.target, expected.current.target]);
      if (!currentAllowed.has(actual[product].current.target)) {
        throw new Error(`${product} current pointer is outside signed rollback fence`);
      }
      if (!previousAllowed.has(actual[product].previous.target)) {
        throw new Error(`${product} previous pointer is outside signed rollback fence`);
      }
    }
  }

  private restoreProductPointers(
    expected: ExpectedPointers['baby'],
    candidateTarget: string,
  ): void {
    const currentPath = mapHostPath(this.options.hostRoot, expected.current.link);
    const previousPath = mapHostPath(this.options.hostRoot, expected.previous.link);
    const currentActual = readSymlinkTarget(currentPath);
    if (!expected.current.target) throw new Error('Known-good current pointer is absent');
    if (currentActual !== expected.current.target) {
      if (currentActual !== candidateTarget) throw new Error('Current pointer changed outside candidate fence');
      atomicCompareAndSwapSymlink(currentPath, candidateTarget, expected.current.target);
    }
    const previousActual = readSymlinkTarget(previousPath);
    if (expected.previous.target === null) {
      if (previousActual !== null) atomicCompareAndRemoveSymlink(previousPath, previousActual);
    } else if (previousActual !== expected.previous.target) {
      atomicCompareAndSwapSymlink(previousPath, previousActual, expected.previous.target);
    }
  }
}
