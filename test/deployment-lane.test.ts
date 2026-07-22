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

  it('ships a non-networked persistent fixed guard outside active releases', () => {
    const service = readFileSync('ops/systemd/baby-quirt-deploy-guard@.service', 'utf8');
    const timer = readFileSync('ops/systemd/baby-quirt-deploy-guard@.timer', 'utf8');
    assert.match(service, /\/usr\/bin\/flock --exclusive --nonblock \/run\/baby-quirt\/deploy\.lock/u);
    assert.match(service, /\/usr\/libexec\/baby-quirt-deploy\/current\/bin\/baby-quirt-deploy-guard/u);
    assert.doesNotMatch(service, /ListenStream|ListenDatagram|DynamicUser/u);
    assert.match(timer, /^Persistent=true$/mu);
    assert.match(timer, /^OnBootSec=15s$/mu);
    assert.match(timer, /^Unit=baby-quirt-deploy-guard@%i\.service$/mu);
  });

  it('keeps inactive install pointer-free and retires product-owned rollback and repair', () => {
    const installer = readFileSync('src/cli/install.ts', 'utf8');
    assert.match(installer, /installInactiveCandidate/u);
    assert.match(installer, /pointerMutation: false/u);
    assert.doesNotMatch(installer, /atomicSwapSymlinks|systemctl|currentLink/u);
    for (const path of ['src/cli/rollback.ts', 'src/cli/repair.ts']) {
      const source = readFileSync(path, 'utf8');
      assert.match(source, /process\.exitCode = 64/u);
      assert.doesNotMatch(source, /rollbackSymlinks|chmodSync|systemctl/u);
    }
  });
});
