/** Exact Baby/gateway ownership, traversal, and secret-permission contract. */

import { chmodSync, chownSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { mapHostPath } from './snapshot.js';
import { DeploymentError } from './types.js';

export type PermissionKind = 'directory' | 'file' | 'socket';

export interface PermissionIdentity {
  rootUid: number;
  rootGid: number;
  horseyGid: number;
  gatewayUid: 997;
  gatewayGid: number;
}

export interface PermissionEntry {
  path: string;
  kind: PermissionKind;
  mode: number;
  uid: number;
  gid: number;
  required: boolean;
}

export interface PermissionCheck extends PermissionEntry {
  ok: boolean;
  actual?: { kind: PermissionKind | 'other'; mode: number; uid: number; gid: number };
}

export function permissionMatrix(identity: PermissionIdentity): PermissionEntry[] {
  return [
    { path: '/etc/baby-quirt', kind: 'directory', mode: 0o750, uid: identity.rootUid, gid: identity.horseyGid, required: true },
    { path: '/etc/baby-quirt/gateway-authority-public.pem', kind: 'file', mode: 0o640, uid: identity.rootUid, gid: identity.horseyGid, required: true },
    { path: '/etc/baby-quirt/supervisor-receipt-public.pem', kind: 'file', mode: 0o640, uid: identity.rootUid, gid: identity.horseyGid, required: true },
    { path: '/etc/baby-quirt/supervisor-receipt-private.pem', kind: 'file', mode: 0o600, uid: identity.rootUid, gid: identity.rootGid, required: true },
    { path: '/etc/baby-quirt/deployment', kind: 'directory', mode: 0o700, uid: identity.rootUid, gid: identity.rootGid, required: true },
    { path: '/var/lib/baby-quirt', kind: 'directory', mode: 0o750, uid: identity.rootUid, gid: identity.rootGid, required: true },
    { path: '/var/lib/baby-quirt/deployments', kind: 'directory', mode: 0o700, uid: identity.rootUid, gid: identity.rootGid, required: true },
    { path: '/run/horsey', kind: 'directory', mode: 0o750, uid: identity.rootUid, gid: identity.horseyGid, required: true },
    { path: '/run/horsey/baby-quirt.sock', kind: 'socket', mode: 0o660, uid: identity.rootUid, gid: identity.horseyGid, required: false },
    { path: '/etc/baby-quirt-mcp', kind: 'directory', mode: 0o750, uid: identity.rootUid, gid: identity.gatewayGid, required: true },
    { path: '/etc/baby-quirt-mcp/gateway-authority-private.pem', kind: 'file', mode: 0o600, uid: identity.gatewayUid, gid: identity.gatewayGid, required: true },
    { path: '/etc/baby-quirt-mcp/oauth-signing-private.pem', kind: 'file', mode: 0o600, uid: identity.gatewayUid, gid: identity.gatewayGid, required: true },
    { path: '/etc/baby-quirt-mcp/github-client-secret.ref', kind: 'file', mode: 0o600, uid: identity.gatewayUid, gid: identity.gatewayGid, required: true },
    { path: '/var/lib/baby-quirt-mcp', kind: 'directory', mode: 0o700, uid: identity.gatewayUid, gid: identity.gatewayGid, required: true },
  ];
}

function kind(path: string): PermissionKind | 'other' {
  const stat = lstatSync(path);
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  if (stat.isSocket()) return 'socket';
  return 'other';
}

function assertRealPathComponents(hostRoot: string, logicalPath: string): void {
  let current = dirname(mapHostPath(hostRoot, logicalPath));
  const root = mapHostPath(hostRoot, '/');
  while (current.startsWith(root) && current !== root && current !== dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new DeploymentError('deployment_integrity_failed', `Unsafe path component for ${logicalPath}`);
    }
    current = dirname(current);
  }
}

export function verifyPermissionMatrix(
  hostRoot: string,
  identity: PermissionIdentity,
): PermissionCheck[] {
  return permissionMatrix(identity).map((entry) => {
    const physical = mapHostPath(hostRoot, entry.path);
    try {
      assertRealPathComponents(hostRoot, entry.path);
      const stat = lstatSync(physical);
      const actual = {
        kind: kind(physical),
        mode: stat.mode & 0o777,
        uid: stat.uid,
        gid: stat.gid,
      };
      return {
        ...entry,
        actual,
        ok:
          actual.kind === entry.kind &&
          actual.mode === entry.mode &&
          actual.uid === entry.uid &&
          actual.gid === entry.gid,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !entry.required) {
        return { ...entry, ok: true };
      }
      return { ...entry, ok: false };
    }
  });
}

export function repairPermissionMatrix(
  hostRoot: string,
  identity: PermissionIdentity,
): PermissionCheck[] {
  for (const entry of permissionMatrix(identity)) {
    const physical = mapHostPath(hostRoot, entry.path);
    try {
      assertRealPathComponents(hostRoot, entry.path);
      const actualKind = kind(physical);
      if (actualKind !== entry.kind) {
        throw new DeploymentError('deployment_integrity_failed', `Permission target kind mismatch: ${entry.path}`);
      }
      chmodSync(physical, entry.mode);
      chownSync(physical, entry.uid, entry.gid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !entry.required) continue;
      throw error;
    }
  }
  const checks = verifyPermissionMatrix(hostRoot, identity);
  if (checks.some((check) => !check.ok)) {
    throw new DeploymentError('deployment_integrity_failed', 'Permission repair readback failed');
  }
  return checks;
}
