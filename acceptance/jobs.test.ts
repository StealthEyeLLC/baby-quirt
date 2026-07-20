import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestServer, stopTestServer, type TestServerContext } from '../test/helpers/server.js';
import { createTestClient, type BabyQuirtTestClient } from '../test/helpers/client.js';
import { JobManager } from '../src/jobs/manager.js';
import { StateStore } from '../src/state/store.js';
import { loadRuntimeConfig } from '../src/config.js';

describe('acceptance: detached jobs', () => {
  let ctx: TestServerContext;
  let client: BabyQuirtTestClient;

  before(async () => {
    ctx = await startTestServer();
    client = createTestClient(ctx);
  });

  after(async () => {
    await stopTestServer(ctx);
  });

  it('runs detached job and survives manager restart', async () => {
    const response = await client.request('baby.exec', {
      argv: ['/bin/sh', '-c', 'sleep 1; echo detached-ok'],
      cwd: ctx.dir,
      detached: true,
    });
    const job = response.result as { jobId: string; status: string };
    assert.equal(job.status, 'detached');

    const config = loadRuntimeConfig({
      stateRoot: ctx.stateRoot,
      expectedMachineIdSha256: 'test',
    });
    const store = new StateStore(config);
    const jobs = new JobManager(config, store);
    const recovered = jobs.recoverDetachedJobs();
    assert.ok(recovered >= 1);

    await new Promise((r) => setTimeout(r, 2500));
    const adopted = jobs.adoptDetachedJob(job.jobId);
    assert.ok(adopted);

    const stream = await client.request('baby.job.stream.read', {
      jobId: job.jobId,
      stream: 'stdout',
    });
    const output = Buffer.from((stream.result as { data: string }).data, 'base64').toString('utf8');
    assert.match(output, /detached-ok/);

    await client.request('baby.job.cancel', { jobId: job.jobId, signal: 'SIGKILL' });
    await new Promise((r) => setTimeout(r, 300));
  });
});
