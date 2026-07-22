import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { generateReleaseManifest } from '../src/release/manifest.js';
import { verifyReleaseCandidate } from '../src/release/candidate.js';
import { installInactiveRelease } from '../src/release/install.js';
import {
  createTestEvidence,
  REQUIRED_RELEASE_GATES,
} from '../src/release/test-evidence.js';

describe('acceptance: frozen release producer and candidate verifier', () => {
  it('builds twice byte-identically, signs exact identity, verifies final layout, and installs only inactive', { timeout: 600_000 }, async () => {
    const root = join(import.meta.dirname, '..');
    const version = '0.0.0-repro.test';
    const epoch = execSync('git log -1 --format=%ct', { cwd: root, encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
    const tree = execSync(`git show -s --format=%T ${commit}`, { cwd: root, encoding: 'utf8' }).trim();
    const archive = join(root, 'release', `baby-quirt-${version}.tar.gz`);
    const digestFile = join(root, 'release', `baby-quirt-${version}.sha256`);
    const buildA = mkdtempSync(join(tmpdir(), 'bq-repro-a-'));
    const buildB = mkdtempSync(join(tmpdir(), 'bq-repro-b-'));
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'bq-release-evidence-'));
    const installRoot = mkdtempSync(join(tmpdir(), 'bq-inactive-install-'));
    const nodedir = join('/tmp/seds-node-headers', `node-v${process.versions.node}`);
    const baseEnv = {
      ...process.env,
      SOURCE_DATE_EPOCH: epoch,
      BABY_QUIRT_SOURCE_COMMIT: commit,
      BABY_QUIRT_SOURCE_TREE: tree,
      BABY_QUIRT_KEEP_BUILD_ROOT: '1',
      LC_ALL: 'C',
      TZ: 'UTC',
      ...(existsSync(nodedir) ? { npm_config_nodedir: nodedir } : {}),
    };
    const privateKeyPath = join(evidenceRoot, 'release-private.pem');
    const publicKeyPath = join(evidenceRoot, 'release-public.pem');
    const testEvidencePath = join(evidenceRoot, `baby-quirt-${version}.test-evidence.json`);
    const manifestPath = join(evidenceRoot, `baby-quirt-${version}.manifest.json`);
    const sbomPath = join(evidenceRoot, `baby-quirt-${version}.spdx.json`);

    try {
      execFileSync('bash', ['scripts/build-bundle.sh', version], {
        cwd: root,
        env: { ...baseEnv, BABY_QUIRT_BUILD_ROOT: buildA },
        stdio: 'pipe',
      });
      const bytesA = readFileSync(archive);
      const digestA = readFileSync(digestFile, 'utf8').split(/\s+/)[0];
      execFileSync('bash', ['scripts/build-bundle.sh', version], {
        cwd: root,
        env: { ...baseEnv, BABY_QUIRT_BUILD_ROOT: buildB },
        stdio: 'pipe',
      });
      const bytesB = readFileSync(archive);
      const digestB = readFileSync(digestFile, 'utf8').split(/\s+/)[0];
      assert.equal(digestA, digestB);
      assert.deepEqual(bytesA, bytesB);

      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
      const testEvidence = createTestEvidence({
        sourceCommit: commit,
        sourceTree: tree,
        suites: REQUIRED_RELEASE_GATES.map((gate) => ({
          name: gate.name,
          command: gate.command,
          testCount: gate.testCount ? 1 : 0,
          passed: true as const,
        })),
      });
      writeFileSync(testEvidencePath, `${JSON.stringify(testEvidence, null, 2)}\n`);

      const candidateRoot = join(buildB, `baby-quirt-${version}`);
      const manifest = await generateReleaseManifest({
        releaseRoot: candidateRoot,
        archivePath: archive,
        outputPath: manifestPath,
        sbomOutputPath: sbomPath,
        testEvidencePath,
        signingPrivateKeyPath: privateKeyPath,
        signingKeyId: 'acceptance-ephemeral-release-key',
        compatibleGatewayManifestDigest: 'a'.repeat(64),
        builderA: 'isolated-a',
        builderB: 'isolated-b',
        archiveDigestA: digestA,
        archiveDigestB: digestB,
      });
      assert.equal(manifest.source.commit, commit);
      assert.equal(manifest.source.tree, tree);
      assert.equal(manifest.archive.fileListDigest?.length, 64);
      assert.equal((manifest.operationContract as { count: number }).count, 31);
      assert.deepEqual(manifest.receiptVersions, ['1.0.0', '2.0.0']);

      const report = await verifyReleaseCandidate({
        candidateRoot,
        archivePath: archive,
        manifestPath,
        sbomPath,
        testEvidencePath,
        signingPublicKeyPath: publicKeyPath,
        expectedVersion: version,
        expectedCommit: commit,
        expectedTree: tree,
      });
      assert.equal(report.passed, true);
      assert.deepEqual(
        report.checks.map((check) => check.name),
        [
          'manifest-schema-and-attestation',
          'source-identity',
          'archive-identity',
          'sbom',
          'test-evidence',
          'internal-manifest',
          'file-inventory',
          'permission-contract',
          'relocatable-entrypoints',
          'packaged-entrypoint-probe',
          'dependency-resolution',
          'native-addon',
        ],
      );
      await assert.rejects(
        () => verifyReleaseCandidate({
          candidateRoot,
          archivePath: archive,
          manifestPath,
          sbomPath,
          testEvidencePath,
          signingPublicKeyPath: publicKeyPath,
          expectedVersion: version,
          expectedCommit: commit,
          expectedTree: 'b'.repeat(40),
        }),
        /exact expected identity/,
      );

      const installed = installInactiveRelease({
        verifiedCandidateRoot: candidateRoot,
        releaseRoot: installRoot,
        manifest,
        ownerUid: process.getuid?.() ?? 0,
        ownerGid: process.getgid?.() ?? 0,
      });
      assert.equal(installed.activated, false);
      assert.equal(installed.pointersChanged, false);
      assert.equal(installed.servicesChanged, false);
      assert.equal(existsSync(join(installRoot, version, 'manifest.json')), true);
      assert.equal(existsSync(join(installRoot, 'current')), false);
      assert.equal(existsSync(join(installRoot, 'previous')), false);
      assert.throws(
        () => installInactiveRelease({
          verifiedCandidateRoot: candidateRoot,
          releaseRoot: installRoot,
          manifest,
          ownerUid: process.getuid?.() ?? 0,
          ownerGid: process.getgid?.() ?? 0,
        }),
        /already exists/,
      );
      assert.throws(
        () => installInactiveRelease({
          verifiedCandidateRoot: candidateRoot,
          releaseRoot: installRoot,
          manifest: { ...manifest, releaseVersion: '0.2.1' },
        }),
        /Reserved release 0\.2\.1/,
      );

      const archiveListing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' });
      assert.doesNotMatch(archiveListing, /^[lhcbps]/m);
      assert.match(archiveListing, /lib\/build\/Release\/peer_cred\.node/);
      assert.doesNotMatch(archiveListing, /lib\/native\/build\/Release\/peer_cred\.node/);
    } finally {
      rmSync(buildA, { recursive: true, force: true });
      rmSync(buildB, { recursive: true, force: true });
      rmSync(evidenceRoot, { recursive: true, force: true });
      rmSync(installRoot, { recursive: true, force: true });
      rmSync(archive, { force: true });
      rmSync(digestFile, { force: true });
    }
  });
});
