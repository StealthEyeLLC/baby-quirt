/** Baby Quirt configuration constants and runtime config loader. */

export const PROTOCOL_VERSION = '1.0.0';
export const CONTRACT_VERSION = '1.0.0';
export const PRODUCT_NAME = 'baby-quirt';
export const FRAME_MAGIC = 'QRT1';

export const DEFAULTS = {
  repository: 'StealthEyeLLC/baby-quirt',
  defaultBranch: 'main',
  workBranch: 'build/quirt-core',
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
  oauthJwksUri: string;
  signingPublicKeyPath: string;
  signingPrivateKeyPath: string;
  signingKeyId: string;
  previousSigningPublicKeyPath?: string;
  gatewayUid?: number;
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
    oauthJwksUri: env.BABY_QUIRT_OAUTH_JWKS_URI ?? DEFAULTS.oauthJwksUri,
    signingPublicKeyPath: `${configRoot}/signing-public.pem`,
    signingPrivateKeyPath: `${configRoot}/signing-private.pem`,
    signingKeyId: 'baby-quirt-signing-v1',
    previousSigningPublicKeyPath: undefined,
    gatewayUid: env.BABY_QUIRT_GATEWAY_UID
      ? parseInt(env.BABY_QUIRT_GATEWAY_UID, 10)
      : undefined,
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

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';

export function getMachineIdSha256(): string {
  try {
    const machineId = readFileSync('/etc/machine-id', 'utf8').trim();
    return createHash('sha256').update(machineId).digest('hex');
  } catch {
    return '';
  }
}

export function getHostname(): string {
  return hostname();
}
