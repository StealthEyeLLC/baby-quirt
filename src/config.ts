/** Baby Quirt configuration constants and runtime config loader. */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';

export const PROTOCOL_VERSION = '1.0.0';
export const CONTRACT_VERSION = '1.0.0';
export const PRODUCT_NAME = 'baby-quirt';
export const FRAME_MAGIC = 'QRT1';

export const GATEWAY_AUTHORITY_KEY_ID = 'gateway-authority-v1';
export const SUPERVISOR_RECEIPT_KEY_ID = 'supervisor-receipt-v1';

export const DEFAULTS = {
  repository: 'StealthEyeLLC/baby-quirt',
  defaultBranch: 'main',
  workBranch: 'cursor/baby-quirt-core-e857',
  gitRemote: 'https://github.com/StealthEyeLLC/baby-quirt.git',
  vpsHost: '51.81.86.225',
  vpsPort: 22,
  vpsUser: 'ubuntu',
  expectedHostname: 'vps-c9f04f5e',
  expectedMachineIdSha256:
    'cd189817b39fea60d338b73878240a6fe7db71374c7a0f35ad60f8eb641e8817',
  nodePath: '/opt/node-v24.18.0-linux-x64/bin/node',
  serviceName: 'baby-quirt.service',
  socketPath: '/run/horsey/baby-quirt.sock',
  socketGroup: 'horsey',
  socketMode: 0o660,
  gatewayUser: 'fix-mcp',
  gatewayUid: 997,
  releaseRoot: '/opt/baby-quirt/releases',
  currentLink: '/opt/baby-quirt/current',
  previousLink: '/opt/baby-quirt/previous',
  stateRoot: '/var/lib/baby-quirt',
  configRoot: '/etc/baby-quirt',
  gatewayId: 'stealtheye-horsey-gateway',
  supervisorId: 'baby-quirt-supervisor',
  expectedSubject: 'stealtheye-owner',
  authorityClass: 'unrestricted-owner',
  oauthIssuer: 'https://mcp.stealtheye.io',
  oauthResource: 'https://mcp.stealtheye.io',
  oauthJwksUri: 'https://mcp.stealtheye.io/oauth/jwks.json',
  maxFrameSize: 16 * 1024 * 1024,
  maxOutputBytes: 64 * 1024 * 1024,
  maxJobQueue: 256,
  maxRetentionJobs: 1024,
  requestMaxAgeMs: 5 * 60 * 1000,
  nonceRetentionMs: 24 * 60 * 60 * 1000,
  idempotencyRetentionMs: 24 * 60 * 60 * 1000,
  streamChunkSize: 64 * 1024,
  maxArchiveBytes: 512 * 1024 * 1024,
  maxArchiveFileBytes: 256 * 1024 * 1024,
} as const;

export interface RuntimeConfig {
  socketPath: string;
  socketGroup: string;
  socketMode: number;
  stateRoot: string;
  configRoot: string;
  gatewayId: string;
  supervisorId: string;
  expectedSubject: string;
  authorityClass: string;
  expectedHostname: string;
  expectedMachineIdSha256: string;
  oauthIssuer: string;
  oauthResource: string;
  oauthJwksUri: string;
  gatewayAuthorityPublicKeyPath: string;
  gatewayAuthorityPrivateKeyPath: string;
  gatewayAuthorityKeyId: string;
  supervisorReceiptPrivateKeyPath: string;
  supervisorReceiptPublicKeyPath: string;
  supervisorReceiptKeyId: string;
  ownerPrincipalFingerprint: string;
  previousGatewayAuthorityPublicKeyPath?: string;
  gatewayUid: number;
  skipPeerCredCheck: boolean;
  maxFrameSize: number;
  maxOutputBytes: number;
  maxJobQueue: number;
  maxRetentionJobs: number;
  requestMaxAgeMs: number;
  nonceRetentionMs: number;
  idempotencyRetentionMs: number;
}

