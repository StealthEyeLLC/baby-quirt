/** Normative Baby automated-delivery contracts. The release subsystem remains authoritative. */

import type { DeploymentState } from '../deployment/types.js';

export const DELIVERY_PLAN_SCHEMA_VERSION = '1.0.0' as const;
export const DELIVERY_OPERATION_VERSION = '1.0.0' as const;

export const DELIVERY_STATES = [
  'PLANNED',
  'SOURCE_VERIFIED',
  'SOURCE_MATERIALIZED',
  'BUILDING',
  'TESTING',
  'CERTIFYING',
  'ARTIFACT_FINALIZED',
  'STAGING',
  'CANDIDATE_VERIFIED',
  'ROLLBACK_ARMED',
  'ACTIVATING',
  'ACCEPTING',
  'SOAKING',
  'SUCCEEDED',
  'REJECTED',
  'FAILED',
  'CANCELLED_PRE_ARM',
  'ROLLBACK_REQUESTED',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
  'REPAIR_REQUIRED',
  'MANUAL_RECOVERY_REQUIRED',
  'PARTIAL',
  'AMBIGUOUS',
  'UNKNOWN',
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const SOURCE_MATERIALIZATION_ADAPTERS = [
  'baby_selfhost',
  'immutable_source_artifact',
  'authenticated_git',
  'connector_handoff',
] as const;
export type SourceMaterializationAdapter = (typeof SOURCE_MATERIALIZATION_ADAPTERS)[number];

export interface DeliverySourceIdentity {
  product: 'baby-quirt' | 'baby-quirt-mcp';
  repository: string;
  commit: string;
  tree: string;
  adapter: SourceMaterializationAdapter;
  immutableDigest: string;
  credentialReference?: string;
}

export interface DeliveryToolchainIdentity {
  name: string;
  version: string;
  digest?: string;
}

export interface DeliveryLockfileIdentity {
  path: string;
  sha256: string;
}

export interface DeliveryBuildProfile {
  name: string;
  version: string;
  commands: readonly string[];
  toolchains: readonly DeliveryToolchainIdentity[];
  lockfiles: readonly DeliveryLockfileIdentity[];
  cleanEnvironment: boolean;
  reproducibleBuilds: number;
}

export interface DeliveryTestProfile {
  name: string;
  version: string;
  commands: readonly string[];
  requireZeroSkips: boolean;
  requireStableCounts: boolean;
}

export interface DeliveryCertificationProfile {
  name: string;
  version: string;
  requiredNspawnProperties: readonly string[];
  cycles: readonly ('success' | 'automatic_rollback' | 'restart_or_reboot_recovery')[];
  requireSystemdPid1: boolean;
  requireUid0Supervisor: boolean;
  requireGatewayUid997: boolean;
  destroyAfterCertification: boolean;
}

export interface DeliveryCandidateVerificationProfile {
  name: string;
  version: string;
  checks: readonly string[];
}

export interface DeliveryAcceptanceProfile {
  privateChecks: readonly string[];
  publicChecks: readonly string[];
  requireAll: boolean;
}

export interface DeliverySoakProfile {
  durationSeconds: number;
  checkpointSeconds: readonly number[];
  checks: readonly string[];
}

export interface DeliveryRollbackPolicy {
  automaticOnAcceptanceFailure: boolean;
  automaticOnSoakFailure: boolean;
  automaticOnDeadline: boolean;
  cancellationAfterArm: 'rollback';
  unknownDisposition: 'repair_required';
  rollbackFailureDisposition: 'manual_recovery_required';
}

export interface DeliveryResourceBounds {
  maxWallSeconds: number;
  maxCpuSeconds: number;
  maxMemoryBytes: number;
  maxDiskBytes: number;
  maxInodes: number;
  maxOutputBytes: number;
  maxArtifacts: number;
}

export interface DeliveryTimeBounds {
  notBefore: string;
  expiresAt: string;
  guardDeadline: string;
}

export interface DeliveryCostBounds {
  currency: string;
  maximumMinorUnits: number;
}

export interface DeliveryRetentionPolicy {
  eventDays: number;
  evidenceDays: number;
  artifactDays: number;
  retainTerminalRuns: number;
}

export interface DeliveryPlanInput {
  schemaVersion: typeof DELIVERY_PLAN_SCHEMA_VERSION;
  deliveryId: string;
  ownerPrincipal: string;
  authorizationReference: string;
  targetHostname: string;
  targetMachineIdentity: string;
  products: readonly DeliverySourceIdentity[];
  buildProfile: DeliveryBuildProfile;
  testProfile: DeliveryTestProfile;
  certificationProfile: DeliveryCertificationProfile;
  targetReleaseIdentifiers: Readonly<Record<'baby-quirt' | 'baby-quirt-mcp', string>>;
  protectedReleases: readonly string[];
  protectedPaths: readonly string[];
  candidateVerificationProfile: DeliveryCandidateVerificationProfile;
  activationOrder: readonly ('baby-quirt-mcp' | 'baby-quirt')[];
  acceptanceProfile: DeliveryAcceptanceProfile;
  soakProfile: DeliverySoakProfile;
  rollbackPolicy: DeliveryRollbackPolicy;
  timeBounds: DeliveryTimeBounds;
  allowedExternalSideEffects: readonly string[];
  resourceBounds: DeliveryResourceBounds;
  costBounds: DeliveryCostBounds;
  evidenceRequirements: readonly string[];
  retentionPolicy: DeliveryRetentionPolicy;
}

export interface CanonicalDeliveryPlan extends DeliveryPlanInput {
  planDigest: string;
}

export interface DeliveryChildJobReference {
  phase: string;
  jobId: string;
  resultDigest?: string;
  receiptId?: string;
  stdoutOffset: number;
  stderrOffset: number;
  terminal: boolean;
}

export interface DeliveryArtifactReference {
  phase: string;
  artifactId: string;
  sha256: string;
  size: number;
  immutable: boolean;
}

export interface DeliveryRunRecord {
  deliveryId: string;
  planDigest: string;
  ownerPrincipal: string;
  authorizationReference: string;
  targetHostname: string;
  targetMachineIdentity: string;
  generation: number;
  state: DeliveryState;
  stateSequence: number;
  deploymentId?: string;
  deploymentState?: DeploymentState;
  activeControllerLease?: string;
  childJobs: readonly DeliveryChildJobReference[];
  artifacts: readonly DeliveryArtifactReference[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  terminal: boolean;
}

export interface DeliveryEventRecord {
  deliveryId: string;
  offset: number;
  generation: number;
  planDigest: string;
  state: DeliveryState;
  phase: string;
  kind: string;
  message: string;
  childJobId?: string;
  artifactReference?: string;
  receiptId?: string;
  occurredAt: string;
  eventDigest: string;
}

export interface DeliveryEvidenceRecord {
  deliveryId: string;
  generation: number;
  planDigest: string;
  deploymentId?: string;
  kind: string;
  digest: string;
  artifactReference: string;
  receiptId?: string;
  redacted: true;
  createdAt: string;
}

export type DeliveryErrorCode =
  | 'delivery_invalid'
  | 'delivery_not_found'
  | 'delivery_conflict'
  | 'delivery_plan_changed'
  | 'delivery_authorization_invalid'
  | 'delivery_expired'
  | 'delivery_wrong_host'
  | 'delivery_wrong_machine'
  | 'delivery_source_mismatch'
  | 'delivery_tree_mismatch'
  | 'delivery_source_digest_mismatch'
  | 'delivery_credential_unavailable'
  | 'delivery_controller_conflict'
  | 'delivery_generation_conflict'
  | 'delivery_state_conflict'
  | 'delivery_receipt_invalid'
  | 'delivery_evidence_insufficient'
  | 'delivery_rollback_failed'
  | 'delivery_manual_recovery_required'
  | 'delivery_unknown'
  | 'idempotency_conflict';

export class DeliveryError extends Error {
  constructor(
    public readonly code: DeliveryErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}
