/** Strict canonicalization and hashing for owner-authorized delivery plans. */

import { canonicalJson, sha256Hex } from '../crypto/canonical.js';
import {
  DELIVERY_PLAN_SCHEMA_VERSION,
  SOURCE_MATERIALIZATION_ADAPTERS,
  DeliveryError,
  type CanonicalDeliveryPlan,
  type DeliveryAcceptanceProfile,
  type DeliveryBuildProfile,
  type DeliveryCandidateVerificationProfile,
  type DeliveryCertificationProfile,
  type DeliveryCostBounds,
  type DeliveryLockfileIdentity,
  type DeliveryPlanInput,
  type DeliveryResourceBounds,
  type DeliveryRetentionPolicy,
  type DeliveryRollbackPolicy,
  type DeliverySoakProfile,
  type DeliverySourceIdentity,
  type DeliveryTestProfile,
  type DeliveryTimeBounds,
  type DeliveryToolchainIdentity,
} from './types.js';

const DIGEST = /^[a-f0-9]{64}$/u;
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,511}$/u;
const PATH = /^\/(?:[^\0/]+\/)*[^\0/]*$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeliveryError('delivery_invalid', `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw new DeliveryError('delivery_invalid', `${label} has unexpected or missing fields`, {
      expected: wanted,
      actual,
    });
  }
}

function text(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new DeliveryError('delivery_invalid', `${label} must be a nonempty bounded string`);
  }
  if (pattern && !pattern.test(value)) {
    throw new DeliveryError('delivery_invalid', `${label} has invalid format`);
  }
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new DeliveryError('delivery_invalid', `${label} must be boolean`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new DeliveryError('delivery_invalid', `${label} must be an integer >= ${minimum}`);
  }
  return Number(value);
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== result) {
    throw new DeliveryError('delivery_invalid', `${label} must be canonical ISO-8601`);
  }
  return result;
}

function strings(value: unknown, label: string, options: { nonempty?: boolean; pattern?: RegExp } = {}): string[] {
  if (!Array.isArray(value) || (options.nonempty === true && value.length === 0) || value.length > 512) {
    throw new DeliveryError('delivery_invalid', `${label} must be a bounded string array`);
  }
  const result = value.map((item, index) => text(item, `${label}[${index}]`, options.pattern));
  if (new Set(result).size !== result.length) {
    throw new DeliveryError('delivery_invalid', `${label} must not contain duplicates`);
  }
  return result;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function source(value: unknown, index: number): DeliverySourceIdentity {
  const item = record(value, `products[${index}]`);
  const allowed = ['product', 'repository', 'commit', 'tree', 'adapter', 'immutableDigest', 'credentialReference'];
  const required = allowed.filter((key) => key !== 'credentialReference');
  const actual = Object.keys(item);
  if (actual.some((key) => !allowed.includes(key)) || required.some((key) => !actual.includes(key))) {
    throw new DeliveryError('delivery_invalid', `products[${index}] has unexpected or missing fields`);
  }
  const product = text(item.product, `products[${index}].product`);
  if (product !== 'baby-quirt' && product !== 'baby-quirt-mcp') {
    throw new DeliveryError('delivery_invalid', `products[${index}].product is unsupported`);
  }
  const repository = text(item.repository, `products[${index}].repository`, REFERENCE);
  if (repository !== `StealthEyeLLC/${product}`) {
    throw new DeliveryError('delivery_invalid', `${product} repository identity is not canonical`);
  }
  const adapter = text(item.adapter, `products[${index}].adapter`);
  if (!(SOURCE_MATERIALIZATION_ADAPTERS as readonly string[]).includes(adapter)) {
    throw new DeliveryError('delivery_invalid', `products[${index}].adapter is unsupported`);
  }
  const credentialReference = item.credentialReference === undefined
    ? undefined
    : text(item.credentialReference, `products[${index}].credentialReference`, REFERENCE);
  if (adapter === 'authenticated_git' && credentialReference === undefined) {
    throw new DeliveryError('delivery_credential_unavailable', 'authenticated_git requires a credential reference');
  }
  if (adapter !== 'authenticated_git' && credentialReference !== undefined) {
    throw new DeliveryError('delivery_invalid', 'credentialReference is valid only for authenticated_git');
  }
  return {
    product,
    repository,
    commit: text(item.commit, `products[${index}].commit`, GIT_OBJECT),
    tree: text(item.tree, `products[${index}].tree`, GIT_OBJECT),
    adapter: adapter as DeliverySourceIdentity['adapter'],
    immutableDigest: text(item.immutableDigest, `products[${index}].immutableDigest`, DIGEST),
    ...(credentialReference === undefined ? {} : { credentialReference }),
  };
}

function toolchain(value: unknown, index: number): DeliveryToolchainIdentity {
  const item = record(value, `buildProfile.toolchains[${index}]`);
  const allowed = item.digest === undefined ? ['name', 'version'] : ['name', 'version', 'digest'];
  exact(item, allowed, `buildProfile.toolchains[${index}]`);
  return {
    name: text(item.name, `buildProfile.toolchains[${index}].name`, IDENTIFIER),
    version: text(item.version, `buildProfile.toolchains[${index}].version`, REFERENCE),
    ...(item.digest === undefined ? {} : { digest: text(item.digest, `buildProfile.toolchains[${index}].digest`, DIGEST) }),
  };
}

function lockfile(value: unknown, index: number): DeliveryLockfileIdentity {
  const item = record(value, `buildProfile.lockfiles[${index}]`);
  exact(item, ['path', 'sha256'], `buildProfile.lockfiles[${index}]`);
  return {
    path: text(item.path, `buildProfile.lockfiles[${index}].path`),
    sha256: text(item.sha256, `buildProfile.lockfiles[${index}].sha256`, DIGEST),
  };
}

function buildProfile(value: unknown): DeliveryBuildProfile {
  const item = record(value, 'buildProfile');
  exact(item, ['name', 'version', 'commands', 'toolchains', 'lockfiles', 'cleanEnvironment', 'reproducibleBuilds'], 'buildProfile');
  if (!Array.isArray(item.toolchains) || item.toolchains.length === 0 || item.toolchains.length > 64) {
    throw new DeliveryError('delivery_invalid', 'buildProfile.toolchains must be a nonempty bounded array');
  }
  if (!Array.isArray(item.lockfiles) || item.lockfiles.length === 0 || item.lockfiles.length > 64) {
    throw new DeliveryError('delivery_invalid', 'buildProfile.lockfiles must be a nonempty bounded array');
  }
  const toolchains = item.toolchains.map(toolchain).sort((a, b) => a.name.localeCompare(b.name));
  const lockfiles = item.lockfiles.map(lockfile).sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(toolchains.map((entry) => entry.name)).size !== toolchains.length) {
    throw new DeliveryError('delivery_invalid', 'buildProfile.toolchains contains duplicate names');
  }
  if (new Set(lockfiles.map((entry) => entry.path)).size !== lockfiles.length) {
    throw new DeliveryError('delivery_invalid', 'buildProfile.lockfiles contains duplicate paths');
  }
  return {
    name: text(item.name, 'buildProfile.name', IDENTIFIER),
    version: text(item.version, 'buildProfile.version', REFERENCE),
    commands: strings(item.commands, 'buildProfile.commands', { nonempty: true }),
    toolchains,
    lockfiles,
    cleanEnvironment: bool(item.cleanEnvironment, 'buildProfile.cleanEnvironment'),
    reproducibleBuilds: integer(item.reproducibleBuilds, 'buildProfile.reproducibleBuilds', 2),
  };
}

function testProfile(value: unknown): DeliveryTestProfile {
  const item = record(value, 'testProfile');
  exact(item, ['name', 'version', 'commands', 'requireZeroSkips', 'requireStableCounts'], 'testProfile');
  return {
    name: text(item.name, 'testProfile.name', IDENTIFIER),
    version: text(item.version, 'testProfile.version', REFERENCE),
    commands: strings(item.commands, 'testProfile.commands', { nonempty: true }),
    requireZeroSkips: bool(item.requireZeroSkips, 'testProfile.requireZeroSkips'),
    requireStableCounts: bool(item.requireStableCounts, 'testProfile.requireStableCounts'),
  };
}

function certificationProfile(value: unknown): DeliveryCertificationProfile {
  const item = record(value, 'certificationProfile');
  exact(item, ['name', 'version', 'requiredNspawnProperties', 'cycles', 'requireSystemdPid1', 'requireUid0Supervisor', 'requireGatewayUid997', 'destroyAfterCertification'], 'certificationProfile');
  const cycles = strings(item.cycles, 'certificationProfile.cycles', { nonempty: true });
  const requiredCycles = ['success', 'automatic_rollback', 'restart_or_reboot_recovery'];
  if (requiredCycles.some((cycle) => !cycles.includes(cycle))) {
    throw new DeliveryError('delivery_invalid', 'certificationProfile.cycles lacks a required production-shaped cycle');
  }
  return {
    name: text(item.name, 'certificationProfile.name', IDENTIFIER),
    version: text(item.version, 'certificationProfile.version', REFERENCE),
    requiredNspawnProperties: sorted(strings(item.requiredNspawnProperties, 'certificationProfile.requiredNspawnProperties', { nonempty: true })),
    cycles: cycles as DeliveryCertificationProfile['cycles'],
    requireSystemdPid1: bool(item.requireSystemdPid1, 'certificationProfile.requireSystemdPid1'),
    requireUid0Supervisor: bool(item.requireUid0Supervisor, 'certificationProfile.requireUid0Supervisor'),
    requireGatewayUid997: bool(item.requireGatewayUid997, 'certificationProfile.requireGatewayUid997'),
    destroyAfterCertification: bool(item.destroyAfterCertification, 'certificationProfile.destroyAfterCertification'),
  };
}

function candidateProfile(value: unknown): DeliveryCandidateVerificationProfile {
  const item = record(value, 'candidateVerificationProfile');
  exact(item, ['name', 'version', 'checks'], 'candidateVerificationProfile');
  return {
    name: text(item.name, 'candidateVerificationProfile.name', IDENTIFIER),
    version: text(item.version, 'candidateVerificationProfile.version', REFERENCE),
    checks: strings(item.checks, 'candidateVerificationProfile.checks', { nonempty: true }),
  };
}

function acceptanceProfile(value: unknown): DeliveryAcceptanceProfile {
  const item = record(value, 'acceptanceProfile');
  exact(item, ['privateChecks', 'publicChecks', 'requireAll'], 'acceptanceProfile');
  return {
    privateChecks: strings(item.privateChecks, 'acceptanceProfile.privateChecks', { nonempty: true }),
    publicChecks: strings(item.publicChecks, 'acceptanceProfile.publicChecks', { nonempty: true }),
    requireAll: bool(item.requireAll, 'acceptanceProfile.requireAll'),
  };
}

function soakProfile(value: unknown): DeliverySoakProfile {
  const item = record(value, 'soakProfile');
  exact(item, ['durationSeconds', 'checkpointSeconds', 'checks'], 'soakProfile');
  const durationSeconds = integer(item.durationSeconds, 'soakProfile.durationSeconds', 1);
  if (!Array.isArray(item.checkpointSeconds) || item.checkpointSeconds.length === 0) {
    throw new DeliveryError('delivery_invalid', 'soakProfile.checkpointSeconds must be nonempty');
  }
  const checkpointSeconds = item.checkpointSeconds.map((entry, index) => integer(entry, `soakProfile.checkpointSeconds[${index}]`, 1));
  if (checkpointSeconds.some((entry) => entry > durationSeconds)) {
    throw new DeliveryError('delivery_invalid', 'soak checkpoint exceeds duration');
  }
  if (new Set(checkpointSeconds).size !== checkpointSeconds.length) {
    throw new DeliveryError('delivery_invalid', 'soak checkpoints must be unique');
  }
  return {
    durationSeconds,
    checkpointSeconds: checkpointSeconds.sort((a, b) => a - b),
    checks: strings(item.checks, 'soakProfile.checks', { nonempty: true }),
  };
}

function rollbackPolicy(value: unknown): DeliveryRollbackPolicy {
  const item = record(value, 'rollbackPolicy');
  exact(item, ['automaticOnAcceptanceFailure', 'automaticOnSoakFailure', 'automaticOnDeadline', 'cancellationAfterArm', 'unknownDisposition', 'rollbackFailureDisposition'], 'rollbackPolicy');
  if (item.cancellationAfterArm !== 'rollback' || item.unknownDisposition !== 'repair_required' || item.rollbackFailureDisposition !== 'manual_recovery_required') {
    throw new DeliveryError('delivery_invalid', 'rollback policy weakens fixed recovery semantics');
  }
  return {
    automaticOnAcceptanceFailure: bool(item.automaticOnAcceptanceFailure, 'rollbackPolicy.automaticOnAcceptanceFailure'),
    automaticOnSoakFailure: bool(item.automaticOnSoakFailure, 'rollbackPolicy.automaticOnSoakFailure'),
    automaticOnDeadline: bool(item.automaticOnDeadline, 'rollbackPolicy.automaticOnDeadline'),
    cancellationAfterArm: 'rollback',
    unknownDisposition: 'repair_required',
    rollbackFailureDisposition: 'manual_recovery_required',
  };
}

function resourceBounds(value: unknown): DeliveryResourceBounds {
  const item = record(value, 'resourceBounds');
  const keys = ['maxWallSeconds', 'maxCpuSeconds', 'maxMemoryBytes', 'maxDiskBytes', 'maxInodes', 'maxOutputBytes', 'maxArtifacts'] as const;
  exact(item, keys, 'resourceBounds');
  return Object.fromEntries(keys.map((key) => [key, integer(item[key], `resourceBounds.${key}`, 1)])) as unknown as DeliveryResourceBounds;
}

function timeBounds(value: unknown): DeliveryTimeBounds {
  const item = record(value, 'timeBounds');
  exact(item, ['notBefore', 'expiresAt', 'guardDeadline'], 'timeBounds');
  const result = {
    notBefore: timestamp(item.notBefore, 'timeBounds.notBefore'),
    expiresAt: timestamp(item.expiresAt, 'timeBounds.expiresAt'),
    guardDeadline: timestamp(item.guardDeadline, 'timeBounds.guardDeadline'),
  };
  if (!(new Date(result.notBefore) < new Date(result.guardDeadline) && new Date(result.guardDeadline) <= new Date(result.expiresAt))) {
    throw new DeliveryError('delivery_invalid', 'time bounds must satisfy notBefore < guardDeadline <= expiresAt');
  }
  return result;
}

function costBounds(value: unknown): DeliveryCostBounds {
  const item = record(value, 'costBounds');
  exact(item, ['currency', 'maximumMinorUnits'], 'costBounds');
  return {
    currency: text(item.currency, 'costBounds.currency', /^[A-Z]{3}$/u),
    maximumMinorUnits: integer(item.maximumMinorUnits, 'costBounds.maximumMinorUnits'),
  };
}

function retentionPolicy(value: unknown): DeliveryRetentionPolicy {
  const item = record(value, 'retentionPolicy');
  const keys = ['eventDays', 'evidenceDays', 'artifactDays', 'retainTerminalRuns'] as const;
  exact(item, keys, 'retentionPolicy');
  return Object.fromEntries(keys.map((key) => [key, integer(item[key], `retentionPolicy.${key}`, 1)])) as unknown as DeliveryRetentionPolicy;
}

export function canonicalizeDeliveryPlan(value: unknown): CanonicalDeliveryPlan {
  const item = record(value, 'delivery plan');
  const keys = [
    'schemaVersion', 'deliveryId', 'ownerPrincipal', 'authorizationReference',
    'targetHostname', 'targetMachineIdentity', 'products', 'buildProfile', 'testProfile',
    'certificationProfile', 'targetReleaseIdentifiers', 'protectedReleases', 'protectedPaths',
    'candidateVerificationProfile', 'activationOrder', 'acceptanceProfile', 'soakProfile',
    'rollbackPolicy', 'timeBounds', 'allowedExternalSideEffects', 'resourceBounds',
    'costBounds', 'evidenceRequirements', 'retentionPolicy',
  ] as const;
  exact(item, keys, 'delivery plan');
  if (item.schemaVersion !== DELIVERY_PLAN_SCHEMA_VERSION) {
    throw new DeliveryError('delivery_invalid', `schemaVersion must be ${DELIVERY_PLAN_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(item.products) || item.products.length !== 2) {
    throw new DeliveryError('delivery_invalid', 'products must contain exactly Baby and Gateway');
  }
  const products = item.products.map(source).sort((a, b) => a.product.localeCompare(b.product));
  if (new Set(products.map((entry) => entry.product)).size !== 2) {
    throw new DeliveryError('delivery_invalid', 'products must contain unique Baby and Gateway identities');
  }
  const targets = record(item.targetReleaseIdentifiers, 'targetReleaseIdentifiers');
  exact(targets, ['baby-quirt', 'baby-quirt-mcp'], 'targetReleaseIdentifiers');
  const activationOrder = strings(item.activationOrder, 'activationOrder');
  if (canonicalJson(activationOrder) !== canonicalJson(['baby-quirt-mcp', 'baby-quirt'])) {
    throw new DeliveryError('delivery_invalid', 'activationOrder must preserve gateway-before-Baby compatibility');
  }
  const body: DeliveryPlanInput = {
    schemaVersion: DELIVERY_PLAN_SCHEMA_VERSION,
    deliveryId: text(item.deliveryId, 'deliveryId', IDENTIFIER),
    ownerPrincipal: text(item.ownerPrincipal, 'ownerPrincipal', IDENTIFIER),
    authorizationReference: text(item.authorizationReference, 'authorizationReference', REFERENCE),
    targetHostname: text(item.targetHostname, 'targetHostname', IDENTIFIER),
    targetMachineIdentity: text(item.targetMachineIdentity, 'targetMachineIdentity', DIGEST),
    products,
    buildProfile: buildProfile(item.buildProfile),
    testProfile: testProfile(item.testProfile),
    certificationProfile: certificationProfile(item.certificationProfile),
    targetReleaseIdentifiers: {
      'baby-quirt': text(targets['baby-quirt'], 'targetReleaseIdentifiers.baby-quirt', IDENTIFIER),
      'baby-quirt-mcp': text(targets['baby-quirt-mcp'], 'targetReleaseIdentifiers.baby-quirt-mcp', IDENTIFIER),
    },
    protectedReleases: sorted(strings(item.protectedReleases, 'protectedReleases', { nonempty: true, pattern: IDENTIFIER })),
    protectedPaths: sorted(strings(item.protectedPaths, 'protectedPaths', { nonempty: true, pattern: PATH })),
    candidateVerificationProfile: candidateProfile(item.candidateVerificationProfile),
    activationOrder: activationOrder as DeliveryPlanInput['activationOrder'],
    acceptanceProfile: acceptanceProfile(item.acceptanceProfile),
    soakProfile: soakProfile(item.soakProfile),
    rollbackPolicy: rollbackPolicy(item.rollbackPolicy),
    timeBounds: timeBounds(item.timeBounds),
    allowedExternalSideEffects: sorted(strings(item.allowedExternalSideEffects, 'allowedExternalSideEffects')),
    resourceBounds: resourceBounds(item.resourceBounds),
    costBounds: costBounds(item.costBounds),
    evidenceRequirements: sorted(strings(item.evidenceRequirements, 'evidenceRequirements', { nonempty: true, pattern: IDENTIFIER })),
    retentionPolicy: retentionPolicy(item.retentionPolicy),
  };
  const planDigest = sha256Hex(canonicalJson(body));
  return { ...body, planDigest };
}

export function canonicalDeliveryPlanJson(value: unknown): string {
  return canonicalJson(canonicalizeDeliveryPlan(value));
}

export function assertAuthorizedPlan(plan: CanonicalDeliveryPlan, authorizedPlanDigest: string): void {
  if (!DIGEST.test(authorizedPlanDigest) || plan.planDigest !== authorizedPlanDigest) {
    throw new DeliveryError('delivery_authorization_invalid', 'Authorization does not bind the exact canonical delivery plan', {
      expected: plan.planDigest,
      authorized: authorizedPlanDigest,
    });
  }
}
