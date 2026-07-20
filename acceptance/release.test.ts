import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

describe('acceptance: reproducible release builds', () => {
  it('produces identical SHA-256 for two builds from same commit', { timeout: 300_000 }, () => {
    const root = join(import.meta.dirname, '..');
    const epoch = execSync('git log -1 --format=%ct', { cwd: root, encoding: 'utf8' }).trim();
    const env = { ...process.env, SOURCE_DATE_EPOCH: epoch, LC_ALL: 'C', TZ: 'UTC' };

    execSync('bash scripts/build-bundle.sh 0.0.0-repro-test', {
      cwd: root,
      env,
      stdio: 'pipe',
    });
    const digest1 = readFileSync(join(root, 'release/baby-quirt-0.0.0-repro-test.sha256'), 'utf8')
      .split(/\s+/)[0];

    execSync('bash scripts/build-bundle.sh 0.0.0-repro-test', {
      cwd: root,
      env,
      stdio: 'pipe',
    });
    const digest2 = readFileSync(join(root, 'release/baby-quirt-0.0.0-repro-test.sha256'), 'utf8')
      .split(/\s+/)[0];

    assert.equal(digest1, digest2);
    assert.ok(existsSync(join(root, 'release/baby-quirt-0.0.0-repro-test.manifest.json')));
  });
});
