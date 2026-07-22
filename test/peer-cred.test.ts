import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getSocketPeerCred } from '../src/net/peer-cred.js';

describe('peer-cred native addon', () => {
  it('returns peer UID over a live unix socket', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'bq-peercred-'));
    const socketPath = join(dir, 'peer.sock');
    const server = createServer({ path: socketPath });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
      });
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('sandbox does not permit Unix-socket creation; host rehearsal remains mandatory');
        return;
      }
      throw error;
    }

    const credPromise = new Promise<ReturnType<typeof getSocketPeerCred>>((resolve) => {
      server.once('connection', (socket) => {
        resolve(getSocketPeerCred(socket));
        socket.end();
      });
    });

    const client = connect(socketPath);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('error', reject);
    });

    const cred = await credPromise;
    client.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });

    assert.ok(cred, 'peer credentials should be available on Linux unix sockets');
    assert.equal(typeof cred!.uid, 'number');
    assert.equal(cred!.uid, process.getuid?.() ?? cred!.uid);
  });
});
