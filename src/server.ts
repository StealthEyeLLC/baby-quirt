/** Unix socket server and connection handler. */

import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, unlinkSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RuntimeConfig } from './config.js';
import { ReplayStore } from './state/replay-store.js';
import { StateStore } from './state/store.js';
import { Authenticator, AuthError } from './auth/authenticator.js';
import { OperationRegistry } from './operations/registry.js';
import {
  FrameType,
  encodeFrame,
  encodeJsonPayload,
  decodeJsonPayload,
  feedFrames,
  createFrameReader,
  type HelloPayload,
  type WelcomePayload,
  type RequestPayload,
  type ErrorPayload,
  ProtocolError,
} from './protocol/frame.js';
import { getHostname, getMachineIdSha256, PROTOCOL_VERSION } from './config.js';
import { redactSecrets } from './crypto/canonical.js';

export class BabyQuirtServer {
  private server?: Server;
  private readonly replayStore: ReplayStore;
  private readonly stateStore: StateStore;
  private readonly authenticator: Authenticator;
  private readonly registry: OperationRegistry;
  private negotiatedAlgorithm = 'ed25519';

  constructor(private readonly config: RuntimeConfig) {
    this.replayStore = new ReplayStore(config);
    this.stateStore = new StateStore(config);
    this.authenticator = new Authenticator(config, this.replayStore);
    this.registry = new OperationRegistry(config, this.stateStore, this.replayStore);
  }

  async start(): Promise<void> {
    const recovery = this.registry.recover();
    console.log(
      `[baby-quirt] recovered ${recovery.jobs} jobs, ${recovery.ptySessions} pty sessions`,
    );

    const socketDir = dirname(this.config.socketPath);
    mkdirSync(socketDir, { recursive: true, mode: 0o750 });

    if (existsSync(this.config.socketPath)) {
      unlinkSync(this.config.socketPath);
    }

    this.server = createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.socketPath, () => {
        try {
          chmodSync(this.config.socketPath, this.config.socketMode);
        } catch {
          // may fail in test environments
        }
        console.log(`[baby-quirt] listening on ${this.config.socketPath}`);
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    this.replayStore.persist();
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
    if (existsSync(this.config.socketPath)) {
      unlinkSync(this.config.socketPath);
    }
  }

  private handleConnection(socket: Socket): void {
    const reader = createFrameReader();
    let handshaken = false;

    socket.on('data', async (chunk) => {
      try {
        const frames = feedFrames(reader, chunk, this.config.maxFrameSize);
        for (const frame of frames) {
          if (!handshaken) {
            if (frame.header.frameType !== FrameType.Hello) {
              this.sendError(socket, frame.header.requestId, 'handshake_required', 'Hello required');
              socket.destroy();
              return;
            }
            const hello = decodeJsonPayload<HelloPayload>(frame.payload);
            this.negotiatedAlgorithm = hello.supportedAlgorithms.includes('ed25519')
              ? 'ed25519'
              : 'hmac-sha256';
            const welcome: WelcomePayload = {
              serverId: this.config.supervisorId,
              protocolVersion: PROTOCOL_VERSION,
              selectedFeatures: ['compression.none'],
              selectedAlgorithm: this.negotiatedAlgorithm,
              machineIdSha256: getMachineIdSha256() || 'unknown',
              hostname: getHostname(),
            };
            socket.write(
              encodeFrame(FrameType.Welcome, encodeJsonPayload(welcome), frame.header.requestId),
            );
            handshaken = true;
            continue;
          }

          switch (frame.header.frameType) {
            case FrameType.Request:
              await this.handleRequest(socket, frame.payload);
              break;
            case FrameType.Ping:
              socket.write(encodeFrame(FrameType.Pong, Buffer.alloc(0), frame.header.requestId));
              break;
            case FrameType.Cancel:
              // cancellation handled at job level via baby.job.cancel
              break;
            default:
              this.sendError(
                socket,
                frame.header.requestId,
                'unsupported_frame',
                `Unsupported frame type: ${frame.header.frameType}`,
              );
          }
        }
      } catch (err) {
        const code = err instanceof ProtocolError ? err.code : 'protocol_error';
        const message = err instanceof Error ? err.message : 'Unknown protocol error';
        this.sendError(socket, '00000000-0000-0000-0000-000000000000', code, message);
        socket.destroy();
      }
    });

    socket.on('error', (err: Error) => {
      console.error('[baby-quirt] socket error:', redactSecrets(err.message));
    });
  }

  private async handleRequest(socket: Socket, payloadBuf: Buffer): Promise<void> {
    let request: RequestPayload;
    try {
      request = decodeJsonPayload<RequestPayload>(payloadBuf);
    } catch {
      this.sendError(socket, '00000000-0000-0000-0000-000000000000', 'invalid_request', 'Invalid JSON request');
      return;
    }

    try {
      const peerUid = await this.getPeerUid(socket);
      const auth = this.authenticator.authenticate(request, peerUid);
      const { response } = await this.registry.dispatch(auth);
      socket.write(
        encodeFrame(FrameType.Response, encodeJsonPayload(response), request.requestId),
      );
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        if (err.code === 'idempotent_replay') {
          try {
            const cached = JSON.parse(err.message);
            socket.write(
              encodeFrame(FrameType.Response, encodeJsonPayload(cached), request.requestId),
            );
            return;
          } catch {
            // fall through
          }
        }
        this.sendError(socket, request.requestId, err.code, err.message, false);
        return;
      }
      const message = err instanceof Error ? err.message : 'Operation failed';
      this.sendError(socket, request.requestId, 'operation_failed', message, true);
    }
  }

  private sendError(
    socket: Socket,
    requestId: string,
    code: string,
    message: string,
    retryable = false,
  ): void {
    const error: ErrorPayload = { requestId, code, message, retryable };
    socket.write(encodeFrame(FrameType.Error, encodeJsonPayload(error), requestId));
  }

  private getPeerUid(_socket: Socket): Promise<number | undefined> {
    // SO_PEERCRED is not directly exposed in Node.js net.Socket;
    // peer credential binding is enforced via socket group permissions.
    return Promise.resolve(undefined);
  }
}
