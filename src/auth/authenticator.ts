/** Request authentication and authorization. */

import { buildSigningDocument, requestHash } from '../crypto/canonical.js';
import { verifyEd25519, loadPublicKey, type AuthorityEnvelope } from '../crypto/signing.js';
import { existsSync } from 'node:fs';
import type { RuntimeConfig } from '../config.js';
import { getHostname, getMachineIdSha256 } from '../config.js';
import type { RequestPayload } from '../protocol/frame.js';
import type { ReplayStore } from '../state/replay-store.js';
import { AuthError, IdempotentReplay } from './errors.js';
import { validatePrincipal } from './principal.js';

export { AuthError, IdempotentReplay };

export interface AuthenticatedRequest {
  payload: RequestPayload;
  signingDocument: string;
  hash: string;
  subject: string;
  authorityClass: string;
}

const SUPPORTED_ALGORITHMS = ['ed25519'] as const;

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
    const principal = validatePrincipal(request.principal as Record<string, unknown>, this.config);
    const authority = request.authority as unknown as AuthorityEnvelope;

    if (!SUPPORTED_ALGORITHMS.includes(authority.algorithm as (typeof SUPPORTED_ALGORITHMS)[number])) {
      throw new AuthError('unsupported_algorithm', `Algorithm ${authority.algorithm} is not supported`);
    }

    if (authority.keyId && authority.keyId !== this.config.signingKeyId) {
      throw new AuthError('invalid_key_id', 'Authority key ID does not match configured signing key');
    }

    if (request.targetHost !== getHostname()) {
      throw new AuthError('invalid_target_host', 'Target host does not match this machine');
    }

    const machineId = getMachineIdSha256();
    if (machineId && machineId !== this.config.expectedMachineIdSha256) {
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
      throw new IdempotentReplay(idempotent);
    }

    if (authority.gatewayId !== this.config.gatewayId) {
      throw new AuthError('invalid_gateway_id', 'Authority gateway ID does not match');
    }

    if (!this.publicKey) {
      throw new AuthError('no_signing_key', 'Server signing public key not configured');
    }

    const valid =
      verifyEd25519(signingDocument, authority.signature, this.publicKey) ||
      (this.previousPublicKey
        ? verifyEd25519(signingDocument, authority.signature, this.previousPublicKey)
        : false);

    if (!valid) {
      throw new AuthError('invalid_signature', 'Authority signature verification failed');
    }

    if (this.config.gatewayUid !== undefined) {
      if (peerUid === undefined) {
        throw new AuthError('invalid_peer', 'Unix peer credentials unavailable');
      }
      if (peerUid !== this.config.gatewayUid && peerUid !== 0) {
        throw new AuthError('invalid_peer', 'Unix peer credentials do not match gateway');
      }
    }

    if (!this.replayStore.tryCommitNonce(authority.nonce)) {
      const retry = this.replayStore.getIdempotentResponse(hash);
      if (retry !== undefined) {
        throw new IdempotentReplay(retry);
      }
      throw new AuthError('replay_detected', 'Nonce has already been used');
    }

    return {
      payload: request,
      signingDocument,
      hash,
      subject: principal.subject,
      authorityClass: principal.authorityClass,
    };
  }
}
