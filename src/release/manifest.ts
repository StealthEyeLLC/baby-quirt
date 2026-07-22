import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { basename, join } from 'node:path';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import {
  GIT_OBJECT_PATTERN,
  RELEASE_MANIFEST_SCHEMA_VERSION,
  RELEASE_VERSION_PATTERN,
  SHA256_PATTERN,
  type InternalReleaseManifest,
  type ReleaseFileRecord,
  type ReleaseManifest,
  type TestEvidenceIndex,
} from './contracts.js';
import { digestJson, readJson, sha256, sha256File, walkRegularFiles } from './digest.js';
import { canonicalJson, type JsonValue } from './json.js';
import { assertInternalReleaseManifest } from './internal-manifest.js';
import { assertReleaseManifestSchema } from './schemas.js';
import { createSpdxSbom } from './sbom.js';
import { HOST_PERMISSION_CONTRACT } from './permissions.js';
import { assertRequiredReleaseGates } from './test-evidence.js';

const BUILD_COMMANDS = [
  'npm ci --include=dev',
  'npm run build:native',
  'npm run build',
  'bash scripts/build-bundle.sh',
];

const CONFIGURATION_CONTRACT = {
  schemaVersion: '1',
  root: '/etc/baby-quirt',
  runtimeConfig: '/etc/baby-quirt/runtime.json',
  publicKeys: [
    '/etc/baby-quirt/gateway-authority-public.pem',
    '/etc/baby-quirt/supervisor-receipt-public.pem',
  ],
  privateKeys: ['/etc/baby-quirt/supervisor-receipt-private.pem'],
} as const;

const STATE_CONTRACT = {
  schemaVersion: '1',
  root: '/var/lib/baby-quirt',
  persistentOutsideRelease: true,
  migrationIds: [],
  downgradePolicy: 'backward_compatible',
} as const;

function classifyFile(path: string, mode: string): ReleaseFileRecord['kind'] {
  if (path.endsWith('.node')) return 'native_addon';
  if (path.startsWith('ops/systemd/')) return 'systemd_unit';
  if (path.startsWith('ops/tmpfiles/')) return 'tmpfiles';
  if (path.startsWith('schemas/')) return 'schema';
  if (path.startsWith('contracts/')) return 'contract';
  if ((Number.parseInt(mode, 8) & 0o111) !== 0) return 'executable';
  return 'file';
}

async function buildRequiredFiles(root: string): Promise<ReleaseFileRecord[]> {
  const result: ReleaseFileRecord[] = [];
  for (const file of walkRegularFiles(root)) {
    result.push({
      path: file.relativePath,
      sha256: await sha256File(file.absolutePath),
      sizeBytes: file.sizeBytes,
      mode: file.mode,
      owner: 'root',
      group: 'root',
      kind: classifyFile(file.relativePath, file.mode),
    });
  }
  return result;
}

export function assertTestEvidence(value: unknown): asserts value is TestEvidenceIndex {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Test evidence index is not an object');
  }
  const evidence = value as TestEvidenceIndex;
  if (evidence.schemaVersion !== '1.0.0'
    || !Number.isSafeInteger(evidence.suiteCount) || evidence.suiteCount < 1
    || !Number.isSafeInteger(evidence.testCount) || evidence.testCount < 1
    || !Array.isArray(evidence.suites) || evidence.suites.length !== evidence.suiteCount
    || !GIT_OBJECT_PATTERN.test(evidence.sourceCommit)
    || !GIT_OBJECT_PATTERN.test(evidence.sourceTree)
    || !SHA256_PATTERN.test(evidence.requiredGateDigest ?? '')
    || evidence.suites.some((suite) => suite === null
      || typeof suite !== 'object'
      || typeof suite.name !== 'string' || suite.name.length === 0 || suite.name.length > 128
      || typeof suite.command !== 'string' || suite.command.length === 0 || suite.command.length > 1024
      || !Number.isSafeInteger(suite.testCount) || suite.testCount < 0
      || suite.passed !== true)) {
    throw new Error('Test evidence index is incomplete or contains a failed suite');
  }
  if (new Set(evidence.suites.map((suite) => suite.name)).size !== evidence.suites.length) {
    throw new Error('Test evidence suite names must be unique');
  }
  assertRequiredReleaseGates(evidence.suites);
  if (evidence.requiredGateDigest !== digestJson(evidence.suites as unknown as JsonValue)) {
    throw new Error('Test evidence required-gate digest mismatch');
  }
  const discovered = evidence.suites.reduce((sum, suite) => sum + suite.testCount, 0);
  if (discovered !== evidence.testCount) throw new Error('Test evidence count mismatch');
}

function manifestBody(manifest: ReleaseManifest): JsonValue {
  const copy = structuredClone(manifest) as Record<string, JsonValue>;
  delete copy.manifestDigest;
  delete copy.attestation;
  return copy;
}

export function releaseManifestDigest(manifest: ReleaseManifest): string {
  return digestJson(manifestBody(manifest));
}

