import type { InternalReleaseManifest } from './contracts.js';
import {
  assertReleaseVersion,
  GIT_OBJECT_PATTERN,
  RELEASE_VERSION_PATTERN,
  SHA256_PATTERN,
} from './contracts.js';
import { digestJson } from './digest.js';
import type { JsonValue } from './json.js';
import { OPERATION_DEFINITIONS } from '../operations/definitions.js';
import { CONTRACT_VERSION, PROTOCOL_VERSION } from '../config.js';

export const INTERNAL_ENTRYPOINTS = [
  { name: 'daemon', path: 'bin/baby-quirt-daemon', runsAs: 'root' },
  { name: 'client', path: 'bin/baby-quirt', runsAs: 'authorized-local-user' },
  { name: 'inactive-installer', path: 'bin/baby-quirt-install', runsAs: 'root' },
  { name: 'candidate-verifier', path: 'bin/baby-quirt-verify-candidate', runsAs: 'root' },
] as const;

export const INTERNAL_NATIVE_ADDONS = [
  { path: 'lib/build/Release/peer_cred.node', loadProbe: 'exports.getPeerCred' },
] as const;

export function requiredOperationsDigest(): string {
  return digestJson(
    OPERATION_DEFINITIONS.map((definition) => definition.operation).sort() as unknown as JsonValue,
  );
}

export function createInternalReleaseManifest(input: {
  version: string;
  commit: string;
  tree: string;
  sourceDateEpoch: number;
}): InternalReleaseManifest {
  assertReleaseVersion(input.version);
  if (!GIT_OBJECT_PATTERN.test(input.commit) || !GIT_OBJECT_PATTERN.test(input.tree)) {
    throw new Error('Internal manifest source identity is invalid');
  }
  if (!Number.isSafeInteger(input.sourceDateEpoch) || input.sourceDateEpoch < 0) {
    throw new Error('Internal manifest source-date epoch is invalid');
  }
  const body = {
    schemaVersion: '1.0.0',
    product: 'baby-quirt',
    releaseVersion: input.version,
    source: {
      repository: 'StealthEyeLLC/baby-quirt',
      commit: input.commit,
      tree: input.tree,
      sourceDateEpoch: input.sourceDateEpoch,
    },
    target: {
      os: 'linux',
      architecture: 'amd64',
      runtime: 'Node 24.18.0',
      nodePath: '/opt/node-v24.18.0-linux-x64/bin/node',
    },
    entrypoints: INTERNAL_ENTRYPOINTS.map((entrypoint) => ({ ...entrypoint })),
    nativeAddons: INTERNAL_NATIVE_ADDONS.map((addon) => ({ ...addon })),
    operationContract: {
      version: CONTRACT_VERSION,
      count: OPERATION_DEFINITIONS.length,
      requiredOperationsDigest: requiredOperationsDigest(),
    },
    receiptVersions: ['1.0.0', '2.0.0'],
    qrt1Version: PROTOCOL_VERSION,
  } as const;
  return { ...body, identityDigest: digestJson(body as unknown as JsonValue) };
}

export function assertInternalReleaseManifest(value: unknown): asserts value is InternalReleaseManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Internal release manifest is not an object');
  }
  const manifest = value as InternalReleaseManifest;
  const { identityDigest, ...body } = manifest;
  if (manifest.schemaVersion !== '1.0.0' || manifest.product !== 'baby-quirt') {
    throw new Error('Internal release manifest identity is invalid');
  }
  if (!RELEASE_VERSION_PATTERN.test(manifest.releaseVersion)
    || !GIT_OBJECT_PATTERN.test(manifest.source.commit)
    || !GIT_OBJECT_PATTERN.test(manifest.source.tree)
    || !Number.isSafeInteger(manifest.source.sourceDateEpoch)
    || manifest.source.sourceDateEpoch < 0) {
    throw new Error('Internal release manifest source is invalid');
  }
  if (!SHA256_PATTERN.test(identityDigest)
    || identityDigest !== digestJson(body as unknown as JsonValue)) {
    throw new Error('Internal release manifest digest mismatch');
  }
  const expected = createInternalReleaseManifest({
    version: manifest.releaseVersion,
    commit: manifest.source.commit,
    tree: manifest.source.tree,
    sourceDateEpoch: manifest.source.sourceDateEpoch,
  });
  if (identityDigest !== expected.identityDigest) {
    throw new Error('Internal release manifest contract mismatch');
  }
}
