export const RELEASE_MANIFEST_SCHEMA_VERSION = '1.0.0' as const;
export const RELEASE_MANIFEST_SCHEMA_SHA256 =
  '59d0b6cd75f8ff117db1d03090237d520f5a4fe1913484329142e9df2d28fb49';
export const COMPATIBILITY_SCHEMA_SHA256 =
  '4e652fe9f1e985ee6d57a81f3c8165e2c85b51fe17aef50411925ce2f4f997b1';
export const RESERVED_RELEASE_VERSIONS = new Set(['0.2.1', '0.2.2']);
export const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const GIT_OBJECT_PATTERN = /^[a-f0-9]{40}$/;

export function assertReleaseVersion(version: string, allowReserved = false): void {
  if (!RELEASE_VERSION_PATTERN.test(version)) throw new Error(`Invalid release version: ${version}`);
  if (!allowReserved && RESERVED_RELEASE_VERSIONS.has(version)) {
    throw new Error(`Reserved release ${version} may not be built, installed, overwritten, relabeled, or reused`);
  }
}

export interface InternalReleaseManifest {
  schemaVersion: '1.0.0';
  product: 'baby-quirt';
  releaseVersion: string;
  source: {
    repository: 'StealthEyeLLC/baby-quirt';
    commit: string;
    tree: string;
    sourceDateEpoch: number;
  };
  target: {
    os: 'linux';
    architecture: 'amd64';
    runtime: 'Node 24.18.0';
    nodePath: '/opt/node-v24.18.0-linux-x64/bin/node';
  };
  entrypoints: Array<{ name: string; path: string; runsAs: string }>;
  nativeAddons: Array<{ path: string; loadProbe: string }>;
  operationContract: {
    version: string;
    count: number;
    requiredOperationsDigest: string;
  };
  receiptVersions: readonly ['1.0.0', '2.0.0'];
  qrt1Version: '1.0.0';
  identityDigest: string;
}

export interface ReleaseFileRecord {
  path: string;
  sha256: string;
  sizeBytes: number;
  mode: string;
  owner: 'root';
  group: 'root';
  kind:
    | 'file'
    | 'executable'
    | 'native_addon'
    | 'systemd_unit'
    | 'tmpfiles'
    | 'schema'
    | 'contract';
}

export interface TestEvidenceIndex {
  schemaVersion: '1.0.0';
  suites: Array<{ name: string; command: string; testCount: number; passed: boolean }>;
  suiteCount: number;
  testCount: number;
  requiredGateDigest?: string;
  sourceCommit: string;
  sourceTree: string;
}

export interface ReleaseManifest {
  [key: string]: unknown;
  schemaVersion: '1.0.0';
  product: 'baby-quirt';
  releaseVersion: string;
  manifestDigest: string;
  source: {
    repository: string;
    commit: string;
    tree: string;
    sourceDateEpoch: number;
  };
  archive: {
    filename: string;
    sha256: string;
    sizeBytes: number;
    format: 'tar.gz';
    topLevelPrefix: string;
    fileListDigest?: string;
  };
  requiredFiles: ReleaseFileRecord[];
  attestation: {
    algorithm: 'Ed25519';
    keyId: string;
    signedDigest: string;
    value: string;
  };
}

export interface CandidateVerificationCheck {
  name: string;
  passed: boolean;
  digest?: string;
  detail: string;
}

export interface CandidateVerificationReport {
  schemaVersion: '1.0.0';
  product: 'baby-quirt';
  releaseVersion: string;
  sourceCommit: string;
  sourceTree: string;
  archiveDigest: string;
  manifestDigest: string;
  candidateRoot: string;
  passed: boolean;
  checks: CandidateVerificationCheck[];
  reportDigest: string;
}
