/** Cryptographically signed operation receipts. */

import { signEd25519 } from '../crypto/signing.js';
import type { KeyObject } from 'node:crypto';
import { canonicalJson, sha256Hex } from '../crypto/canonical.js';
import { PROTOCOL_VERSION } from '../config.js';

export const RECEIPT_SCHEMA_VERSION = '1.0.0';

export interface ReceiptInput {
  requestId: string;
  operation: string;
  subject: string;
  authorityClass: string;
  resultDigest: string;
  timestamp: string;
  machineIdSha256: string;
  hostname: string;
}

export interface SignedReceipt extends ReceiptInput {
  receiptSchemaVersion: string;
  protocolVersion: string;
  receiptId: string;
  signature: string;
  keyId: string;
}

export function buildReceiptDigest(input: ReceiptInput): string {
  return sha256Hex(canonicalJson(input));
}

export function signReceipt(
  input: ReceiptInput,
  privateKey: KeyObject,
  keyId: string,
): SignedReceipt {
  const receiptId = sha256Hex(
    `${input.requestId}:${input.operation}:${input.timestamp}`,
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
