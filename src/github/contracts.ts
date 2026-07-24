/**
 * Universal GitHub Authority v1 normative contracts.
 *
 * Checkpoint A deliberately freezes schemas, authority boundaries, errors, and
 * lifecycle truth without advertising these operations through baby.describe.
 * Later checkpoints may register an operation only after its handler and
 * durable implementation exist.
 */

export const GITHUB_AUTHORITY_CONTRACT_VERSION = '1.0.0' as const;
export const GITHUB_AUTHORITY_SUPPORT_STATE = 'contract_only' as const;

export type GitObjectId = string;
export type DigestSha256 = string;
export type IsoTimestamp = string;
export type GitHubAuthorityRisk = 'low' | 'medium' | 'high';
export type GitHubAuthorityOwner = 'local_git' | 'github_provider' | 'compound';
export type GitHubCredentialType =
  | 'ssh_deploy_key'
  | 'github_app_installation'
  | 'fine_grained_token'
  | 'commit_signing';

export interface GitRepositoryIdentity {
  repositoryId: string;
  canonicalRemote: string;
  host: string;
  owner: string;
  name: string;
  numericRepositoryId?: number;
}

export interface GitSourceIdentity {
  repository: GitRepositoryIdentity;
  ref?: string;
  commit: GitObjectId;
  tree: GitObjectId;
  parents: GitObjectId[];
}

export interface GitCredentialReference {
  credentialReferenceId: string;
  credentialType: GitHubCredentialType;
  provider: 'git' | 'github';
  accountOrInstallationId: string;
  repositoryAuthorityId: string;
  allowedOperationFamilies: string[];
  permissionSnapshotDigest: DigestSha256;
  expiresAt?: IsoTimestamp;
  revoked: boolean;
  health: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
}

export interface GitWorkspaceIdentity {
  workspaceId: string;
  repositoryId: string;
  mirrorPath: string;
  worktreePath: string;
  branch?: string;
  head: GitObjectId;
  tree: GitObjectId;
  clean: boolean;
}

export interface GitRefExpectation {
  remote: string;
  destinationRef: string;
  expectedOldObject?: GitObjectId;
  newObject: GitObjectId;
  newTree: GitObjectId;
  fastForwardOnly: true;
}

export interface GitPushPlan {
  planId: string;
  planDigest: DigestSha256;
  principal: string;
  repositoryAuthorityId: string;
  workspace: GitWorkspaceIdentity;
  credentialReferenceId: string;
  sourceRef: string;
  expectation: GitRefExpectation;
  mergeBase?: GitObjectId;
  objectsToTransfer: GitObjectId[];
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

export interface GitCommitEvidence {
  commit: GitObjectId;
  tree: GitObjectId;
  parents: GitObjectId[];
  authorIdentityReference: string;
  committerIdentityReference: string;
  messageDigest: DigestSha256;
  changedPaths: string[];
  signatureStatus: 'verified' | 'unsigned' | 'not_configured';
}

export interface GitTreeEvidence {
  tree: GitObjectId;
  entryCount: number;
  changedPaths: string[];
  digest: DigestSha256;
}

export interface GitRemoteReadback {
  repository: GitRepositoryIdentity;
  remote: string;
  destinationRef: string;
  observedObject?: GitObjectId;
  observedCommit?: GitObjectId;
  observedTree?: GitObjectId;
  expectedObject: GitObjectId;
  expectedTree: GitObjectId;
  ancestryVerified: boolean;
  observedAt: IsoTimestamp;
}

export interface GitHubProviderAccount {
  providerAccountId: string;
  host: string;
  credentialReferenceId: string;
  credentialType: GitHubCredentialType;
  login?: string;
  accountId?: number;
  installationId?: number;
  health: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  lastSuccessfulUse?: IsoTimestamp;
}

export interface GitHubPermissionSnapshot {
  snapshotId: string;
  digest: DigestSha256;
  repositoryPermissions: Record<string, 'none' | 'read' | 'write' | 'admin'>;
  organizationPermissions: Record<string, 'none' | 'read' | 'write' | 'admin'>;
  capturedAt: IsoTimestamp;
}

export interface GitHubRepositoryAuthority {
  authorityId: string;
  schemaVersion: typeof GITHUB_AUTHORITY_CONTRACT_VERSION;
  principal: string;
  repository: GitRepositoryIdentity;
  credentialReferenceId: string;
  credentialType: GitHubCredentialType;
  readWriteClassification: 'read_only' | 'read_write';
  allowedBranchPatterns: string[];
  allowedOperationFamilies: string[];
  permissionSnapshot: GitHubPermissionSnapshot;
  pinnedSshHostKeyDigest?: DigestSha256;
  createdAt: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  revoked: boolean;
  lastVerifiedAt?: IsoTimestamp;
  health: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
}

export interface GitHubRateLimitState {
  limit: number;
  remaining: number;
  used: number;
  resetsAt: IsoTimestamp;
  retryAfterSeconds?: number;
  secondaryLimited: boolean;
  observedAt: IsoTimestamp;
}

export type GitHubMutationState =
  | 'intent_persisted'
  | 'local_prepared'
  | 'remote_attempted'
  | 'remote_reconciled'
  | 'verified'
  | 'failed'
  | 'ambiguous'
  | 'unknown';

export interface GitHubMutationIntent {
  mutationId: string;
  schemaVersion: typeof GITHUB_AUTHORITY_CONTRACT_VERSION;
  operation: GitHubAuthorityOperationName;
  principal: string;
  authorityReference: string;
  repository: GitRepositoryIdentity;
  semanticIdempotencyFingerprint: DigestSha256;
  requestedStateDigest: DigestSha256;
  state: GitHubMutationState;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

export interface GitHubMutationReadback {
  mutationId: string;
  state: GitHubMutationState;
  externalIdentifiers: Record<string, string | number>;
  observedStateDigest?: DigestSha256;
  evidenceReferences: string[];
  eventCursor: number;
  restartBehavior: 'durable_reconcile';
  recoveryState: 'none' | 'automatic' | 'manual' | 'unknown';
  observedAt: IsoTimestamp;
}

export interface GitHubWorkflowIdentity {
  repository: GitRepositoryIdentity;
  workflowId: string;
  workflowName?: string;
  runId: number;
  attempt: number;
  headSha: GitObjectId;
  event: string;
}

export interface GitHubArtifactIdentity {
  repository: GitRepositoryIdentity;
  workflow: GitHubWorkflowIdentity;
  artifactId: number;
  name: string;
  archiveDigest: DigestSha256;
  size: number;
  sourceCommit: GitObjectId;
  sourceTree: GitObjectId;
}

export interface GitHubCredentialEnrollmentRecord {
  enrollmentId: string;
  schemaVersion: typeof GITHUB_AUTHORITY_CONTRACT_VERSION;
  ownerPrincipal: string;
  provider: 'github';
  credentialType: GitHubCredentialType;
  credentialReferenceId: string;
  accountOrInstallationId: string;
  repositoryAuthorityIds: string[];
  allowedOperationFamilies: string[];
  permissionSnapshotDigest: DigestSha256;
  encryptedCredentialName: string;
  encryptedCredentialDigest: DigestSha256;
  createdAt: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  revoked: boolean;
  plaintextPersisted: false;
}

const identifier = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$' } as const;
const nonEmptyString = { type: 'string', minLength: 1, maxLength: 4096 } as const;
const gitObject = { type: 'string', pattern: '^[a-f0-9]{40}$' } as const;
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const timestamp = { type: 'string', format: 'date-time' } as const;
const integer = { type: 'integer', minimum: 0 } as const;
const boolean = { type: 'boolean' } as const;
const stringArray = { type: 'array', items: nonEmptyString } as const;

function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length === 0 ? {} : { required: [...required] }),
  };
}

