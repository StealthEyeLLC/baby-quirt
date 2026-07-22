import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const architecture = readFileSync(join(root, 'docs/STANDALONE_DEPLOYMENT_V2.md'), 'utf8');
const riskRegister = readFileSync(join(root, 'docs/FAILURE_RISK_REGISTER_V2.md'), 'utf8');

function filesBelow(path: string): string[] {
  const absolute = join(root, path);
  if (!statSync(absolute).isDirectory()) return [absolute];
  const files: string[] = [];
  for (const name of readdirSync(absolute)) {
    const child = join(absolute, name);
    if (statSync(child).isDirectory()) files.push(...filesBelow(relative(root, child)));
    else files.push(child);
  }
  return files;
}

describe('standalone deployment architecture', () => {
  it('assigns deployment and recovery ownership to Baby Quirt', () => {
    for (const statement of [
      'Baby Quirt owns source materialization',
      'fixed-function host controller and guard',
      'may never replace the controller that protects it',
      'first active mutation is forbidden until a generation-bound rollback guard is durably armed',
      'Production requires a later, separate owner authorization',
    ]) assert.ok(architecture.includes(statement), statement);
  });

  it('freezes the eleven distinct release and self-hosting operations', () => {
    const operations = [
      'baby.release.status', 'baby.release.build', 'baby.release.stage',
      'baby.release.verify', 'baby.release.activate', 'baby.release.rollback',
      'baby.release.repair', 'baby.release.prune', 'baby.selfhost.source.get',
      'baby.selfhost.acceptance.run', 'baby.selfhost.evidence.get',
    ];
    for (const operation of operations) assert.ok(architecture.includes('`' + operation + '`'), operation);
    assert.equal(new Set(operations).size, 11);
  });

  it('tracks every required failure scenario in the live evidence ledger', () => {
    const identifiers = [...riskRegister.matchAll(/^\| R(\d{3}) \|/gmu)].map((match) => Number(match[1]));
    assert.deepEqual(identifiers, Array.from({ length: 94 }, (_, index) => index + 1));
    assert.equal((riskRegister.match(/Source-gated; exact-head certification required/gmu) ?? []).length, 94);
  });

  it('has no executable dependency on Fix, its broker, or the operator', () => {
    const executableSurface = [
      ...filesBelow('src'), ...filesBelow('scripts'), ...filesBelow('ops'),
      ...filesBelow('schemas'), ...filesBelow('contracts'),
      join(root, 'package.json'), join(root, 'binding.gyp'),
    ];
    const forbidden = [
      /\/run\/fix\//u,
      /privilege-broker\.sock/u,
      /StealthEyeLLC\/(?:fix|stealtheye-fix-operator)/iu,
      /FIX_(?:BROKER|DEPLOYMENT|PLAN|ARTIFACT|SUCCESS_MARKER)/u,
      /(?:from|require\()[^\n]*(?:@stealtheye\/fix|\bfix\b)/iu,
    ];
    for (const file of executableSurface) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        assert.doesNotMatch(content, pattern, `${relative(root, file)} contains ${pattern}`);
      }
    }
  });
});
