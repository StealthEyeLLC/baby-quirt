import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { startTestServer, stopTestServer, type TestServerContext } from '../test/helpers/server.js';
import { createTestClient } from '../test/helpers/client.js';
import { assertNoSecretLeak, readStream } from './helpers/protocol.js';

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
      argv: ['sh', '-c', 'printf %s "$CANARY" 1>&2; echo done'],
      cwd: ctx.dir,
      environment: [{ name: 'CANARY', secretReference: 'github:BABY_QUIRT_TEST_CANARY' }],
    });
    const jobId = (exec.result as { jobId: string }).jobId;
    await client.request('baby.job.wait', { jobId, timeoutMs: 15_000 });

    const stdout = await readStream(client, jobId, 'stdout');
    const stderr = await readStream(client, jobId, 'stderr');
    assert.match(stdout, /done/);
    assert.match(stderr, new RegExp(CANARY));

    const job = await client.request('baby.job.get', { jobId });
    assertNoSecretLeak(JSON.stringify(job), CANARY, 'job get response');
    if (job.receipt) {
      assertNoSecretLeak(JSON.stringify(job.receipt), CANARY, 'job receipt');
    }

    const jobsDir = join(ctx.stateRoot, 'jobs');
    for (const file of readdirSync(jobsDir)) {
      assertNoSecretLeak(readFileSync(join(jobsDir, file), 'utf8'), CANARY, `job state file ${file}`);
    }

    const list = await client.request('baby.job.list', { limit: 20 });
    assertNoSecretLeak(JSON.stringify(list), CANARY, 'job list response');

    const err = await client.expectError(
      'baby.job.get',
      { jobId: 'missing-job-id' },
      'operation_failed',
    );
    assertNoSecretLeak(JSON.stringify(err), CANARY, 'error response');

    const gitLog = execSync('git log -1 --format=%B', { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' });
    assertNoSecretLeak(gitLog, CANARY, 'git history');
  });
});
