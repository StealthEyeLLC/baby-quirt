#!/usr/bin/env node
/** Baby Quirt verifier — checks installation health. */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { DEFAULTS } from '../config.js';

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

function check(name: string, passed: boolean, message: string): CheckResult {
  return { name, passed, message };
}

async function verifySocket(): Promise<CheckResult> {
  return new Promise((resolve) => {
    const socket = createConnection(DEFAULTS.socketPath);
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(check('socket', false, 'Socket connection timeout'));
    }, 5000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolve(check('socket', true, `Socket reachable at ${DEFAULTS.socketPath}`));
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      resolve(check('socket', false, `Socket error: ${err.message}`));
    });
  });
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];

  // Config exists
  const configPath = join(DEFAULTS.configRoot, 'runtime.json');
  results.push(
    check(
      'config',
      existsSync(configPath),
      existsSync(configPath) ? 'Runtime config present' : 'Runtime config missing',
    ),
  );

  const pubKey = join(DEFAULTS.configRoot, 'gateway-authority-public.pem');
  const receiptPub = join(DEFAULTS.configRoot, 'supervisor-receipt-public.pem');
  const receiptPriv = join(DEFAULTS.configRoot, 'supervisor-receipt-private.pem');
  results.push(
    check('gateway-authority-public', existsSync(pubKey), existsSync(pubKey) ? 'Gateway public key present' : 'Gateway public key missing'),
  );
  results.push(
    check('supervisor-receipt-public', existsSync(receiptPub), existsSync(receiptPub) ? 'Supervisor receipt public key present' : 'Supervisor receipt public key missing'),
  );
  results.push(
    check('supervisor-receipt-private', existsSync(receiptPriv), existsSync(receiptPriv) ? 'Supervisor receipt private key present' : 'Supervisor receipt private key missing'),
  );

  // Current release link
  results.push(
    check(
      'current-release',
      existsSync(DEFAULTS.currentLink),
      existsSync(DEFAULTS.currentLink) ? `Current link: ${DEFAULTS.currentLink}` : 'Current release link missing',
    ),
  );

  // State directory
  results.push(
    check(
      'state-root',
      existsSync(DEFAULTS.stateRoot),
      existsSync(DEFAULTS.stateRoot) ? `State root: ${DEFAULTS.stateRoot}` : 'State root missing',
    ),
  );

  // Socket connectivity
  if (existsSync(DEFAULTS.socketPath)) {
    results.push(await verifySocket());
  } else {
    results.push(check('socket', false, `Socket not found: ${DEFAULTS.socketPath}`));
  }

  // Machine identity
  try {
    const { createHash } = await import('node:crypto');
    const machineId = readFileSync('/etc/machine-id');
    const hash = createHash('sha256').update(machineId).digest('hex');
    const match = hash === DEFAULTS.expectedMachineIdSha256;
    results.push(
      check(
        'machine-id',
        match,
        match ? 'Machine identity matches' : `Machine identity mismatch: ${hash}`,
      ),
    );
  } catch {
    results.push(check('machine-id', false, 'Could not read /etc/machine-id'));
  }

  const allPassed = results.every((r) => r.passed);
  console.log(JSON.stringify({ passed: allPassed, checks: results }, null, 2));
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Verify failed:', err.message);
  process.exit(1);
});
