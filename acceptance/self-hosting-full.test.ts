/**
 * Consolidated protocol-only self-hosting acceptance workflow.
 * Harness filesystem calls are limited to outer sandbox, bare remote, and fixture tarball.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  existsSync,
  readdirSync,
  renameSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, execFileSync } from 'node:child_process';
import {
  startTestServer,
  stopTestServer,
  restartTestServer,
  type TestServerContext,
} from '../test/helpers/server.js';
import { createTestClient, type BabyQuirtTestClient } from '../test/helpers/client.js';
import {
  writeFile,
  readFile,
  shellWait,
  readStream,
  assertNoSecretLeak,
} from './helpers/protocol.js';

const REPO_ROOT = join(import.meta.dirname, '..');
const CANARY = 'bq-selfhost-canary-9e4f1b2a';
const RELEASE_V1 = '0.1.0-r1';
const RELEASE_V2 = '0.1.0-r2';

describe('acceptance: protocol-only self-hosting end-to-end', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'bq-selfhost-full-'));
  const bareRemote = join(sandbox, 'bare.git');
  const fixtureDir = join(REPO_ROOT, 'acceptance/fixtures/local-fixture-pkg');
  const fixtureTgz = join(sandbox, 'local-fixture-pkg-1.0.0.tgz');
  const projectDir = join(sandbox, 'project');
  const installRoot = join(sandbox, 'install');
  const configRoot = join(installRoot, 'config');
  const stateRoot = join(installRoot, 'state');
  const releaseRoot = join(installRoot, 'releases');
  const currentLink = join(installRoot, 'current');
  const previousLink = join(installRoot, 'previous');

  let ctx: TestServerContext;
  let client: BabyQuirtTestClient;

  before(() => {
    execFileSync('git', ['init', '--bare', bareRemote]);
    execFileSync('npm', ['pack', '--pack-destination', sandbox], { cwd: fixtureDir, stdio: 'pipe' });
    const packed = readdirSync(sandbox).find((f) => f.endsWith('.tgz'));
    assert.ok(packed, 'fixture tarball must exist');
    if (packed !== 'local-fixture-pkg-1.0.0.tgz') {
      renameSync(join(sandbox, packed), fixtureTgz);
    }
  });

  after(async () => {
    if (ctx) await stopTestServer(ctx);
    rmSync(sandbox, { recursive: true, force: true });
    delete process.env.BABY_QUIRT_TEST_CANARY;
  });

  it(
    'executes the full Baby Quirt protocol workflow in one pass',
    { timeout: 900_000 },
    async () => {
      process.env.BABY_QUIRT_TEST_CANARY = CANARY;
      ctx = await startTestServer();
      client = createTestClient(ctx);

      const sourceCommit = execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
      assert.equal(sourceCommit.length, 40);

      const installEnv = [
        `BABY_QUIRT_CONFIG_ROOT=${configRoot}`,
        `BABY_QUIRT_STATE_ROOT=${stateRoot}`,
        `BABY_QUIRT_RELEASE_ROOT=${releaseRoot}`,
        `BABY_QUIRT_CURRENT_LINK=${currentLink}`,
        `BABY_QUIRT_PREVIOUS_LINK=${previousLink}`,
        `BABY_QUIRT_SOCKET_PATH=${join(stateRoot, 'baby-quirt.sock')}`,
        'BABY_QUIRT_SKIP_MACHINE_ID_CHECK=1',
      ].join(' ');

      // 1–3: create project, manifest, sources, patch
      await writeFile(
        client,
        join(projectDir, 'package.json'),
        JSON.stringify(
          {
            name: 'selfhost-demo',
            version: '0.0.1',
            type: 'module',
            scripts: {
              build: 'mkdir -p dist && cp src/app.js dist/app.js',
              test: 'node test/run.test.js',
            },
            dependencies: {
              'local-fixture-pkg': `file:${fixtureTgz}`,
            },
          },
          null,
          2,
        ),
      );
      await writeFile(
        client,
        join(projectDir, 'src/app.js'),
        `import { greet } from 'local-fixture-pkg';\nexport function main() { return greet('world'); }\n`,
      );
      await writeFile(
        client,
        join(projectDir, 'test/run.test.js'),
        `import assert from 'node:assert/strict';\nimport { main } from '../dist/app.js';\nassert.equal(main(), 'hello selfhost');\nconsole.log('project-tests-ok');\n`,
      );
      await client.request('baby.file.patch', {
        path: join(projectDir, 'src/app.js'),
        patches: [{ offset: 0, data: "import { greet } from 'local-fixture-pkg';\nexport function main() { return greet('selfhost'); }\n", encoding: 'utf8' }],
      });
      const patched = await readFile(client, join(projectDir, 'src/app.js'));
      assert.match(patched, /selfhost/);

      // 4–6: git init and author identity
      await shellWait(client, 'git init && git checkout -b main', projectDir);
      await shellWait(
        client,
        'git config user.email "selfhost@test.local" && git config user.name "Self Host"',
        projectDir,
      );

      // 7–9: install dependency, build, test with stream offsets
      const installOut = await shellWait(client, 'npm install --no-audit --no-fund', projectDir);
      assert.match(installOut.stdout + installOut.stderr, /added 1 package/);
      await shellWait(client, 'npm run build', projectDir);
      const testJob = await client.request('baby.shell', {
        script: 'npm test 2>&1',
        cwd: projectDir,
      });
      const testJobId = (testJob.result as { jobId: string }).jobId;
      const partialStdout = await readStream(client, testJobId, 'stdout', 0);
      assertNoSecretLeak(partialStdout, CANARY, 'partial test stdout');
      await client.request('baby.job.wait', { jobId: testJobId, timeoutMs: 120_000 });
      const testStdout = await readStream(client, testJobId, 'stdout', partialStdout.length);
      assert.match(partialStdout + testStdout, /project-tests-ok/);

      const probe = await shellWait(
        client,
        'node -e "console.log(\\"stdout-line\\"); console.error(\\"stderr-line\\")"',
        projectDir,
      );
      const probeStdout = await readStream(client, probe.jobId, 'stdout');
      const probeStderr = await readStream(client, probe.jobId, 'stderr');
      assert.match(probeStdout, /stdout-line/);
      assert.match(probeStderr, /stderr-line/);

      // 10–12: bare remote, commit, push
      await shellWait(client, `git remote add origin ${bareRemote}`, projectDir);
      await shellWait(client, 'git add -A && git commit -m "selfhost initial"', projectDir);
      await shellWait(client, 'git push -u origin main', projectDir);

      // Provision install gateway key via protocol
      const gatewayPub = readFileSync(
        join(REPO_ROOT, 'ops/bootstrap/gateway-authority-public.pem'),
        'utf8',
      );
      await writeFile(client, join(configRoot, 'gateway-authority-public.pem'), gatewayPub);

      const buildRelease = async (version: string): Promise<string> => {
        const script = [
          `cd ${REPO_ROOT}`,
          `export BABY_QUIRT_SOURCE_COMMIT=${sourceCommit}`,
          'npm run build',
          `bash scripts/build-bundle.sh ${version}`,
          `cd release && sha256sum -c baby-quirt-${version}.sha256`,
          `python3 -c "import json; m=json.load(open('baby-quirt-${version}.manifest.json')); assert m['commit']=='${sourceCommit}', m['commit']"`,
        ].join(' && ');
        const result = await shellWait(client, script, REPO_ROOT, 600_000);
        const digest = readFileSync(
          join(REPO_ROOT, `release/baby-quirt-${version}.sha256`),
          'utf8',
        )
          .trim()
          .split(/\s+/)[0];
        assert.equal(digest.length, 64);
        return digest;
      };

      // 13–16: release v1 build, verify, install, activate
      const digestV1 = await buildRelease(RELEASE_V1);
      const installV1 = await shellWait(
        client,
        `${installEnv} node ${join(REPO_ROOT, 'dist/src/cli/install.js')} --archive ${join(REPO_ROOT, `release/baby-quirt-${RELEASE_V1}.tar.gz`)} --version ${RELEASE_V1}`,
        REPO_ROOT,
      );
      assert.match(installV1.stdout, /Installed Baby Quirt/);
      assert.ok(existsSync(currentLink));

      // 17: health verification
      const verifyV1 = await shellWait(
        client,
        `${installEnv} node ${join(REPO_ROOT, 'dist/src/cli/verify.js')}`,
        REPO_ROOT,
      );
      assert.match(verifyV1.stdout, /"passed": true/);

      // 18: second release
      const digestV2 = await buildRelease(RELEASE_V2);
      assert.notEqual(digestV1, digestV2);
      await shellWait(
        client,
        `${installEnv} node ${join(REPO_ROOT, 'dist/src/cli/install.js')} --archive ${join(REPO_ROOT, `release/baby-quirt-${RELEASE_V2}.tar.gz`)} --version ${RELEASE_V2}`,
        REPO_ROOT,
      );

      // 19–20: rollback and repair
      await shellWait(
        client,
        `${installEnv} node ${join(REPO_ROOT, 'dist/src/cli/rollback.js')}`,
        REPO_ROOT,
      );
      const repair = await shellWait(
        client,
        `${installEnv} node ${join(REPO_ROOT, 'dist/src/cli/repair.js')}`,
        REPO_ROOT,
      );
      assert.match(repair.stdout, /repair/);

      // 21–22: detached job across daemon restart with durable offsets
      const detached = await client.request('baby.exec', {
        argv: ['/bin/sh', '-c', 'printf partial-; sleep 2; echo complete'],
        cwd: projectDir,
        detached: true,
      });
      const detachedId = (detached.result as { jobId: string }).jobId;
      await new Promise((r) => setTimeout(r, 400));
      const offsetBefore = await readStream(client, detachedId, 'stdout', 0);
      assert.match(offsetBefore, /partial-/);

      await restartTestServer(ctx);
      await new Promise((r) => setTimeout(r, 2500));

      let combined = offsetBefore;
      for (let attempt = 0; attempt < 20; attempt++) {
        const chunk = await readStream(client, detachedId, 'stdout', combined.length);
        combined += chunk;
        if (/complete/.test(combined)) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.match(combined, /complete/);

      // 23–27: tmux PTY create, input, resize, restart, reattach
      const pty = await client.request('baby.pty.create', {
        shell: '/bin/sh',
        cwd: projectDir,
        cols: 80,
        rows: 24,
      });
      const sessionId = (pty.result as { sessionId: string }).sessionId;
      await client.request('baby.pty.input', {
        sessionId,
        data: 'echo pty-before-restart\n',
        encoding: 'utf8',
      });
      await client.request('baby.pty.resize', { sessionId, cols: 100, rows: 30 });
      await new Promise((r) => setTimeout(r, 600));
      const ptyBefore = await client.request('baby.pty.read', { sessionId, offset: 0 });
      const ptyTextBefore = Buffer.from(
        (ptyBefore.result as { data: string }).data,
        'base64',
      ).toString('utf8');
      assert.match(ptyTextBefore, /pty-before-restart/);
      const ptyOffset = (ptyBefore.result as { offset: number }).offset;

      await restartTestServer(ctx);
      await new Promise((r) => setTimeout(r, 500));

      await client.request('baby.pty.input', {
        sessionId,
        data: 'echo pty-after-restart\n',
        encoding: 'utf8',
      });
      await new Promise((r) => setTimeout(r, 1000));
      const fullPty = await client.request('baby.pty.read', { sessionId, offset: 0 });
      const allPtyText = Buffer.from(
        (fullPty.result as { data: string }).data,
        'base64',
      ).toString('utf8');
      assert.match(allPtyText, /pty-before-restart/);
      assert.match(allPtyText, /pty-after-restart/);
      await client.request('baby.pty.close', { sessionId });

      // 28: cancel isolated process group
      const sleeper = await client.request('baby.shell', {
        command: 'sleep 5',
        cwd: projectDir,
      });
      const sleeperId = (sleeper.result as { jobId: string }).jobId;
      await new Promise((r) => setTimeout(r, 200));
      const cancelled = await client.request('baby.job.cancel', {
        jobId: sleeperId,
        signal: 'SIGTERM',
      });
      assert.equal((cancelled.result as { status: string }).status, 'cancelled');

      // 29–30: secret reference without disclosure
      const secretExec = await client.request('baby.exec', {
        argv: ['sh', '-c', 'printf %s "$GH_TOKEN"'],
        cwd: projectDir,
        environment: [{ name: 'GH_TOKEN', secretReference: 'github:BABY_QUIRT_TEST_CANARY' }],
      });
      const secretJobId = (secretExec.result as { jobId: string }).jobId;
      await client.request('baby.job.wait', { jobId: secretJobId, timeoutMs: 30_000 });
      const secretStdout = await readStream(client, secretJobId, 'stdout');
      assert.equal(secretStdout.trim(), CANARY);

      const surfaces: string[] = [
        JSON.stringify(await client.request('baby.job.get', { jobId: secretJobId })),
        JSON.stringify(await client.request('baby.job.list', { limit: 50 })),
      ];
      for (const file of readdirSync(join(ctx.stateRoot, 'jobs'))) {
        surfaces.push(readFileSync(join(ctx.stateRoot, 'jobs', file), 'utf8'));
      }
      const manifestPath = join(REPO_ROOT, `release/baby-quirt-${RELEASE_V1}.manifest.json`);
      if (existsSync(manifestPath)) {
        surfaces.push(readFileSync(manifestPath, 'utf8'));
      }
      for (const [idx, surface] of surfaces.entries()) {
        assertNoSecretLeak(surface, CANARY, `surface-${idx}`);
      }

      // Final health check
      const health = await client.request('baby.health');
      assert.equal((health.result as { status: string }).status, 'healthy');
    },
  );
});
