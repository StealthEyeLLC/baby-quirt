import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { verifyNspawnRunPlan } from '../src/rehearsal/nspawn-contract.js';
import { prepareNspawnInput } from '../src/rehearsal/nspawn-input.js';

const HARNESS = 'fixed fixture certification harness\n';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function git(root: string, args: string[]): string {
  return execFileSync('/usr/bin/git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function repository(root: string, name: string): { path: string; commit: string } {
  const path = join(root, name);
  mkdirSync(path);
  git(path, ['init', '--initial-branch=main']);
  git(path, ['config', 'user.name', 'Fixture']);
  git(path, ['config', 'user.email', 'fixture@example.invalid']);
  writeFileSync(join(path, 'README.md'), `${name}\n`);
  if (name === 'baby') {
    mkdirSync(join(path, 'ops', 'rehearsal'), { recursive: true });
    writeFileSync(join(path, 'ops', 'rehearsal', 'baby-quirt-host-certification.mjs'), HARNESS);
  }
  git(path, ['add', '.']);
  git(path, ['commit', '-m', 'fixture']);
  return { path, commit: git(path, ['rev-parse', 'HEAD']) };
}

describe('nspawn offline input preparation', () => {
  it('binds clean exact Git commits, trees, bundles, dependency cache, and golden snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'baby-quirt-nspawn-input-'));
    try {
      const baby = repository(root, 'baby');
      const gateway = repository(root, 'gateway');
      const bootstrap = join(root, 'bootstrap.json');
      writeFileSync(bootstrap, `${JSON.stringify({
        recordVersion: '1.0.0',
        recordType: 'baby-quirt-nspawn-bootstrap',
        pool: 'babycert',
        snapshot: 'babycert/base/noble@golden-v1',
        snapshotGuid: '1234567890123456789',
        harnessDigest: sha256(HARNESS),
        runnerDigest: '2'.repeat(64),
        nodeVersion: '24.18.0',
        poolBytes: 12 * 1024 ** 3,
      })}\n`);
      const cache = join(root, 'npm-cache.tar');
      writeFileSync(cache, 'offline dependency cache');
      const output = join(root, 'output');
      const plan = prepareNspawnInput({
        runId: 'cert-input-0001',
        requestedAt: '2026-07-22T19:00:00.000Z',
        deadline: '2026-07-22T20:00:00.000Z',
        babyRepositoryPath: baby.path,
        babyCommit: baby.commit,
        gatewayRepositoryPath: gateway.path,
        gatewayCommit: gateway.commit,
        dependencyCachePath: cache,
        bootstrapRecordPath: bootstrap,
        harnessPath: join(baby.path, 'ops', 'rehearsal', 'baby-quirt-host-certification.mjs'),
        outputRoot: output,
      });
      assert.equal(plan.inputs.baby.commit, baby.commit);
      assert.equal(plan.inputs.baby.tree, git(baby.path, ['rev-parse', 'HEAD^{tree}']));
      assert.equal(plan.inputs.gateway.commit, gateway.commit);
      assert.equal(plan.baseSnapshotGuid, '1234567890123456789');
      assert.equal(
        verifyNspawnRunPlan(JSON.parse(readFileSync(join(output, 'plan.json'), 'utf8'))).planDigest,
        plan.planDigest,
      );
      assert.equal(readFileSync(join(output, 'baby-quirt-host-certification.mjs'), 'utf8'), HARNESS);
      for (const [name, repositoryPath] of [
        ['baby-quirt.bundle', baby.path],
        ['baby-quirt-mcp.bundle', gateway.path],
      ] as const) {
        execFileSync(
          '/usr/bin/git',
          ['-C', repositoryPath, 'bundle', 'verify', join(output, name)],
          { stdio: 'pipe' },
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a dirty source instead of silently certifying uncommitted bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'baby-quirt-nspawn-dirty-'));
    try {
      const baby = repository(root, 'baby');
      const gateway = repository(root, 'gateway');
      writeFileSync(join(baby.path, 'untracked'), 'dirty');
      const bootstrap = join(root, 'bootstrap.json');
      writeFileSync(bootstrap, JSON.stringify({
        recordVersion: '1.0.0', recordType: 'baby-quirt-nspawn-bootstrap', pool: 'babycert',
        snapshot: 'babycert/base/noble@golden-v1', snapshotGuid: '1234567890123456789',
        harnessDigest: sha256(HARNESS), runnerDigest: '2'.repeat(64), nodeVersion: '24.18.0',
        poolBytes: 12 * 1024 ** 3,
      }));
      const cache = join(root, 'npm-cache.tar');
      writeFileSync(cache, 'cache');
      assert.throws(() => prepareNspawnInput({
        runId: 'cert-input-0002',
        requestedAt: '2026-07-22T19:00:00.000Z',
        deadline: '2026-07-22T20:00:00.000Z',
        babyRepositoryPath: baby.path,
        babyCommit: baby.commit,
        gatewayRepositoryPath: gateway.path,
        gatewayCommit: gateway.commit,
        dependencyCachePath: cache,
        bootstrapRecordPath: bootstrap,
        harnessPath: join(baby.path, 'ops', 'rehearsal', 'baby-quirt-host-certification.mjs'),
        outputRoot: join(root, 'output'),
      }), /worktree is not clean/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
