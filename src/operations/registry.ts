/** Operation registry and dispatch. */

import type { RuntimeConfig } from '../config.js';
import type { AuthenticatedRequest } from '../auth/authenticator.js';
import { AuthError } from '../auth/authenticator.js';
import type { ReplayStore } from '../state/replay-store.js';
import type { StateStore } from '../state/store.js';
import { JobManager } from '../jobs/manager.js';
import { FileManager } from '../files/manager.js';
import { PtyManager } from '../pty/manager.js';
import { ArtifactManager } from '../artifacts/manager.js';
import { signReceipt, resultDigest } from '../receipts/receipt.js';
import { existsSync } from 'node:fs';
import { loadPrivateKey as loadPrivKey } from '../crypto/signing.js';
import { getHostname, getMachineIdSha256, PROTOCOL_VERSION } from '../config.js';
import type { ResponsePayload } from '../protocol/frame.js';

export interface OperationResult {
  response: ResponsePayload;
  cached?: boolean;
}

export class OperationRegistry {
  private readonly jobs: JobManager;
  private readonly files: FileManager;
  private readonly pty: PtyManager;
  private readonly artifacts: ArtifactManager;
  private privateKey?: ReturnType<typeof loadPrivKey>;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly store: StateStore,
    private readonly replayStore: ReplayStore,
  ) {
    this.jobs = new JobManager(config, store);
    this.files = new FileManager();
    this.pty = new PtyManager(store);
    this.artifacts = new ArtifactManager(store);

    if (existsSync(config.supervisorReceiptPrivateKeyPath)) {
      this.privateKey = loadPrivKey(config.supervisorReceiptPrivateKeyPath);
    }
  }

  recover(): { jobs: number; detached: number; ptySessions: number } {
    return {
      jobs: this.jobs.recoverRunningJobs(),
      detached: this.jobs.recoverDetachedJobs(),
      ptySessions: this.pty.recoverSessions(),
    };
  }

  async dispatch(auth: AuthenticatedRequest): Promise<OperationResult> {
    const { payload, hash } = auth;
    const operation = payload.operation;
    const body = payload.payload as Record<string, unknown>;

    try {
      const result = await this.executeOperation(operation, payload.requestId, body);
      const response: ResponsePayload = {
        requestId: payload.requestId,
        operation,
        result,
      };

      if (this.privateKey) {
        response.receipt = signReceipt(
          {
            requestId: payload.requestId,
            operation,
            subject: auth.subject,
            authorityClass: auth.authorityClass,
            resultDigest: resultDigest(result),
            timestamp: new Date().toISOString(),
            machineIdSha256: getMachineIdSha256() || 'unknown',
            hostname: getHostname(),
          },
          this.privateKey,
          this.config.supervisorReceiptKeyId,
        ) as unknown as Record<string, unknown>;
      }

      this.replayStore.storeIdempotentResponse(hash, response);
      this.replayStore.persist();
      this.store.pruneJobs(this.config.maxRetentionJobs);

      return { response };
    } catch (err) {
      if (err instanceof AuthError && err.code === 'idempotent_replay') {
        const cached = JSON.parse(err.message) as ResponsePayload;
        return { response: cached, cached: true };
      }
      throw err;
    }
  }

  private async executeOperation(
    operation: string,
    requestId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    switch (operation) {
      case 'baby.health':
        return this.health();
      case 'baby.exec':
        return await this.jobs.exec(requestId, body as never);
      case 'baby.shell':
        return await this.jobs.shell(requestId, body as never);
      case 'baby.job.get':
        return this.jobs.getJob(String(body.jobId));
      case 'baby.job.list':
        return this.jobs.listJobs(body as never);
      case 'baby.job.wait':
        return this.jobs.waitForJob(body as never);
      case 'baby.job.cancel':
        return this.jobs.cancelJob(body as never);
      case 'baby.job.stream.read':
        return this.jobs.readStream(body as never);
      case 'baby.file.stat':
        return this.files.stat(body as never);
      case 'baby.file.read':
        return this.files.read(body as never);
      case 'baby.file.write':
        return this.files.write(body as never);
      case 'baby.file.patch':
        return this.files.patch(body as never);
      case 'baby.file.copy':
        return this.files.copy(body as never);
      case 'baby.file.move':
        return this.files.move(body as never);
      case 'baby.file.remove':
        return this.files.remove(body as never);
      case 'baby.file.list':
        return this.files.list(body as never);
      case 'baby.pty.create':
        return this.pty.create(requestId, body as never);
      case 'baby.pty.input':
        return this.pty.input(body as never);
      case 'baby.pty.resize':
        return this.pty.resize(body as never);
      case 'baby.pty.read':
        return this.pty.read(body as never);
      case 'baby.pty.close':
        return this.pty.close(body as never);
      case 'baby.artifact.create':
        return this.artifacts.createFromFile(body as never);
      case 'baby.artifact.upload':
        return this.artifacts.uploadChunk(body as never);
      case 'baby.artifact.download':
        return this.artifacts.download(body as never);
      case 'baby.artifact.list':
        return this.artifacts.list();
      case 'baby.artifact.get':
        return this.artifacts.get(String(body.artifactId));
      default:
        return {
          error: {
            code: 'unknown_operation',
            message: `Unknown operation: ${operation}`,
            retryable: false,
          },
        };
    }
  }

  private health(): Record<string, unknown> {
    return {
      status: 'healthy',
      product: 'baby-quirt',
      protocolVersion: PROTOCOL_VERSION,
      supervisorId: this.config.supervisorId,
      hostname: getHostname(),
      machineIdSha256: getMachineIdSha256() || 'unknown',
      uptime: process.uptime(),
      jobs: this.store.listJobs().length,
      timestamp: new Date().toISOString(),
    };
  }
}

export const OPERATIONS = [
  'baby.health',
  'baby.exec',
  'baby.shell',
  'baby.job.get',
  'baby.job.list',
  'baby.job.wait',
  'baby.job.cancel',
  'baby.job.stream.read',
  'baby.file.stat',
  'baby.file.read',
  'baby.file.write',
  'baby.file.patch',
  'baby.file.copy',
  'baby.file.move',
  'baby.file.remove',
  'baby.file.list',
  'baby.pty.create',
  'baby.pty.input',
  'baby.pty.resize',
  'baby.pty.read',
  'baby.pty.close',
  'baby.artifact.create',
  'baby.artifact.upload',
  'baby.artifact.download',
  'baby.artifact.list',
  'baby.artifact.get',
] as const;
