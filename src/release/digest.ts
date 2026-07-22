import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import type { JsonValue } from './json.js';
import { canonicalJson } from './json.js';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(path: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(path);
    input.on('data', (chunk) => hash.update(chunk));
    input.once('error', reject);
    input.once('end', () => resolve(hash.digest('hex')));
  });
}

export function sha256FileSync(path: string): string {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

export function digestJson(value: JsonValue): string {
  return sha256(canonicalJson(value));
}

export function fileMode(path: string): string {
  return (lstatSync(path).mode & 0o7777).toString(8).padStart(4, '0');
}

export interface WalkedReleaseFile {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  mode: string;
}

export function walkRegularFiles(root: string): WalkedReleaseFile[] {
  const files: WalkedReleaseFile[] = [];
  const visit = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Release tree contains a symbolic link: ${path}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
      return;
    }
    if (!stat.isFile()) throw new Error(`Release tree contains a special entry: ${path}`);
    const rel = relative(root, path).split(sep).join(posix.sep);
    if (rel.length === 0 || rel.startsWith('../')) throw new Error(`Release path escaped root: ${path}`);
    files.push({ absolutePath: path, relativePath: rel, sizeBytes: stat.size, mode: fileMode(path) });
  };
  visit(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function readJson(path: string): JsonValue {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
}
