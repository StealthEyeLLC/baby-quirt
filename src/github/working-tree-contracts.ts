export const G3_WORKING_TREE_CONTRACT_VERSION = '1.0.0' as const;
export const G3_WORKING_TREE_SUPPORT_STATE = 'implemented_but_not_registered' as const;

const identityProperties = {
  repositoryAuthorityId: { type: 'string', minLength: 1, maxLength: 256 },
  workspaceId: { type: 'string', minLength: 1, maxLength: 256 },
} as const;

const pathArray = {
  type: 'array',
  minItems: 1,
  maxItems: 1024,
  uniqueItems: true,
  items: { type: 'string', minLength: 1, maxLength: 4096 },
} as const;

const optionalPathArray = {
  type: 'array',
  maxItems: 1024,
  uniqueItems: true,
  items: { type: 'string', minLength: 1, maxLength: 4096 },
} as const;

const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const objectId = { type: 'string', pattern: '^[a-f0-9]{40,64}$' } as const;
const scope = { type: 'string', enum: ['worktree', 'staged', 'head'] } as const;

export interface G3WorkingTreeOperationContract {
  operation: string;
  version: typeof G3_WORKING_TREE_CONTRACT_VERSION;
  support: typeof G3_WORKING_TREE_SUPPORT_STATE;
  executable: false;
  implementation: string;
  mutation: boolean;
  risk: 'low' | 'medium';
  authority: 'git.repository.read' | 'git.repository.write';
  idempotency: 'read_only' | 'observed_state_precondition';
  inputSchema: Readonly<Record<string, unknown>>;
  outputSchema: Readonly<Record<string, unknown>>;
  safety: readonly string[];
}

const readOutputSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['resultDigest'],
  properties: { resultDigest: digest },
} as const;

export const G3_WORKING_TREE_OPERATION_CONTRACTS: readonly G3WorkingTreeOperationContract[] = [
  {
    operation: 'baby.git.status',
    version: G3_WORKING_TREE_CONTRACT_VERSION,
    support: G3_WORKING_TREE_SUPPORT_STATE,
    executable: false,
    implementation: 'GitRepositoryTruth.status',
    mutation: false,
    risk: 'low',
    authority: 'git.repository.read',
    idempotency: 'read_only',
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['repositoryAuthorityId', 'workspaceId'],
      properties: identityProperties,
    },
    outputSchema: readOutputSchema,
    safety: ['canonical_workspace', 'bounded_status', 'sequencer_state', 'content_digest'],
  },
  ...(['baby.git.diff', 'baby.git.diff.stat', 'baby.git.diff.name_status'] as const).map((operation) => ({
    operation,
    version: G3_WORKING_TREE_CONTRACT_VERSION,
    support: G3_WORKING_TREE_SUPPORT_STATE,
    executable: false as const,
    implementation: operation === 'baby.git.diff'
      ? 'GitRepositoryTruth.diff'
      : operation === 'baby.git.diff.stat'
        ? 'GitRepositoryTruth.diffStat'
        : 'GitRepositoryTruth.diffNameStatus',
    mutation: false,
    risk: 'low' as const,
    authority: 'git.repository.read' as const,
    idempotency: 'read_only' as const,
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['repositoryAuthorityId', 'workspaceId'],
      properties: {
        ...identityProperties,
        scope,
        paths: optionalPathArray,
        ...(operation === 'baby.git.diff'
          ? { maximumBytes: { type: 'integer', minimum: 1, maximum: 1_048_576 } }
          : {}),
      },
    },
    outputSchema: readOutputSchema,
    safety: ['canonical_workspace', 'path_confinement', 'no_external_diff', 'bounded_output', 'content_digest'],
  })),
  {
    operation: 'baby.git.add',
    version: G3_WORKING_TREE_CONTRACT_VERSION,
    support: G3_WORKING_TREE_SUPPORT_STATE,
    executable: false,
    implementation: 'GitRepositoryTruth.add',
    mutation: true,
    risk: 'medium',
    authority: 'git.repository.write',
    idempotency: 'observed_state_precondition',
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['repositoryAuthorityId', 'workspaceId', 'paths', 'expectedHead', 'expectedStatusDigest'],
      properties: {
        ...identityProperties,
        paths: pathArray,
        expectedHead: objectId,
        expectedStatusDigest: digest,
      },
    },
    outputSchema: readOutputSchema,
    safety: [
      'exact_observed_head',
      'exact_observed_status_digest',
      'declared_changed_paths_only',
      'no_active_sequencer',
      'no_conflicts',
      'post_stage_readback',
    ],
  },
  ...(['baby.git.ignore.check', 'baby.git.attributes.check'] as const).map((operation) => ({
    operation,
    version: G3_WORKING_TREE_CONTRACT_VERSION,
    support: G3_WORKING_TREE_SUPPORT_STATE,
    executable: false as const,
    implementation: operation === 'baby.git.ignore.check'
      ? 'GitRepositoryTruth.checkIgnore'
      : 'GitRepositoryTruth.checkAttributes',
    mutation: false,
    risk: 'low' as const,
    authority: 'git.repository.read' as const,
    idempotency: 'read_only' as const,
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['repositoryAuthorityId', 'workspaceId', 'paths'],
      properties: { ...identityProperties, paths: pathArray },
    },
    outputSchema: readOutputSchema,
    safety: ['canonical_workspace', 'path_confinement', 'bounded_paths', 'structured_output'],
  })),
];

export const G3_WORKING_TREE_OPERATION_NAMES = G3_WORKING_TREE_OPERATION_CONTRACTS.map(
  (contract) => contract.operation,
);

export const G3_WORKING_TREE_CONTRACT_BUNDLE = {
  schemaVersion: G3_WORKING_TREE_CONTRACT_VERSION,
  support: G3_WORKING_TREE_SUPPORT_STATE,
  publicTool: 'call_quirt',
  publicArguments: ['operation', 'payload', 'idempotencyKey'],
  publicToolChanged: false,
  toolJsChanged: false,
  deployed: false,
  operations: G3_WORKING_TREE_OPERATION_CONTRACTS,
} as const;
