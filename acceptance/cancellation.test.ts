import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, type TestServerContext } from '../test/helpers/server.js';
import { BabyQuirtTestClient } from '../test/helpers/client.js';

describe('acceptance: process tree cancellation', () => {
  let ctx: TestServerContext;
  let client: BabyQuirtTestClient;

  before(async () => {
    ctx = await startTestServer();
    client = new BabyQuirtTestClient({ socketPath: ctx.socketPath, configRoot: ctx.configRoot });
  });

  after(async () => {
    await stopTestServer(ctx);
  });

  it('cancels running foreground job', async () => {
    const started = await client.request('baby.shell', {
      command: 'sleep 5',
      cwd: ctx.dir,
    });
    const jobId = (started.result as { jobId: string }).jobId;
    await new Promise((r) => setTimeout(r, 200));
    const cancelled = await client.request('baby.job.cancel', { jobId, signal: 'SIGTERM' });
    assert.equal((cancelled.result as { status: string }).status, 'cancelled');
    await new Promise((r) => setTimeout(r, 300));
  });
});
