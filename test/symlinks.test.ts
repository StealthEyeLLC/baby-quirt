import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicSwapSymlinks, rollbackSymlinks } from '../src/install/symlinks.js';
import { redactSecrets } from '../src/crypto/canonical.js';
import { FileManager } from '../src/files/manager.js';

describe('symlink utilities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bq-symlink-'));
  const current = join(dir, 'current');
  const previous = join(dir, 'previous');
  const target = join(dir, 'release');

  it('swaps and rolls back atomically', () => {
    mkdirSync(target, { recursive: true });
    const target2 = join(dir, 'release2');
    mkdirSync(target2, { recursive: true });
    atomicSwapSymlinks(current, previous, target);
    atomicSwapSymlinks(current, previous, target2);
    const rolled = rollbackSymlinks(current, previous);
    assert.equal(rolled.current, target);
  });

  it('handles broken symlinks', () => {
    rmSync(current, { force: true });
    symlinkSync('/missing/target', current);
    atomicSwapSymlinks(current, previous, target);
    assert.doesNotThrow(() => rollbackSymlinks(current, previous));
  });

  it('cleans up', () => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('redactSecrets', () => {
  it('does not redact ordinary file paths', () => {
    const result = redactSecrets('/etc/baby-quirt/signing-private.pem');
    assert.equal(result, '/etc/baby-quirt/signing-private.pem');
  });

  it('redacts PEM private keys', () => {
    const result = redactSecrets('-----BEGIN PRIVATE KEY-----\nabc');
    assert.equal(result, '[REDACTED]');
  });
});

describe('file manager symlink stat', () => {
  const fm = new FileManager();
  const dir = mkdtempSync(join(tmpdir(), 'bq-lstat-'));

  it('detects symlink type', () => {
    mkdirSync(dir, { recursive: true });
    symlinkSync('/etc/hosts', join(dir, 'link'));
    const stat = fm.stat({ path: join(dir, 'link') });
    assert.equal(stat.type, 'symlink');
    rmSync(dir, { recursive: true, force: true });
  });
});
