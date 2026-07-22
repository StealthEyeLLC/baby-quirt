import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import {
  assertReleaseVersion,
  GIT_OBJECT_PATTERN,
  SHA256_PATTERN,
  type CandidateVerificationCheck,
  type CandidateVerificationReport,
  type InternalReleaseManifest,
  type ReleaseFileRecord,
} from './contracts.js';
import { digestJson, fileMode, readJson, sha256, sha256File, walkRegularFiles } from './digest.js';
import { assertInternalReleaseManifest } from './internal-manifest.js';
import { assertTestEvidence, loadAndVerifyReleaseManifest } from './manifest.js';
import type { JsonValue } from './json.js';
import { assertReleaseTreeModes, HOST_PERMISSION_CONTRACT } from './permissions.js';

export interface VerifyCandidateInput {
  candidateRoot: string;
  archivePath: string;
  manifestPath: string;
  sbomPath: string;
  testEvidencePath: string;
  signingPublicKeyPath: string;
  expectedVersion: string;
  expectedCommit: string;
  expectedTree: string;
}

function check(checks: CandidateVerificationCheck[], name: string, detail: string, digest?: string): void {
  checks.push({ name, passed: true, detail, ...(digest === undefined ? {} : { digest }) });
}

function assertExpectedIdentity(input: VerifyCandidateInput): void {
  assertReleaseVersion(input.expectedVersion);
  if (!GIT_OBJECT_PATTERN.test(input.expectedCommit)
    || !GIT_OBJECT_PATTERN.test(input.expectedTree)) {
    throw new Error('Expected candidate identity is invalid');
  }
}

function assertRegularFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
}

function assertSpdxSbom(value: unknown, version: string, commit: string, sourceDateEpoch: number): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Candidate SBOM is not an SPDX object');
  }
  const sbom = value as {
    spdxVersion?: unknown;
    dataLicense?: unknown;
    SPDXID?: unknown;
    name?: unknown;
    documentNamespace?: unknown;
    creationInfo?: { created?: unknown; creators?: unknown };
    packages?: unknown;
    documentDescribes?: unknown;
  };
  if (sbom.spdxVersion !== 'SPDX-2.3'
    || sbom.dataLicense !== 'CC0-1.0'
    || sbom.SPDXID !== 'SPDXRef-DOCUMENT'
    || sbom.name !== `baby-quirt-${version}`
    || sbom.documentNamespace !== `https://stealtheye.io/sbom/baby-quirt/${version}/${commit}`
    || sbom.creationInfo?.created !== new Date(sourceDateEpoch * 1000).toISOString()
    || !Array.isArray(sbom.creationInfo?.creators)
    || !Array.isArray(sbom.packages)
    || !Array.isArray(sbom.documentDescribes)) {
    throw new Error('Candidate SBOM identity or structure mismatch');
  }
}

function assertInternalExternalBinding(internal: InternalReleaseManifest, external: ReturnType<typeof loadAndVerifyReleaseManifest>): void {
  if (internal.releaseVersion !== external.releaseVersion
    || internal.source.repository !== external.source.repository
    || internal.source.commit !== external.source.commit
    || internal.source.tree !== external.source.tree
    || internal.source.sourceDateEpoch !== external.source.sourceDateEpoch) {
    throw new Error('External and internal release manifests disagree');
  }
  const externalOperation = external.operationContract as Record<string, JsonValue>;
  if (internal.operationContract.version !== externalOperation.version
    || internal.operationContract.count !== externalOperation.count
    || internal.operationContract.requiredOperationsDigest !== externalOperation.requiredOperationsDigest
    || internal.qrt1Version !== external.qrt1Version) {
    throw new Error('External and internal runtime contracts disagree');
  }
}

function assertRelocatableEntrypoints(root: string): void {
  for (const relativePath of [
    'bin/baby-quirt-daemon',
    'bin/baby-quirt',
    'bin/baby-quirt-install',
    'bin/baby-quirt-verify-candidate',
  ]) {
    const path = join(root, relativePath);
    const source = readFileSync(path, 'utf8');
    if (source.includes('/opt/baby-quirt/current')) {
      throw new Error(`Packaged entrypoint is pointer-bound: ${relativePath}`);
    }
    if (!source.includes('BASH_SOURCE[0]') || !source.includes('BABY_QUIRT_NODE_PATH')) {
      throw new Error(`Packaged entrypoint is not relocatable: ${relativePath}`);
    }
    if ((Number.parseInt(fileMode(path), 8) & 0o111) === 0) {
      throw new Error(`Packaged entrypoint is not executable: ${relativePath}`);
    }
  }
}

