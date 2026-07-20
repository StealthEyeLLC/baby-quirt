/** Interactive PTY session management. */

import * as pty from 'node-pty';
import { createWriteStream, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RuntimeConfig } from '../config.js';
import type { StateStore, PtySessionRecord } from '../state/store.js';
import { DEFAULTS } from '../config.js';

export interface PtyCreatePayload {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export interface PtyInputPayload {
  sessionId: string;
  data: string;
  encoding?: 'base64' | 'utf8';
}

export interface PtyResizePayload {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface PtyReadPayload {
  sessionId: string;
  offset?: number;
  limit?: number;
}

export interface PtyClosePayload {
  sessionId: string;
  signal?: string;
}

const activePtys = new Map<string, pty.IPty>();

export class PtyManager {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly store: StateStore,
  ) {}

  create(requestId: string, payload: PtyCreatePayload): PtySessionRecord {
    const sessionId = randomUUID();
    const shell = payload.shell ?? process.env.SHELL ?? '/bin/bash';
    const cwd = payload.cwd ?? process.cwd();
    const cols = payload.cols ?? 80;
    const rows = payload.rows ?? 24;
    const outputPath = join(this.store.streamsDir(), `pty-${sessionId}.out`);

    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: payload.env ? { ...process.env, ...payload.env } : process.env,
    });

    const outputStream = createWriteStream(outputPath, { flags: 'a' });
    let outputOffset = 0;

    const session: PtySessionRecord = {
      sessionId,
      jobId: requestId,
      pid: term.pid,
      cols,
      rows,
      createdAt: new Date().toISOString(),
      status: 'active',
      outputPath,
      outputOffset: 0,
    };

    term.onData((data: string) => {
      const buf = Buffer.from(data, 'utf8');
      outputStream.write(buf);
      outputOffset += buf.length;
      session.outputOffset = outputOffset;
      if (outputOffset > this.config.maxOutputBytes) {
        term.kill();
      }
    });

    term.onExit(() => {
      outputStream.end();
      session.status = 'closed';
      this.store.savePtySession(session);
      activePtys.delete(sessionId);
    });

    activePtys.set(sessionId, term);
    this.store.savePtySession(session);
    return session;
  }

  input(payload: PtyInputPayload): { sessionId: string; bytesWritten: number } {
    const session = this.store.getPtySession(payload.sessionId);
    if (!session) throw new Error(`PTY session not found: ${payload.sessionId}`);
    const term = activePtys.get(payload.sessionId);
    if (!term) throw new Error('PTY session is not active');

    const data =
      payload.encoding === 'base64'
        ? Buffer.from(payload.data, 'base64').toString('utf8')
        : payload.data;
    term.write(data);
    return { sessionId: payload.sessionId, bytesWritten: Buffer.byteLength(data) };
  }

  resize(payload: PtyResizePayload): { sessionId: string; cols: number; rows: number } {
    const session = this.store.getPtySession(payload.sessionId);
    if (!session) throw new Error(`PTY session not found: ${payload.sessionId}`);
    const term = activePtys.get(payload.sessionId);
    if (!term) throw new Error('PTY session is not active');

    term.resize(payload.cols, payload.rows);
    session.cols = payload.cols;
    session.rows = payload.rows;
    this.store.savePtySession(session);
    return { sessionId: payload.sessionId, cols: payload.cols, rows: payload.rows };
  }

  read(payload: PtyReadPayload): {
    data: string;
    offset: number;
    eof: boolean;
    encoding: string;
  } {
    const session = this.store.getPtySession(payload.sessionId);
    if (!session) throw new Error(`PTY session not found: ${payload.sessionId}`);

    const offset = payload.offset ?? 0;
    const limit = Math.min(payload.limit ?? DEFAULTS.streamChunkSize, DEFAULTS.streamChunkSize);

    const fd = openSync(session.outputPath, 'r');
    try {
      const stat = fstatSync(fd);
      const available = Math.max(0, stat.size - offset);
      const toRead = Math.min(limit, available);
      const buf = Buffer.alloc(toRead);
      if (toRead > 0) {
        readSync(fd, buf, 0, toRead, offset);
      }
      const eof = session.status === 'closed' && offset + toRead >= stat.size;
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

  close(payload: PtyClosePayload): PtySessionRecord {
    const session = this.store.getPtySession(payload.sessionId);
    if (!session) throw new Error(`PTY session not found: ${payload.sessionId}`);
    const term = activePtys.get(payload.sessionId);
    if (term) {
      term.kill(payload.signal ?? 'SIGHUP');
      activePtys.delete(payload.sessionId);
    }
    session.status = 'closed';
    this.store.savePtySession(session);
    return session;
  }

  recoverSessions(): number {
    const sessions = this.store.listPtySessions().filter((s: PtySessionRecord) => s.status === 'active');
    let recovered = 0;
    for (const session of sessions) {
      try {
        process.kill(session.pid, 0);
        recovered++;
      } catch {
        session.status = 'closed';
        this.store.savePtySession(session);
      }
    }
    return recovered;
  }
}
