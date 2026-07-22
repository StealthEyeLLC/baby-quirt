#!/usr/bin/env node
/** Install one already-verified Baby Quirt release as an inactive immutable target. */

import {
  assertExactOptions,
  integerOption,
  parseLongOptions,
  requiredOption,
} from '../release/args.js';
import { verifyReleaseCandidate } from '../release/candidate.js';
import { installInactiveRelease } from '../release/install.js';
import { loadAndVerifyReleaseManifest } from '../release/manifest.js';

async function main(): Promise<void> {
  const options = parseLongOptions(process.argv.slice(2));
  assertExactOptions(options, [
    '--candidate-root',
    '--archive',
    '--manifest',
    '--sbom',
    '--test-evidence',
    '--signing-public-key',
    '--expected-version',
    '--expected-commit',
    '--expected-tree',
    '--release-root',
    '--owner-uid',
    '--owner-gid',
  ]);
  const publicKey = requiredOption(options, '--signing-public-key');
  const manifestPath = requiredOption(options, '--manifest');
  const candidateRoot = requiredOption(options, '--candidate-root');
  const expectedVersion = requiredOption(options, '--expected-version');
  const report = await verifyReleaseCandidate({
    candidateRoot,
    archivePath: requiredOption(options, '--archive'),
    manifestPath,
    sbomPath: requiredOption(options, '--sbom'),
    testEvidencePath: requiredOption(options, '--test-evidence'),
    signingPublicKeyPath: publicKey,
    expectedVersion,
    expectedCommit: requiredOption(options, '--expected-commit'),
    expectedTree: requiredOption(options, '--expected-tree'),
  });
  const manifest = loadAndVerifyReleaseManifest(manifestPath, publicKey);
  if (manifest.manifestDigest !== report.manifestDigest
    || manifest.releaseVersion !== expectedVersion
    || manifest.source.commit !== report.sourceCommit
    || manifest.source.tree !== report.sourceTree) {
    throw new Error('Candidate manifest changed after verification');
  }
  const result = installInactiveRelease({
    verifiedCandidateRoot: candidateRoot,
    releaseRoot: requiredOption(options, '--release-root'),
    manifest,
    ...(options.has('--owner-uid') ? { ownerUid: integerOption(options, '--owner-uid') } : {}),
    ...(options.has('--owner-gid') ? { ownerGid: integerOption(options, '--owner-gid') } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
