import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GITHUB_AUTHORITY_CONTRACT_BUNDLE,
  GITHUB_AUTHORITY_CONTRACT_VERSION,
  GITHUB_AUTHORITY_OPERATION_NAMES,
} from '../src/github/contracts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = join(root, 'contracts', 'github-authority-contracts-v1.json');
const schemaPath = join(root, 'schemas', 'github-authority-contracts-v1.schema.json');

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://baby-quirt.stealtheye.io/schemas/github-authority-contracts-v1.schema.json',
  title: 'Baby Quirt Universal GitHub Authority v1 contract bundle',
  type: 'object',
  additionalProperties: false,
  required: [
    'capabilityId',
    'capabilityVersion',
    'checkpoint',
    'supportState',
    'publicTool',
    'publicArguments',
    'modelSchemas',
    'operations',
    'errors',
    'mutationStates',
    'mutationTransitions',
    'publicationStates',
    'publicationNonSuccessStates',
    'exclusions',
    'ownership',
    'nonDuplicationRules',
    'capabilityMatrix',
    'credentialPolicy',
  ],
  properties: {
    capabilityId: { const: 'baby-quirt-universal-github-authority' },
    capabilityVersion: { const: GITHUB_AUTHORITY_CONTRACT_VERSION },
    checkpoint: { const: 'A' },
    supportState: { const: 'contract_only' },
    publicTool: { const: 'call_quirt' },
    publicArguments: {
      type: 'array',
      prefixItems: [
        { const: 'operation' },
        { const: 'payload' },
        { const: 'idempotencyKey' },
      ],
      minItems: 3,
      maxItems: 3,
    },
    modelSchemas: { type: 'object', minProperties: 17 },
    operations: {
      type: 'array',
      minItems: GITHUB_AUTHORITY_OPERATION_NAMES.length,
      maxItems: GITHUB_AUTHORITY_OPERATION_NAMES.length,
      items: {
        type: 'object',
        required: [
          'operation', 'version', 'owner', 'mutation', 'risk', 'idempotency',
          'restartBehavior', 'support', 'executable', 'permissionFamilies',
          'input', 'output',
        ],
        properties: {
          operation: { enum: [...GITHUB_AUTHORITY_OPERATION_NAMES] },
          version: { const: GITHUB_AUTHORITY_CONTRACT_VERSION },
          owner: { enum: ['local_git', 'github_provider', 'compound'] },
          mutation: { type: 'boolean' },
          risk: { enum: ['low', 'medium', 'high'] },
          idempotency: { enum: ['read_only', 'semantic_replay_or_conflict'] },
          restartBehavior: { enum: ['read_only', 'durable_reconcile'] },
          support: { const: 'contract_only' },
          executable: { const: false },
          permissionFamilies: { type: 'array', items: { type: 'string' } },
          input: { type: 'object' },
          output: { type: 'object' },
        },
      },
    },
    errors: { type: 'array', minItems: 1, items: { type: 'string' } },
    mutationStates: { type: 'array', minItems: 8, maxItems: 8, items: { type: 'string' } },
    mutationTransitions: { type: 'object' },
    publicationStates: { type: 'array', minItems: 1, items: { type: 'string' } },
    publicationNonSuccessStates: { type: 'array', minItems: 1, items: { type: 'string' } },
    exclusions: { type: 'array', minItems: 1, items: { type: 'string' } },
    ownership: { type: 'object' },
    nonDuplicationRules: { type: 'array', minItems: 1, items: { type: 'string' } },
    capabilityMatrix: { type: 'array', minItems: 26, maxItems: 26 },
    credentialPolicy: {
      type: 'object',
      additionalProperties: false,
      required: [
        'valuesPersisted', 'referencesOnly', 'plaintextInSqlite',
        'plaintextInReleaseDirectories', 'plaintextInGitWorkspaces',
        'currentBuildTransport', 'permanentApiModel',
      ],
      properties: {
        valuesPersisted: { const: false },
        referencesOnly: { const: true },
        plaintextInSqlite: { const: false },
        plaintextInReleaseDirectories: { const: false },
        plaintextInGitWorkspaces: { const: false },
        currentBuildTransport: { const: 'repository_scoped_encrypted_ssh_deploy_key' },
        permanentApiModel: { const: 'github_app_installation_credential_reference' },
      },
    },
  },
} as const;

mkdirSync(dirname(contractPath), { recursive: true });
mkdirSync(dirname(schemaPath), { recursive: true });
writeFileSync(contractPath, `${JSON.stringify(GITHUB_AUTHORITY_CONTRACT_BUNDLE, null, 2)}\n`, 'utf8');
writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
