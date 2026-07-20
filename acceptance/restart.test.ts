import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, type TestServerContext } from '../test/helpers/server.js';
import { BabyQuirtTestClient } from '../test/helpers/client.js';
import { BabyQuirtServer } from '../src/server.js';
import { loadRuntimeConfig } from '../src/config.js';

describe('acceptance: restart recovery', () => {
  let ctx: TestServerContext;
  let client: BabyQuirtTestClient;

  before(async () => {
    ctx = await startTestServer();
    client = new BabyQuirtTestClient({ socketPath: ctx.socketPath, configRoot: ctx.configRoot });
  });

  after(async () => {
    await stopTestServer(ctx);
  });

  it('recovers health after server restart with same state', async () => {
    await client.request('baby.exec', {
      argv: ['echo', 'before-restart'],
      cwd: ctx.dir,
    });

    await ctx.server.stop();

    const config = loadRuntimeConfig({
      socketPath: ctx.socketPath,
      stateRoot: ctx.stateRoot,
      configRoot: ctx.configRoot,
      expectedMachineIdSha256: 'test',
      signingKeyId: 'test',
    });
    const server2 = new BabyQuirtServer(config);
    await server2.start();
    ctx.server = server2;

    const health = await client.request('baby.health');
    const result = health.result as { status: string };
    assert.equal(result.status, 'healthy');

    const jobs = await client.request('baby.job.list', { limit: 10 });
    const list = jobs.result as unknown[];
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 1);
  });
});
