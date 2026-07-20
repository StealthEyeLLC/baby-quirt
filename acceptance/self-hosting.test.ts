import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestServer, stopTestServer, type TestServerContext } from '../test/helpers/server.js';
import { BabyQuirtTestClient } from '../test/helpers/client.js';
import { loadPublicKey } from '../src/crypto/signing.js';
import { verifyReceipt } from '../src/receipts/verify.js';

describe('acceptance: self-hosting workflow', () => {
  let ctx: TestServerContext;
  let client: BabyQuirtTestClient;
  const workspace = mkdtempSync(join(tmpdir(), 'bq-selfhost-'));

  before(async () => {
    ctx = await startTestServer();
    client = new BabyQuirtTestClient({ socketPath: ctx.socketPath, configRoot: ctx.configRoot });
  });

  after(async () => {
    await stopTestServer(ctx);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('writes source tree, runs build, inspects output, and verifies receipt', async () => {
    const mainPath = join(workspace, 'main.js');
    const source = 'console.log("self-hosted");\n';
    await client.request('baby.file.write', {
      path: mainPath,
      data: Buffer.from(source).toString('base64'),
      encoding: 'base64',
    });

    const stat = await client.request('baby.file.stat', { path: mainPath });
    assert.equal((stat.result as { type: string }).type, 'file');
    assert.ok((stat.result as { sha256: string }).sha256);

    const exec = await client.request('baby.exec', {
      argv: ['node', mainPath],
      cwd: workspace,
    });
    const jobId = (exec.result as { jobId: string }).jobId;
    const completed = await client.request('baby.job.wait', { jobId, timeoutMs: 15_000 });
    assert.equal((completed.result as { status: string }).status, 'completed');

    const stream = await client.request('baby.job.stream.read', { jobId, stream: 'stdout' });
    const output = Buffer.from((stream.result as { data: string }).data, 'base64').toString('utf8');
    assert.match(output, /self-hosted/);

    assert.ok(stat.receipt);
    const receipt = stat.receipt as import('../src/receipts/receipt.js').SignedReceipt;
    const pub = loadPublicKey(join(ctx.configRoot, 'signing-public.pem'));
    assert.ok(verifyReceipt(receipt, pub), 'receipt signature should verify');
  });

  it('patches file and lists workspace', async () => {
    const path = join(workspace, 'patch.txt');
    await client.request('baby.file.write', {
      path,
      data: Buffer.from('AAAA').toString('base64'),
      encoding: 'base64',
    });
    await client.request('baby.file.patch', {
      path,
      patches: [{ offset: 2, data: 'BB', encoding: 'utf8' }],
    });
    const read = await client.request('baby.file.read', { path, encoding: 'utf8' });
    assert.equal((read.result as { data: string }).data, 'AABB');

    const list = await client.request('baby.file.list', { path: workspace });
    const entries = (list.result as { entries: unknown[] }).entries;
    assert.ok(entries.length >= 2);
  });
});

describe('acceptance: artifact bounds', () => {
  let ctx: TestServerContext;
  let client: BabyQuirtTestClient;
  const workspace = mkdtempSync(join(tmpdir(), 'bq-artifact-'));

  before(async () => {
    ctx = await startTestServer();
    client = new BabyQuirtTestClient({ socketPath: ctx.socketPath, configRoot: ctx.configRoot });
  });

  after(async () => {
    await stopTestServer(ctx);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('uploads artifact in chunks and downloads with offset', async () => {
    const source = join(workspace, 'blob.bin');
    const data = Buffer.alloc(128 * 1024, 0xcd);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(source, data);

    const created = await client.request('baby.artifact.create', {
      name: 'test-blob',
      sourcePath: source,
    });
    const artifactId = (created.result as { artifactId: string }).artifactId;
    const download = await client.request('baby.artifact.download', {
      artifactId,
      offset: 0,
      limit: 4096,
    });
    const chunk = Buffer.from((download.result as { data: string }).data, 'base64');
    assert.equal(chunk.length, 4096);
    assert.ok((download.result as { sha256: string }).sha256);
  });
});
