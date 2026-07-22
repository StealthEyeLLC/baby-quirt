import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertTestEvidence,
  generateReleaseManifest,
  loadAndVerifyReleaseManifest,
  releaseManifestDigest,
} from '../src/release/manifest.js';
import { createInternalReleaseManifest } from '../src/release/internal-manifest.js';
import { sha256File } from '../src/release/digest.js';
import { loadFrozenSchema } from '../src/release/schemas.js';
import {
  createTestEvidence,
  REQUIRED_RELEASE_GATES,
} from '../src/release/test-evidence.js';

const VERSION = '0.3.0-test';
const COMMIT = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const EPOCH = 1_784_707_707;

function writeFixture(path: string, data: string | Buffer, mode = 0o444): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  chmodSync(path, mode);
}

function makeReleaseRoot(root: string): string {
  const releaseRoot = join(root, `baby-quirt-${VERSION}`);
  const internal = createInternalReleaseManifest({
    version: VERSION,
    commit: COMMIT,
    tree: TREE,
    sourceDateEpoch: EPOCH,
  });
  writeFixture(join(releaseRoot, 'manifest.json'), `${JSON.stringify(internal, null, 2)}\n`);
  for (const entrypoint of internal.entrypoints) {
    writeFixture(
      join(releaseRoot, entrypoint.path),
      '#!/usr/bin/env bash\nB="${BASH_SOURCE[0]}"\nNODE="${BABY_QUIRT_NODE_PATH:-node}"\nexec "$NODE" --version\n',
      0o555,
    );
  }
  writeFixture(join(releaseRoot, 'lib/build/Release/peer_cred.node'), 'fixture-native-addon');
  writeFixture(join(releaseRoot, 'lib/package.json'), JSON.stringify({ name: 'baby-quirt', version: '0.1.0', dependencies: {} }));
  writeFixture(join(releaseRoot, 'lib/package-lock.json'), JSON.stringify({
    name: 'baby-quirt',
    version: '0.1.0',
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: 'baby-quirt', version: '0.1.0', license: 'UNLICENSED' } },
  }));
  writeFixture(join(releaseRoot, 'libexec/bootstrap-safe-extract.py'), '#!/usr/bin/env python3\n', 0o555);
  writeFixture(join(releaseRoot, 'ops/systemd/baby-quirt.service'), '[Service]\n');
  writeFixture(join(releaseRoot, 'ops/systemd/baby-quirt.socket'), '[Socket]\n');
  writeFixture(join(releaseRoot, 'ops/tmpfiles/baby-quirt.conf'), 'd /run/horsey 0750 root horsey -\n');
  for (const schema of ['release-manifest.schema.json', 'compatibility.schema.json']) {
    const destination = join(releaseRoot, 'schemas/deployment', schema);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(process.cwd(), 'schemas/deployment', schema), destination);
    chmodSync(destination, 0o444);
  }
  const contractDestination = join(releaseRoot, 'contracts/baby-quirt-contracts-v1.json');
  mkdirSync(dirname(contractDestination), { recursive: true });
  copyFileSync(join(process.cwd(), 'contracts/baby-quirt-contracts-v1.json'), contractDestination);
  chmodSync(contractDestination, 0o444);
  return releaseRoot;
}

describe('frozen signed release manifest', () => {
  it('binds source tree, files, tests, SBOM, compatibility, and reproducibility', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-release-manifest-'));
    try {
      const releaseRoot = makeReleaseRoot(root);
      const archive = join(root, `baby-quirt-${VERSION}.tar.gz`);
      writeFileSync(archive, 'deterministic-archive-fixture');
      const archiveDigest = await sha256File(archive);
      const evidence = join(root, 'test-evidence.json');
      const passingEvidence = createTestEvidence({
        sourceCommit: COMMIT,
        sourceTree: TREE,
        suites: REQUIRED_RELEASE_GATES.map((gate) => ({
          name: gate.name,
          command: gate.command,
          testCount: gate.testCount ? 1 : 0,
          passed: true as const,
        })),
      });
      writeFileSync(evidence, `${JSON.stringify(passingEvidence)}\n`);
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const privatePath = join(root, 'release-private.pem');
      const publicPath = join(root, 'release-public.pem');
      writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
      writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
      const output = join(root, `baby-quirt-${VERSION}.manifest.json`);
      const sbom = join(root, `baby-quirt-${VERSION}.spdx.json`);
      const manifest = await generateReleaseManifest({
        releaseRoot,
        archivePath: archive,
        outputPath: output,
        sbomOutputPath: sbom,
        testEvidencePath: evidence,
        signingPrivateKeyPath: privatePath,
        signingKeyId: 'fixture-release-v1',
        compatibleGatewayManifestDigest: 'c'.repeat(64),
        builderA: 'isolated-a',
        builderB: 'isolated-b',
        archiveDigestA: archiveDigest,
        archiveDigestB: archiveDigest,
      });

      assert.equal(manifest.source.commit, COMMIT);
      assert.equal(manifest.source.tree, TREE);
      assert.equal(manifest.operationContract.count, 31);
      assert.equal(manifest.archive.sha256, archiveDigest);
      assert.equal(manifest.reproducibility.byteIdentical, true);
      assert.ok(manifest.requiredFiles.some((file) => file.path === 'lib/build/Release/peer_cred.node'));
      assert.equal(releaseManifestDigest(manifest), manifest.manifestDigest);
      assert.deepEqual(loadAndVerifyReleaseManifest(output, publicPath), manifest);
      const spdx = JSON.parse(readFileSync(sbom, 'utf8')) as { spdxVersion: string; name: string };
      assert.equal(spdx.spdxVersion, 'SPDX-2.3');
      assert.equal(spdx.name, `baby-quirt-${VERSION}`);

      const tampered = structuredClone(manifest);
      tampered.source.tree = 'd'.repeat(40);
      writeFileSync(output, `${JSON.stringify(tampered, null, 2)}\n`);
      assert.throws(() => loadAndVerifyReleaseManifest(output, publicPath), /attestation verification failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('pins the exact frozen schema bytes and protects reserved versions', () => {
    assert.equal(loadFrozenSchema('release').$id, 'https://stealtheye.io/schemas/deployment/release-manifest-v1.json');
    assert.equal(loadFrozenSchema('compatibility').$id, 'https://stealtheye.io/schemas/deployment/compatibility-v1.json');
    for (const version of ['0.2.1', '0.2.2']) {
      assert.throws(
        () => createInternalReleaseManifest({ version, commit: COMMIT, tree: TREE, sourceDateEpoch: EPOCH }),
        /Reserved release/,
      );
    }
  });

  it('requires the exact frozen gate set and its digest', () => {
    const evidence = createTestEvidence({
      sourceCommit: COMMIT,
      sourceTree: TREE,
      suites: REQUIRED_RELEASE_GATES.map((gate) => ({
        name: gate.name,
        command: gate.command,
        testCount: gate.testCount ? 1 : 0,
        passed: true as const,
      })),
    });
    assert.doesNotThrow(() => assertTestEvidence(evidence));
    const substituted = structuredClone(evidence);
    substituted.suites[0]!.name = 'untrusted-substitute';
    assert.throws(() => assertTestEvidence(substituted), /release gate mismatch/);
    const staleDigest = structuredClone(evidence);
    staleDigest.requiredGateDigest = 'd'.repeat(64);
    assert.throws(() => assertTestEvidence(staleDigest), /required-gate digest mismatch/);
  });
});
