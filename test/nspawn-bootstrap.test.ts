import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('one-time nspawn host bootstrap contract', () => {
  it('is syntactically valid, exact-confirmation gated, and creates only the disposable file pool', () => {
    const path = 'ops/rehearsal/bootstrap-nspawn-host.sh';
    const syntax = spawnSync('/usr/bin/bash', ['-n', path], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const source = readFileSync(path, 'utf8');
    assert.match(source, /--confirm-create-babycert-v1/u);
    assert.match(source, /POOL_BYTES=12884901888/u);
    assert.match(source, /HOST_RESERVE_BYTES=15032385536/u);
    assert.match(source, /fallocate --length "\$POOL_BYTES" "\$VDEV"/u);
    assert.match(source, /zpool create -f/u);
    assert.match(source, /primarycache=metadata/u);
    assert.match(source, /secondarycache=none/u);
    assert.match(source, /zfs set readonly=on/u);
    assert.match(source, /zfs snapshot "\$BASE_SNAPSHOT"/u);
    assert.doesNotMatch(source, /zfs_arc_max|\/etc\/modprobe\.d|\/dev\/sda|parted|fdisk|mkfs/u);
  });

  it('bakes the fixed harness and powers off after its one systemd boot', () => {
    const unit = readFileSync('ops/rehearsal/baby-quirt-host-certification.service', 'utf8');
    const harness = readFileSync('ops/rehearsal/baby-quirt-host-certification.mjs', 'utf8');
    assert.match(unit, /^SuccessAction=poweroff$/mu);
    assert.match(unit, /^FailureAction=poweroff-force$/mu);
    assert.match(unit, /^ExecStart=\/opt\/node-v24\.18\.0-linux-x64\/bin\/node /mu);
    assert.match(harness, /\/proc\/self\/uid_map/u);
    assert.match(harness, /allCapabilities/u);
    assert.match(harness, /NoNewPrivs/u);
    assert.match(harness, /SO_PEERCRED UID 997 probe/u);
    assert.match(harness, /npm_config_offline: 'true'/u);
  });

  it('does not bind a production tree, host cgroup tree, or host network into the machine', () => {
    const runner = readFileSync('src/rehearsal/nspawn-runner.ts', 'utf8');
    assert.match(runner, /'--private-users=no'/u);
    assert.match(runner, /'--capability=all'/u);
    assert.match(runner, /'--no-new-privileges=no'/u);
    assert.match(runner, /'--system-call-filter=@known'/u);
    assert.match(runner, /'--property=DevicePolicy=auto'/u);
    assert.match(runner, /'--private-network'/u);
    assert.doesNotMatch(runner, /--bind-ro=\/sys\/fs\/cgroup/u);
    assert.doesNotMatch(runner, /\/opt\/baby-quirt\/current|\/opt\/baby-quirt-mcp\/current/u);
  });

  it('boots automatically only from an exact, isolated authorization commit', () => {
    const workflow = readFileSync('.github/workflows/bootstrap-nspawn-host.yml', 'utf8');
    assert.match(workflow, /^  push:\n    branches: \[build\/standalone-deployment-system-v2\]$/mu);
    assert.match(workflow, /^  pull_request:\n    branches: \[main\]\n    types: \[opened, reopened\]$/mu);
    assert.doesNotMatch(workflow, /workflow_dispatch/u);
    assert.match(workflow, /github\.event\.head_commit\.message == 'chore: authorize one-time nspawn host bootstrap'/u);
    assert.match(workflow, /github\.event\.pull_request\.head\.ref == 'build\/standalone-deployment-system-v2'/u);
    assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
    assert.match(workflow, /git diff-tree --no-commit-id --name-only -r HEAD/u);
    assert.match(workflow, /\.github\/nspawn-bootstrap-authorization\.json/u);
    assert.match(workflow, /now < expires <= now \+ datetime\.timedelta\(hours=24\)/u);
    assert.equal(workflow.includes('\\\\$1'), false, 'remote awk fields must not expand in the local shell');
    assert.match(workflow, /StrictHostKeyChecking=yes/u);
    assert.match(workflow, /token: \$\{\{ secrets\.quirt_all_gh_token \}\}/u);
    assert.equal((workflow.match(/persist-credentials: false/gu) ?? []).length, 3);
    assert.match(workflow, /--confirm-create-babycert-v1/u);
    assert.match(workflow, /baby-quirt-nspawn-runner preflight '\$RUN_ID'/u);
    assert.match(workflow, /baby-quirt-nspawn-runner run '\$RUN_ID'/u);
    assert.doesNotMatch(workflow, /systemctl restart|release pointer/u);
  });
});
