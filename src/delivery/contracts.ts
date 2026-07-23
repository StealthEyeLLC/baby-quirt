/** Strict runtime-operation and record schemas for the delivery capability family. */

import { DELIVERY_OPERATION_VERSION, DELIVERY_STATES } from './types.js';

const identifier = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$' } as const;
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const integer = { type: 'integer', minimum: 0 } as const;
const timestamp = { type: 'string', format: 'date-time' } as const;
const string = { type: 'string', minLength: 1, maxLength: 4096 } as const;
const boolean = { type: 'boolean' } as const;

function objectSchema(properties: Record<string, unknown>, required: readonly string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length === 0 ? {} : { required: [...required] }),
  };
}

const sourceIdentity = objectSchema({
  product: { enum: ['baby-quirt', 'baby-quirt-mcp'] },
  repository: string,
  commit: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' },
  tree: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' },
  adapter: { enum: ['baby_selfhost', 'immutable_source_artifact', 'authenticated_git', 'connector_handoff'] },
  immutableDigest: digest,
  credentialReference: string,
}, ['product', 'repository', 'commit', 'tree', 'adapter', 'immutableDigest']);

const planBody = objectSchema({
  schemaVersion: { const: '1.0.0' },
  deliveryId: identifier,
  ownerPrincipal: identifier,
  authorizationReference: string,
  targetHostname: identifier,
  targetMachineIdentity: digest,
  products: { type: 'array', minItems: 2, maxItems: 2, items: sourceIdentity },
  buildProfile: { type: 'object' },
  testProfile: { type: 'object' },
  certificationProfile: { type: 'object' },
  targetReleaseIdentifiers: { type: 'object' },
  protectedReleases: { type: 'array', items: string },
  protectedPaths: { type: 'array', items: string },
  candidateVerificationProfile: { type: 'object' },
  activationOrder: { type: 'array', prefixItems: [{ const: 'baby-quirt-mcp' }, { const: 'baby-quirt' }], minItems: 2, maxItems: 2 },
  acceptanceProfile: { type: 'object' },
  soakProfile: { type: 'object' },
  rollbackPolicy: { type: 'object' },
  timeBounds: { type: 'object' },
  allowedExternalSideEffects: { type: 'array', items: string },
  resourceBounds: { type: 'object' },
  costBounds: { type: 'object' },
  evidenceRequirements: { type: 'array', items: identifier },
  retentionPolicy: { type: 'object' },
}, [
  'schemaVersion', 'deliveryId', 'ownerPrincipal', 'authorizationReference', 'targetHostname',
  'targetMachineIdentity', 'products', 'buildProfile', 'testProfile', 'certificationProfile',
  'targetReleaseIdentifiers', 'protectedReleases', 'protectedPaths', 'candidateVerificationProfile',
  'activationOrder', 'acceptanceProfile', 'soakProfile', 'rollbackPolicy', 'timeBounds',
  'allowedExternalSideEffects', 'resourceBounds', 'costBounds', 'evidenceRequirements', 'retentionPolicy',
]);

export const DELIVERY_PLAN_SCHEMA = planBody;
export const DELIVERY_RUN_SCHEMA = objectSchema({
  deliveryId: identifier,
  planDigest: digest,
  ownerPrincipal: identifier,
  authorizationReference: string,
  targetHostname: identifier,
  targetMachineIdentity: digest,
  generation: { type: 'integer', minimum: 1 },
  state: { enum: DELIVERY_STATES },
  stateSequence: integer,
  deploymentId: identifier,
  deploymentState: string,
  activeControllerLease: string,
  childJobs: { type: 'array' },
  artifacts: { type: 'array' },
  createdAt: timestamp,
  updatedAt: timestamp,
  expiresAt: timestamp,
  terminal: boolean,
}, ['deliveryId', 'planDigest', 'ownerPrincipal', 'authorizationReference', 'targetHostname', 'targetMachineIdentity', 'generation', 'state', 'stateSequence', 'childJobs', 'artifacts', 'createdAt', 'updatedAt', 'expiresAt', 'terminal']);

export const DELIVERY_EVENT_SCHEMA = objectSchema({
  deliveryId: identifier,
  offset: integer,
  generation: { type: 'integer', minimum: 1 },
  planDigest: digest,
  state: { enum: DELIVERY_STATES },
  phase: identifier,
  kind: identifier,
  message: string,
  childJobId: identifier,
  artifactReference: string,
  receiptId: identifier,
  occurredAt: timestamp,
  eventDigest: digest,
}, ['deliveryId', 'offset', 'generation', 'planDigest', 'state', 'phase', 'kind', 'message', 'occurredAt', 'eventDigest']);

export const DELIVERY_EVIDENCE_SCHEMA = objectSchema({
  deliveryId: identifier,
  generation: { type: 'integer', minimum: 1 },
  planDigest: digest,
  deploymentId: identifier,
  kind: identifier,
  digest,
  artifactReference: string,
  receiptId: identifier,
  redacted: { const: true },
  createdAt: timestamp,
}, ['deliveryId', 'generation', 'planDigest', 'kind', 'digest', 'artifactReference', 'redacted', 'createdAt']);

