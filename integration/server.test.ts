import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer, stopTestServer, type TestServerContext } from '../test/helpers/server.js';
import { BabyQuirtTestClient } from '../test/helpers/client.js';

describe('integration: server round-trip', () => {
  let ctx: TestServerContext;
  let client: BabyQuirtTestClient;

  before(async () => {
    ctx = await startTestServer();
    client = new BabyQuirtTestClient({ socketPath: ctx.socketPath, configRoot: ctx.configRoot });
  });

  after(async () => {
    await stopTestServer(ctx);
  });

  it('responds to baby.health', async () => {
    const response = await client.request('baby.health');
    assert.equal(response.operation, 'baby.health');
    const result = response.result as Record<string, unknown>;
    assert.equal(result.status, 'healthy');
    assert.ok(response.receipt);
  });

  it('executes baby.exec', async () => {
    const response = await client.request('baby.exec', {
      argv: ['echo', 'integration-test'],
      cwd: ctx.dir,
    });
    const result = response.result as Record<string, unknown>;
    assert.ok(result.jobId);
    assert.equal(result.operation, 'baby.exec');
  });

  it('handles file operations', async () => {
    const testPath = `${ctx.dir}/integ-file.txt`;
    await client.request('baby.file.write', {
      path: testPath,
      data: Buffer.from('integration').toString('base64'),
      encoding: 'base64',
    });

    const stat = await client.request('baby.file.stat', { path: testPath });
    const statResult = stat.result as Record<string, unknown>;
    assert.equal(statResult.exists, true);
    assert.equal(statResult.type, 'file');
  });

  it('rejects replayed nonce', async () => {
    const nonce = 'fixed-replay-nonce-integration';
    await client.request('baby.health', {}, { nonce });
    await client.expectError('baby.health', {}, 'replay_detected', { nonce });
  });

  it('returns idempotent response on exact retry', async () => {
    const requestId = randomUUID();
    const nonce = randomUUID();
    const timestamp = new Date().toISOString();
    const first = await client.request('baby.health', {}, { requestId, nonce, timestamp });
    const second = await client.request('baby.health', {}, { requestId, nonce, timestamp });
    assert.deepEqual(first.result, second.result);
  });
});
