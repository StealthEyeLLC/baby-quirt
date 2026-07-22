import assert from 'node:assert/strict';
import {
  chmodSync,
  chownSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import {
  permissionMatrix,
  repairPermissionMatrix,
  verifyPermissionMatrix,
  type PermissionIdentity,
} from '../src/deployment/permissions.js';
import { mapHostPath } from '../src/deployment/snapshot.js';

function materialize(hostRoot: string, identity: PermissionIdentity): void {
  chmodSync(hostRoot, 0o755);
  for (const entry of permissionMatrix(identity)) {
    if (entry.kind === 'socket') continue;
    const path = mapHostPath(hostRoot, entry.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
    if (entry.kind === 'directory') mkdirSync(path, { recursive: true, mode: entry.mode });
    else writeFileSync(path, `${entry.path} fixture\n`, { mode: entry.mode });
    chmodSync(path, entry.mode);
    chownSync(path, entry.uid, entry.gid);
  }
}

function uidRead(path: string, gid: number): ReturnType<typeof spawnSync> {
  return spawnSync(
    '/usr/bin/setpriv',
    ['--reuid=997', `--regid=${gid}`, '--clear-groups', '/usr/bin/cat', path],
    { encoding: 'utf8' },
  );
}

describe('Baby and gateway permission matrix', () => {
  it('declares the exact root, horsey, and gateway UID 997 contract', () => {
    const entries = permissionMatrix({
      rootUid: 0,
      rootGid: 0,
      horseyGid: 2234,
      gatewayUid: 997,
      gatewayGid: 2235,
    });
    assert.deepEqual(
      entries.find((entry) => entry.path === '/etc/baby-quirt')?.mode,
      0o750,
    );
    assert.deepEqual(
      entries.find((entry) => entry.path === '/etc/baby-quirt/gateway-authority-public.pem')
        ?.mode,
      0o640,
    );
    assert.deepEqual(
      entries.find((entry) => entry.path === '/etc/baby-quirt/supervisor-receipt-private.pem')
        ?.mode,
      0o600,
    );
    assert.equal(
      entries.find((entry) => entry.path === '/etc/baby-quirt-mcp/gateway-authority-private.pem')
        ?.uid,
      997,
    );
  });

  it('proves path traversal, public/private separation, and UID 997 access', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'baby-quirt-permissions-'));
    const identity: PermissionIdentity = {
      rootUid: 0,
      rootGid: 0,
      horseyGid: 2234,
      gatewayUid: 997,
      gatewayGid: 2235,
    };
    try {
      try {
        materialize(root, identity);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EINVAL') {
          t.skip('execution sandbox rejects chown/setuid UID 997 fixtures with EINVAL');
          return;
        }
        throw error;
      }
      const checks = verifyPermissionMatrix(root, identity);
      assert.equal(checks.every((check) => check.ok), true, JSON.stringify(checks));

      const publicKey = mapHostPath(root, '/etc/baby-quirt/gateway-authority-public.pem');
      const receiptPrivate = mapHostPath(root, '/etc/baby-quirt/supervisor-receipt-private.pem');
      const gatewayPrivate = mapHostPath(root, '/etc/baby-quirt-mcp/gateway-authority-private.pem');
      assert.equal(uidRead(publicKey, identity.horseyGid).status, 0);
      assert.notEqual(uidRead(receiptPrivate, identity.horseyGid).status, 0);
      assert.equal(uidRead(gatewayPrivate, identity.gatewayGid).status, 0);

      chmodSync(publicKey, 0o600);
      chownSync(gatewayPrivate, 0, 0);
      assert.equal(verifyPermissionMatrix(root, identity).some((check) => !check.ok), true);
      const repaired = repairPermissionMatrix(root, identity);
      assert.equal(repaired.every((check) => check.ok), true);
      assert.equal(uidRead(publicKey, identity.horseyGid).status, 0);
      assert.equal(uidRead(gatewayPrivate, identity.gatewayGid).status, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
