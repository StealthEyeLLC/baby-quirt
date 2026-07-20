/** Immutable artifact storage. */

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import type { StateStore } from '../state/store.js';

export interface ArtifactCreatePayload {
  name: string;
  sourcePath: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactUploadPayload {
  artifactId: string;
  offset: number;
  data: string;
  encoding?: 'base64';
  finalize?: boolean;
}

export interface ArtifactDownloadPayload {
  artifactId: string;
  offset?: number;
  limit?: number;
}

export interface ArtifactRecord {
  artifactId: string;
  name: string;
  sha256: string;
  size: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
  path: string;
}

export class ArtifactManager {
  private readonly manifestPath: string;

  constructor(private readonly store: StateStore) {
    this.manifestPath = join(store.artifactsDir(), 'manifest.json');
    mkdirSync(store.artifactsDir(), { recursive: true, mode: 0o750 });
  }

  private loadManifest(): ArtifactRecord[] {
    if (!existsSync(this.manifestPath)) return [];
    try {
      return JSON.parse(readFileSync(this.manifestPath, 'utf8')) as ArtifactRecord[];
    } catch {
      return [];
    }
  }

  private saveManifest(records: ArtifactRecord[]): void {
    writeFileSync(this.manifestPath, JSON.stringify(records, null, 2), { mode: 0o600 });
  }

  createFromFile(payload: ArtifactCreatePayload): ArtifactRecord {
    const artifactId = randomUUID();
    const destPath = join(this.store.artifactsDir(), `${artifactId}.blob`);
    const hash = createHash('sha256');
    const data = readFileSync(payload.sourcePath);
    hash.update(data);
    writeFileSync(destPath, data, { mode: 0o600 });

    const record: ArtifactRecord = {
      artifactId,
      name: payload.name,
      sha256: hash.digest('hex'),
      size: data.length,
      createdAt: new Date().toISOString(),
      metadata: payload.metadata,
      path: destPath,
    };

    const manifest = this.loadManifest();
    manifest.push(record);
    this.saveManifest(manifest);
    return record;
  }

  beginUpload(name: string, metadata?: Record<string, unknown>): ArtifactRecord {
    const artifactId = randomUUID();
    const destPath = join(this.store.artifactsDir(), `${artifactId}.blob`);
    writeFileSync(destPath, Buffer.alloc(0), { mode: 0o600 });

    const record: ArtifactRecord = {
      artifactId,
      name,
      sha256: '',
      size: 0,
      createdAt: new Date().toISOString(),
      metadata,
      path: destPath,
    };

    const manifest = this.loadManifest();
    manifest.push(record);
    this.saveManifest(manifest);
    return record;
  }

  uploadChunk(payload: ArtifactUploadPayload): ArtifactRecord {
    const manifest = this.loadManifest();
    const record = manifest.find((r) => r.artifactId === payload.artifactId);
    if (!record) throw new Error(`Artifact not found: ${payload.artifactId}`);

    const data = Buffer.from(payload.data, payload.encoding ?? 'base64');
    const fd = openSync(record.path, 'r+');
    try {
      writeSync(fd, data, 0, data.length, payload.offset);
    } finally {
      closeSync(fd);
    }

    if (payload.finalize) {
      const fileData = readFileSync(record.path);
      record.sha256 = createHash('sha256').update(fileData).digest('hex');
      record.size = fileData.length;
    } else {
      record.size = Math.max(record.size, payload.offset + data.length);
    }

    this.saveManifest(manifest);
    return record;
  }

  download(payload: ArtifactDownloadPayload): {
    artifactId: string;
    data: string;
    offset: number;
    eof: boolean;
    sha256: string;
    size: number;
  } {
    const manifest = this.loadManifest();
    const record = manifest.find((r) => r.artifactId === payload.artifactId);
    if (!record) throw new Error(`Artifact not found: ${payload.artifactId}`);

    const offset = payload.offset ?? 0;
    const limit = payload.limit ?? 64 * 1024;
    const stat = statSync(record.path);
    const fd = openSync(record.path, 'r');
    try {
      const available = Math.max(0, stat.size - offset);
      const toRead = Math.min(limit, available);
      const buf = Buffer.alloc(toRead);
      if (toRead > 0) {
        readSync(fd, buf, 0, toRead, offset);
      }
      return {
        artifactId: record.artifactId,
        data: buf.toString('base64'),
        offset: offset + toRead,
        eof: offset + toRead >= stat.size,
        sha256: record.sha256,
        size: record.size,
      };
    } finally {
      closeSync(fd);
    }
  }

  list(): ArtifactRecord[] {
    return this.loadManifest();
  }

  get(artifactId: string): ArtifactRecord | undefined {
    return this.loadManifest().find((r) => r.artifactId === artifactId);
  }
}
