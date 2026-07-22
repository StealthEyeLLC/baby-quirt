import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

interface TarEntry {
  name: string;
  type?: string;
  mode?: number;
  data?: Buffer;
}

function octal(target: Buffer, offset: number, length: number, value: number): void {
  const encoded = `${value.toString(8).padStart(length - 1, '0')}\0`;
  target.write(encoded, offset, length, 'ascii');
}

function header(entry: TarEntry): Buffer {
  const result = Buffer.alloc(512);
  result.write(entry.name, 0, 100, 'utf8');
  octal(result, 100, 8, entry.mode ?? (entry.type === '5' ? 0o555 : 0o444));
  octal(result, 108, 8, 0);
  octal(result, 116, 8, 0);
  octal(result, 124, 12, entry.data?.length ?? 0);
  octal(result, 136, 12, 1);
  result.fill(0x20, 148, 156);
  result.write(entry.type ?? '0', 156, 1, 'ascii');
  result.write('ustar\0', 257, 6, 'binary');
  result.write('00', 263, 2, 'ascii');
  const sum = result.reduce((total, byte) => total + byte, 0);
  result.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return result;
}

function archive(entries: TarEntry[], trailing?: Buffer): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0);
    blocks.push(header(entry), data);
    const remainder = data.length % 512;
    if (remainder !== 0) blocks.push(Buffer.alloc(512 - remainder));
  }
  blocks.push(Buffer.alloc(1024));
  if (trailing !== undefined) blocks.push(trailing);
  return gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
}

function runFixture(bytes: Buffer, env: NodeJS.ProcessEnv = {}): { status: number | null; stderr: string; outputExists: boolean } {
  const root = mkdtempSync(join(tmpdir(), 'bq-strict-fault-'));
  try {
    const path = join(root, 'fixture.tar.gz');
    const output = join(root, 'output');
    writeFileSync(path, bytes);
    const result = spawnSync(
      'python3',
      [join(process.cwd(), 'scripts/bootstrap-safe-extract.py'), path, output, 'baby-quirt-0.3.0'],
      { encoding: 'utf8', env: { ...process.env, ...env } },
    );
    return { status: result.status, stderr: result.stderr, outputExists: existsSync(output) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const rootEntry: TarEntry = { name: 'baby-quirt-0.3.0', type: '5' };

describe('strict archive fault matrix', () => {
  const cases: Array<{ name: string; entries: TarEntry[]; pattern: RegExp; trailing?: Buffer }> = [
    { name: 'absolute path', entries: [rootEntry, { name: '/absolute', data: Buffer.from('x') }], pattern: /unsafe archive path/ },
    { name: 'traversal', entries: [rootEntry, { name: 'baby-quirt-0.3.0/../escape', data: Buffer.from('x') }], pattern: /unsafe archive path/ },
    { name: 'backslash', entries: [rootEntry, { name: 'baby-quirt-0.3.0\\escape', data: Buffer.from('x') }], pattern: /unsafe archive path/ },
    { name: 'symlink', entries: [rootEntry, { name: 'baby-quirt-0.3.0/link', type: '2' }], pattern: /forbidden archive entry type/ },
    { name: 'hardlink', entries: [rootEntry, { name: 'baby-quirt-0.3.0/link', type: '1' }], pattern: /forbidden archive entry type/ },
    { name: 'device', entries: [rootEntry, { name: 'baby-quirt-0.3.0/device', type: '3' }], pattern: /forbidden archive entry type/ },
    { name: 'fifo', entries: [rootEntry, { name: 'baby-quirt-0.3.0/fifo', type: '6' }], pattern: /forbidden archive entry type/ },
    { name: 'PAX metadata', entries: [rootEntry, { name: 'baby-quirt-0.3.0/pax', type: 'x' }], pattern: /PAX\/GNU\/sparse/ },
    { name: 'duplicate entry', entries: [rootEntry, { name: 'baby-quirt-0.3.0/a', data: Buffer.from('a') }, { name: 'baby-quirt-0.3.0/a', data: Buffer.from('b') }], pattern: /duplicate normalized/ },
    { name: 'file-directory conflict', entries: [rootEntry, { name: 'baby-quirt-0.3.0/a', data: Buffer.from('a') }, { name: 'baby-quirt-0.3.0/a/child', data: Buffer.from('b') }], pattern: /file\/directory archive conflict/ },
    { name: 'undeclared parent', entries: [rootEntry, { name: 'baby-quirt-0.3.0/missing/child', data: Buffer.from('b') }], pattern: /parent directory is undeclared/ },
    { name: 'special permission bits', entries: [rootEntry, { name: 'baby-quirt-0.3.0/suid', mode: 0o4755, data: Buffer.from('x') }], pattern: /special permission bits|non-permission mode bits/ },
    { name: 'trailing nonzero garbage', entries: [rootEntry], trailing: Buffer.concat([Buffer.from([1]), Buffer.alloc(511)]), pattern: /trailing nonzero garbage/ },
  ];

  for (const fixture of cases) {
    it(`rejects ${fixture.name} and removes partial output`, () => {
      const result = runFixture(archive(fixture.entries, fixture.trailing));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, fixture.pattern);
      assert.equal(result.outputExists, false);
    });
  }

  it('enforces compressed and decompressed bounds', () => {
    const bytes = archive([rootEntry, { name: 'baby-quirt-0.3.0/data', data: Buffer.alloc(4096, 1) }]);
    const compressed = runFixture(bytes, { BABY_QUIRT_MAX_ARCHIVE_BYTES: '32' });
    assert.notEqual(compressed.status, 0);
    assert.match(compressed.stderr, /compressed size is out of bounds/);
    const decompressed = runFixture(bytes, { BABY_QUIRT_MAX_DECOMPRESSED_BYTES: '1024' });
    assert.notEqual(decompressed.status, 0);
    assert.match(decompressed.stderr, /decompressed archive exceeds/);
  });
});
