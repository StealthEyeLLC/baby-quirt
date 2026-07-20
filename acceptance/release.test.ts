import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('acceptance: reproducible release builds', () => {
  it('produces identical SHA-256 for two builds from same commit', { timeout: 300_000 }, () => {
    const root = join(import.meta.dirname, '..');
    const epoch = execSync('git log -1 --format=%ct', { cwd: root, encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
    const baseEnv = {
      ...process.env,
      SOURCE_DATE_EPOCH: epoch,
      BABY_QUIRT_SOURCE_COMMIT: commit,
      LC_ALL: 'C',
      TZ: 'UTC',
    };

    const buildA = mkdtempSync(join(tmpdir(), 'bq-repro-a-'));
    const buildB = mkdtempSync(join(tmpdir(), 'bq-repro-b-'));

    try {
      execSync('bash scripts/build-bundle.sh 0.0.0-repro-test', {
        cwd: root,
        env: { ...baseEnv, BABY_QUIRT_BUILD_ROOT: buildA },
        stdio: 'pipe',
      });
      const digest1 = readFileSync(join(root, 'release/baby-quirt-0.0.0-repro-test.sha256'), 'utf8')
        .split(/\s+/)[0];

      execSync('bash scripts/build-bundle.sh 0.0.0-repro-test', {
        cwd: root,
        env: { ...baseEnv, BABY_QUIRT_BUILD_ROOT: buildB },
        stdio: 'pipe',
      });
      const digest2 = readFileSync(join(root, 'release/baby-quirt-0.0.0-repro-test.sha256'), 'utf8')
        .split(/\s+/)[0];

      assert.equal(digest1, digest2);
      assert.equal(commit.length, 40);
      const manifest = JSON.parse(
        readFileSync(join(root, 'release/baby-quirt-0.0.0-repro-test.manifest.json'), 'utf8'),
      ) as { commit: string };
      assert.equal(manifest.commit, commit);
      assert.ok(existsSync(join(root, 'release/baby-quirt-0.0.0-repro-test.tar.gz')));
    } finally {
      rmSync(buildA, { recursive: true, force: true });
      rmSync(buildB, { recursive: true, force: true });
    }
  });
});
