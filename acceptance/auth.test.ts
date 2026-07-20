import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer, stopTestServer, type TestServerContext } from '../test/helpers/server.js';
import { BabyQuirtTestClient } from '../test/helpers/client.js';
import { buildOwnerPrincipal } from '../src/auth/principal.js';
import { ReplayStore } from '../src/state/replay-store.js';
import { loadRuntimeConfig } from '../src/config.js';

describe('acceptance: auth adversarial', () => {
  let ctx: TestServerContext;
  let client: BabyQuirtTestClient;

  before(async () => {
    ctx = await startTestServer();
    client = new BabyQuirtTestClient({ socketPath: ctx.socketPath, configRoot: ctx.configRoot });
  });

  after(async () => {
    await stopTestServer(ctx);
  });

  it('rejects invalid subject', async () => {
    await client.expectError('baby.health', {}, 'invalid_subject', {
      principal: buildOwnerPrincipal({ subject: 'wrong-subject' }),
    });
  });

  it('rejects invalid issuer', async () => {
    await client.expectError('baby.health', {}, 'invalid_issuer', {
      principal: buildOwnerPrincipal({ issuer: 'https://evil.example' }),
    });
  });

  it('rejects non-null workspace authority', async () => {
    await client.expectError('baby.health', {}, 'invalid_workspace_authority', {
      principal: { ...buildOwnerPrincipal(), workspaceAuthority: 'workspace' as never },
    });
  });

  it('rejects expired timestamp', async () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await client.expectError('baby.health', {}, 'request_expired', { timestamp: old });
  });

  it('rejects replayed nonce after successful request', async () => {
    const nonce = randomUUID();
    await client.request('baby.health', {}, { nonce });
    await client.expectError('baby.health', {}, 'replay_detected', { nonce });
  });

  it('returns cached idempotent response for exact retry', async () => {
    const requestId = randomUUID();
    const nonce = randomUUID();
    const timestamp = new Date().toISOString();
    const first = await client.request('baby.health', {}, { requestId, nonce, timestamp });
    const second = await client.request('baby.health', {}, { requestId, nonce, timestamp });
    assert.equal(first.requestId, second.requestId);
    assert.deepEqual(first.result, second.result);
  });
});

describe('acceptance: replay store ordering', () => {
  it('checks idempotency before nonce commit', () => {
    const store = new ReplayStore(loadRuntimeConfig({ stateRoot: '/tmp/bq-replay-order', expectedMachineIdSha256: 'test' }));
    const hash = 'semantic-hash-1';
    store.storeIdempotentResponse(hash, { ok: true });
    assert.equal(store.getIdempotentResponse(hash)?.ok, true);
    assert.ok(store.tryCommitNonce('fresh-nonce'));
    assert.ok(!store.tryCommitNonce('fresh-nonce'));
  });
});
