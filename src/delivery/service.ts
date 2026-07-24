/** Durable automated-delivery operation service over the authoritative deployment database. */

import { canonicalJson, sha256Hex } from '../crypto/canonical.js';
import { getHostname, getMachineIdSha256 } from '../config.js';
import { OperationError } from '../operations/errors.js';
import type { DeploymentDatabase } from '../deployment/database.js';
import { assertAuthorizedPlan, canonicalizeDeliveryPlan } from './plan.js';
import { DeliveryError, type DeliveryRunRecord, type DeliveryState } from './types.js';

export const DELIVERY_OPERATIONS = new Set([
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
]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperationError('invalid_request', `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OperationError('invalid_request', `${label} is required`);
  }
  return value;
}

function integer(value: unknown, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new OperationError('invalid_request', `${label} must be a nonnegative integer`);
  }
  return Number(value);
}

function mapped(error: unknown): never {
  if (error instanceof OperationError) throw error;
  if (error instanceof DeliveryError) throw new OperationError(error.code, error.message, false, error.details);
  throw new OperationError('operation_failed', error instanceof Error ? error.message : 'Delivery operation failed');
}

export class AutomatedDeliveryService {
  constructor(
    private readonly database: DeploymentDatabase,
    private readonly fixtureMode: boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static handles(operation: string): boolean {
    return DELIVERY_OPERATIONS.has(operation);
  }

  execute(operation: string, requestId: string, raw: Record<string, unknown>): unknown {
    try {
      switch (operation) {
        case 'baby.delivery.plan': return this.plan(requestId, raw);
        case 'baby.delivery.execute': return this.advance(requestId, raw, 'SOURCE_VERIFIED', 'source', 'source_verified');
        case 'baby.delivery.get': return this.result(this.required(text(raw.deliveryId, 'deliveryId')));
        case 'baby.delivery.list': return this.list(raw);
        case 'baby.delivery.events': return this.events(raw);
        case 'baby.delivery.verify': return this.verify(raw);
        case 'baby.delivery.cancel': return this.advance(requestId, raw, 'CANCELLED_PRE_ARM', 'cancel', 'cancelled_pre_arm');
        case 'baby.delivery.rollback': return this.advance(requestId, raw, 'ROLLBACK_REQUESTED', 'rollback', 'rollback_requested');
        case 'baby.delivery.repair': return this.advance(requestId, raw, 'REPAIR_REQUIRED', 'repair', 'repair_required');
        case 'baby.delivery.evidence.get': return this.evidence(raw);
        default: throw new OperationError('unknown_operation', `Unknown delivery operation: ${operation}`);
      }
    } catch (error) {
      return mapped(error);
    }
  }

  private plan(requestId: string, body: Record<string, unknown>): Record<string, unknown> {
    const plan = canonicalizeDeliveryPlan(object(body.plan, 'plan'));
    assertAuthorizedPlan(plan, text(body.authorizedPlanDigest, 'authorizedPlanDigest'));
    const hostname = getHostname();
    const machineId = getMachineIdSha256() || 'unknown';
    if (plan.targetHostname !== hostname) {
      throw new DeliveryError('delivery_wrong_host', 'Delivery plan targets another hostname', { expected: hostname, actual: plan.targetHostname });
    }
    if (plan.targetMachineIdentity !== machineId) {
      throw new DeliveryError('delivery_wrong_machine', 'Delivery plan targets another machine identity', { expected: machineId, actual: plan.targetMachineIdentity });
    }
    const existing = this.database.deliveries.getRun(plan.deliveryId);
    const run = existing ?? this.database.deliveries.createRun(plan, 1, this.now().toISOString());
    if (existing && existing.planDigest !== plan.planDigest) {
      throw new DeliveryError('delivery_plan_changed', 'Delivery ID is already bound to another plan');
    }
    return this.result(run, requestId);
  }

  private advance(
    requestId: string,
    body: Record<string, unknown>,
    nextState: DeliveryState,
    phase: string,
    kind: string,
  ): Record<string, unknown> {
    this.assertFixtureExecution(`baby.delivery.${phase === 'source' ? 'execute' : phase}`);
    const deliveryId = text(body.deliveryId, 'deliveryId');
    const planDigest = text(body.planDigest, 'planDigest');
    const expectedSequence = integer(body.expectedSequence, 'expectedSequence', 0);
    const current = this.required(deliveryId);
    const result = this.database.deliveries.transition({
      deliveryId,
      planDigest,
      generation: current.generation,
      expectedState: current.state,
      expectedSequence,
      nextState,
      phase,
      kind,
      message: typeof body.reason === 'string' ? body.reason : `${kind} accepted`,
      idempotencyKey: requestId,
      occurredAt: this.now().toISOString(),
    });
    return this.result(result.run, requestId);
  }

  private list(body: Record<string, unknown>): Record<string, unknown> {
    const offset = integer(body.offset, 'offset', 0);
    const limit = Math.min(Math.max(integer(body.limit, 'limit', 50), 1), 200);
    const state = typeof body.state === 'string' ? body.state as DeliveryState : undefined;
    const items = this.database.deliveries.listRuns({ offset, limit, ...(state ? { state } : {}) });
    return { offset, nextOffset: offset + items.length, items };
  }

  private events(body: Record<string, unknown>): Record<string, unknown> {
    const deliveryId = text(body.deliveryId, 'deliveryId');
    const offset = integer(body.offset, 'offset', 0);
    const limit = Math.min(Math.max(integer(body.limit, 'limit', 50), 1), 200);
    const page = this.database.deliveries.listEvents(deliveryId, offset, limit);
    return { ...page, deliveryId };
  }

  private evidence(body: Record<string, unknown>): Record<string, unknown> {
    const deliveryId = text(body.deliveryId, 'deliveryId');
    const offset = integer(body.offset, 'offset', 0);
    const limit = Math.min(Math.max(integer(body.limit, 'limit', 50), 1), 200);
    const kind = typeof body.kind === 'string' ? body.kind : undefined;
    const page = this.database.deliveries.listEvidence(deliveryId, { offset, limit, ...(kind ? { kind } : {}) });
    return { ...page, deliveryId };
  }

  private verify(body: Record<string, unknown>): Record<string, unknown> {
    const run = this.required(text(body.deliveryId, 'deliveryId'));
    const plan = this.database.deliveries.getPlan(run.deliveryId);
    if (!plan || plan.planDigest !== run.planDigest) {
      throw new DeliveryError('delivery_plan_changed', 'Stored delivery plan does not match run identity');
    }
    const events = this.database.deliveries.listEvents(run.deliveryId, 0, 200).items;
    const evidence = this.database.deliveries.listEvidence(run.deliveryId, { offset: 0, limit: 200 }).items;
    const verificationDigest = sha256Hex(canonicalJson({ run, plan, events, evidence }));
    return { ...this.result(run), verification: { status: 'verified', verificationDigest } };
  }

  private required(deliveryId: string): DeliveryRunRecord {
    const run = this.database.deliveries.getRun(deliveryId);
    if (!run) throw new DeliveryError('delivery_not_found', `Delivery ${deliveryId} not found`);
    return run;
  }

  private result(run: DeliveryRunRecord, requestId?: string): Record<string, unknown> {
    const body = { run, resultDigest: sha256Hex(canonicalJson(run)), receiptBinding: { receiptVersion: '2.0.0', required: true } };
    return requestId ? { ...body, requestId } : body;
  }

  private assertFixtureExecution(operation: string): void {
    if (!this.fixtureMode) {
      throw new OperationError(
        'resource_unavailable',
        `${operation} requires the separately bootstrapped automated-delivery controller`,
        true,
        { supportState: 'unavailable', productionMutation: false },
      );
    }
  }
}
