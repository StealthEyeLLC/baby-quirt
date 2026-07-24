import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { sha256Hex } from '../src/crypto/canonical.js';
import {
  GITHUB_HELPER_PROTOCOL_VERSION,
  runGitHubHelper,
  type GitHubHelperRequest,
} from '../src/github/helper.js';
import { redactGitHubText } from '../src/github/redaction.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'bq-github-helper-test-'));
  roots.push(root);
  const credentials = join(root, 'credentials');
  const temporary = join(root, 'temporary');
  const bin = join(root, 'fake-git');
  writeFileSync(join(root, 'mkdir-placeholder'), '');
  requireDirectory(credentials);
  requireDirectory(temporary);
  writeFileSync(join(credentials, 'github-baby-quirt-ssh'), 'fixture-private-key', { mode: 0o400 });
  writeFileSync(bin, `#!/usr/bin/env node
process.stdout.write('prompt=' + process.env.GIT_TERMINAL_PROMPT + ' helper=' + process.env.GIT_CONFIG_VALUE_0 + '\\n');
process.stderr.write('Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 /run/credentials/unit/github-baby-quirt-ssh\\n');
process.exit(7);
`, { mode: 0o755 });
  chmodSync(bin, 0o755);
  const knownHosts = 'github.com ssh-ed25519 AAAAC3NzaFixturePinnedHostKey\n';
  const request: GitHubHelperRequest = {
    protocolVersion: GITHUB_HELPER_PROTOCOL_VERSION,
    requestId: 'helper-request-001',
    operation: 'git',
    credentialName: 'github-baby-quirt-ssh',
    knownHosts,
    pinnedSshHostKeyDigest: sha256Hex(knownHosts),
    git: { kind: 'ls-remote', remote: 'git@github.com:StealthEyeLLC/baby-quirt.git' },
  };
  return { credentials, temporary, bin, request };
}

function requireDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

describe('baby-github helper', () => {
  it('returns bounded machine-readable health without requiring a credential', () => {
    const result = runGitHubHelper({
      protocolVersion: GITHUB_HELPER_PROTOCOL_VERSION,
      requestId: 'helper-health-001',
      operation: 'health',
    });
    assert.equal(result.status, 'healthy');
    assert.equal(result.exitCode, 0);
    assert.equal(result.redacted, true);
    assert.equal(result.cleanup, 'not_required');
  });

  it('uses isolated noninteractive Git, preserves exit status, redacts output, and removes temporary state', () => {
    const fixture = setup();
    const result = runGitHubHelper(fixture.request, {
      gitPath: fixture.bin,
      credentialDirectory: fixture.credentials,
      temporaryRoot: fixture.temporary,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 7);
    assert.match(result.stdout, /prompt=0 helper=/u);
    assert.doesNotMatch(result.stderr, /ghp_|ABCDEFGHIJKLMNOPQRSTUVWXYZ|\/run\/credentials\/unit/u);
    assert.match(result.stderr, /\[REDACTED\]/u);
    assert.equal(result.cleanup, 'completed');
    assert.deepEqual(readdirSync(fixture.temporary), []);
  });

  it('rejects arbitrary commands, embedded credentials, option injection, and wrong pinned trust', () => {
    const fixture = setup();
    assert.throws(() => runGitHubHelper({
      ...fixture.request,
      git: { kind: 'shell' } as never,
    }, { credentialDirectory: fixture.credentials }), /Structured|operation/iu);
    assert.throws(() => runGitHubHelper({
      ...fixture.request,
      git: { kind: 'ls-remote', remote: 'ssh://user:password@github.com/StealthEyeLLC/baby-quirt.git' },
    }, { credentialDirectory: fixture.credentials }), /credential-free SSH remotes/iu);
    assert.throws(() => runGitHubHelper({
      ...fixture.request,
      git: { kind: 'ls-remote', remote: 'git@github.com:StealthEyeLLC/baby-quirt.git', refs: ['--upload-pack=evil'] },
    }, { credentialDirectory: fixture.credentials }), /ref or refspec is invalid/iu);
    assert.throws(() => runGitHubHelper({
      ...fixture.request,
      pinnedSshHostKeyDigest: sha256Hex('different'),
    }, { credentialDirectory: fixture.credentials }), /host-key digest mismatch/iu);
  });

  it('redacts private keys, tokens, URL userinfo, runtime credential paths, explicit secrets, and truncates', () => {
    const secret = 'fixture-secret-value';
    const result = redactGitHubText([
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'abc',
      '-----END OPENSSH PRIVATE KEY-----',
      'Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
      'https://user:password@github.com/repo',
      '/run/credentials/unit/key',
      secret,
      'tail'.repeat(100),
    ].join('\n'), { secretValues: [secret], maximumBytes: 180 });
    assert.equal(result.redacted, true);
    assert.equal(result.truncated, true);
    assert.doesNotMatch(result.text, /PRIVATE KEY|ABCDEFGHIJKLMNOPQRSTUVWXYZ|user:password|\/run\/credentials\/unit|fixture-secret-value/u);
  });
});
