import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer } from '../test/helpers/server.js';
import { createTestClient } from '../test/helpers/client.js';

describe('acceptance: process tree cancellation', () => {
  it('cancels running foreground job', async () => {
    const ctx = await startTestServer();
    const client = createTestClient(ctx);
    try {
      const started = await client.request('baby.shell', {
        command: 'sleep 30',
        cwd: ctx.dir,
      });
      const jobId = (started.result as { jobId: string }).jobId;
      await new Promise((r) => setTimeout(r, 200));
      const cancelled = await client.request('baby.job.cancel', { jobId, signal: 'SIGTERM' });
      assert.equal((cancelled.result as { status: string }).status, 'cancelled');
    } finally {
      await stopTestServer(ctx);
    }
  });
});
