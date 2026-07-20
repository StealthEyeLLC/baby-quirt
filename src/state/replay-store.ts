/** Replay protection and idempotency store. */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeConfig } from '../config.js';

interface NonceEntry {
  nonce: string;
  seenAt: number;
}

interface IdempotencyEntry {
  requestHash: string;
  response: unknown;
  storedAt: number;
}

interface StoreData {
  nonces: NonceEntry[];
  idempotency: IdempotencyEntry[];
}

export class ReplayStore {
  private data: StoreData;
  private readonly storePath: string;
  private dirty = false;

  constructor(private readonly config: RuntimeConfig) {
    this.storePath = join(config.stateRoot, 'replay-store.json');
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      if (existsSync(this.storePath)) {
        return JSON.parse(readFileSync(this.storePath, 'utf8')) as StoreData;
      }
    } catch {
      // start fresh
    }
    return { nonces: [], idempotency: [] };
  }

  persist(): void {
    if (!this.dirty) return;
    mkdirSync(this.config.stateRoot, { recursive: true, mode: 0o750 });
    writeFileSync(this.storePath, JSON.stringify(this.data), { mode: 0o600 });
    this.dirty = false;
  }

  private prune(): void {
    const now = Date.now();
    this.data.nonces = this.data.nonces.filter(
      (n) => now - n.seenAt < this.config.nonceRetentionMs,
    );
    this.data.idempotency = this.data.idempotency.filter(
      (e) => now - e.storedAt < this.config.idempotencyRetentionMs,
    );
  }

  hasNonce(nonce: string): boolean {
    this.prune();
    return this.data.nonces.some((n) => n.nonce === nonce);
  }

  tryCommitNonce(nonce: string): boolean {
    this.prune();
    if (this.data.nonces.some((n) => n.nonce === nonce)) {
      return false;
    }
    this.data.nonces.push({ nonce, seenAt: Date.now() });
    this.dirty = true;
    return true;
  }

  /** @deprecated use tryCommitNonce after verification */
  checkAndRecordNonce(nonce: string): boolean {
    return this.tryCommitNonce(nonce);
  }

  getIdempotentResponse(hash: string): unknown | undefined {
    this.prune();
    const entry = this.data.idempotency.find((e) => e.requestHash === hash);
    return entry?.response;
  }

  storeIdempotentResponse(hash: string, response: unknown): void {
    this.prune();
    const existing = this.data.idempotency.findIndex((e) => e.requestHash === hash);
    const entry: IdempotencyEntry = { requestHash: hash, response, storedAt: Date.now() };
    if (existing >= 0) {
      this.data.idempotency[existing] = entry;
    } else {
      this.data.idempotency.push(entry);
    }
    this.dirty = true;
  }
}