export function loadRuntimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  const env = process.env;
  const configRoot = overrides.configRoot ?? env.BABY_QUIRT_CONFIG_ROOT ?? DEFAULTS.configRoot;
  const stateRoot = overrides.stateRoot ?? env.BABY_QUIRT_STATE_ROOT ?? DEFAULTS.stateRoot;

  const base: RuntimeConfig = {
    socketPath: env.BABY_QUIRT_SOCKET_PATH ?? DEFAULTS.socketPath,
    socketGroup: env.BABY_QUIRT_SOCKET_GROUP ?? DEFAULTS.socketGroup,
    socketMode: env.BABY_QUIRT_SOCKET_MODE
      ? parseInt(env.BABY_QUIRT_SOCKET_MODE, 8)
      : DEFAULTS.socketMode,
    stateRoot,
    configRoot,
    gatewayId: env.BABY_QUIRT_GATEWAY_ID ?? DEFAULTS.gatewayId,
    supervisorId: env.BABY_QUIRT_SUPERVISOR_ID ?? DEFAULTS.supervisorId,
    expectedSubject: env.BABY_QUIRT_EXPECTED_SUBJECT ?? DEFAULTS.expectedSubject,
    authorityClass: DEFAULTS.authorityClass,
    expectedHostname: env.BABY_QUIRT_EXPECTED_HOSTNAME ?? DEFAULTS.expectedHostname,
    expectedMachineIdSha256:
      env.BABY_QUIRT_EXPECTED_MACHINE_ID_SHA256 ?? DEFAULTS.expectedMachineIdSha256,
    oauthIssuer: env.BABY_QUIRT_OAUTH_ISSUER ?? DEFAULTS.oauthIssuer,
    oauthResource: env.BABY_QUIRT_OAUTH_RESOURCE ?? DEFAULTS.oauthResource,
    oauthJwksUri: env.BABY_QUIRT_OAUTH_JWKS_URI ?? DEFAULTS.oauthJwksUri,
    gatewayAuthorityPublicKeyPath: `${configRoot}/gateway-authority-public.pem`,
    gatewayAuthorityPrivateKeyPath: `${configRoot}/gateway-authority-private.pem`,
    gatewayAuthorityKeyId: GATEWAY_AUTHORITY_KEY_ID,
    supervisorReceiptPrivateKeyPath: `${configRoot}/supervisor-receipt-private.pem`,
    supervisorReceiptPublicKeyPath: `${configRoot}/supervisor-receipt-public.pem`,
    supervisorReceiptKeyId: SUPERVISOR_RECEIPT_KEY_ID,
    ownerPrincipalFingerprint: env.BABY_QUIRT_OWNER_PRINCIPAL_FINGERPRINT ?? '',
    previousGatewayAuthorityPublicKeyPath: undefined,
    gatewayUid: env.BABY_QUIRT_GATEWAY_UID
      ? parseInt(env.BABY_QUIRT_GATEWAY_UID, 10)
      : DEFAULTS.gatewayUid,
    skipPeerCredCheck:
      overrides.skipPeerCredCheck ??
      (env.BABY_QUIRT_SKIP_PEER_CRED === '1' || env.BABY_QUIRT_TEST_MODE === '1'),
    maxFrameSize: DEFAULTS.maxFrameSize,
    maxOutputBytes: DEFAULTS.maxOutputBytes,
    maxJobQueue: DEFAULTS.maxJobQueue,
    maxRetentionJobs: DEFAULTS.maxRetentionJobs,
    requestMaxAgeMs: DEFAULTS.requestMaxAgeMs,
    nonceRetentionMs: DEFAULTS.nonceRetentionMs,
    idempotencyRetentionMs: DEFAULTS.idempotencyRetentionMs,
  };

  return { ...base, ...overrides, configRoot, stateRoot };
}

export function normalizeMachineId(raw: Buffer | string): string {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  return text.replace(/[\r\n]/g, '');
}

export function machineIdSha256(raw: Buffer | string): string {
  const normalized = normalizeMachineId(raw);
  if (!normalized) return '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function getMachineIdSha256(): string {
  try {
    return machineIdSha256(readFileSync('/etc/machine-id'));
  } catch {
    return '';
  }
}

export function getHostname(): string {
  return hostname();
}

export function publicKeyFingerprint(pemPath: string): string {
  const pem = readFileSync(pemPath);
  return createHash('sha256').update(pem).digest('hex');
}
