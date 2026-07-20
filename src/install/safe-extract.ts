/** Safe release archive extraction with traversal and symlink guards. */

import { mkdirSync, openSync, readSync, closeSync, writeSync, fstatSync } from 'node:fs';
import { join, resolve, normalize } from 'node:path';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

export function assertSafeVersion(version: string): void {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
}

function parseTarHeader(buf: Buffer): {
  name: string;
  size: number;
  typeflag: string;
} | null {
  if (buf.length < 512) return null;
  const name = buf.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  if (!name) return null;
  const sizeOct = buf.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
  const size = parseInt(sizeOct, 8) || 0;
  const typeflag = String.fromCharCode(buf[156]);
  return { name, size, typeflag };
}

export async function safeExtractTarGz(
  archivePath: string,
  destRoot: string,
  expectedPrefix: string,
): Promise<void> {
  const absoluteDest = resolve(destRoot);
  mkdirSync(absoluteDest, { recursive: true });

  const fd = openSync(archivePath, 'r');
  try {
    const statSize = fstatSync(fd).size;
    const chunks: Buffer[] = [];
    let offset = 0;
    const buf = Buffer.alloc(64 * 1024);
    while (offset < statSize) {
      const n = readSync(fd, buf, 0, buf.length, offset);
      if (n <= 0) break;
      chunks.push(buf.subarray(0, n));
      offset += n;
    }
    const compressed = Buffer.concat(chunks);
    const tarData = await new Promise<Buffer>((resolveBuf, reject) => {
      const parts: Buffer[] = [];
      const gunzip = createGunzip();
      gunzip.on('data', (c: Buffer) => parts.push(c));
      gunzip.on('end', () => resolveBuf(Buffer.concat(parts)));
      gunzip.on('error', reject);
      Readable.from(compressed).pipe(gunzip);
    });

    let pos = 0;
    while (pos + 512 <= tarData.length) {
      const header = tarData.subarray(pos, pos + 512);
      const parsed = parseTarHeader(header);
      pos += 512;
      if (!parsed) break;
      if (parsed.name === '') break;

      const entryPath = normalize(parsed.name.replace(/^\.\//, ''));
      if (entryPath.startsWith('..') || entryPath.includes('/../')) {
        throw new Error(`Unsafe archive path: ${parsed.name}`);
      }
      if (!entryPath.startsWith(expectedPrefix)) {
        throw new Error(`Archive entry outside expected prefix: ${parsed.name}`);
      }
      if (parsed.typeflag === '2' || parsed.typeflag === '1') {
        throw new Error(`Symlink or hardlink entries forbidden: ${parsed.name}`);
      }

      const outPath = resolve(join(absoluteDest, entryPath.slice(expectedPrefix.length + 1)));
      if (!outPath.startsWith(absoluteDest + '/') && outPath !== absoluteDest) {
        throw new Error(`Path traversal detected: ${parsed.name}`);
      }

      const padded = Math.ceil(parsed.size / 512) * 512;
      const content = tarData.subarray(pos, pos + parsed.size);
      pos += padded;

      if (parsed.typeflag === '5' || parsed.name.endsWith('/')) {
        mkdirSync(outPath, { recursive: true });
      } else if (parsed.size > 0) {
        mkdirSync(resolve(outPath, '..'), { recursive: true });
        const outFd = openSync(outPath, 'w', 0o644);
        try {
          writeSync(outFd, content, 0, content.length, 0);
        } finally {
          closeSync(outFd);
        }
      }
    }
  } finally {
    closeSync(fd);
  }
}
