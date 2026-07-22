import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { assertSafeVersion } from '../src/install/safe-extract.js';
import { installInactiveRelease } from '../src/release/install.js';
import { sha256FileSync } from '../src/release/digest.js';
import type { ReleaseManifest } from '../src/release/contracts.js';

function fixtureManifest(version: string, candidateRoot: string): ReleaseManifest {
  const payload = join(candidateRoot, 'payload.txt');
  return {
    releaseVersion: version,
    requiredFiles: existsSync(payload)
      ? [{
          path: 'payload.txt',
          sha256: sha256FileSync(payload),
          sizeBytes: statSync(payload).size,
          mode: '0444',
          owner: 'root',
          group: 'root',
          kind: 'file',
        }]
      : [],
  } as unknown as ReleaseManifest;
}

describe('acceptance: inactive immutable release installation', () => {
  it('installs create-once without pointers, services, configuration, or state mutation', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-inactive-install-'));
    try {
      const version = '0.3.0-test';
      const candidateRoot = join(root, `baby-quirt-${version}`);
      const releaseRoot = join(root, 'releases');
      mkdirSync(candidateRoot);
      writeFileSync(join(candidateRoot, 'payload.txt'), 'exact-candidate-bytes\n');
      chmodSync(join(candidateRoot, 'payload.txt'), 0o444);
      const manifest = fixtureManifest(version, candidateRoot);
      const result = installInactiveRelease({
        verifiedCandidateRoot: candidateRoot,
        releaseRoot,
        manifest,
        ownerUid: process.getuid?.() ?? 0,
        ownerGid: process.getgid?.() ?? 0,
      });

      assert.deepEqual(result, {
        version,
        target: join(releaseRoot, version),
        activated: false,
        pointersChanged: false,
        servicesChanged: false,
      });
      assert.equal(readFileSync(join(result.target, 'payload.txt'), 'utf8'), 'exact-candidate-bytes\n');
      assert.equal(statSync(join(result.target, 'payload.txt')).mode & 0o7777, 0o444);
      assert.equal(statSync(result.target).mode & 0o7777, 0o555);
      assert.equal(existsSync(join(root, 'current')), false);
      assert.equal(existsSync(join(root, 'previous')), false);
      assert.equal(existsSync(join(root, 'etc')), false);
      assert.equal(existsSync(join(root, 'state')), false);
      assert.throws(
        () => installInactiveRelease({
          verifiedCandidateRoot: candidateRoot,
          releaseRoot,
          manifest,
          ownerUid: process.getuid?.() ?? 0,
          ownerGid: process.getgid?.() ?? 0,
        }),
        /already exists/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses reserved releases 0.2.1 and 0.2.2 before creating a target', () => {
    for (const version of ['0.2.1', '0.2.2']) {
      const root = mkdtempSync(join(tmpdir(), 'bq-reserved-release-'));
      try {
        const candidateRoot = join(root, `baby-quirt-${version}`);
        const releaseRoot = join(root, 'releases');
        mkdirSync(candidateRoot);
        assert.throws(
          () => installInactiveRelease({
            verifiedCandidateRoot: candidateRoot,
            releaseRoot,
            manifest: fixtureManifest(version, candidateRoot),
            ownerUid: process.getuid?.() ?? 0,
            ownerGid: process.getgid?.() ?? 0,
          }),
          /Reserved release/,
        );
        assert.equal(existsSync(join(releaseRoot, version)), false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('re-hashes copied bytes and removes staging state if the candidate changed after verification', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-mutated-candidate-'));
    try {
      const version = '0.3.1-test';
      const candidateRoot = join(root, `baby-quirt-${version}`);
      const releaseRoot = join(root, 'releases');
      mkdirSync(candidateRoot);
      const payload = join(candidateRoot, 'payload.txt');
      writeFileSync(payload, 'verified-bytes');
      chmodSync(payload, 0o444);
      const manifest = fixtureManifest(version, candidateRoot);
      chmodSync(payload, 0o644);
      writeFileSync(payload, 'substituted-bytes');
      chmodSync(payload, 0o444);
      assert.throws(
        () => installInactiveRelease({
          verifiedCandidateRoot: candidateRoot,
          releaseRoot,
          manifest,
          ownerUid: process.getuid?.() ?? 0,
          ownerGid: process.getgid?.() ?? 0,
        }),
        /bytes changed during installation/,
      );
      assert.equal(existsSync(join(releaseRoot, version)), false);
      assert.deepEqual(existsSync(releaseRoot) ? readdirSync(releaseRoot) : [], []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not remove another installer claim when concurrent installation is fenced', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-concurrent-install-'));
    try {
      const version = '0.3.2-test';
      const candidateRoot = join(root, `baby-quirt-${version}`);
      const releaseRoot = join(root, 'releases');
      mkdirSync(candidateRoot);
      mkdirSync(releaseRoot);
      const payload = join(candidateRoot, 'payload.txt');
      writeFileSync(payload, 'candidate-bytes');
      chmodSync(payload, 0o444);
      const claim = join(releaseRoot, `.installing-${version}`);
      writeFileSync(claim, 'other-installer');
      assert.throws(
        () => installInactiveRelease({
          verifiedCandidateRoot: candidateRoot,
          releaseRoot,
          manifest: fixtureManifest(version, candidateRoot),
          ownerUid: process.getuid?.() ?? 0,
          ownerGid: process.getgid?.() ?? 0,
        }),
        /EEXIST|file already exists/i,
      );
      assert.equal(readFileSync(claim, 'utf8'), 'other-installer');
      assert.equal(existsSync(join(releaseRoot, version)), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects candidate and release roots that traverse symbolic-link parents', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-install-symlink-parent-'));
    try {
      const version = '0.3.3-test';
      const realParent = join(root, 'real-parent');
      const linkedParent = join(root, 'linked-parent');
      const candidateRoot = join(realParent, `baby-quirt-${version}`);
      mkdirSync(candidateRoot, { recursive: true });
      const payload = join(candidateRoot, 'payload.txt');
      writeFileSync(payload, 'candidate-bytes');
      chmodSync(payload, 0o444);
      symlinkSync(realParent, linkedParent, 'dir');
      assert.throws(
        () => installInactiveRelease({
          verifiedCandidateRoot: join(linkedParent, `baby-quirt-${version}`),
          releaseRoot: join(root, 'releases'),
          manifest: fixtureManifest(version, candidateRoot),
          ownerUid: process.getuid?.() ?? 0,
          ownerGid: process.getgid?.() ?? 0,
        }),
        /real release identity/,
      );
      assert.equal(existsSync(join(root, 'releases')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps product rollback a non-mutating refusal', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/rollback.ts'], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /generation-bound StealthEye deployment guard/);
  });
});

describe('acceptance: release version validation', () => {
  it('rejects malformed versions', () => {
    assert.throws(() => assertSafeVersion('../etc/passwd'), /Invalid release version/);
    assert.throws(() => assertSafeVersion('not-a-version'), /Invalid release version/);
    assert.doesNotThrow(() => assertSafeVersion('0.3.0-test'));
  });
});
