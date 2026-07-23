#!/usr/bin/env node
/** Verify the extracted candidate bytes, entrypoints, dependencies, and native addon. */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { strictExtractRelease } from '../src/release/strict-extractor.js';
import type { CandidateBuildRecord } from '../src/release/release-manifest.js';

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return resolve(value);
}

const archivePath = option('--archive');
const buildRecordPath = option('--build-record');
const build = JSON.parse(readFileSync(buildRecordPath, 'utf8')) as CandidateBuildRecord;
const destination = mkdtempSync(join(tmpdir(), 'baby-quirt-candidate-'));
try {
  const extracted = await strictExtractRelease({
    archivePath,
    destination,
    manifest: build,
  });
  const releaseRoot = extracted.releaseRoot;
  for (const path of [
    'release.json',
    'sbom.spdx.json',
    ...(build.product === 'baby-quirt'
      ? [
          'bin/baby-quirt',
          'bin/baby-quirt-daemon',
          'lib/dist/index.js',
          'lib/build/Release/peer_cred.node',
          'lib/package.json',
          'lib/node_modules',
        ]
      : ['bin/baby-quirt-mcp', 'src/main.js', 'package.json']),
  ]) {
    if (!existsSync(join(releaseRoot, path))) throw new Error(`Candidate is missing ${path}`);
  }
  const identity = JSON.parse(readFileSync(join(releaseRoot, 'release.json'), 'utf8')) as {
    product: string;
    releaseVersion: string;
    commit: string;
    tree: string;
  };
  if (
    identity.product !== build.product ||
    identity.releaseVersion !== build.releaseVersion ||
    identity.commit !== build.commit ||
    identity.tree !== build.tree
  ) throw new Error('Extracted internal release identity differs from build record');

  if (build.product === 'baby-quirt') {
    const nativePath = join(releaseRoot, 'lib', 'build', 'Release', 'peer_cred.node');
    const require = createRequire(join(releaseRoot, 'lib', 'dist', 'index.js'));
    const native = require(nativePath) as { getPeerCred?: unknown };
    if (typeof native.getPeerCred !== 'function') throw new Error('Packaged native addon cannot load');
    const packageJson = JSON.parse(readFileSync(join(releaseRoot, 'lib', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
      require.resolve(dependency);
    }
    const cli = execFileSync(join(releaseRoot, 'bin', 'baby-quirt'), ['--help'], {
      env: { ...process.env, BABY_QUIRT_NODE_BIN: process.execPath },
      encoding: 'utf8',
      cwd: releaseRoot,
    });
    if (!/Usage: baby-quirt/u.test(cli)) throw new Error('Packaged relocatable CLI did not run');
    const forbidden = '/opt/baby-quirt/current';
    for (const wrapper of [
      'bin/baby-quirt',
      'bin/baby-quirt-daemon',
      'bin/baby-quirt-install',
      'bin/baby-quirt-verify',
      'bin/baby-quirt-rollback',
      'bin/baby-quirt-repair',
    ]) {
      if (readFileSync(join(releaseRoot, wrapper), 'utf8').includes(forbidden)) {
        throw new Error(`Packaged wrapper is not relocatable: ${wrapper}`);
      }
    }
  } else {
    const wrapper = readFileSync(join(releaseRoot, 'bin', 'baby-quirt-mcp'), 'utf8');
    if (wrapper.includes('/opt/baby-quirt-mcp/current/src')) {
      throw new Error('Packaged gateway wrapper is not relocatable');
    }
    execFileSync(process.execPath, ['--check', join(releaseRoot, 'src', 'main.js')], {
      cwd: releaseRoot,
      stdio: 'pipe',
    });
  }
  console.log(JSON.stringify({
    verified: true,
    product: build.product,
    releaseVersion: build.releaseVersion,
    commit: build.commit,
    tree: build.tree,
    archiveDigest: build.archive.digest,
    fileCount: build.files.length,
  }));
} finally {
  rmSync(destination, { recursive: true, force: true });
}
