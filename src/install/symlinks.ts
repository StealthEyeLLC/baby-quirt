/** Read-only release pointer inspection. Pointer mutation belongs to the Fix broker/guard. */

import { lstatSync, readlinkSync, realpathSync } from 'node:fs';

export interface ReleasePointerObservation {
  path: string;
  target: string | null;
  resolvedTarget: string | null;
  safeSymlink: boolean;
}

export function readReleasePointer(path: string): ReleasePointerObservation {
  try {
    const stat = lstatSync(path);
    if (!stat.isSymbolicLink()) {
      return { path, target: null, resolvedTarget: null, safeSymlink: false };
    }
    return {
      path,
      target: readlinkSync(path),
      resolvedTarget: realpathSync(path),
      safeSymlink: true,
    };
  } catch {
    return { path, target: null, resolvedTarget: null, safeSymlink: false };
  }
}

export function assertReleasePointer(path: string, expectedResolvedTarget: string): ReleasePointerObservation {
  const observation = readReleasePointer(path);
  if (!observation.safeSymlink || observation.resolvedTarget !== expectedResolvedTarget) {
    throw new Error(`Release pointer CAS readback mismatch: ${path}`);
  }
  return observation;
}

export const POINTER_MUTATION_AUTHORITY = 'fix-privilege-broker/generation-bound-deployment-guard';