function probePackagedEntrypoint(root: string): void {
  const output = execFileSync(join(root, 'bin', 'baby-quirt'), ['--help'], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, BABY_QUIRT_NODE_PATH: process.execPath },
  });
  if (!output.includes('Usage: baby-quirt')) {
    throw new Error('Relocatable packaged entrypoint probe returned unexpected output');
  }
}

function probeNativeAddon(root: string): void {
  const addonPath = join(root, 'lib', 'build', 'Release', 'peer_cred.node');
  const require = createRequire(join(root, 'lib', 'package.json'));
  const addon = require(addonPath) as { getPeerCred?: unknown };
  if (typeof addon.getPeerCred !== 'function') {
    throw new Error('Canonical native addon load probe did not expose getPeerCred');
  }
}

function verifyRuntimeDependencies(root: string): void {
  const packagePath = join(root, 'lib', 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { dependencies?: Record<string, string> };
  const require = createRequire(packagePath);
  for (const dependency of Object.keys(pkg.dependencies ?? {}).sort()) {
    require.resolve(dependency);
  }
}

export async function verifyReleaseCandidate(input: VerifyCandidateInput): Promise<CandidateVerificationReport> {
  assertExpectedIdentity(input);
  const checks: CandidateVerificationCheck[] = [];
  const requestedRoot = resolve(input.candidateRoot);
  const root = realpathSync(requestedRoot);
  const rootStat = lstatSync(root);
  if (root !== requestedRoot || !rootStat.isDirectory() || rootStat.isSymbolicLink()
    || basename(root) !== `baby-quirt-${input.expectedVersion}`) {
    throw new Error('Candidate root is not the exact real release directory');
  }
  for (const [path, label] of [
    [input.archivePath, 'Candidate archive'],
    [input.manifestPath, 'Candidate manifest'],
    [input.sbomPath, 'Candidate SBOM'],
    [input.testEvidencePath, 'Candidate test evidence'],
    [input.signingPublicKeyPath, 'Release signing public key'],
  ] as const) assertRegularFile(path, label);
  const manifest = loadAndVerifyReleaseManifest(input.manifestPath, input.signingPublicKeyPath);
  check(checks, 'manifest-schema-and-attestation', 'Frozen schema and Ed25519 attestation verified', manifest.manifestDigest);
  if (manifest.product !== 'baby-quirt'
    || manifest.releaseVersion !== input.expectedVersion
    || manifest.source.commit !== input.expectedCommit
    || manifest.source.tree !== input.expectedTree) {
    throw new Error('Candidate manifest does not match the exact expected identity');
  }
  check(checks, 'source-identity', 'Product, version, commit, and Git tree match exactly');
  const archiveDigest = await sha256File(input.archivePath);
  const archiveStat = statSync(input.archivePath);
  if (archiveDigest !== manifest.archive.sha256
    || archiveStat.size !== manifest.archive.sizeBytes
    || basename(input.archivePath) !== manifest.archive.filename
    || manifest.archive.topLevelPrefix !== `baby-quirt-${input.expectedVersion}`) {
    throw new Error('Candidate archive identity mismatch');
  }
  check(checks, 'archive-identity', 'Archive filename, size, digest, and prefix match', archiveDigest);
  const sbomBytes = readFileSync(input.sbomPath);
  if (basename(input.sbomPath) !== (manifest.sbom as Record<string, JsonValue>).filename
    || sha256(sbomBytes) !== (manifest.sbom as Record<string, JsonValue>).sha256) {
    throw new Error('Candidate SBOM identity mismatch');
  }
  const sbomValue: unknown = JSON.parse(sbomBytes.toString('utf8'));
  assertSpdxSbom(
    sbomValue,
    manifest.releaseVersion,
    manifest.source.commit,
    manifest.source.sourceDateEpoch,
  );
  check(checks, 'sbom', 'Manifest-covered SPDX SBOM verified', sha256(sbomBytes));
  const testEvidenceBytes = readFileSync(input.testEvidencePath);
  if (sha256(testEvidenceBytes) !== (manifest.testEvidence as Record<string, JsonValue>).indexDigest) {
    throw new Error('Candidate test evidence digest mismatch');
  }
  const testEvidence: unknown = JSON.parse(testEvidenceBytes.toString('utf8'));
  assertTestEvidence(testEvidence);
  if (testEvidence.sourceCommit !== manifest.source.commit || testEvidence.sourceTree !== manifest.source.tree) {
    throw new Error('Candidate test evidence source identity mismatch');
  }
  if (testEvidence.suiteCount !== (manifest.testEvidence as Record<string, JsonValue>).suiteCount
    || testEvidence.testCount !== (manifest.testEvidence as Record<string, JsonValue>).testCount) {
    throw new Error('Candidate test evidence counts mismatch');
  }
  check(checks, 'test-evidence', 'Manifest-covered passing test index verified', sha256(testEvidenceBytes));
  const internalValue: unknown = readJson(join(root, 'manifest.json'));
  assertInternalReleaseManifest(internalValue);
  assertInternalExternalBinding(internalValue, manifest);
  check(checks, 'internal-manifest', 'Internal manifest digest and external binding verified', internalValue.identityDigest);
  const actualFiles = walkRegularFiles(root);
  if (!SHA256_PATTERN.test(manifest.archive.fileListDigest ?? '')) {
    throw new Error('Candidate manifest is missing the required file-list digest');
  }
  const expectedFiles = new Map(manifest.requiredFiles.map((file) => [file.path, file] as const));
  if (actualFiles.length !== expectedFiles.size) throw new Error('Candidate file inventory count mismatch');
  const actualRecords: ReleaseFileRecord[] = [];
  for (const file of actualFiles) {
    const expected = expectedFiles.get(file.relativePath);
    if (expected === undefined) throw new Error(`Candidate contains an undeclared file: ${file.relativePath}`);
    const digest = await sha256File(file.absolutePath);
    if (digest !== expected.sha256 || file.sizeBytes !== expected.sizeBytes || file.mode !== expected.mode) {
      throw new Error(`Candidate file identity mismatch: ${file.relativePath}`);
    }
    actualRecords.push(expected);
  }
  const fileListDigest = digestJson(actualRecords as unknown as JsonValue);
  if (manifest.archive.fileListDigest !== fileListDigest) throw new Error('Candidate file-list digest mismatch');
  check(checks, 'file-inventory', 'Every declared file hash, size, and mode matches with no extras', fileListDigest);
  const configuration = manifest.configuration as Record<string, JsonValue>;
  if (configuration.permissionContractDigest !== digestJson(HOST_PERMISSION_CONTRACT as unknown as JsonValue)) {
    throw new Error('Candidate host permission contract digest mismatch');
  }
  assertReleaseTreeModes(root, manifest.requiredFiles);
  check(checks, 'permission-contract', 'Host contract digest and all immutable release modes match');
  assertRelocatableEntrypoints(root);
  check(checks, 'relocatable-entrypoints', 'Real packaged entrypoints are executable and pointer-independent');
  probePackagedEntrypoint(root);
  check(checks, 'packaged-entrypoint-probe', 'Extracted client entrypoint executed from its own release root');
  verifyRuntimeDependencies(root);
  check(checks, 'dependency-resolution', 'All packaged runtime dependencies resolve from the final layout');
  probeNativeAddon(root);
  const nativeDigest = await sha256File(join(root, 'lib', 'build', 'Release', 'peer_cred.node'));
  check(checks, 'native-addon', 'Canonical final-layout SO_PEERCRED addon loaded', nativeDigest);
  const partial = {
    schemaVersion: '1.0.0',
    product: 'baby-quirt',
    releaseVersion: input.expectedVersion,
    sourceCommit: input.expectedCommit,
    sourceTree: input.expectedTree,
    archiveDigest,
    manifestDigest: manifest.manifestDigest,
    candidateRoot: root,
    passed: true,
    checks,
  } as const;
  return { ...partial, reportDigest: digestJson(partial as unknown as JsonValue) };
}
