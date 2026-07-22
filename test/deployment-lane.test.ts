import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

describe('standalone deployment source lane', () => {
  it('retires the SSH installer, SSH rollback, and production deploy workflow fail closed', () => {
    for (const script of ['scripts/remote-install.sh', 'scripts/remote-rollback.sh']) {
      const syntax = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
      assert.equal(syntax.status, 0, `${script}: ${syntax.stderr}`);
      const run = spawnSync('bash', [script], { encoding: 'utf8' });
      assert.equal(run.status, 64, script);
      assert.match(run.stderr, /standalone Baby deployment/u);
    }
    assert.equal(existsSync('.github/workflows/deploy.yml'), false);
  });

  it('packages the compiled runtime and native addon at their exact relocatable paths', () => {
    const bundle = readFileSync('scripts/build-bundle.sh', 'utf8');
    assert.match(bundle, /test -d dist\/src/u);
    assert.match(bundle, /cp -R dist\/src\/\. "\$RELEASE_DIR\/lib\/dist\/"/u);
    assert.match(bundle, /lib\/build\/Release\/peer_cred\.node/u);
    assert.doesNotMatch(bundle, /lib\/native\/build\/Release/u);
    assert.match(bundle, /RELEASE_ROOT=.*SCRIPT_DIR\/\.\./u);
    assert.doesNotMatch(bundle, /current\/lib\/dist/u);
    assert.match(bundle, /production dependency graph contains a link/u);
  });

  it('uses one bounded strict archive implementation', () => {
    const wrapper = readFileSync('src/install/safe-extract.ts', 'utf8');
    const strict = readFileSync('src/release/strict-extractor.ts', 'utf8');
    const retired = readFileSync('scripts/bootstrap-safe-extract.py', 'utf8');
    assert.match(wrapper, /strictExtractRelease/u);
    assert.match(strict, /createGunzip/u);
    assert.match(strict, /O_NOFOLLOW/u);
    assert.match(strict, /O_EXCL/u);
    assert.doesNotMatch(retired, /tarfile|extractall|\.extract\(/u);
  });
});
