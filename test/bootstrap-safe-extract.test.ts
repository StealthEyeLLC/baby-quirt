import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';

interface TarEntry {
  name: string;
  type?: string;
  data?: string;
  mode?: number;
  uid?: number;
  gid?: number;
  linkname?: string;
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
}

function tarBytes(entries: readonly TarEntry[], options: { corruptChecksum?: boolean; trailingGarbage?: boolean } = {}): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '');
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    writeOctal(header, 100, 8, entry.mode ?? (entry.type === '5' ? 0o755 : 0o644));
    writeOctal(header, 108, 8, entry.uid ?? 0);
    writeOctal(header, 116, 8, entry.gid ?? 0);
    writeOctal(header, 124, 12, data.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header.write(entry.type ?? '0', 156, 1, 'ascii');
    if (entry.linkname) header.write(entry.linkname, 157, 100, 'utf8');
    header.write('ustar\0', 257, 6, 'binary');
    header.write('00', 263, 2, 'ascii');
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    if (options.corruptChecksum) header[0] ^= 1;
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  if (options.trailingGarbage) {
    const trailing = Buffer.alloc(512);
    trailing[0] = 1;
    blocks.push(trailing);
  }
  return Buffer.concat(blocks);
}

function writeTarGz(path: string, entries: readonly TarEntry[], options?: Parameters<typeof tarBytes>[1]): void {
  writeFileSync(path, gzipSync(tarBytes(entries, options), { level: 9 }));
}

