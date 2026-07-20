import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRuntimeConfig } from '../src/config.js';
import { StateStore } from '../src/state/store.js';
import { JobManager } from '../src/jobs/manager.js';
import {
  captureProcessIdentity,
  processAlive,
  readProcessStartTime,
} from '../src/process/identity.js';

describe('acceptance: process identity and PID reuse', () => {
  it('distinguishes live processes from stale PID records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bq-pidreuse-'));
    try {
      const config = loadRuntimeConfig({ stateRoot: dir, expectedMachineIdSha256: 'test' });
      const store = new StateStore(config);
      const jobs = new JobManager(config, store);

      const job = await jobs.exec('req-pid', {
        argv: ['/bin/sh', '-c', 'sleep 0.2'],
        cwd: dir,
      });
      assert.ok(job.pid);
      const identity = captureProcessIdentity(job.pid!);
      assert.ok(processAlive(identity));

      const stale = {
        ...identity,
        processStartTime: String(Number(identity.processStartTime) + 999_999),
      };
      assert.equal(processAlive(stale), false);

      const completed = await jobs.waitForJob({ jobId: job.jobId, timeoutMs: 10_000 });
      assert.equal(completed.status, 'completed');
      assert.equal(processAlive(identity), false);
      assert.notEqual(readProcessStartTime(job.pid!), identity.processStartTime);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
