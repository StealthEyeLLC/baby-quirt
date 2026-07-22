/** Cryptographically signed operation receipts. */

import { signEd25519 } from '../crypto/signing.js';
import type { KeyObject } from 'node:crypto';
import { canonicalJson, sha256Hex } from '../crypto/canonical.js';
import { PROTOCOL_VERSION } from '../config.js';
import { readRuntimeReleaseIdentity } from '../release/runtime-identity.js';

export const RECEIPT_SCHEMA_VERSION = '2.0.0';

export interface ReceiptReleaseIdentity {
  status: 'installed' | 'unknown';
  manifestPath: string;
  manifestSha256?: string;
  version?: string;
  commit?: string;
  tree?: string;
  sourceDateEpoch?: number | string;
}

export interface ReceiptInputV1 {
  requestId: string;
  operation: string;
  subject: string;
  authorityClass: string;
  resultDigest: string;
  timestamp: string;
  machineIdSha256: string;
  hostname: string;
}

export interface ReceiptInputV2 extends ReceiptInputV1 {
  requestDigest: string;
  requestFingerprint: string;
  startedAt: string;
  completedAt: string;
  release: ReceiptReleaseIdentity;
}

export interface SignedReceiptV1 extends ReceiptInputV1 {
  receiptSchemaVersion: '1.0.0';
  protocolVersion: string;
  receiptId: string;
  signature: string;
  keyId: string;
}

export interface SignedReceiptV2 extends ReceiptInputV2 {
  receiptSchemaVersion: '2.0.0';
  protocolVersion: string;
  receiptId: string;
  signature: string;
  keyId: string;
}

export type SignedReceipt = SignedReceiptV1 | SignedReceiptV2;
export type ReceiptInput = ReceiptInputV1 | ReceiptInputV2;

export function readReceiptReleaseIdentity(): ReceiptReleaseIdentity {
  return readRuntimeReleaseIdentity();
}

export function buildReceiptDigest(input: ReceiptInput): string {
  return sha256Hex(canonicalJson(input));
}

export function signReceipt(
  input: ReceiptInputV2,
  privateKey: KeyObject,
  keyId: string,
): SignedReceiptV2 {
  const receiptId = sha256Hex(
    `${input.requestDigest}:${input.resultDigest}:${input.completedAt}`,
  ).slice(0, 32);
  const digest = buildReceiptDigest(input);
  const signingBody = canonicalJson({ ...input, receiptId, digest });
  const signature = signEd25519(signingBody, privateKey);

  return {
    receiptSchemaVersion: RECEIPT_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    receiptId,
    ...input,
    signature,
    keyId,
  };
}

export function resultDigest(result: unknown): string {
  return sha256Hex(canonicalJson(result));
}
