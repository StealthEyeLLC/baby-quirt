/** Process and job execution engine. */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  openSync,
  readSync,
  closeSync,
  fstatSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { RuntimeConfig } from '../config.js';
import type { StateStore, JobRecord } from '../state/store.js';
import { DEFAULTS } from '../config.js';

export interface ExecPayload {
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  detached?: boolean;
}

export interface ShellPayload {
  shell?: string;
  command?: string;
  script?: string;
  cwd?: string;
  env?: Record<string, string>;
  detached?: boolean;
}

export interface JobWaitPayload {
  jobId: string;
  timeoutMs?: number;
}

export interface JobCancelPayload {
  jobId: string;
  signal?: string;
}

export interface JobStreamReadPayload {
  jobId: string;
  stream: 'stdout' | 'stderr';
  offset?: number;
  limit?: number;
}

export interface JobListPayload {
  status?: string;
  limit?: number;
}

const runningProcesses = new Map<string, ChildProcess>();

export class JobManager {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly store: StateStore,
  ) {}

  exec(requestId: string, payload: ExecPayload): JobRecord {
    if (!payload.argv || payload.argv.length === 0) {
      throw new Error('argv must be a non-empty array');
    }
    const cwd = payload.cwd ?? process.cwd();
    const job = this.store.createJob({
      requestId,
      operation: 'baby.exec',
      status: 'pending',
      cwd,
      argv: [...payload.argv],
      env: payload.env,
      detached: payload.detached ?? false,
    });

    this.startProcess(job, payload.argv, cwd, payload.env, payload.detached ?? false);
    return this.store.getJob(job.jobId)!;
  }

  shell(requestId: string, payload: ShellPayload): JobRecord {
    const cwd = payload.cwd ?? process.cwd();
    let argv: string[];
    if (payload.script) {
      const shellBin = payload.shell ?? '/bin/sh';
      argv = [shellBin, '-c', payload.script];
    } else if (payload.command) {
      const shellBin = payload.shell ?? '/bin/sh';
      argv = [shellBin, '-c', payload.command];
    } else {
      throw new Error('Either command or script is required');
    }

    const job = this.store.createJob({
      requestId,
      operation: 'baby.shell',
      status: 'pending',
      cwd,
      argv,
      shell: payload.shell,
      script: payload.script ?? payload.command,
      env: payload.env,
      detached: payload.detached ?? false,
    });

    this.startProcess(job, argv, cwd, payload.env, payload.detached ?? false);
    return this.store.getJob(job.jobId)!;
  }

  private startProcess(
    job: JobRecord,
    argv: string[],
    cwd: string,
    env?: Record<string, string>,
    detached = false,
  ): void {
    const stdoutStream = createWriteStream(job.streams.stdoutPath, { flags: 'a' });
    const stderrStream = createWriteStream(job.streams.stderrPath, { flags: 'a' });

    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      detached,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    job.status = detached ? 'detached' : 'running';
    job.pid = child.pid;
    job.startedAt = new Date().toISOString();
    this.store.saveJob(job);
    runningProcesses.set(job.jobId, child);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutStream.write(chunk);
      job.streams.stdoutOffset += chunk.length;
      if (job.streams.stdoutOffset > this.config.maxOutputBytes) {
        child.kill('SIGTERM');
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrStream.write(chunk);
      job.streams.stderrOffset += chunk.length;
      if (job.streams.stderrOffset > this.config.maxOutputBytes) {
        child.kill('SIGTERM');
      }
    });

    const finalize = (status: JobRecord['status'], exitCode?: number | null, signal?: string | null) => {
      stdoutStream.end();
      stderrStream.end();
      job.status = status;
      job.exitCode = exitCode ?? null;
      job.signal = signal ?? null;
      job.completedAt = new Date().toISOString();
      job.streams.stdoutClosed = true;
      job.streams.stderrClosed = true;
      this.store.saveJob(job);
      runningProcesses.delete(job.jobId);
    };

    child.on('error', (err) => {
      finalize('failed');
      stderrStream.write(Buffer.from(`Process error: ${err.message}\n`));
    });

    child.on('close', (code, signal) => {
      const status = code === 0 ? 'completed' : 'failed';
      finalize(status, code, signal);
    });

    if (detached) {
      child.unref();
    }
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.store.getJob(jobId);
  }

  listJobs(payload: JobListPayload = {}): JobRecord[] {
    let jobs = this.store.listJobs();
    if (payload.status) {
      jobs = jobs.filter((j: JobRecord) => j.status === payload.status);
    }
    const limit = payload.limit ?? 100;
    return jobs.slice(0, limit);
  }

  async waitForJob(payload: JobWaitPayload): Promise<JobRecord> {
    const job = this.store.getJob(payload.jobId);
    if (!job) throw new Error(`Job not found: ${payload.jobId}`);

    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      return job;
    }

    const timeout = payload.timeoutMs ?? 300_000;
    const start = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        const current = this.store.getJob(payload.jobId);
        if (!current) {
          reject(new Error('Job disappeared'));
          return;
        }
        if (['completed', 'failed', 'cancelled', 'detached'].includes(current.status)) {
          if (current.status === 'detached') {
            resolve(current);
            return;
          }
          if (['completed', 'failed', 'cancelled'].includes(current.status)) {
            resolve(current);
            return;
          }
        }
        if (Date.now() - start > timeout) {
          reject(new Error('Job wait timeout'));
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  cancelJob(payload: JobCancelPayload): JobRecord {
    const job = this.store.getJob(payload.jobId);
    if (!job) throw new Error(`Job not found: ${payload.jobId}`);

    const signal = payload.signal ?? 'SIGTERM';
    const child = runningProcesses.get(payload.jobId);
    if (child?.pid) {
      try {
        process.kill(-child.pid, signal as NodeJS.Signals);
      } catch {
        try {
          child.kill(signal as NodeJS.Signals);
        } catch {
          // process may have exited
        }
      }
    }

    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    this.store.saveJob(job);
    return job;
  }

  readStream(payload: JobStreamReadPayload): {
    data: string;
    offset: number;
    eof: boolean;
    encoding: string;
  } {
    const job = this.store.getJob(payload.jobId);
    if (!job) throw new Error(`Job not found: ${payload.jobId}`);

    const path =
      payload.stream === 'stderr' ? job.streams.stderrPath : job.streams.stdoutPath;
    if (!existsSync(path)) {
      return { data: '', offset: payload.offset ?? 0, eof: true, encoding: 'base64' };
    }

    const offset = payload.offset ?? 0;
    const limit = Math.min(payload.limit ?? DEFAULTS.streamChunkSize, DEFAULTS.streamChunkSize);

    const fd = openSync(path, 'r');
    try {
      const stat = fstatSync(fd);
      const available = Math.max(0, stat.size - offset);
      const toRead = Math.min(limit, available);
      const buf = Buffer.alloc(toRead);
      if (toRead > 0) {
        readSync(fd, buf, 0, toRead, offset);
      }
      const closed =
        payload.stream === 'stderr' ? job.streams.stderrClosed : job.streams.stdoutClosed;
      const eof = closed && offset + toRead >= stat.size;
      return {
        data: buf.toString('base64'),
        offset: offset + toRead,
        eof,
        encoding: 'base64',
      };
    } finally {
      closeSync(fd);
    }
  }

  recoverRunningJobs(): number {
    const jobs = this.store.listJobs().filter((j: JobRecord) => j.status === 'running');
    let recovered = 0;
    for (const job of jobs) {
      if (job.pid) {
        try {
          process.kill(job.pid, 0);
          recovered++;
        } catch {
          job.status = 'failed';
          job.completedAt = new Date().toISOString();
          this.store.saveJob(job);
        }
      } else {
        job.status = 'failed';
        job.completedAt = new Date().toISOString();
        this.store.saveJob(job);
      }
    }
    return recovered;
  }
}

export function generateJobId(): string {
  return randomUUID();
}