function signManifestDigest(digest: string, privateKey: KeyObject): string {
  return sign(null, Buffer.from(digest, 'hex'), privateKey).toString('base64url');
}

export function verifyReleaseManifestAttestation(manifest: ReleaseManifest, publicKey: KeyObject): boolean {
  if (manifest.attestation.signedDigest !== manifest.manifestDigest
    || releaseManifestDigest(manifest) !== manifest.manifestDigest) return false;
  try {
    return verify(
      null,
      Buffer.from(manifest.manifestDigest, 'hex'),
      publicKey,
      Buffer.from(manifest.attestation.value, 'base64url'),
    );
  } catch {
    return false;
  }
}

export interface GenerateReleaseManifestInput {
  releaseRoot: string;
  archivePath: string;
  outputPath: string;
  sbomOutputPath: string;
  testEvidencePath: string;
  signingPrivateKeyPath: string;
  signingKeyId: string;
  compatibleGatewayManifestDigest: string;
  builderA: string;
  builderB: string;
  archiveDigestA: string;
  archiveDigestB: string;
}

export async function generateReleaseManifest(input: GenerateReleaseManifestInput): Promise<ReleaseManifest> {
  const internalValue: unknown = JSON.parse(readFileSync(join(input.releaseRoot, 'manifest.json'), 'utf8'));
  assertInternalReleaseManifest(internalValue);
  const internal: InternalReleaseManifest = internalValue;
  if (!RELEASE_VERSION_PATTERN.test(internal.releaseVersion)
    || !GIT_OBJECT_PATTERN.test(internal.source.commit)
    || !GIT_OBJECT_PATTERN.test(internal.source.tree)) {
    throw new Error('Release source identity is invalid');
  }
  if (!SHA256_PATTERN.test(input.compatibleGatewayManifestDigest)) {
    throw new Error('Compatible gateway manifest digest is required');
  }
  if (input.builderA.length < 1 || input.builderA.length > 256
    || input.builderB.length < 1 || input.builderB.length > 256
    || input.builderA === input.builderB) {
    throw new Error('Two distinct isolated builder identities are required');
  }
  const archiveDigest = await sha256File(input.archivePath);
  if (!SHA256_PATTERN.test(input.archiveDigestA) || !SHA256_PATTERN.test(input.archiveDigestB)
    || input.archiveDigestA !== archiveDigest || input.archiveDigestB !== archiveDigest) {
    throw new Error('Two byte-identical archive digests are required');
  }
  const testEvidenceBytes = readFileSync(input.testEvidencePath);
  const testEvidenceValue: unknown = JSON.parse(testEvidenceBytes.toString('utf8'));
  assertTestEvidence(testEvidenceValue);
  const testEvidence = testEvidenceValue;
  if (testEvidence.sourceCommit !== internal.source.commit) {
    throw new Error('Test evidence commit mismatch');
  }
  if (testEvidence.sourceTree !== internal.source.tree) {
    throw new Error('Test evidence tree mismatch');
  }
  const lockfileBytes = readFileSync(join(input.releaseRoot, 'lib', 'package-lock.json'));
  const lockfile = JSON.parse(lockfileBytes.toString('utf8')) as Parameters<typeof createSpdxSbom>[0]['lockfile'];
  const sbom = createSpdxSbom({
    lockfile,
    version: internal.releaseVersion,
    commit: internal.source.commit,
    sourceDateEpoch: internal.source.sourceDateEpoch,
  });
  const sbomBytes = `${canonicalJson(sbom)}\n`;
  writeFileSync(input.sbomOutputPath, sbomBytes, { mode: 0o644 });
  const requiredFiles = await buildRequiredFiles(input.releaseRoot);
  const requiredByPath = new Map(requiredFiles.map((file) => [file.path, file] as const));
  for (const entrypoint of internal.entrypoints) {
    const file = requiredByPath.get(entrypoint.path);
    if (file === undefined || file.kind !== 'executable') {
      throw new Error(`Declared packaged entrypoint is missing or not executable: ${entrypoint.path}`);
    }
  }
  for (const requiredPath of [
    'lib/package.json',
    'lib/package-lock.json',
    'libexec/bootstrap-safe-extract.py',
    'ops/systemd/baby-quirt.service',
    'ops/systemd/baby-quirt.socket',
    'ops/tmpfiles/baby-quirt.conf',
    'schemas/deployment/release-manifest.schema.json',
    'schemas/deployment/compatibility.schema.json',
    'contracts/baby-quirt-contracts-v1.json',
  ]) {
    if (!requiredByPath.has(requiredPath)) throw new Error(`Required release file is missing: ${requiredPath}`);
  }
  const nativePath = 'lib/build/Release/peer_cred.node';
  const native = requiredFiles.find((file) => file.path === nativePath);
  if (native === undefined) throw new Error(`Canonical native addon is missing: ${nativePath}`);
  const systemdUnits = requiredFiles.filter((file) => file.kind === 'systemd_unit');
  const tmpfiles = requiredFiles.find((file) => file.kind === 'tmpfiles') ?? null;
  const archiveStat = statSync(input.archivePath);
  const environment = {
    runtime: 'Node 24.18.0',
    locale: 'C',
    timezone: 'UTC',
    os: 'linux',
    architecture: 'amd64',
    nodePath: '/opt/node-v24.18.0-linux-x64/bin/node',
  } as const;
  const unsigned = {
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    product: 'baby-quirt',
    releaseVersion: internal.releaseVersion,
    source: internal.source,
    archive: {
      filename: basename(input.archivePath),
      sha256: archiveDigest,
      sizeBytes: archiveStat.size,
      format: 'tar.gz',
      topLevelPrefix: `baby-quirt-${internal.releaseVersion}`,
      fileListDigest: digestJson(requiredFiles as unknown as JsonValue),
    },
    build: {
      runtime: 'Node 24.18.0',
      lockfileDigest: sha256(lockfileBytes),
      commandDigest: digestJson(BUILD_COMMANDS as unknown as JsonValue),
      environmentDigest: digestJson(environment as unknown as JsonValue),
      provenanceDigest: internal.identityDigest,
      dependencyResolutionDigest: sha256(lockfileBytes),
      locale: 'C',
      timezone: 'UTC',
    },
    buildProvenance: {
      internalManifestDigest: internal.identityDigest,
      sourceRepository: internal.source.repository,
      sourceCommit: internal.source.commit,
      sourceTree: internal.source.tree,
    },
    target: internal.target,
    entrypoints: internal.entrypoints,
    nativeAddons: [{ path: nativePath, sha256: native.sha256, loadProbe: 'exports.getPeerCred', abi: 'N-API' }],
    requiredFiles,
    systemdUnits,
    tmpfiles,
    caddyFragments: [],
    configuration: {
      schemaVersion: CONFIGURATION_CONTRACT.schemaVersion,
      schemaDigest: digestJson(CONFIGURATION_CONTRACT as unknown as JsonValue),
      permissionContractDigest: digestJson(HOST_PERMISSION_CONTRACT as unknown as JsonValue),
    },
    state: {
      schemaVersion: STATE_CONTRACT.schemaVersion,
      schemaDigest: digestJson(STATE_CONTRACT as unknown as JsonValue),
      migrationIds: [],
      persistentOutsideRelease: true,
      downgradePolicy: 'backward_compatible',
    },
    operationContract: internal.operationContract,
    receiptVersions: internal.receiptVersions,
    qrt1Version: internal.qrt1Version,
    compatiblePeers: [
      { product: 'baby-quirt-mcp', manifestDigest: input.compatibleGatewayManifestDigest, role: 'required' },
    ],
    rollback: {
      knownGoodRequired: true,
      snapshotSchemaVersion: '1.0.0',
      statePolicy: 'preserve',
      requiredRestorePaths: [
        '/opt/baby-quirt/current',
        '/opt/baby-quirt/previous',
        '/etc/systemd/system/baby-quirt.socket',
        '/etc/systemd/system/baby-quirt.service',
        '/etc/tmpfiles.d/baby-quirt.conf',
      ],
    },
    sbom: {
      format: 'SPDX-JSON',
      filename: basename(input.sbomOutputPath),
      sha256: sha256(sbomBytes),
    },
    testEvidence: {
      indexDigest: sha256(testEvidenceBytes),
      suiteCount: testEvidence.suiteCount,
      testCount: testEvidence.testCount,
      ...(testEvidence.requiredGateDigest === undefined
        ? {}
        : { requiredGateDigest: testEvidence.requiredGateDigest }),
    },
    reproducibility: {
      builderA: input.builderA,
      builderB: input.builderB,
      archiveDigestA: input.archiveDigestA,
      archiveDigestB: input.archiveDigestB,
      byteIdentical: true,
    },
    knownLimitations: [],
  } as unknown as ReleaseManifest;
  const manifestDigest = digestJson(unsigned as unknown as JsonValue);
  const privateKey = createPrivateKey(readFileSync(input.signingPrivateKeyPath, 'utf8'));
  const manifest = {
    ...unsigned,
    manifestDigest,
    attestation: {
      algorithm: 'Ed25519',
      keyId: input.signingKeyId,
      signedDigest: manifestDigest,
      value: signManifestDigest(manifestDigest, privateKey),
    },
  } as ReleaseManifest;
  assertReleaseManifestSchema(manifest);
  if (releaseManifestDigest(manifest) !== manifestDigest) throw new Error('Release manifest digest construction failed');
  writeFileSync(input.outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return manifest;
}

export function loadAndVerifyReleaseManifest(path: string, publicKeyPath: string): ReleaseManifest {
  const value: unknown = readJson(path);
  assertReleaseManifestSchema(value);
  const manifest = value as ReleaseManifest;
  const publicKey = createPublicKey(readFileSync(publicKeyPath, 'utf8'));
  if (!verifyReleaseManifestAttestation(manifest, publicKey)) {
    throw new Error('Release manifest attestation verification failed');
  }
  return manifest;
}
