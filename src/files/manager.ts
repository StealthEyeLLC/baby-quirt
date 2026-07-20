/** Binary-safe file operations with symlink and recursion bounds. */

import {
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
  writeSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const FILE_LIST_MAX_DEPTH = 32;
export const FILE_LIST_MAX_ENTRIES = 4096;
export const FILE_READ_MAX_CHUNK = 64 * 1024;

export interface FileStatPayload {
  path: string;
}

export interface FileReadPayload {
  path: string;
  offset?: number;
  limit?: number;
  encoding?: 'base64' | 'utf8';
}

export interface FileWritePayload {
  path: string;
  data: string;
  encoding?: 'base64' | 'utf8';
  offset?: number;
  create?: boolean;
}

export interface FilePatchPayload {
  path: string;
  patches: Array<{
    offset: number;
    data: string;
    encoding?: 'base64' | 'utf8';
  }>;
}

export interface FileCopyPayload {
  source: string;
  destination: string;
  overwrite?: boolean;
}

export interface FileMovePayload {
  source: string;
  destination: string;
  overwrite?: boolean;
}

export interface FileRemovePayload {
  path: string;
  recursive?: boolean;
}

export interface FileListPayload {
  path: string;
  recursive?: boolean;
  maxDepth?: number;
  maxEntries?: number;
}

export interface FileStatResult {
  path: string;
  exists: boolean;
  type?: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  mode?: number;
  uid?: number;
  gid?: number;
  mtime?: string;
  sha256?: string;
}

function assertSafePath(path: string): string {
  const resolved = resolve(path);
  if (resolved.includes('\0')) {
    throw new Error('Path contains null byte');
  }
  return resolved;
}

function decodeData(data: string, encoding: 'base64' | 'utf8' = 'base64'): Buffer {
  return encoding === 'utf8' ? Buffer.from(data, 'utf8') : Buffer.from(data, 'base64');
}

export class FileManager {
  stat(payload: FileStatPayload): FileStatResult {
    const path = assertSafePath(payload.path);
    if (!existsSync(path)) {
      return { path, exists: false };
    }
    const s = lstatSync(path);
    const result: FileStatResult = {
      path,
      exists: true,
      size: s.size,
      mode: s.mode,
      uid: s.uid,
      gid: s.gid,
      mtime: s.mtime.toISOString(),
    };
    if (s.isSymbolicLink()) {
      result.type = 'symlink';
    } else if (s.isFile()) {
      result.type = 'file';
      if (s.size <= 10 * 1024 * 1024) {
        result.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
      }
    } else if (s.isDirectory()) {
      result.type = 'directory';
    } else {
      result.type = 'other';
    }
    return result;
  }

  read(payload: FileReadPayload): { data: string; offset: number; eof: boolean; encoding: string } {
    const path = assertSafePath(payload.path);
    const encoding = payload.encoding ?? 'base64';
    const offset = payload.offset ?? 0;
    const limit = Math.min(payload.limit ?? FILE_READ_MAX_CHUNK, FILE_READ_MAX_CHUNK);

    const fd = openSync(path, 'r');
    try {
      const stat = lstatSync(path);
      const available = Math.max(0, stat.size - offset);
      const toRead = Math.min(limit, available);
      const buf = Buffer.alloc(toRead);
      if (toRead > 0) {
        readSync(fd, buf, 0, toRead, offset);
      }
      const data = encoding === 'utf8' ? buf.toString('utf8') : buf.toString('base64');
      return {
        data,
        offset: offset + toRead,
        eof: offset + toRead >= stat.size,
        encoding,
      };
    } finally {
      closeSync(fd);
    }
  }

  write(payload: FileWritePayload): { path: string; bytesWritten: number } {
    const path = assertSafePath(payload.path);
    const encoding = payload.encoding ?? 'base64';
    const buf = decodeData(payload.data, encoding);

    if (payload.offset !== undefined && payload.offset > 0) {
      const fd = openSync(path, 'r+');
      try {
        writeSync(fd, buf, 0, buf.length, payload.offset);
      } finally {
        closeSync(fd);
      }
    } else {
      if (payload.create !== false) {
        mkdirSync(dirname(path), { recursive: true });
      }
      writeFileSync(path, buf);
    }
    return { path, bytesWritten: buf.length };
  }

  patch(payload: FilePatchPayload): { path: string; patchesApplied: number } {
    const path = assertSafePath(payload.path);
    const fd = openSync(path, 'r+');
    let applied = 0;
    try {
      for (const patch of payload.patches) {
        const buf = decodeData(patch.data, patch.encoding ?? 'base64');
        writeSync(fd, buf, 0, buf.length, patch.offset);
        applied++;
      }
    } finally {
      closeSync(fd);
    }
    return { path, patchesApplied: applied };
  }

  copy(payload: FileCopyPayload): { source: string; destination: string } {
    const source = assertSafePath(payload.source);
    const destination = assertSafePath(payload.destination);
    if (!payload.overwrite && existsSync(destination)) {
      throw new Error('Destination exists');
    }
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    return { source, destination };
  }

  move(payload: FileMovePayload): { source: string; destination: string } {
    const source = assertSafePath(payload.source);
    const destination = assertSafePath(payload.destination);
    if (!payload.overwrite && existsSync(destination)) {
      throw new Error('Destination exists');
    }
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);
    return { source, destination };
  }

  remove(payload: FileRemovePayload): { path: string; removed: boolean } {
    const path = assertSafePath(payload.path);
    if (!existsSync(path)) {
      return { path, removed: false };
    }
    const s = lstatSync(path);
    if (s.isDirectory() && !s.isSymbolicLink()) {
      if (payload.recursive) {
        rmSync(path, { recursive: true, force: true });
      } else {
        throw new Error('Cannot remove directory without recursive flag');
      }
    } else {
      unlinkSync(path);
    }
    return { path, removed: true };
  }

  list(payload: FileListPayload): {
    path: string;
    entries: Array<{ name: string; type: string; path: string }>;
    truncated: boolean;
  } {
    const basePath = assertSafePath(payload.path);
    const maxDepth = payload.maxDepth ?? FILE_LIST_MAX_DEPTH;
    const maxEntries = payload.maxEntries ?? FILE_LIST_MAX_ENTRIES;
    const entries: Array<{ name: string; type: string; path: string }> = [];
    let truncated = false;

    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth) {
        truncated = true;
        return;
      }
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      for (const name of readdirSync(dir)) {
        if (entries.length >= maxEntries) {
          truncated = true;
          return;
        }
        const fullPath = join(dir, name);
        try {
          const s = lstatSync(fullPath);
          const type = s.isSymbolicLink()
            ? 'symlink'
            : s.isDirectory()
              ? 'directory'
              : s.isFile()
                ? 'file'
                : 'other';
          entries.push({ name, type, path: fullPath });
          if (payload.recursive && s.isDirectory() && !s.isSymbolicLink()) {
            walk(fullPath, depth + 1);
          }
        } catch {
          entries.push({ name, type: 'inaccessible', path: fullPath });
        }
      }
    };

    walk(basePath, 0);
    return { path: basePath, entries, truncated };
  }
}
