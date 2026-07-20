import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestServer, stopTestServer, type TestServerContext } from '../test/helpers/server.js';
import { BabyQuirtTestClient } from '../test/helpers/client.js';
import { FileManager } from '../src/files/manager.js';

describe('acceptance: hostile filesystem', () => {
  const fm = new FileManager();
  const dir = mkdtempSync(join(tmpdir(), 'bq-hostile-'));

  before(() => {
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(join(dir, 'file.txt'), 'data');
    symlinkSync(join(dir, 'file.txt'), join(dir, 'link.txt'));
    symlinkSync(dir, join(dir, 'loop'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects symlinks with lstat', () => {
    const stat = fm.stat({ path: join(dir, 'link.txt') });
    assert.equal(stat.type, 'symlink');
  });

  it('does not recurse through symlinks', () => {
    const list = fm.list({ path: dir, recursive: true });
    const loopEntries = list.entries.filter((e) => e.path.includes('/loop/loop'));
    assert.equal(loopEntries.length, 0);
    assert.ok(list.entries.some((e) => e.type === 'symlink'));
  });
});

describe('acceptance: large binary transfer', () => {
  let ctx: TestServerContext;
  let client: BabyQuirtTestClient;
  const testDir = mkdtempSync(join(tmpdir(), 'bq-binary-'));

  before(async () => {
    ctx = await startTestServer();
    client = new BabyQuirtTestClient({ socketPath: ctx.socketPath, configRoot: ctx.configRoot });
  });

  after(async () => {
    await stopTestServer(ctx);
    rmSync(testDir, { recursive: true, force: true });
  });

  it('writes and reads large binary file in chunks', async () => {
    const path = join(testDir, 'large.bin');
    const chunk = Buffer.alloc(32 * 1024, 0xab);
    let offset = 0;
    for (let i = 0; i < 8; i++) {
      await client.request('baby.file.write', {
        path,
        data: chunk.toString('base64'),
        encoding: 'base64',
        offset,
      });
      offset += chunk.length;
    }
    const stat = await client.request('baby.file.stat', { path });
    assert.equal((stat.result as { size: number }).size, chunk.length * 8);

    let readOffset = 0;
    let chunks = 0;
    while (chunks < 8) {
      const read = await client.request('baby.file.read', {
        path,
        offset: readOffset,
        limit: 32 * 1024,
      });
      const result = read.result as { data: string; offset: number; eof: boolean };
      assert.ok(result.data.length > 0);
      readOffset = result.offset;
      chunks++;
    }
  });
});