const repositoryIdentitySchema = objectSchema({
  repositoryId: identifier,
  canonicalRemote: nonEmptyString,
  host: nonEmptyString,
  owner: nonEmptyString,
  name: nonEmptyString,
  numericRepositoryId: integer,
}, ['repositoryId', 'canonicalRemote', 'host', 'owner', 'name']);

const sourceIdentitySchema = objectSchema({
  repository: repositoryIdentitySchema,
  ref: nonEmptyString,
  commit: gitObject,
  tree: gitObject,
  parents: { type: 'array', items: gitObject },
}, ['repository', 'commit', 'tree', 'parents']);

const credentialReferenceSchema = objectSchema({
  credentialReferenceId: identifier,
  credentialType: { enum: ['ssh_deploy_key', 'github_app_installation', 'fine_grained_token', 'commit_signing'] },
  provider: { enum: ['git', 'github'] },
  accountOrInstallationId: identifier,
  repositoryAuthorityId: identifier,
  allowedOperationFamilies: stringArray,
  permissionSnapshotDigest: digest,
  expiresAt: timestamp,
  revoked: boolean,
  health: { enum: ['healthy', 'degraded', 'unavailable', 'unknown'] },
}, [
  'credentialReferenceId', 'credentialType', 'provider', 'accountOrInstallationId',
  'repositoryAuthorityId', 'allowedOperationFamilies', 'permissionSnapshotDigest',
  'revoked', 'health',
]);

const workspaceIdentitySchema = objectSchema({
  workspaceId: identifier,
  repositoryId: identifier,
  mirrorPath: nonEmptyString,
  worktreePath: nonEmptyString,
  branch: nonEmptyString,
  head: gitObject,
  tree: gitObject,
  clean: boolean,
}, ['workspaceId', 'repositoryId', 'mirrorPath', 'worktreePath', 'head', 'tree', 'clean']);

const permissionSnapshotSchema = objectSchema({
  snapshotId: identifier,
  digest,
  repositoryPermissions: { type: 'object', additionalProperties: { enum: ['none', 'read', 'write', 'admin'] } },
  organizationPermissions: { type: 'object', additionalProperties: { enum: ['none', 'read', 'write', 'admin'] } },
  capturedAt: timestamp,
}, ['snapshotId', 'digest', 'repositoryPermissions', 'organizationPermissions', 'capturedAt']);

const repositoryAuthoritySchema = objectSchema({
  authorityId: identifier,
  schemaVersion: { const: GITHUB_AUTHORITY_CONTRACT_VERSION },
  principal: identifier,
  repository: repositoryIdentitySchema,
  credentialReferenceId: identifier,
  credentialType: { enum: ['ssh_deploy_key', 'github_app_installation', 'fine_grained_token', 'commit_signing'] },
  readWriteClassification: { enum: ['read_only', 'read_write'] },
  allowedBranchPatterns: stringArray,
  allowedOperationFamilies: stringArray,
  permissionSnapshot: permissionSnapshotSchema,
  pinnedSshHostKeyDigest: digest,
  createdAt: timestamp,
  expiresAt: timestamp,
  revoked: boolean,
  lastVerifiedAt: timestamp,
  health: { enum: ['healthy', 'degraded', 'unavailable', 'unknown'] },
}, [
  'authorityId', 'schemaVersion', 'principal', 'repository', 'credentialReferenceId',
  'credentialType', 'readWriteClassification', 'allowedBranchPatterns',
  'allowedOperationFamilies', 'permissionSnapshot', 'createdAt', 'revoked', 'health',
]);

const rateLimitSchema = objectSchema({
  limit: integer,
  remaining: integer,
  used: integer,
  resetsAt: timestamp,
  retryAfterSeconds: integer,
  secondaryLimited: boolean,
  observedAt: timestamp,
}, ['limit', 'remaining', 'used', 'resetsAt', 'secondaryLimited', 'observedAt']);

