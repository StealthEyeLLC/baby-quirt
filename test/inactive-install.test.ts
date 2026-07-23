import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { sha256Hex } from '../src/crypto/canonical.js';
import {
  generateEd25519KeyPair,
  loadPrivateKey,
  loadPublicKey,
} from '../src/crypto/signing.js';
import { installInactiveCandidate } from '../src/deployment/inactive-install.js';
import { mapHostPath } from '../src/deployment/snapshot.js';
import { PINNED_NODE_VERSION } from '../src/release/archive-contract.js';
import { createDeterministicTarGz } from '../src/release/deterministic-archive.js';
import {
  buildSignedReleaseManifest,
  type CandidateBuildRecord,
} from '../src/release/release-manifest.js';

const digest = (label: string): string => sha256Hex(label);

describe('strict inactive candidate installation', () => {
  it('installs create-once without changing either product pointer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'baby-quirt-inactive-'));
    try {
      const releaseRoot = join(root, 'candidate');
      for (const path of [
        'bin/baby-quirt-mcp',
        'src/main.js',
        'src/server.js',
        'ops/systemd/baby-quirt-mcp.service',
        'ops/caddy/baby-quirt-mcp.Caddyfile',
        'package.json',
      ]) {
        const absolute = join(releaseRoot, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, `${path}\n`, { mode: path.startsWith('bin/') ? 0o755 : 0o644 });
      }
      const archivePath = join(root, 'baby-quirt-mcp-0.3.0.tar.gz');
      const packaged = await createDeterministicTarGz({
        releaseRoot,
        topLevelPrefix: 'baby-quirt-mcp-0.3.0',
        archivePath,
        sourceDateEpoch: 1_784_741_000,
      });
      const build: CandidateBuildRecord = {
        recordVersion: '2.0.0',
        schemaVersion: '2.0.0',
        product: 'baby-quirt-mcp',
        repository: 'StealthEyeLLC/baby-quirt-mcp',
        releaseVersion: '0.3.0',
        commit: '1'.repeat(40),
        tree: '2'.repeat(40),
        sourceDateEpoch: 1_784_741_000,
        lockfileDigest: digest('lock'),
        nodeVersion: PINNED_NODE_VERSION,
        buildCommandDigest: digest('build'),
        environmentIdentity: {
          os: 'fixture-linux',
          architecture: 'x64',
          locale: 'C.UTF-8',
          timezone: 'UTC',
          umask: '0022',
          toolchainDigest: digest('toolchain'),
        },
        archive: packaged.archive,
        internalManifestDigest: digest('internal-manifest'),
        files: packaged.files,
        sbom: {
          digest: digest('sbom'),
          artifactReference: `artifact:sha256:${digest('sbom')}`,
          format: 'spdx-json-2.3',
        },
        testEvidenceIndexDigest: digest('tests'),
        compatibilityDigest: digest('compatibility'),
        stateMigration: { supported: true, strategy: 'fixture', evidenceDigest: digest('migration') },
        rollback: { supported: true, strategy: 'snapshot', evidenceDigest: digest('rollback') },
        peerCompatibility: {
          minimumRelease: '0.1.3',
          maximumRelease: '0.x',
          protocolVersions: ['1.0.0'],
          receiptVersions: ['1.0.0', '2.0.0'],
          catalogVersions: ['legacy-26', 'runtime-native-v2'],
        },
      };
      const publicPath = join(root, 'release-public.pem');
      const privatePath = join(root, 'release-private.pem');
      generateEd25519KeyPair({
        publicKeyPath: publicPath,
        privateKeyPath: privatePath,
        keyId: 'release-authority-v2',
      });
      const privateKey = loadPrivateKey(privatePath);
      const publicKey = loadPublicKey(publicPath);
      const manifest = buildSignedReleaseManifest({
        first: build,
        second: build,
        signingKeyId: 'release-authority-v2',
        privateKey,
      });

      const hostRoot = join(root, 'host');
      mkdirSync(mapHostPath(hostRoot, '/opt/baby-quirt-mcp/releases'), { recursive: true });
      mkdirSync(mapHostPath(hostRoot, '/opt/baby-quirt-mcp'), { recursive: true });
      symlinkSync(
        '/opt/baby-quirt-mcp/releases/0.1.0',
        mapHostPath(hostRoot, '/opt/baby-quirt-mcp/current'),
      );
      const result = await installInactiveCandidate({
        hostRoot,
        product: 'baby-quirt-mcp',
        archivePath,
        manifest,
        releaseAuthorityPublicKey: publicKey,
      });
      assert.equal(result.releaseVersion, '0.3.0');
      assert.equal(
        readFileSync(join(result.target, 'bin', 'baby-quirt-mcp'), 'utf8'),
        'bin/baby-quirt-mcp\n',
      );
      assert.equal(
        readlinkSync(mapHostPath(hostRoot, '/opt/baby-quirt-mcp/current')),
        '/opt/baby-quirt-mcp/releases/0.1.0',
      );
      assert.equal(
        await installInactiveCandidate({
          hostRoot,
          product: 'baby-quirt-mcp',
          archivePath,
          manifest,
          releaseAuthorityPublicKey: publicKey,
        }).then(() => 'unexpected', (error: Error) => error.message),
        'Immutable inactive release target already exists',
      );

      const reservedBuild = { ...build, releaseVersion: '0.2.1' };
      const reserved = buildSignedReleaseManifest({
        first: reservedBuild,
        second: reservedBuild,
        signingKeyId: 'release-authority-v2',
        privateKey,
      });
      await assert.rejects(
        installInactiveCandidate({
          hostRoot,
          product: 'baby-quirt-mcp',
          archivePath,
          manifest: reserved,
          releaseAuthorityPublicKey: publicKey,
        }),
        /Reserved release version/u,
      );
      await assert.rejects(
        installInactiveCandidate({
          hostRoot,
          product: 'baby-quirt',
          archivePath,
          manifest,
          releaseAuthorityPublicKey: publicKey,
        }),
        /product does not match/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
