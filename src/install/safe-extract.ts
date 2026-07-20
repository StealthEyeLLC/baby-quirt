/** Safe release archive extraction with traversal and symlink guards. */

import {
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  writeSync,
  lstatSync,
} from 'node:fs';
import { join, resolve, normalize, posix } from 'node:path';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { DEFAULTS } from '../config.js';

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
  valid: boolean;
} | null {
  if (buf.length < 512) return null;
  const nameRaw = buf.subarray(0, 100);
  const name = nameRaw.toString('utf8').replace(/\0.*$/, '');
  if (!name) return null;
  const sizeOct = buf.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
  if (!/^[0-7]*$/.test(sizeOct)) {
    return { name, size: 0, typeflag: '?', valid: false };
  }
  const size = parseInt(sizeOct, 8) || 0;
  const typeflag = String.fromCharCode(buf[156]);
  return { name, size, typeflag, valid: true };
}

export interface SafeExtractOptions {
  maxArchiveBytes?: number;
  maxFileBytes?: number;
}

export async function safeExtractTarGz(
  archivePath: string,
  destRoot: string,
  expectedPrefix: string,
  options: SafeExtractOptions = {},
): Promise<void> {
  const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULTS.maxArchiveBytes;
  const maxFileBytes = options.maxFileBytes ?? DEFAULTS.maxArchiveFileBytes;
  const absoluteDest = resolve(destRoot);
  mkdirSync(absoluteDest, { recursive: true });

  const stat = lstatSync(archivePath);
  if (!stat.isFile()) {
    throw new Error('Archive path is not a regular file');
  }
  if (stat.size > maxArchiveBytes) {
    throw new Error('Archive exceeds maximum allowed size');
  }

  const fd = openSync(archivePath, 'r');
  const seen = new Set<string>();
  const written = new Map<string, string>();

  try {
    const chunks: Buffer[] = [];
    let offset = 0;
    const buf = Buffer.alloc(64 * 1024);
    while (offset < stat.size) {
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

    if (tarData.length > maxArchiveBytes) {
      throw new Error('Decompressed archive exceeds maximum allowed size');
    }

    let pos = 0;
    while (pos + 512 <= tarData.length) {
      const header = tarData.subarray(pos, pos + 512);
      const parsed = parseTarHeader(header);
      pos += 512;
      if (!parsed) break;
      if (parsed.name === '') break;
      if (!parsed.valid) {
        throw new Error(`Malformed tar header: ${parsed.name}`);
      }

      const entryPath = normalize(parsed.name.replace(/^\.\//, ''));
      if (entryPath.startsWith('..') || entryPath.includes('/../') || entryPath.includes('\\')) {
        throw new Error(`Unsafe archive path: ${parsed.name}`);
      }
      if (!entryPath.startsWith(expectedPrefix)) {
        throw new Error(`Archive entry outside expected prefix: ${parsed.name}`);
      }
      if (seen.has(entryPath)) {
        throw new Error(`Duplicate archive entry: ${parsed.name}`);
      }
      seen.add(entryPath);

      if (parsed.typeflag === '2' || parsed.typeflag === '1' || parsed.typeflag === '3' || parsed.typeflag === '4' || parsed.typeflag === '6') {
        throw new Error(`Forbidden entry type ${parsed.typeflag}: ${parsed.name}`);
      }
      if (parsed.size < 0 || parsed.size > maxFileBytes) {
        throw new Error(`File size out of bounds: ${parsed.name}`);
      }

      const relative = entryPath.slice(expectedPrefix.length + 1);
      const outPath = resolve(join(absoluteDest, relative));
      if (!outPath.startsWith(absoluteDest + posix.sep) && outPath !== absoluteDest) {
        throw new Error(`Path traversal detected: ${parsed.name}`);
      }

      const prior = written.get(outPath);
      if (prior && prior !== entryPath) {
        throw new Error(`Conflicting archive entries for ${outPath}`);
      }
      written.set(outPath, entryPath);

      const padded = Math.ceil(parsed.size / 512) * 512;
      if (pos + padded > tarData.length) {
        throw new Error(`Truncated archive entry: ${parsed.name}`);
      }
      const content = tarData.subarray(pos, pos + parsed.size);
      pos += padded;

      if (parsed.typeflag === '5' || parsed.name.endsWith('/')) {
        mkdirSync(outPath, { recursive: true });
      } else if (parsed.size > 0) {
        mkdirSync(resolve(outPath, '..'), { recursive: true });
        const outFd = openSync(outPath, 'wx', 0o644);
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
