/** Receipt verification. */

import { verifyEd25519 } from '../crypto/signing.js';
import type { KeyObject } from 'node:crypto';
import { canonicalJson } from '../crypto/canonical.js';
import { buildReceiptDigest, type SignedReceipt } from './receipt.js';

export function verifyReceipt(receipt: SignedReceipt, publicKey: KeyObject): boolean {
  const input = {
    requestId: receipt.requestId,
    operation: receipt.operation,
    subject: receipt.subject,
    authorityClass: receipt.authorityClass,
    resultDigest: receipt.resultDigest,
    timestamp: receipt.timestamp,
    machineIdSha256: receipt.machineIdSha256,
    hostname: receipt.hostname,
  };
  const digest = buildReceiptDigest(input);
  const signingBody = canonicalJson({ ...input, receiptId: receipt.receiptId, digest });
  return verifyEd25519(signingBody, receipt.signature, publicKey);
}