export const DELIVERY_OPERATION_NAMES = [
  'baby.delivery.plan',
  'baby.delivery.execute',
  'baby.delivery.get',
  'baby.delivery.list',
  'baby.delivery.events',
  'baby.delivery.verify',
  'baby.delivery.cancel',
  'baby.delivery.rollback',
  'baby.delivery.repair',
  'baby.delivery.evidence.get',
] as const;
export type DeliveryOperationName = (typeof DELIVERY_OPERATION_NAMES)[number];

export interface DeliveryOperationContract {
  operation: DeliveryOperationName;
  version: typeof DELIVERY_OPERATION_VERSION;
  mutation: boolean;
  risk: 'low' | 'medium' | 'high';
  idempotency: 'read_only' | 'semantic_replay_or_conflict';
  confirmation: 'not_required' | 'bound_owner_authorization';
  cancellation: 'not_applicable' | 'pre_arm_cancel_post_arm_rollback';
  restartBehavior: 'read_only' | 'durable_reconcile';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

const runResult = objectSchema({
  run: DELIVERY_RUN_SCHEMA,
  resultDigest: digest,
  receiptBinding: objectSchema({ receiptVersion: { const: '2.0.0' }, required: { const: true } }, ['receiptVersion', 'required']),
}, ['run', 'resultDigest', 'receiptBinding']);

const readContract = (operation: DeliveryOperationName, input: Record<string, unknown>, output = runResult): DeliveryOperationContract => ({
  operation,
  version: DELIVERY_OPERATION_VERSION,
  mutation: false,
  risk: 'low',
  idempotency: 'read_only',
  confirmation: 'not_required',
  cancellation: 'not_applicable',
  restartBehavior: 'read_only',
  input,
  output,
});

const mutateContract = (operation: DeliveryOperationName, risk: 'medium' | 'high', input: Record<string, unknown>): DeliveryOperationContract => ({
  operation,
  version: DELIVERY_OPERATION_VERSION,
  mutation: true,
  risk,
  idempotency: 'semantic_replay_or_conflict',
  confirmation: 'bound_owner_authorization',
  cancellation: 'pre_arm_cancel_post_arm_rollback',
  restartBehavior: 'durable_reconcile',
  input,
  output: runResult,
});

export const DELIVERY_OPERATION_CONTRACTS: readonly DeliveryOperationContract[] = Object.freeze([
  mutateContract('baby.delivery.plan', 'medium', objectSchema({ plan: planBody, authorizedPlanDigest: digest }, ['plan', 'authorizedPlanDigest'])),
  mutateContract('baby.delivery.execute', 'high', objectSchema({ deliveryId: identifier, planDigest: digest, expectedSequence: integer }, ['deliveryId', 'planDigest', 'expectedSequence'])),
  readContract('baby.delivery.get', objectSchema({ deliveryId: identifier }, ['deliveryId'])),
  readContract('baby.delivery.list', objectSchema({ offset: integer, limit: { type: 'integer', minimum: 1, maximum: 200 }, state: { enum: DELIVERY_STATES } })),
  readContract('baby.delivery.events', objectSchema({ deliveryId: identifier, offset: integer, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['deliveryId']), objectSchema({ deliveryId: identifier, offset: integer, nextOffset: integer, items: { type: 'array', items: DELIVERY_EVENT_SCHEMA } }, ['deliveryId', 'offset', 'nextOffset', 'items'])),
  readContract('baby.delivery.verify', objectSchema({ deliveryId: identifier }, ['deliveryId'])),
  mutateContract('baby.delivery.cancel', 'high', objectSchema({ deliveryId: identifier, planDigest: digest, reason: string }, ['deliveryId', 'planDigest', 'reason'])),
  mutateContract('baby.delivery.rollback', 'high', objectSchema({ deliveryId: identifier, planDigest: digest, reason: string }, ['deliveryId', 'planDigest', 'reason'])),
  mutateContract('baby.delivery.repair', 'high', objectSchema({ deliveryId: identifier, planDigest: digest, expectedSequence: integer, authorizationReference: string }, ['deliveryId', 'planDigest', 'expectedSequence', 'authorizationReference'])),
  readContract('baby.delivery.evidence.get', objectSchema({ deliveryId: identifier, kind: identifier, offset: integer, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['deliveryId']), objectSchema({ deliveryId: identifier, offset: integer, nextOffset: integer, items: { type: 'array', items: DELIVERY_EVIDENCE_SCHEMA } }, ['deliveryId', 'offset', 'nextOffset', 'items'])),
]);

export const DELIVERY_TYPED_ERRORS = Object.freeze([
  'delivery_invalid', 'delivery_not_found', 'delivery_conflict', 'delivery_plan_changed',
  'delivery_authorization_invalid', 'delivery_expired', 'delivery_wrong_host', 'delivery_wrong_machine',
  'delivery_source_mismatch', 'delivery_tree_mismatch', 'delivery_source_digest_mismatch',
  'delivery_credential_unavailable', 'delivery_controller_conflict', 'delivery_generation_conflict',
  'delivery_state_conflict', 'delivery_receipt_invalid', 'delivery_evidence_insufficient',
  'delivery_rollback_failed', 'delivery_manual_recovery_required', 'delivery_unknown',
  'idempotency_conflict',
]);

export const DELIVERY_LIMITS = Object.freeze({
  defaultPageSize: 50,
  maximumPageSize: 200,
  maximumInlineBytes: 65536,
  maximumEventsPerRun: 100000,
  monotonicEventOffsets: true,
  secretMaterialAllowed: false,
  credentialReferencesOnly: true,
});
