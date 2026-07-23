import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore, type JobRecord, type PtySessionRecord } from '../src/state/store.js';
import { loadRuntimeConfig } from '../src/config.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bq-state-store-'));
  const config = loadRuntimeConfig({
    stateRoot: root,
    socketPath: join(root, 'baby.sock'),
  });
  return { root, store: new StateStore(config) };
}

describe('atomic state records', () => {
  it('atomically creates and replaces job and PTY JSON without temporary residue', () => {
    const { root, store } = fixture();
    try {
      const job = store.createJob({
        requestId: 'request-1',
        operation: 'baby.exec',
        status: 'pending',
        cwd: root,
        argv: ['true'],
        detached: false,
      });
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      store.saveJob(job);
      const persistedJob = JSON.parse(readFileSync(join(root, 'jobs', `${job.jobId}.json`), 'utf8')) as JobRecord;
      assert.equal(persistedJob.status, 'completed');

      const session: PtySessionRecord = {
        sessionId: 'session-1',
        jobId: job.jobId,
        pid: process.pid,
        cols: 80,
        rows: 24,
        createdAt: new Date().toISOString(),
        status: 'active',
        outputPath: join(root, 'streams', 'pty.log'),
        outputOffset: 0,
      };
      store.savePtySession(session);
      session.status = 'closed';
      store.savePtySession(session);
      const persistedSession = JSON.parse(readFileSync(join(root, 'pty', 'session-1.json'), 'utf8')) as PtySessionRecord;
      assert.equal(persistedSession.status, 'closed');

      assert.deepEqual(readdirSync(join(root, 'jobs')).filter((name) => name.includes('.tmp-')), []);
      assert.deepEqual(readdirSync(join(root, 'pty')).filter((name) => name.includes('.tmp-')), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
