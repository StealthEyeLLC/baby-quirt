#!/usr/bin/env node
/** Baby Quirt installer — generates supervisor receipt keys and installs release. */

import { mkdirSync, writeFileSync, existsSync, cpSync, readFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { generateEd25519KeyPair } from '../crypto/signing.js';
import { DEFAULTS, SUPERVISOR_RECEIPT_KEY_ID } from '../config.js';
import { atomicSwapSymlinks } from '../install/symlinks.js';
import { assertSafeVersion, safeExtractTarGz } from '../install/safe-extract.js';

function parseArgs(): { releaseDir: string; version: string; archivePath?: string } {
  const args = process.argv.slice(2);
  let releaseDir = '';
  let version = '0.0.0';
  let archivePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--release-dir') releaseDir = args[++i];
    if (args[i] === '--archive') archivePath = args[++i];
    if (args[i] === '--version') version = args[++i];
    if (args[i] === '--help') {
      console.log(
        'Usage: baby-quirt-install --release-dir <path> [--archive <tar.gz>] [--version <ver>]',
      );
      process.exit(0);
    }
  }

  if (!releaseDir && !archivePath) {
    console.error('--release-dir or --archive is required');
    process.exit(1);
  }
  return { releaseDir: releaseDir ? resolve(releaseDir) : '', version, archivePath };
}

function fingerprintPem(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function main(): Promise<void> {
  const { releaseDir, version, archivePath } = parseArgs();
  assertSafeVersion(version);

  const configRoot = process.env.BABY_QUIRT_CONFIG_ROOT ?? DEFAULTS.configRoot;
  const stateRoot = process.env.BABY_QUIRT_STATE_ROOT ?? DEFAULTS.stateRoot;
  const releaseRoot = process.env.BABY_QUIRT_RELEASE_ROOT ?? DEFAULTS.releaseRoot;
  const currentLink = process.env.BABY_QUIRT_CURRENT_LINK ?? DEFAULTS.currentLink;
  const previousLink = process.env.BABY_QUIRT_PREVIOUS_LINK ?? DEFAULTS.previousLink;

  for (const dir of [
    configRoot,
    stateRoot,
    releaseRoot,
    join(stateRoot, 'jobs'),
    join(stateRoot, 'streams'),
    join(stateRoot, 'pty'),
  ]) {
    mkdirSync(dir, { recursive: true, mode: 0o750 });
  }

  const gatewayPublicPath = join(configRoot, 'gateway-authority-public.pem');
  if (!existsSync(gatewayPublicPath)) {
    console.error('Gateway authority public key must be installed before Baby Quirt');
    process.exit(1);
  }

  const receiptPublicPath = join(configRoot, 'supervisor-receipt-public.pem');
  const receiptPrivatePath = join(configRoot, 'supervisor-receipt-private.pem');
  if (!existsSync(receiptPublicPath)) {
    console.log('Generating supervisor receipt signing key pair on host...');
    generateEd25519KeyPair({
      publicKeyPath: receiptPublicPath,
      privateKeyPath: receiptPrivatePath,
      keyId: SUPERVISOR_RECEIPT_KEY_ID,
    });
    chmodSync(receiptPrivatePath, 0o600);
    console.log(`SUPERVISOR_RECEIPT_FINGERPRINT=${fingerprintPem(receiptPublicPath)}`);
  }

  const runtimeConfig = {
    version,
    socketPath: DEFAULTS.socketPath,
    socketGroup: DEFAULTS.socketGroup,
    socketMode: '0660',
    stateRoot,
    configRoot,
    gatewayId: DEFAULTS.gatewayId,
    supervisorId: DEFAULTS.supervisorId,
    expectedSubject: DEFAULTS.expectedSubject,
    expectedHostname: DEFAULTS.expectedHostname,
    expectedMachineIdSha256: DEFAULTS.expectedMachineIdSha256,
    oauthIssuer: DEFAULTS.oauthIssuer,
    oauthJwksUri: DEFAULTS.oauthJwksUri,
    ownerPrincipalFingerprint: fingerprintPem(gatewayPublicPath),
    installedAt: new Date().toISOString(),
  };
  writeFileSync(join(configRoot, 'runtime.json'), JSON.stringify(runtimeConfig, null, 2), {
    mode: 0o640,
  });

  const targetRelease = join(releaseRoot, version);
  mkdirSync(targetRelease, { recursive: true, mode: 0o755 });

  if (archivePath) {
    const prefix = `baby-quirt-${version}`;
    await safeExtractTarGz(archivePath, targetRelease, prefix);
    if (!existsSync(join(targetRelease, 'bin', 'baby-quirt-daemon'))) {
      console.error('Extracted release directory missing');
      process.exit(1);
    }
  } else {
    cpSync(releaseDir, targetRelease, { recursive: true });
  }

  const swap = atomicSwapSymlinks(currentLink, previousLink, targetRelease);

  console.log(`Installed Baby Quirt ${version} to ${targetRelease}`);
  console.log(`Current link: ${currentLink} -> ${swap.current}`);
  if (swap.previous) {
    console.log(`Previous link: ${previousLink} -> ${swap.previous}`);
  }
  console.log('Run: systemctl daemon-reload && systemctl enable --now baby-quirt.socket');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
