import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertReleasePointer,
  POINTER_MUTATION_AUTHORITY,
  readReleasePointer,
} from '../src/install/symlinks.js';
import { redactSecrets } from '../src/crypto/canonical.js';
import { FileManager } from '../src/files/manager.js';

describe('release pointer authority', () => {
  it('performs exact read-only pointer observation', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-pointer-'));
    try {
      const target = join(root, 'releases', '0.3.0');
      mkdirSync(target, { recursive: true });
      const current = join(root, 'current');
      symlinkSync(target, current);
      const observed = readReleasePointer(current);
      assert.equal(observed.safeSymlink, true);
      assert.equal(observed.resolvedTarget, target);
      assert.deepEqual(assertReleasePointer(current, target), observed);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a regular file as pointer readback', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-pointer-unsafe-'));
    try {
      const current = join(root, 'current');
      writeFileSync(current, 'not-a-link');
      assert.equal(readReleasePointer(current).safeSymlink, false);
      assert.throws(() => assertReleasePointer(current, '/expected'), /CAS readback mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('declares the only pointer mutation authority', () => {
    assert.equal(POINTER_MUTATION_AUTHORITY, 'fix-privilege-broker/generation-bound-deployment-guard');
  });
});

describe('redactSecrets', () => {
  it('does not redact ordinary file paths', () => {
    assert.equal(redactSecrets('/etc/baby-quirt/signing-private.pem'), '/etc/baby-quirt/signing-private.pem');
  });

  it('redacts PEM private keys', () => {
    assert.equal(redactSecrets('-----BEGIN PRIVATE KEY-----\nabc'), '[REDACTED]');
  });
});

describe('file manager symlink stat', () => {
  it('detects symlink type without following it', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-lstat-'));
    try {
      symlinkSync('/etc/hosts', join(root, 'link'));
      assert.equal(new FileManager().stat({ path: join(root, 'link') }).type, 'symlink');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
