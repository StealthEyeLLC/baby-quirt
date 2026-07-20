#!/usr/bin/env node
/** Baby Quirt installer — generates keys and installs release. */

import { mkdirSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateEd25519KeyPair } from '../crypto/signing.js';
import { DEFAULTS } from '../config.js';
import { atomicSwapSymlinks } from '../install/symlinks.js';

function parseArgs(): { releaseDir: string; version: string } {
  const args = process.argv.slice(2);
  let releaseDir = '';
  let version = '0.0.0';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--release-dir') releaseDir = args[++i];
    if (args[i] === '--version') version = args[++i];
    if (args[i] === '--help') {
      console.log('Usage: baby-quirt-install --release-dir <path> [--version <ver>]');
      process.exit(0);
    }
  }

  if (!releaseDir) {
    console.error('--release-dir is required');
    process.exit(1);
  }
  return { releaseDir: resolve(releaseDir), version };
}

function main(): void {
  const { releaseDir, version } = parseArgs();
  const configRoot = DEFAULTS.configRoot;
  const stateRoot = DEFAULTS.stateRoot;
  const releaseRoot = DEFAULTS.releaseRoot;
  const currentLink = DEFAULTS.currentLink;
  const previousLink = DEFAULTS.previousLink;

  for (const dir of [configRoot, stateRoot, releaseRoot, join(stateRoot, 'jobs'), join(stateRoot, 'streams')]) {
    mkdirSync(dir, { recursive: true, mode: 0o750 });
  }

  const publicKeyPath = join(configRoot, 'signing-public.pem');
  const privateKeyPath = join(configRoot, 'signing-private.pem');
  if (!existsSync(publicKeyPath)) {
    console.log('Generating Ed25519 signing key pair...');
    generateEd25519KeyPair({
      publicKeyPath,
      privateKeyPath,
      keyId: 'baby-quirt-signing-v1',
    });
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
    installedAt: new Date().toISOString(),
  };
  writeFileSync(join(configRoot, 'runtime.json'), JSON.stringify(runtimeConfig, null, 2), {
    mode: 0o640,
  });

  const targetRelease = join(releaseRoot, version);
  mkdirSync(targetRelease, { recursive: true, mode: 0o755 });
  cpSync(releaseDir, targetRelease, { recursive: true });

  const swap = atomicSwapSymlinks(currentLink, previousLink, targetRelease);

  console.log(`Installed Baby Quirt ${version} to ${targetRelease}`);
  console.log(`Current link: ${currentLink} -> ${swap.current}`);
  if (swap.previous) {
    console.log(`Previous link: ${previousLink} -> ${swap.previous}`);
  }
  console.log('Run: systemctl daemon-reload && systemctl enable --now baby-quirt.socket');
}

main();
