/** Request authentication and authorization. */

import { buildSigningDocument, requestHash } from '../crypto/canonical.js';
import { verifyAuthority, type AuthorityEnvelope } from '../crypto/signing.js';
import { loadPublicKey } from '../crypto/signing.js';
import { existsSync } from 'node:fs';
import type { RuntimeConfig } from '../config.js';
import { getHostname, getMachineIdSha256 } from '../config.js';
import type { RequestPayload } from '../protocol/frame.js';
import type { ReplayStore } from '../state/replay-store.js';

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthenticatedRequest {
  payload: RequestPayload;
  signingDocument: string;
  hash: string;
  subject: string;
  authorityClass: string;
}

export class Authenticator {
  private publicKey?: ReturnType<typeof loadPublicKey>;
  private previousPublicKey?: ReturnType<typeof loadPublicKey>;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly replayStore: ReplayStore,
  ) {
    this.loadKeys();
  }

  private loadKeys(): void {
    if (existsSync(this.config.signingPublicKeyPath)) {
      this.publicKey = loadPublicKey(this.config.signingPublicKeyPath);
    }
    if (
      this.config.previousSigningPublicKeyPath &&
      existsSync(this.config.previousSigningPublicKeyPath)
    ) {
      this.previousPublicKey = loadPublicKey(this.config.previousSigningPublicKeyPath);
    }
  }

  authenticate(request: RequestPayload, peerUid?: number): AuthenticatedRequest {
    const principal = request.principal as Record<string, unknown>;
    const authority = request.authority as unknown as AuthorityEnvelope;

    const subject = String(principal.subject ?? '');
    const authorityClass = String(principal.authorityClass ?? '');

    if (subject !== this.config.expectedSubject) {
      throw new AuthError('invalid_subject', 'Principal subject does not match expected owner');
    }

    if (authorityClass !== this.config.authorityClass) {
      throw new AuthError('invalid_authority_class', 'Authority class does not match');
    }

    if (request.targetHost !== getHostname()) {
      throw new AuthError('invalid_target_host', 'Target host does not match this machine');
    }

    const machineId = getMachineIdSha256();
    if (machineId && machineId !== this.config.expectedMachineIdSha256) {
      // Allow empty machine id in test environments
      if (this.config.expectedMachineIdSha256 !== 'test') {
        throw new AuthError('invalid_machine_id', 'Machine identity does not match');
      }
    }

    const requestTime = new Date(request.timestamp).getTime();
    if (Number.isNaN(requestTime)) {
      throw new AuthError('invalid_timestamp', 'Request timestamp is not valid ISO-8601');
    }
    const age = Math.abs(Date.now() - requestTime);
    if (age > this.config.requestMaxAgeMs) {
      throw new AuthError('request_expired', 'Request timestamp outside allowed age window');
    }

    if (!authority.nonce) {
      throw new AuthError('missing_nonce', 'Authority nonce is required');
    }
    if (!this.replayStore.checkAndRecordNonce(authority.nonce)) {
      throw new AuthError('replay_detected', 'Nonce has already been used');
    }

    const authorityForSigning = {
      algorithm: authority.algorithm,
      gatewayId: authority.gatewayId,
      nonce: authority.nonce,
    };

    const signingDocument = buildSigningDocument({
      protocolVersion: request.protocolVersion,
      requestId: request.requestId,
      operation: request.operation,
      principal: request.principal as Record<string, unknown>,
      authority: authorityForSigning as Record<string, unknown>,
      targetHost: request.targetHost,
      timestamp: request.timestamp,
      payload: request.payload,
      binaryLength: request.binaryLength,
    });

    const hash = requestHash(signingDocument);

    const idempotent = this.replayStore.getIdempotentResponse(hash);
    if (idempotent !== undefined) {
      throw new AuthError('idempotent_replay', JSON.stringify(idempotent));
    }

    if (!this.publicKey) {
      throw new AuthError('no_signing_key', 'Server signing public key not configured');
    }

    const valid = verifyAuthority({
      document: signingDocument,
      authority,
      expectedGatewayId: this.config.gatewayId,
      publicKey: this.publicKey,
      previousPublicKey: this.previousPublicKey,
    });

    if (!valid) {
      throw new AuthError('invalid_signature', 'Authority signature verification failed');
    }

    if (this.config.gatewayUid !== undefined && peerUid !== undefined) {
      if (peerUid !== this.config.gatewayUid && peerUid !== 0) {
        throw new AuthError('invalid_peer', 'Unix peer credentials do not match gateway');
      }
    }

    return {
      payload: request,
      signingDocument,
      hash,
      subject,
      authorityClass,
    };
  }
}