const commitEvidenceSchema = objectSchema({
  commit: gitObject,
  tree: gitObject,
  parents: { type: 'array', items: gitObject },
  authorIdentityReference: identifier,
  committerIdentityReference: identifier,
  messageDigest: digest,
  changedPaths: stringArray,
  signatureStatus: { enum: ['verified', 'unsigned', 'not_configured'] },
}, [
  'commit', 'tree', 'parents', 'authorIdentityReference', 'committerIdentityReference',
  'messageDigest', 'changedPaths', 'signatureStatus',
]);

const remoteReadbackSchema = objectSchema({
  repository: repositoryIdentitySchema,
  remote: nonEmptyString,
  destinationRef: nonEmptyString,
  observedObject: gitObject,
  observedCommit: gitObject,
  observedTree: gitObject,
  expectedObject: gitObject,
  expectedTree: gitObject,
  ancestryVerified: boolean,
  observedAt: timestamp,
}, [
  'repository', 'remote', 'destinationRef', 'expectedObject', 'expectedTree',
  'ancestryVerified', 'observedAt',
]);

const workflowIdentitySchema = objectSchema({
  repository: repositoryIdentitySchema,
  workflowId: identifier,
  workflowName: nonEmptyString,
  runId: integer,
  attempt: { type: 'integer', minimum: 1 },
  headSha: gitObject,
  event: nonEmptyString,
}, ['repository', 'workflowId', 'runId', 'attempt', 'headSha', 'event']);

const artifactIdentitySchema = objectSchema({
  repository: repositoryIdentitySchema,
  workflow: workflowIdentitySchema,
  artifactId: integer,
  name: nonEmptyString,
  archiveDigest: digest,
  size: integer,
  sourceCommit: gitObject,
  sourceTree: gitObject,
}, ['repository', 'workflow', 'artifactId', 'name', 'archiveDigest', 'size', 'sourceCommit', 'sourceTree']);

export const GITHUB_AUTHORITY_MODEL_SCHEMAS = Object.freeze({
  GitRepositoryIdentity: repositoryIdentitySchema,
  GitSourceIdentity: sourceIdentitySchema,
  GitCredentialReference: credentialReferenceSchema,
  GitWorkspaceIdentity: workspaceIdentitySchema,
  GitRefExpectation: objectSchema({
    remote: nonEmptyString,
    destinationRef: nonEmptyString,
    expectedOldObject: gitObject,
    newObject: gitObject,
    newTree: gitObject,
    fastForwardOnly: { const: true },
  }, ['remote', 'destinationRef', 'newObject', 'newTree', 'fastForwardOnly']),
  GitPushPlan: objectSchema({
    planId: identifier,
    planDigest: digest,
    principal: identifier,
    repositoryAuthorityId: identifier,
    workspace: workspaceIdentitySchema,
    credentialReferenceId: identifier,
    sourceRef: nonEmptyString,
    expectation: objectSchema({
      remote: nonEmptyString,
      destinationRef: nonEmptyString,
      expectedOldObject: gitObject,
      newObject: gitObject,
      newTree: gitObject,
      fastForwardOnly: { const: true },
    }, ['remote', 'destinationRef', 'newObject', 'newTree', 'fastForwardOnly']),
    mergeBase: gitObject,
    objectsToTransfer: { type: 'array', items: gitObject },
    createdAt: timestamp,
    expiresAt: timestamp,
  }, [
    'planId', 'planDigest', 'principal', 'repositoryAuthorityId', 'workspace',
    'credentialReferenceId', 'sourceRef', 'expectation', 'objectsToTransfer',
    'createdAt', 'expiresAt',
  ]),
  GitCommitEvidence: commitEvidenceSchema,
  GitTreeEvidence: objectSchema({
    tree: gitObject,
    entryCount: integer,
    changedPaths: stringArray,
    digest,
  }, ['tree', 'entryCount', 'changedPaths', 'digest']),
  GitRemoteReadback: remoteReadbackSchema,
  GitHubProviderAccount: objectSchema({
    providerAccountId: identifier,
    host: nonEmptyString,
    credentialReferenceId: identifier,
    credentialType: { enum: ['ssh_deploy_key', 'github_app_installation', 'fine_grained_token', 'commit_signing'] },
    login: nonEmptyString,
    accountId: integer,
    installationId: integer,
    health: { enum: ['healthy', 'degraded', 'unavailable', 'unknown'] },
    lastSuccessfulUse: timestamp,
  }, ['providerAccountId', 'host', 'credentialReferenceId', 'credentialType', 'health']),
  GitHubRepositoryAuthority: repositoryAuthoritySchema,
  GitHubPermissionSnapshot: permissionSnapshotSchema,
  GitHubRateLimitState: rateLimitSchema,
  GitHubMutationIntent: objectSchema({
    mutationId: identifier,
    schemaVersion: { const: GITHUB_AUTHORITY_CONTRACT_VERSION },
    operation: nonEmptyString,
    principal: identifier,
    authorityReference: identifier,
    repository: repositoryIdentitySchema,
    semanticIdempotencyFingerprint: digest,
    requestedStateDigest: digest,
    state: { enum: ['intent_persisted', 'local_prepared', 'remote_attempted', 'remote_reconciled', 'verified', 'failed', 'ambiguous', 'unknown'] },
    createdAt: timestamp,
    expiresAt: timestamp,
  }, [
    'mutationId', 'schemaVersion', 'operation', 'principal', 'authorityReference',
    'repository', 'semanticIdempotencyFingerprint', 'requestedStateDigest', 'state',
    'createdAt', 'expiresAt',
  ]),
  GitHubMutationReadback: objectSchema({
    mutationId: identifier,
    state: { enum: ['intent_persisted', 'local_prepared', 'remote_attempted', 'remote_reconciled', 'verified', 'failed', 'ambiguous', 'unknown'] },
    externalIdentifiers: { type: 'object' },
    observedStateDigest: digest,
    evidenceReferences: stringArray,
    eventCursor: integer,
    restartBehavior: { const: 'durable_reconcile' },
    recoveryState: { enum: ['none', 'automatic', 'manual', 'unknown'] },
    observedAt: timestamp,
  }, [
    'mutationId', 'state', 'externalIdentifiers', 'evidenceReferences', 'eventCursor',
    'restartBehavior', 'recoveryState', 'observedAt',
  ]),
  GitHubWorkflowIdentity: workflowIdentitySchema,
  GitHubArtifactIdentity: artifactIdentitySchema,
  GitHubCredentialEnrollmentRecord: objectSchema({
    enrollmentId: identifier,
    schemaVersion: { const: GITHUB_AUTHORITY_CONTRACT_VERSION },
    ownerPrincipal: identifier,
    provider: { const: 'github' },
    credentialType: { enum: ['ssh_deploy_key', 'github_app_installation', 'fine_grained_token', 'commit_signing'] },
    credentialReferenceId: identifier,
    accountOrInstallationId: identifier,
    repositoryAuthorityIds: { type: 'array', items: identifier },
    allowedOperationFamilies: stringArray,
    permissionSnapshotDigest: digest,
    encryptedCredentialName: identifier,
    encryptedCredentialDigest: digest,
    createdAt: timestamp,
    expiresAt: timestamp,
    revoked: boolean,
    plaintextPersisted: { const: false },
  }, [
    'enrollmentId', 'schemaVersion', 'ownerPrincipal', 'provider', 'credentialType',
    'credentialReferenceId', 'accountOrInstallationId', 'repositoryAuthorityIds',
    'allowedOperationFamilies', 'permissionSnapshotDigest', 'encryptedCredentialName',
    'encryptedCredentialDigest', 'createdAt', 'revoked', 'plaintextPersisted',
  ]),
});

