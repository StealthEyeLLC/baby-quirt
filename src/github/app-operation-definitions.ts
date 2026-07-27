/** Discovery contracts for the minimal GitHub App authority. */

const emptyObject = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

const authority = {
  class: 'unrestricted-owner',
  confirmation: 'risk_dependent',
  scope: 'baby.apply',
  issuer: 'https://baby-quirt.stealtheye.io',
  resource: 'https://baby-quirt.stealtheye.io/mcp',
} as const;

const common = {
  version: '1.0.0',
  family: 'delivery',
  input: emptyObject,
  output: emptyObject,
  authority,
  costClass: 'local_zero',
  support: { state: 'supported', provider: 'baby-standalone-deployment-v2' },
  postActionVerification: true,
  receiptVersion: '2.0.0',
  limits: { maxInlineResultBytes: 65_536 },
} as const;

export const GITHUB_APP_OPERATION_DEFINITIONS = Object.freeze([
  {
    ...common,
    operation: 'baby.github.app.verify',
    description: 'Verify the exact GitHub App, installation, account, narrowed token permissions, and proof-repository access without returning credentials.',
    mutation: false,
    idempotency: 'read_only',
    risk: 'low',
    errors: [
      'invalid_request',
      'github_credential_unavailable',
      'github_credential_invalid',
      'github_app_identity_mismatch',
      'github_installation_mismatch',
      'github_permission_denied',
      'github_api_unavailable',
      'github_api_invalid_response',
    ],
    cancellation: 'not_applicable',
    restartBehavior: 'read_only',
  },
  {
    ...common,
    operation: 'baby.github.app.proof',
    description: 'Create, read back, and positively delete one deterministic temporary proof branch in StealthEyeLLC/baby-x.',
    mutation: true,
    idempotency: 'caller_key',
    risk: 'high',
    errors: [
      'invalid_request',
      'github_credential_unavailable',
      'github_credential_invalid',
      'github_app_identity_mismatch',
      'github_installation_mismatch',
      'github_permission_denied',
      'github_api_unavailable',
      'github_api_invalid_response',
      'github_remote_mismatch',
      'github_proof_cleanup_failed',
    ],
    cancellation: 'pre_arm_cleanup_post_arm_rollback',
    restartBehavior: 'durable_reconcile',
  },
] as const);

export const GITHUB_APP_OPERATION_NAMES = GITHUB_APP_OPERATION_DEFINITIONS.map((definition) => definition.operation);