describe('bootstrap safe extractor', () => {
  it('extracts a bounded regular-file release and preserves executable mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-bootstrap-extract-'));
    try {
      const source = join(root, 'source');
      const prefix = 'baby-quirt-0.1.1';
      const bin = join(source, prefix, 'bin');
      mkdirSync(bin, { recursive: true });
      const daemon = join(bin, 'baby-quirt-daemon');
      writeFileSync(daemon, '#!/usr/bin/env bash\necho ok\n');
      chmodSync(daemon, 0o755);

      const archive = join(root, 'release.tar.gz');
      execFileSync('tar', [
        '--format=ustar', '--owner=0', '--group=0', '--numeric-owner',
        '-czf', archive, '-C', source, prefix,
      ]);

      const destination = join(root, 'out');
      const result = spawnSync(
        'python3',
        [join(process.cwd(), 'scripts/bootstrap-safe-extract.py'), archive, destination, prefix],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);

      const extracted = join(destination, prefix, 'bin', 'baby-quirt-daemon');
      assert.equal(readFileSync(extracted, 'utf8'), '#!/usr/bin/env bash\necho ok\n');
      assert.notEqual(statSync(extracted).mode & 0o111, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects symbolic links and removes partial output', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-bootstrap-reject-'));
    try {
      const source = join(root, 'source');
      const prefix = 'baby-quirt-0.1.1';
      mkdirSync(join(source, prefix), { recursive: true });
      symlinkSync('/etc/passwd', join(source, prefix, 'escape'));

      const archive = join(root, 'malicious.tar.gz');
      execFileSync('tar', [
        '--format=ustar', '--owner=0', '--group=0', '--numeric-owner',
        '-czf', archive, '-C', source, prefix,
      ]);

      const destination = join(root, 'out');
      const result = spawnSync(
        'python3',
        [join(process.cwd(), 'scripts/bootstrap-safe-extract.py'), archive, destination, prefix],
        { encoding: 'utf8' },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /forbidden archive entry type/i);
      assert.equal(existsSync(destination), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects every frozen unsafe archive class exercised by the product adapter', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-bootstrap-matrix-'));
    const prefix = 'baby-quirt-0.3.0-test';
    const base: TarEntry[] = [{ name: prefix, type: '5' }];
    const cases: Array<{
      name: string;
      entries: TarEntry[];
      options?: Parameters<typeof tarBytes>[1];
      env?: Record<string, string>;
      message: RegExp;
    }> = [
      { name: 'absolute', entries: [...base, { name: '/etc/passwd' }], message: /unsafe archive path|outside expected prefix/i },
      { name: 'traversal', entries: [...base, { name: `${prefix}/../escape` }], message: /unsafe archive path/i },
      { name: 'backslash', entries: [...base, { name: `${prefix}\\escape` }], message: /unsafe archive path/i },
      { name: 'duplicate', entries: [...base, { name: `${prefix}/file` }, { name: `${prefix}/file` }], message: /duplicate normalized/i },
      { name: 'file-directory-conflict', entries: [...base, { name: `${prefix}/parent` }, { name: `${prefix}/parent/child` }], message: /file\/directory archive conflict/i },
      { name: 'symlink', entries: [...base, { name: `${prefix}/link`, type: '2', linkname: '/etc/passwd' }], message: /forbidden archive entry type/i },
      { name: 'hardlink', entries: [...base, { name: `${prefix}/link`, type: '1', linkname: `${prefix}/target` }], message: /forbidden archive entry type/i },
      { name: 'fifo', entries: [...base, { name: `${prefix}/fifo`, type: '6' }], message: /forbidden archive entry type/i },
      { name: 'pax', entries: [...base, { name: `${prefix}/pax`, type: 'x' }], message: /unsupported PAX\/GNU\/sparse/i },
      { name: 'sparse', entries: [...base, { name: `${prefix}/sparse`, type: 'S' }], message: /unsupported PAX\/GNU\/sparse/i },
      { name: 'special-bits', entries: [...base, { name: `${prefix}/setuid`, mode: 0o4755 }], message: /forbidden special/i },
      { name: 'non-root-owner', entries: [...base, { name: `${prefix}/owned`, uid: 1000 }], message: /ownership must be numeric root:root/i },
      { name: 'oversized-member', entries: [...base, { name: `${prefix}/large`, data: '12345' }], env: { BABY_QUIRT_MAX_ARCHIVE_FILE_BYTES: '4' }, message: /member size is out of bounds/i },
      { name: 'excess-members', entries: [...base, { name: `${prefix}/one` }], env: { BABY_QUIRT_MAX_ARCHIVE_MEMBERS: '1' }, message: /too many entries/i },
      { name: 'checksum', entries: [...base, { name: `${prefix}/file` }], options: { corruptChecksum: true }, message: /header checksum/i },
      { name: 'trailing-garbage', entries: [...base, { name: `${prefix}/file` }], options: { trailingGarbage: true }, message: /trailing nonzero garbage/i },
    ];

    try {
      for (const testCase of cases) {
        const archive = join(root, `${testCase.name}.tar.gz`);
        const destination = join(root, `out-${testCase.name}`);
        writeTarGz(archive, testCase.entries, testCase.options);
        const result = spawnSync(
          'python3',
          [join(process.cwd(), 'scripts/bootstrap-safe-extract.py'), archive, destination, prefix],
          { encoding: 'utf8', env: { ...process.env, ...testCase.env } },
        );
        assert.notEqual(result.status, 0, testCase.name);
        assert.match(result.stderr, testCase.message, testCase.name);
        assert.equal(existsSync(destination), false, testCase.name);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlink archive and a non-empty destination', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-bootstrap-paths-'));
    const prefix = 'baby-quirt-0.3.0-test';
    try {
      const archive = join(root, 'release.tar.gz');
      writeTarGz(archive, [{ name: prefix, type: '5' }, { name: `${prefix}/file`, data: 'ok' }]);
      const archiveLink = join(root, 'archive-link.tar.gz');
      symlinkSync(archive, archiveLink);
      const linked = spawnSync(
        'python3',
        [join(process.cwd(), 'scripts/bootstrap-safe-extract.py'), archiveLink, join(root, 'linked-out'), prefix],
        { encoding: 'utf8' },
      );
      assert.notEqual(linked.status, 0);
      assert.match(linked.stderr, /not a regular file/i);

      const destination = join(root, 'nonempty');
      mkdirSync(destination);
      writeFileSync(join(destination, 'keep'), 'do-not-remove');
      const nonempty = spawnSync(
        'python3',
        [join(process.cwd(), 'scripts/bootstrap-safe-extract.py'), archive, destination, prefix],
        { encoding: 'utf8' },
      );
      assert.notEqual(nonempty.status, 0);
      assert.match(nonempty.stderr, /destination must be an empty real directory/i);
      assert.equal(readFileSync(join(destination, 'keep'), 'utf8'), 'do-not-remove');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
