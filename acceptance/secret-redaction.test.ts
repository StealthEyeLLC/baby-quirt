import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startTestServer, stopTestServer, type TestServerContext } from '../test/helpers/server.js';
import { createTestClient } from '../test/helpers/client.js';
import { readFileSync } from 'node:fs';

const CANARY = 'bq-canary-secret-value-7f3a9c2d';

describe('acceptance: secret redaction', () => {
  let ctx: TestServerContext;
  let client: ReturnType<typeof createTestClient>;

  before(async () => {
    process.env.BABY_QUIRT_TEST_CANARY = CANARY;
    ctx = await startTestServer();
    client = createTestClient(ctx);
  });

  after(async () => {
    delete process.env.BABY_QUIRT_TEST_CANARY;
    await stopTestServer(ctx);
  });

  it('never leaks canary secret through job APIs or persisted state', async () => {
    const exec = await client.request('baby.exec', {
      argv: ['sh', '-c', 'printf %s "$CANARY"'],
      cwd: ctx.dir,
      environment: [{ name: 'CANARY', secretReference: 'github:BABY_QUIRT_TEST_CANARY' }],
    });
    const jobId = (exec.result as { jobId: string }).jobId;
    const job = await client.request('baby.job.get', { jobId });
    const serialized = JSON.stringify(job);
    assert.ok(!serialized.includes(CANARY));

    const jobsDir = join(ctx.stateRoot, 'jobs');
    for (const file of readdirSync(jobsDir)) {
      const content = readFileSync(join(jobsDir, file), 'utf8');
      assert.ok(!content.includes(CANARY));
    }

    const list = await client.request('baby.job.list', { limit: 20 });
    assert.ok(!JSON.stringify(list).includes(CANARY));
    if (job.receipt) {
      assert.ok(!JSON.stringify(job.receipt).includes(CANARY));
    }
  });
});
