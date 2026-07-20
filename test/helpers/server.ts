/** Shared test server lifecycle. */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostname } from 'node:os';
import { loadRuntimeConfig } from '../../src/config.js';
import { BabyQuirtServer } from '../../src/server.js';
import { generateEd25519KeyPair } from '../../src/crypto/signing.js';
import { setupTestEnv } from './client.js';

export interface TestServerContext {
  dir: string;
  socketPath: string;
  configRoot: string;
  stateRoot: string;
  server: BabyQuirtServer;
}

export async function startTestServer(
  overrides: Parameters<typeof loadRuntimeConfig>[0] = {},
): Promise<TestServerContext> {
  setupTestEnv();
  const dir = mkdtempSync(join(tmpdir(), 'bq-test-'));
  const socketPath = join(dir, 'test.sock');
  const configRoot = join(dir, 'config');
  const stateRoot = join(dir, 'state');

  generateEd25519KeyPair({
    publicKeyPath: join(configRoot, 'signing-public.pem'),
    privateKeyPath: join(configRoot, 'signing-private.pem'),
    keyId: 'test',
  });

  const config = loadRuntimeConfig({
    socketPath,
    stateRoot,
    configRoot,
    expectedMachineIdSha256: 'test',
    expectedHostname: hostname(),
    signingKeyId: 'test',
    ...overrides,
  });

  const server = new BabyQuirtServer(config);
  await server.start();

  return { dir, socketPath, configRoot, stateRoot, server };
}

export async function stopTestServer(ctx: TestServerContext): Promise<void> {
  await ctx.server.stop();
  rmSync(ctx.dir, { recursive: true, force: true });
}