export const GITHUB_AUTHORITY_OPERATION_NAMES = [
  'baby.git.describe',
  'baby.git.repository.materialize',
  'baby.git.repository.verify',
  'baby.git.repository.status',
  'baby.git.fetch',
  'baby.git.branch.create',
  'baby.git.commit.create',
  'baby.git.commit.verify',
  'baby.git.push.preview',
  'baby.git.push.apply',
  'baby.git.push.verify',
  'baby.github.describe',
  'baby.github.auth.status',
  'baby.github.repo.authority.get',
  'baby.github.repo.authority.list',
  'baby.github.remote.verify',
  'baby.github.pr.upsert',
  'baby.github.pr.get',
  'baby.github.pr.verify',
  'baby.github.workflow.find',
  'baby.github.workflow.wait',
  'baby.github.workflow.get',
  'baby.github.workflow.logs',
  'baby.github.workflow.artifacts',
  'baby.github.artifact.verify',
  'baby.github.delivery.publish',
] as const;

export type GitHubAuthorityOperationName = (typeof GITHUB_AUTHORITY_OPERATION_NAMES)[number];

export interface GitHubAuthorityOperationContract {
  operation: GitHubAuthorityOperationName;
  version: typeof GITHUB_AUTHORITY_CONTRACT_VERSION;
  owner: GitHubAuthorityOwner;
  mutation: boolean;
  risk: GitHubAuthorityRisk;
  idempotency: 'read_only' | 'semantic_replay_or_conflict';
  restartBehavior: 'read_only' | 'durable_reconcile';
  support: typeof GITHUB_AUTHORITY_SUPPORT_STATE;
  executable: false;
  permissionFamilies: readonly string[];
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

const operationResult = objectSchema({
  operation: nonEmptyString,
  contractVersion: { const: GITHUB_AUTHORITY_CONTRACT_VERSION },
  support: { const: GITHUB_AUTHORITY_SUPPORT_STATE },
  evidenceReferences: stringArray,
  resultDigest: digest,
}, ['operation', 'contractVersion', 'support', 'evidenceReferences', 'resultDigest']);

const repositoryAuthorityInput = objectSchema({
  repositoryAuthorityId: identifier,
}, ['repositoryAuthorityId']);

const workspaceInput = objectSchema({
  workspaceId: identifier,
  repositoryAuthorityId: identifier,
}, ['workspaceId', 'repositoryAuthorityId']);

function contract(
  operation: GitHubAuthorityOperationName,
  owner: GitHubAuthorityOwner,
  mutation: boolean,
  risk: GitHubAuthorityRisk,
  permissionFamilies: readonly string[],
  input: Record<string, unknown>,
  output: Record<string, unknown> = operationResult,
): GitHubAuthorityOperationContract {
  return {
    operation,
    version: GITHUB_AUTHORITY_CONTRACT_VERSION,
    owner,
    mutation,
    risk,
    idempotency: mutation ? 'semantic_replay_or_conflict' : 'read_only',
    restartBehavior: mutation ? 'durable_reconcile' : 'read_only',
    support: GITHUB_AUTHORITY_SUPPORT_STATE,
    executable: false,
    permissionFamilies,
    input,
    output,
  };
}

export const GITHUB_AUTHORITY_OPERATION_CONTRACTS: readonly GitHubAuthorityOperationContract[] = Object.freeze([
  contract('baby.git.describe', 'local_git', false, 'low', ['git.discovery'], objectSchema({}), objectSchema({
    providerVersion: nonEmptyString,
    installedGitVersion: nonEmptyString,
    supportedOperationVersions: { type: 'object' },
    repositoryStorageRoots: stringArray,
    limits: { type: 'object' },
    credentialReferenceSupport: { const: true },
    knownLimitations: stringArray,
    restartBehavior: { const: 'read_only' },
    supportState: { const: GITHUB_AUTHORITY_SUPPORT_STATE },
  }, [
    'providerVersion', 'installedGitVersion', 'supportedOperationVersions',
    'repositoryStorageRoots', 'limits', 'credentialReferenceSupport',
    'knownLimitations', 'restartBehavior', 'supportState',
  ])),
  contract('baby.git.repository.materialize', 'local_git', true, 'medium', ['git.transport', 'git.repository.write'], objectSchema({
    repositoryAuthorityId: identifier,
    credentialReferenceId: identifier,
    canonicalRemote: nonEmptyString,
    expectedCommit: gitObject,
    expectedTree: gitObject,
    sourceRef: nonEmptyString,
    workspaceId: identifier,
  }, [
    'repositoryAuthorityId', 'credentialReferenceId', 'canonicalRemote',
    'expectedCommit', 'expectedTree', 'workspaceId',
  ]), objectSchema({ workspace: workspaceIdentitySchema, source: sourceIdentitySchema, resultDigest: digest }, ['workspace', 'source', 'resultDigest'])),
  contract('baby.git.repository.verify', 'local_git', false, 'low', ['git.repository.read'], workspaceInput, objectSchema({
    workspace: workspaceIdentitySchema,
    source: sourceIdentitySchema,
    canonicalRemoteVerified: boolean,
    ancestryVerified: boolean,
    objectAvailabilityVerified: boolean,
    submodulesDeclared: boolean,
    lfsDeclared: boolean,
    resultDigest: digest,
  }, [
    'workspace', 'source', 'canonicalRemoteVerified', 'ancestryVerified',
    'objectAvailabilityVerified', 'submodulesDeclared', 'lfsDeclared', 'resultDigest',
  ])),
  contract('baby.git.repository.status', 'local_git', false, 'low', ['git.repository.read'], workspaceInput, objectSchema({
    workspace: workspaceIdentitySchema,
    upstream: nonEmptyString,
    ahead: integer,
    behind: integer,
    stagedPaths: stringArray,
    unstagedPaths: stringArray,
    untrackedPaths: stringArray,
    conflicts: stringArray,
    sequencerState: { enum: ['none', 'merge', 'rebase', 'cherry_pick', 'revert', 'bisect'] },
    boundedDiffSummary: { type: 'object' },
  }, [
    'workspace', 'ahead', 'behind', 'stagedPaths', 'unstagedPaths',
    'untrackedPaths', 'conflicts', 'sequencerState', 'boundedDiffSummary',
  ])),
  contract('baby.git.fetch', 'local_git', true, 'medium', ['git.transport', 'git.repository.write'], objectSchema({
    repositoryAuthorityId: identifier,
    workspaceId: identifier,
    credentialReferenceId: identifier,
    exactRefs: stringArray,
    prune: { const: false },
  }, ['repositoryAuthorityId', 'workspaceId', 'credentialReferenceId', 'exactRefs', 'prune'])),
  contract('baby.git.branch.create', 'local_git', true, 'medium', ['git.repository.write'], objectSchema({
    repositoryAuthorityId: identifier,
    workspaceId: identifier,
    branch: nonEmptyString,
    expectedCommit: gitObject,
    expectedTree: gitObject,
  }, ['repositoryAuthorityId', 'workspaceId', 'branch', 'expectedCommit', 'expectedTree'])),
  contract('baby.git.commit.create', 'local_git', true, 'high', ['git.repository.write', 'git.commit'], objectSchema({
    repositoryAuthorityId: identifier,
    workspaceId: identifier,
    expectedParent: gitObject,
    declaredPaths: stringArray,
    authorIdentityReference: identifier,
    committerIdentityReference: identifier,
    message: { type: 'string', minLength: 1, maxLength: 10000 },
    signingCredentialReferenceId: identifier,
  }, [
    'repositoryAuthorityId', 'workspaceId', 'expectedParent', 'declaredPaths',
    'authorIdentityReference', 'committerIdentityReference', 'message',
  ]), commitEvidenceSchema),
  contract('baby.git.commit.verify', 'local_git', false, 'low', ['git.repository.read'], objectSchema({
    repositoryAuthorityId: identifier,
    workspaceId: identifier,
    expectedCommit: gitObject,
    expectedTree: gitObject,
    expectedBase: gitObject,
  }, ['repositoryAuthorityId', 'workspaceId', 'expectedCommit', 'expectedTree', 'expectedBase']), commitEvidenceSchema),
  contract('baby.git.push.preview', 'local_git', false, 'low', ['git.transport', 'git.remote.read'], objectSchema({
    repositoryAuthorityId: identifier,
    workspaceId: identifier,
    credentialReferenceId: identifier,
    sourceRef: nonEmptyString,
    destinationRef: nonEmptyString,
    expectedRemoteOldObject: gitObject,
    expiresAt: timestamp,
  }, [
    'repositoryAuthorityId', 'workspaceId', 'credentialReferenceId',
    'sourceRef', 'destinationRef', 'expiresAt',
  ]), GITHUB_AUTHORITY_MODEL_SCHEMAS.GitPushPlan),
  contract('baby.git.push.apply', 'local_git', true, 'high', ['git.transport', 'git.remote.write'], objectSchema({
    repositoryAuthorityId: identifier,
    planId: identifier,
    planDigest: digest,
    expectedLocalHead: gitObject,
    expectedLocalTree: gitObject,
    expectedRemoteOldObject: gitObject,
    authorizationReference: identifier,
  }, [
    'repositoryAuthorityId', 'planId', 'planDigest', 'expectedLocalHead',
    'expectedLocalTree', 'authorizationReference',
  ]), objectSchema({
    mutationId: identifier,
    state: { enum: ['intent_persisted', 'local_prepared', 'remote_attempted', 'remote_reconciled', 'verified', 'failed', 'ambiguous', 'unknown'] },
    readback: remoteReadbackSchema,
    evidenceReferences: stringArray,
  }, ['mutationId', 'state', 'evidenceReferences'])),
  contract('baby.git.push.verify', 'local_git', false, 'low', ['git.transport', 'git.remote.read'], objectSchema({
    repositoryAuthorityId: identifier,
    credentialReferenceId: identifier,
    destinationRef: nonEmptyString,
    expectedCommit: gitObject,
    expectedTree: gitObject,
  }, [
    'repositoryAuthorityId', 'credentialReferenceId', 'destinationRef',
    'expectedCommit', 'expectedTree',
  ]), remoteReadbackSchema),
  contract('baby.github.describe', 'github_provider', false, 'low', ['github.discovery'], objectSchema({}), objectSchema({
    providerVersion: nonEmptyString,
    apiVersion: nonEmptyString,
    host: nonEmptyString,
    credentialTypes: stringArray,
    supportedOperations: stringArray,
    permissionRequirements: { type: 'object' },
    rateLimitBehavior: { type: 'object' },
    limits: { type: 'object' },
    supportState: { const: GITHUB_AUTHORITY_SUPPORT_STATE },
    acceptanceState: { enum: ['fixture_only', 'live_nonproduction_verified', 'production_enabled'] },
  }, [
    'providerVersion', 'apiVersion', 'host', 'credentialTypes', 'supportedOperations',
    'permissionRequirements', 'rateLimitBehavior', 'limits', 'supportState', 'acceptanceState',
  ])),
  contract('baby.github.auth.status', 'github_provider', false, 'low', ['github.auth.read'], objectSchema({
    credentialReferenceId: identifier,
  }, ['credentialReferenceId']), objectSchema({
    credentialReference: credentialReferenceSchema,
    providerAccountId: identifier,
    repositoryScope: stringArray,
    permissionSnapshot: permissionSnapshotSchema,
    expiry: timestamp,
    health: { enum: ['healthy', 'degraded', 'unavailable', 'unknown'] },
    lastSuccessfulUse: timestamp,
  }, ['credentialReference', 'providerAccountId', 'repositoryScope', 'permissionSnapshot', 'health'])),
  contract('baby.github.repo.authority.get', 'github_provider', false, 'low', ['github.repository.metadata'], repositoryAuthorityInput, repositoryAuthoritySchema),
  contract('baby.github.repo.authority.list', 'github_provider', false, 'low', ['github.repository.metadata'], objectSchema({
    offset: integer,
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  }), objectSchema({
    offset: integer,
    nextOffset: integer,
    total: integer,
    items: { type: 'array', items: repositoryAuthoritySchema },
  }, ['offset', 'nextOffset', 'total', 'items'])),
  contract('baby.github.remote.verify', 'github_provider', false, 'low', ['github.repository.metadata', 'github.contents.read'], objectSchema({
    repositoryAuthorityId: identifier,
    branch: nonEmptyString,
    expectedCommit: gitObject,
    expectedTree: gitObject,
    expectedBaseBranch: nonEmptyString,
  }, ['repositoryAuthorityId', 'branch', 'expectedCommit', 'expectedTree']), objectSchema({
    repository: repositoryIdentitySchema,
    branch: nonEmptyString,
    commit: gitObject,
    tree: gitObject,
    parents: { type: 'array', items: gitObject },
    defaultBranch: nonEmptyString,
    archived: boolean,
    visibility: { enum: ['private', 'internal', 'public'] },
    comparison: { type: 'object' },
    rateLimit: rateLimitSchema,
  }, ['repository', 'branch', 'commit', 'tree', 'parents', 'defaultBranch', 'archived', 'visibility', 'comparison', 'rateLimit'])),
  contract('baby.github.pr.upsert', 'github_provider', true, 'high', ['github.pull_requests.write'], objectSchema({
    repositoryAuthorityId: identifier,
    headBranch: nonEmptyString,
    headCommit: gitObject,
    headTree: gitObject,
    baseBranch: nonEmptyString,
    expectedPreviousStateDigest: digest,
    title: { type: 'string', minLength: 1, maxLength: 256 },
    body: { type: 'string', maxLength: 65536 },
    draft: { const: true },
    authorizationReference: identifier,
  }, [
    'repositoryAuthorityId', 'headBranch', 'headCommit', 'headTree',
    'baseBranch', 'title', 'body', 'draft', 'authorizationReference',
  ])),
  contract('baby.github.pr.get', 'github_provider', false, 'low', ['github.pull_requests.read'], objectSchema({
    repositoryAuthorityId: identifier,
    pullRequestNumber: { type: 'integer', minimum: 1 },
  }, ['repositoryAuthorityId', 'pullRequestNumber'])),
  contract('baby.github.pr.verify', 'github_provider', false, 'low', ['github.pull_requests.read', 'github.contents.read'], objectSchema({
    repositoryAuthorityId: identifier,
    pullRequestNumber: { type: 'integer', minimum: 1 },
    expectedBaseBranch: nonEmptyString,
    expectedHeadBranch: nonEmptyString,
    expectedHeadCommit: gitObject,
    expectedHeadTree: gitObject,
    expectedDraft: boolean,
    expectedChangedPathsDigest: digest,
  }, [
    'repositoryAuthorityId', 'pullRequestNumber', 'expectedBaseBranch',
    'expectedHeadBranch', 'expectedHeadCommit', 'expectedHeadTree',
    'expectedDraft', 'expectedChangedPathsDigest',
  ])),
  contract('baby.github.workflow.find', 'github_provider', false, 'low', ['github.actions.read'], objectSchema({
    repositoryAuthorityId: identifier,
    exactCommit: gitObject,
    workflowId: identifier,
    event: nonEmptyString,
  }, ['repositoryAuthorityId', 'exactCommit'])),
  contract('baby.github.workflow.wait', 'github_provider', true, 'medium', ['github.actions.read'], objectSchema({
    repositoryAuthorityId: identifier,
    workflow: workflowIdentitySchema,
    selectedJobIds: { type: 'array', items: integer },
    deadline: timestamp,
    pollPolicy: { type: 'object' },
  }, ['repositoryAuthorityId', 'workflow', 'deadline', 'pollPolicy'])),
  contract('baby.github.workflow.get', 'github_provider', false, 'low', ['github.actions.read'], objectSchema({
    repositoryAuthorityId: identifier,
    workflow: workflowIdentitySchema,
  }, ['repositoryAuthorityId', 'workflow'])),
  contract('baby.github.workflow.logs', 'github_provider', true, 'medium', ['github.actions.read', 'artifact.write'], objectSchema({
    repositoryAuthorityId: identifier,
    workflow: workflowIdentitySchema,
    jobId: integer,
    maximumBytes: { type: 'integer', minimum: 1, maximum: 67108864 },
    redactionProfile: identifier,
  }, ['repositoryAuthorityId', 'workflow', 'maximumBytes', 'redactionProfile'])),
  contract('baby.github.workflow.artifacts', 'github_provider', true, 'medium', ['github.actions.read', 'artifact.write'], objectSchema({
    repositoryAuthorityId: identifier,
    workflow: workflowIdentitySchema,
    artifactNames: stringArray,
    maximumArchiveBytes: { type: 'integer', minimum: 1, maximum: 536870912 },
  }, ['repositoryAuthorityId', 'workflow', 'maximumArchiveBytes'])),
  contract('baby.github.artifact.verify', 'github_provider', false, 'low', ['github.actions.read', 'artifact.read'], objectSchema({
    repositoryAuthorityId: identifier,
    artifact: artifactIdentitySchema,
    expectedArchiveDigest: digest,
    expectedMembers: stringArray,
    expectedExtractedDigests: { type: 'object', additionalProperties: digest },
    expectedSourceCommit: gitObject,
    expectedSourceTree: gitObject,
    expectedCandidateDigest: digest,
  }, [
    'repositoryAuthorityId', 'artifact', 'expectedArchiveDigest',
    'expectedMembers', 'expectedExtractedDigests', 'expectedSourceCommit',
    'expectedSourceTree',
  ])),
  contract('baby.github.delivery.publish', 'compound', true, 'high', [
    'git.repository.read', 'git.transport', 'git.remote.write',
    'github.repository.metadata', 'github.pull_requests.write',
    'github.actions.read', 'artifact.write', 'artifact.read',
  ], objectSchema({
    repositoryAuthorityId: identifier,
    workspaceId: identifier,
    expectedLocalCommit: gitObject,
    expectedLocalTree: gitObject,
    sourceBranch: nonEmptyString,
    destinationBranch: nonEmptyString,
    expectedRemoteOldObject: gitObject,
    pushPlanDigest: digest,
    pullRequest: objectSchema({
      baseBranch: nonEmptyString,
      title: { type: 'string', minLength: 1, maxLength: 256 },
      body: { type: 'string', maxLength: 65536 },
      draft: { const: true },
    }, ['baseBranch', 'title', 'body', 'draft']),
    workflowExpectation: { type: 'object' },
    artifactExpectations: { type: 'array' },
    authorizationReference: identifier,
    deadline: timestamp,
  }, [
    'repositoryAuthorityId', 'workspaceId', 'expectedLocalCommit',
    'expectedLocalTree', 'sourceBranch', 'destinationBranch', 'pushPlanDigest',
    'pullRequest', 'workflowExpectation', 'artifactExpectations',
    'authorizationReference', 'deadline',
  ])),
]);

export const GITHUB_AUTHORITY_TYPED_ERRORS = Object.freeze([
  'invalid_request',
  'unsupported',
  'not_configured',
  'authority_missing',
  'credential_unavailable',
  'credential_revoked',
  'credential_expired',
  'permission_denied',
  'permission_drift',
  'repository_not_found',
  'repository_mismatch',
  'wrong_github_host',
  'workspace_not_found',
  'workspace_outside_root',
  'workspace_dirty',
  'object_missing',
  'object_corrupt',
  'ref_mismatch',
  'expected_parent_mismatch',
  'undeclared_path_change',
  'invalid_commit_message',
  'host_key_mismatch',
  'remote_base_mismatch',
  'non_fast_forward',
  'plan_mismatch',
  'idempotency_conflict',
  'push_failed',
  'push_result_unknown',
  'remote_mismatch',
  'pr_failed',
  'pr_mismatch',
  'workflow_not_found',
  'workflow_failed',
  'workflow_cancelled',
  'workflow_timed_out',
  'artifact_missing',
  'artifact_mismatch',
  'rate_limited',
  'cancelled',
  'partial',
  'recovery_required',
  'manual_recovery_required',
  'ambiguous',
  'unknown',
] as const);

export type GitHubAuthorityErrorCode = (typeof GITHUB_AUTHORITY_TYPED_ERRORS)[number];

export interface GitHubAuthorityError {
  code: GitHubAuthorityErrorCode;
  message: string;
  retryable: boolean;
  operation: GitHubAuthorityOperationName;
  requestId: string;
  mutationId?: string;
  partial: boolean;
  state?: GitHubMutationState;
  details?: Record<string, unknown>;
}

export const GITHUB_MUTATION_STATES = Object.freeze([
  'intent_persisted',
  'local_prepared',
  'remote_attempted',
  'remote_reconciled',
  'verified',
  'failed',
  'ambiguous',
  'unknown',
] as const);

export const GITHUB_MUTATION_TRANSITIONS = Object.freeze({
  intent_persisted: ['local_prepared', 'failed', 'unknown'],
  local_prepared: ['remote_attempted', 'failed', 'unknown'],
  remote_attempted: ['remote_reconciled', 'ambiguous', 'unknown'],
  remote_reconciled: ['verified', 'failed', 'ambiguous', 'unknown'],
  verified: [],
  failed: [],
  ambiguous: ['remote_reconciled', 'failed', 'unknown'],
  unknown: ['remote_reconciled', 'failed'],
} as const);

export const GITHUB_PUBLICATION_STATES = Object.freeze([
  'PLANNED',
  'LOCAL_VERIFYING',
  'LOCAL_VERIFIED',
  'REMOTE_BASE_READING',
  'FAST_FORWARD_PROVEN',
  'PUSH_INTENT_PERSISTED',
  'PUSHING',
  'REMOTE_RECONCILING',
  'REMOTE_VERIFIED',
  'PR_UPSERTING',
  'PR_VERIFIED',
  'WORKFLOW_DISCOVERING',
  'WORKFLOW_WAITING',
  'WORKFLOW_TERMINAL',
  'LOGS_CAPTURING',
  'ARTIFACTS_CAPTURING',
  'ARTIFACTS_VERIFYING',
  'SUCCEEDED',
] as const);

export const GITHUB_PUBLICATION_NON_SUCCESS_STATES = Object.freeze([
  'REJECTED',
  'DIRTY_WORKTREE',
  'LOCAL_IDENTITY_MISMATCH',
  'REMOTE_BASE_MISMATCH',
  'NON_FAST_FORWARD',
  'AUTHORITY_MISSING',
  'CREDENTIAL_UNAVAILABLE',
  'PUSH_FAILED',
  'PUSH_RESULT_UNKNOWN',
  'REMOTE_MISMATCH',
  'PR_FAILED',
  'PR_MISMATCH',
  'WORKFLOW_NOT_FOUND',
  'WORKFLOW_FAILED',
  'WORKFLOW_CANCELLED',
  'WORKFLOW_TIMED_OUT',
  'ARTIFACT_MISSING',
  'ARTIFACT_MISMATCH',
  'RATE_LIMITED',
  'CANCELLED',
  'PARTIAL',
  'RECOVERY_REQUIRED',
  'MANUAL_RECOVERY_REQUIRED',
  'UNKNOWN',
] as const);

export const GITHUB_AUTHORITY_EXCLUSIONS = Object.freeze([
  'unconstrained_force_push',
  'remote_ref_deletion',
  'repository_deletion',
  'repository_transfer',
  'repository_visibility_change',
  'organization_membership_change',
  'collaborator_change',
  'team_change',
  'repository_secret_change',
  'actions_secret_change',
  'branch_protection_change',
  'ruleset_change',
  'deploy_key_deletion_or_rotation',
  'pull_request_merge',
  'auto_merge',
  'release_publication',
  'package_publication',
  'arbitrary_github_admin_api',
] as const);

export const GITHUB_AUTHORITY_OWNERSHIP = Object.freeze({
  publicAuthenticationAndMcpTransport: 'baby_gateway',
  localGitWorkspacesAndProcesses: 'baby_quirt',
  durableOperationLifecycle: 'baby_quirt',
  credentialReferenceResolution: 'baby_quirt',
  remoteGitRefs: 'git_remote',
  githubProviderState: 'github',
  localArtifactsAndEvidence: 'baby_quirt',
  externalStateVerification: 'baby_quirt_provider_readback',
  productionDeployment: 'existing_baby_release_authority_later',
});

export const GITHUB_AUTHORITY_NON_DUPLICATION_RULES = Object.freeze([
  'one_public_call_quirt_tool',
  'existing_baby_scheduler_only',
  'existing_baby_job_database_only',
  'existing_baby_artifact_store_only',
  'receipt_v2_only',
  'existing_private_unix_socket_only',
  'no_gateway_owned_git_controller',
  'no_fix_dependency',
  'no_old_operator_dependency',
  'no_routine_ssh_or_termius_dependency',
]);

export const GITHUB_AUTHORITY_CAPABILITY_MATRIX = Object.freeze(
  GITHUB_AUTHORITY_OPERATION_CONTRACTS.map((entry) => ({
    operation: entry.operation,
    owner: entry.owner,
    mutation: entry.mutation,
    risk: entry.risk,
    permissionFamilies: [...entry.permissionFamilies],
    support: entry.support,
    executable: entry.executable,
  })),
);

export const GITHUB_AUTHORITY_CONTRACT_BUNDLE = Object.freeze({
  capabilityId: 'baby-quirt-universal-github-authority',
  capabilityVersion: GITHUB_AUTHORITY_CONTRACT_VERSION,
  checkpoint: 'A',
  supportState: GITHUB_AUTHORITY_SUPPORT_STATE,
  publicTool: 'call_quirt',
  publicArguments: ['operation', 'payload', 'idempotencyKey'],
  modelSchemas: GITHUB_AUTHORITY_MODEL_SCHEMAS,
  operations: GITHUB_AUTHORITY_OPERATION_CONTRACTS,
  errors: GITHUB_AUTHORITY_TYPED_ERRORS,
  mutationStates: GITHUB_MUTATION_STATES,
  mutationTransitions: GITHUB_MUTATION_TRANSITIONS,
  publicationStates: GITHUB_PUBLICATION_STATES,
  publicationNonSuccessStates: GITHUB_PUBLICATION_NON_SUCCESS_STATES,
  exclusions: GITHUB_AUTHORITY_EXCLUSIONS,
  ownership: GITHUB_AUTHORITY_OWNERSHIP,
  nonDuplicationRules: GITHUB_AUTHORITY_NON_DUPLICATION_RULES,
  capabilityMatrix: GITHUB_AUTHORITY_CAPABILITY_MATRIX,
  credentialPolicy: {
    valuesPersisted: false,
    referencesOnly: true,
    plaintextInSqlite: false,
    plaintextInReleaseDirectories: false,
    plaintextInGitWorkspaces: false,
    currentBuildTransport: 'repository_scoped_encrypted_ssh_deploy_key',
    permanentApiModel: 'github_app_installation_credential_reference',
  },
});
