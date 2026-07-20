import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { loadRuntimeConfig } from '../src/config.js';
import { BabyQuirtServer } from '../src/server.js';
import {
  generateEd25519KeyPair,
  loadPrivateKey,
  signEd25519,
} from '../src/crypto/signing.js';
import { buildSigningDocument } from '../src/crypto/canonical.js';
import { PROTOCOL_VERSION, DEFAULTS } from '../src/config.js';
import {
  FrameType,
  encodeFrame,
  encodeJsonPayload,
  decodeJsonPayload,
  feedFrames,
  createFrameReader,
  type HelloPayload,
  type RequestPayload,
  type ResponsePayload,
} from '../src/protocol/frame.js';

describe('integration: server round-trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bq-integ-'));
  const socketPath = join(dir, 'test.sock');
  const configRoot = join(dir, 'config');
  const stateRoot = join(dir, 'state');

  const config = loadRuntimeConfig({
    socketPath,
    stateRoot,
    configRoot,
    expectedMachineIdSha256: 'test',
    expectedHostname: hostname(),
  });

  const publicKeyPath = join(configRoot, 'signing-public.pem');
  const privateKeyPath = join(configRoot, 'signing-private.pem');
  generateEd25519KeyPair({ publicKeyPath, privateKeyPath, keyId: 'test' });

  let server: BabyQuirtServer;

  before(async () => {
    server = new BabyQuirtServer(config);
    await server.start();
  });

  after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  async function sendOperation(operation: string, payload: unknown = {}): Promise<ResponsePayload> {
    const privateKey = loadPrivateKey(privateKeyPath);
    const requestId = randomUUID();
    const timestamp = new Date().toISOString();
    const nonce = randomUUID();

    const principal = {
      subject: DEFAULTS.expectedSubject,
      authorityClass: DEFAULTS.authorityClass,
      issuer: DEFAULTS.oauthIssuer,
    };

    const authorityBase = {
      algorithm: 'ed25519' as const,
      gatewayId: DEFAULTS.gatewayId,
      nonce,
    };

    const signingDoc = buildSigningDocument({
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      operation,
      principal,
      authority: authorityBase,
      targetHost: hostname(),
      timestamp,
      payload,
      binaryLength: 0,
    });

    const authority = {
      ...authorityBase,
      signature: signEd25519(signingDoc, privateKey),
      keyId: 'test',
    };

    const request: RequestPayload = {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      operation,
      principal,
      authority,
      targetHost: hostname(),
      timestamp,
      payload,
      binaryLength: 0,
    };

    return new Promise((resolve, reject) => {
      const socket = connect(socketPath);
      const reader = createFrameReader();
      let handshaken = false;

      socket.on('connect', () => {
        const hello: HelloPayload = {
          clientId: 'test-client',
          supportedFeatures: ['compression.none'],
          supportedAlgorithms: ['ed25519'],
        };
        socket.write(encodeFrame(FrameType.Hello, encodeJsonPayload(hello)));
      });

      socket.on('data', (chunk) => {
        const frames = feedFrames(reader, chunk, 16 * 1024 * 1024);
        for (const frame of frames) {
          if (!handshaken && frame.header.frameType === FrameType.Welcome) {
            handshaken = true;
            socket.write(encodeFrame(FrameType.Request, encodeJsonPayload(request), requestId));
            continue;
          }
          if (frame.header.frameType === FrameType.Response) {
            socket.end();
            resolve(decodeJsonPayload<ResponsePayload>(frame.payload));
            return;
          }
          if (frame.header.frameType === FrameType.Error) {
            const error = decodeJsonPayload<{ code: string; message: string }>(frame.payload);
            socket.end();
            reject(new Error(`${error.code}: ${error.message}`));
            return;
          }
        }
      });

      socket.on('error', reject);
      setTimeout(() => {
        socket.destroy();
        reject(new Error('timeout'));
      }, 15_000);
    });
  }

  it('responds to baby.health', async () => {
    const response = await sendOperation('baby.health');
    assert.equal(response.operation, 'baby.health');
    const result = response.result as Record<string, unknown>;
    assert.equal(result.status, 'healthy');
    assert.ok(response.receipt);
  });

  it('executes baby.exec', async () => {
    const response = await sendOperation('baby.exec', {
      argv: ['echo', 'integration-test'],
      cwd: dir,
    });
    const result = response.result as Record<string, unknown>;
    assert.ok(result.jobId);
    assert.equal(result.operation, 'baby.exec');
  });

  it('handles file operations', async () => {
    const testPath = join(dir, 'integ-file.txt');
    await sendOperation('baby.file.write', {
      path: testPath,
      data: Buffer.from('integration').toString('base64'),
      encoding: 'base64',
    });

    const stat = await sendOperation('baby.file.stat', { path: testPath });
    const statResult = stat.result as Record<string, unknown>;
    assert.equal(statResult.exists, true);
    assert.equal(statResult.type, 'file');
  });

  it('rejects replayed nonce', async () => {
    const privateKey = loadPrivateKey(privateKeyPath);
    const requestId = randomUUID();
    const timestamp = new Date().toISOString();
    const nonce = 'fixed-replay-nonce-test';

    const principal = {
      subject: DEFAULTS.expectedSubject,
      authorityClass: DEFAULTS.authorityClass,
      issuer: DEFAULTS.oauthIssuer,
    };

    const authorityBase = {
      algorithm: 'ed25519' as const,
      gatewayId: DEFAULTS.gatewayId,
      nonce,
    };

    const signingDoc = buildSigningDocument({
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      operation: 'baby.health',
      principal,
      authority: authorityBase,
      targetHost: hostname(),
      timestamp,
      payload: {},
      binaryLength: 0,
    });

    const authority = {
      ...authorityBase,
      signature: signEd25519(signingDoc, privateKey),
      keyId: 'test',
    };

    const request: RequestPayload = {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      operation: 'baby.health',
      principal,
      authority,
      targetHost: hostname(),
      timestamp,
      payload: {},
      binaryLength: 0,
    };

    // First request should succeed
    await new Promise<void>((resolve, reject) => {
      const socket = connect(socketPath);
      const reader = createFrameReader();
      let handshaken = false;
      socket.on('connect', () => {
        socket.write(
          encodeFrame(
            FrameType.Hello,
            encodeJsonPayload({
              clientId: 'replay-test',
              supportedFeatures: ['compression.none'],
              supportedAlgorithms: ['ed25519'],
            }),
          ),
        );
      });
      socket.on('data', (chunk) => {
        const frames = feedFrames(reader, chunk, 16 * 1024 * 1024);
        for (const frame of frames) {
          if (!handshaken && frame.header.frameType === FrameType.Welcome) {
            handshaken = true;
            socket.write(encodeFrame(FrameType.Request, encodeJsonPayload(request), requestId));
          }
          if (frame.header.frameType === FrameType.Response) {
            socket.end();
            resolve();
          }
          if (frame.header.frameType === FrameType.Error) {
            socket.end();
            reject(new Error('unexpected error on first request'));
          }
        }
      });
      socket.on('error', reject);
    });

    // Second request with same nonce should fail
    await new Promise<void>((resolve, reject) => {
      const socket = connect(socketPath);
      const reader = createFrameReader();
      let handshaken = false;
      socket.on('connect', () => {
        socket.write(
          encodeFrame(
            FrameType.Hello,
            encodeJsonPayload({
              clientId: 'replay-test-2',
              supportedFeatures: ['compression.none'],
              supportedAlgorithms: ['ed25519'],
            }),
          ),
        );
      });
      socket.on('data', (chunk) => {
        const frames = feedFrames(reader, chunk, 16 * 1024 * 1024);
        for (const frame of frames) {
          if (!handshaken && frame.header.frameType === FrameType.Welcome) {
            handshaken = true;
            socket.write(encodeFrame(FrameType.Request, encodeJsonPayload(request), requestId));
          }
          if (frame.header.frameType === FrameType.Error) {
            const error = decodeJsonPayload<{ code: string }>(frame.payload);
            assert.equal(error.code, 'replay_detected');
            socket.end();
            resolve();
          }
        }
      });
      socket.on('error', reject);
      setTimeout(() => reject(new Error('expected replay error')), 10_000);
    });
  });
});
