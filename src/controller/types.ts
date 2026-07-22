/** Fixed-function standalone deployment controller contracts. */

export const CONTROLLER_RECORD_VERSION = '2.0.0' as const;

export type ControllerDisposition =
  | 'armed'
  | 'pending'
  | 'success_marker_valid'
  | 'disarmed'
  | 'stale_generation'
  | 'rolled_back'
  | 'rollback_failed';

export interface PointerIdentity {
  link: string;
  target: string | null;
}

export interface ExpectedProductPointers {
  current: PointerIdentity;
  previous: PointerIdentity;
}

export interface ExpectedPointers {
  baby: ExpectedProductPointers;
  gateway: ExpectedProductPointers;
}

export interface CandidateManifestDigests {
  baby: string;
  gateway: string;
}

export interface DeploymentGuardPayload {
  recordVersion: typeof CONTROLLER_RECORD_VERSION;
  recordType: 'baby-quirt-deployment-guard';
  deploymentId: string;
  generation: number;
  machineId: string;
  planDigest: string;
  snapshotDigest: string;
  candidateManifestDigests: CandidateManifestDigests;
  expectedPointers: ExpectedPointers;
  deadline: string;
  evidenceDigest: string;
  signingKeyId: string;
  signatureAlgorithm: 'ed25519';
}

export interface SignedDeploymentGuardRecord extends DeploymentGuardPayload {
  recordDigest: string;
  signature: string;
}

export interface SuccessMarkerPayload {
  recordVersion: typeof CONTROLLER_RECORD_VERSION;
  recordType: 'baby-quirt-deployment-success';
  deploymentId: string;
  generation: number;
  machineId: string;
  planDigest: string;
  snapshotDigest: string;
  candidateManifestDigests: CandidateManifestDigests;
  evidenceDigest: string;
  acceptedAt: string;
  signingKeyId: string;
  signatureAlgorithm: 'ed25519';
}

export interface SignedSuccessMarker extends SuccessMarkerPayload {
  recordDigest: string;
  signature: string;
}

export interface ControllerEvidencePayload {
  recordVersion: typeof CONTROLLER_RECORD_VERSION;
  recordType: 'baby-quirt-controller-evidence';
  deploymentId: string;
  generation: number;
  machineId: string;
  planDigest: string;
  snapshotDigest: string;
  candidateManifestDigests: CandidateManifestDigests;
  disposition: ControllerDisposition;
  detailsDigest: string;
  occurredAt: string;
  signingKeyId: string;
  signatureAlgorithm: 'ed25519';
}

export interface SignedControllerEvidence extends ControllerEvidencePayload {
  recordDigest: string;
  signature: string;
}

export interface GuardRollbackResult {
  completed: boolean;
  details: Record<string, unknown>;
}

/**
 * The controller can invoke exactly two host adapter actions. Implementations
 * do not receive arbitrary paths or argv; every target comes from a verified
 * generation-bound guard record.
 */
export interface FixedGuardHostAdapter {
  readPointers(record: SignedDeploymentGuardRecord): ExpectedPointers;
  restoreSnapshot(record: SignedDeploymentGuardRecord): GuardRollbackResult;
}

export interface ControllerStatus {
  deploymentId: string;
  generation: number;
  disposition: ControllerDisposition;
  guardRecordDigest: string;
  evidence?: SignedControllerEvidence;
}

export type ControllerErrorCode =
  | 'controller_invalid_record'
  | 'controller_signature_invalid'
  | 'controller_machine_mismatch'
  | 'controller_generation_conflict'
  | 'controller_active_guard_conflict'
  | 'controller_pointer_mismatch'
  | 'controller_deadline_invalid'
  | 'controller_marker_mismatch'
  | 'controller_not_found'
  | 'controller_lock_busy'
  | 'controller_integrity_failed'
  | 'controller_rollback_failed';

export class ControllerError extends Error {
  constructor(
    public readonly code: ControllerErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ControllerError';
  }
}
