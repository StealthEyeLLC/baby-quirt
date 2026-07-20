import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

describe('production deployment lane', () => {
  it('keeps the remote scripts syntactically valid and first-install capable', () => {
    for (const script of ['scripts/remote-install.sh', 'scripts/remote-rollback.sh']) {
      const syntax = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
      assert.equal(syntax.status, 0, `${script}: ${syntax.stderr}`);
    }

    const install = readFileSync('scripts/remote-install.sh', 'utf8');
    assert.match(install, /tr -d '\\r\\n' <\/etc\/machine-id/);
    assert.match(install, /bootstrap-safe-extract\.py/);
    assert.doesNotMatch(install, /CURRENT_LINK.*safe-extract/);
    assert.doesNotMatch(install, /CURRENT_LINK.*cli\/install/);
    assert.match(install, /gateway-authority-public\.pem/);
    assert.ok(install.includes('ACTIVE_TARGET=$(sudo readlink -f "$CURRENT_LINK")'));
    assert.ok(!install.includes('ACTIVE_TARGET=$(readlink -f "$CURRENT_LINK")'));
  });

  it('packages runtime files at the exact paths consumed by first install', () => {
    const bundle = readFileSync('scripts/build-bundle.sh', 'utf8');
    assert.match(bundle, /test -d dist\/src/);
    assert.match(bundle, /cp -r dist\/src\/\. "\$RELEASE_DIR\/lib\/dist\/"/);
    assert.doesNotMatch(bundle, /cp -r dist "\$RELEASE_DIR\/lib\/"/);
    for (const required of [
      'lib/dist/index.js',
      'lib/dist/cli/install.js',
      'lib/dist/cli/verify.js',
      'lib/dist/cli/rollback.js',
      'bin/baby-quirt-daemon',
    ]) {
      assert.match(bundle, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(bundle, /unexpected nested dist\/src runtime/);
  });

  it('pins deploy checkout and all upload-artifact actions', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const uploadPin = 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02';
    assert.equal(workflow.split(uploadPin).length - 1, 3);
    assert.match(workflow, /ref: \$\{\{ needs\.build\.outputs\.commit \}\}/);
    assert.match(workflow, /git merge-base --is-ancestor/);
    assert.match(workflow, /BABY_QUIRT_EXPECTED_GATEWAY_PUBLIC_KEY_SHA256/);
  });
});
