#!/usr/bin/env node

import { assertExactOptions, parseLongOptions, requiredOption } from '../release/args.js';
import { generateReleaseManifest } from '../release/manifest.js';

async function main(): Promise<void> {
  const options = parseLongOptions(process.argv.slice(2));
  assertExactOptions(options, [
    '--release-root', '--archive', '--output', '--sbom-output', '--test-evidence',
    '--signing-private-key', '--signing-key-id', '--compatible-gateway-manifest-digest',
    '--builder-a', '--builder-b', '--archive-digest-a', '--archive-digest-b',
  ]);
  const manifest = await generateReleaseManifest({
    releaseRoot: requiredOption(options, '--release-root'),
    archivePath: requiredOption(options, '--archive'),
    outputPath: requiredOption(options, '--output'),
    sbomOutputPath: requiredOption(options, '--sbom-output'),
    testEvidencePath: requiredOption(options, '--test-evidence'),
    signingPrivateKeyPath: requiredOption(options, '--signing-private-key'),
    signingKeyId: requiredOption(options, '--signing-key-id'),
    compatibleGatewayManifestDigest: requiredOption(options, '--compatible-gateway-manifest-digest'),
    builderA: requiredOption(options, '--builder-a'),
    builderB: requiredOption(options, '--builder-b'),
    archiveDigestA: requiredOption(options, '--archive-digest-a'),
    archiveDigestB: requiredOption(options, '--archive-digest-b'),
  });
  process.stdout.write(`${manifest.manifestDigest}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
