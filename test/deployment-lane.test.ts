import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

describe('frozen deployment authority boundary', () => {
  it('keeps the product adapter inactive, broker-bound, and reserved-version safe', () => {
    for (const script of ['scripts/remote-install.sh', 'scripts/remote-rollback.sh']) {
      const syntax = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
      assert.equal(syntax.status, 0, `${script}: ${syntax.stderr}`);
    }
    const install = readFileSync('scripts/remote-install.sh', 'utf8');
    for (const required of [
      'STEALTHEYE_DEPLOYMENT_AUTHORITY',
      'fix-privilege-broker',
      'STEALTHEYE_DEPLOYMENT_ID',
      'STEALTHEYE_DEPLOYMENT_GENERATION',
      'STEALTHEYE_DEPLOYMENT_PLAN_HASH',
      'BABY_QUIRT_EXPECTED_TREE',
      'BABY_QUIRT_EXPECTED_ARCHIVE_SHA256',
      'BABY_QUIRT_EXPECTED_MANIFEST_SHA256',
      'BABY_QUIRT_RELEASE_SIGNING_PUBLIC_KEY_SHA256',
      'BABY_QUIRT_STRICT_EXTRACTOR_PATH',
      'BABY_QUIRT_STRICT_EXTRACTOR_SHA256',
      'BABY_QUIRT_TRUSTED_INSTALL_CLI_PATH',
      'BABY_QUIRT_TRUSTED_INSTALL_CLI_SHA256',
      'INSTALL_CLI',
      'inactive',
      'pointerChanged',
      'serviceChanged',
      '0.2.1',
      '0.2.2',
    ]) assert.ok(install.includes(required), required);
    assert.doesNotMatch(install, /CANDIDATE_ROOT\/lib\/dist\/cli\/install\.js/);
    assert.doesNotMatch(install, /systemctl|currentLink|previousLink|\/etc\/systemd|\/etc\/tmpfiles/);
    const rollback = readFileSync('scripts/remote-rollback.sh', 'utf8');
    assert.match(rollback, /generation-bound deployment guard/);
    assert.doesNotMatch(rollback, /systemctl|rm\s|ln\s|symlink/);
  });

  it('builds a tree-bound, strict, relocatable final layout', () => {
    const bundle = readFileSync('scripts/build-bundle.sh', 'utf8');
    for (const required of [
      'BABY_QUIRT_SOURCE_TREE',
      'lib/build/Release/peer_cred.node',
      'BASH_SOURCE[0]',
      'BABY_QUIRT_NODE_PATH',
      '--format=ustar',
      'bootstrap-safe-extract.py',
      'write-internal-manifest.js',
      'schemas',
      'contracts',
    ]) assert.ok(bundle.includes(required), required);
    assert.doesNotMatch(bundle, /(?:cp|mkdir)[^\n]*lib\/native\/build\/Release\/peer_cred\.node/);
    assert.doesNotMatch(bundle, /\/opt\/baby-quirt\/current\/lib/);
    const nativeLoader = readFileSync('src/net/peer-cred.ts', 'utf8');
    assert.match(nativeLoader, /\.\.\/\.\.\/build\/Release\/peer_cred\.node/);
  });

  it('contains no direct product-owned production deployment workflow', () => {
    assert.equal(existsSync('.github/workflows/deploy.yml'), false);
    const release = readFileSync('scripts/release.sh', 'utf8');
    assert.doesNotMatch(release, /ssh|scp|systemctl|\/opt\/baby-quirt\/current/);
  });

  it('pins the immutable host permission contract in units and tmpfiles', () => {
    const service = readFileSync('ops/systemd/baby-quirt.service', 'utf8');
    const tmpfiles = readFileSync('ops/tmpfiles/baby-quirt.conf', 'utf8');
    assert.match(service, /ReadOnlyPaths=\/opt\/baby-quirt \/etc\/baby-quirt/);
    assert.doesNotMatch(service, /ReadWritePaths=.*\/opt\/baby-quirt/);
    assert.match(tmpfiles, /d \/etc\/baby-quirt 0750 root horsey/);
    assert.match(tmpfiles, /d \/opt\/baby-quirt\/releases 0755 root root/);
  });
});
