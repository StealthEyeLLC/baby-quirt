import { readFileSync, writeFileSync } from 'node:fs';
import { GIT_OBJECT_PATTERN, type TestEvidenceIndex } from './contracts.js';
import { digestJson } from './digest.js';
import type { JsonValue } from './json.js';

export interface GateResult {
  name: string;
  command: string;
  testCount: number;
  passed: true;
}

export const REQUIRED_RELEASE_GATES = [
  { name: 'dependencies', command: 'npm ci --include=dev', testCount: false },
  { name: 'lint', command: 'npm run lint', testCount: false },
  { name: 'build-native', command: 'npm run build:native', testCount: false },
  { name: 'build', command: 'npm run build', testCount: false },
  { name: 'unit', command: 'npm run test', testCount: true },
  { name: 'integration', command: 'npm run test:integration', testCount: true },
  { name: 'acceptance', command: 'npm run test:acceptance', testCount: true },
  { name: 'contracts', command: 'npm run test:contracts', testCount: true },
  { name: 'aggregate', command: 'npm run test:all', testCount: true },
] as const;

export function assertRequiredReleaseGates(
  suites: readonly { name: string; command: string; testCount: number; passed: boolean }[],
): void {
  if (suites.length !== REQUIRED_RELEASE_GATES.length) {
    throw new Error('Test evidence does not contain the exact frozen release gates');
  }
  for (const [index, required] of REQUIRED_RELEASE_GATES.entries()) {
    const actual = suites[index];
    if (actual?.name !== required.name || actual.command !== required.command || actual.passed !== true) {
      throw new Error(`Test evidence release gate mismatch: ${required.name}`);
    }
    if ((required.testCount && actual.testCount < 1)
      || (!required.testCount && actual.testCount !== 0)) {
      throw new Error(`Test evidence count is invalid for release gate: ${required.name}`);
    }
  }
}

export function readGateResults(path: string): GateResult[] {
  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.length > 0);
  const names = new Set<string>();
  return lines.map((line) => {
    const fields = line.split('\t');
    if (fields.length !== 3) throw new Error('Malformed release gate result row');
    const [name, rawCount, command] = fields;
    const testCount = Number(rawCount);
    if (name.length === 0 || command.length === 0 || names.has(name)
      || !Number.isSafeInteger(testCount) || testCount < 0) {
      throw new Error('Invalid release gate result row');
    }
    names.add(name);
    return { name, command, testCount, passed: true };
  });
}

export function createTestEvidence(input: {
  sourceCommit: string;
  sourceTree: string;
  suites: GateResult[];
}): TestEvidenceIndex {
  if (!GIT_OBJECT_PATTERN.test(input.sourceCommit) || !GIT_OBJECT_PATTERN.test(input.sourceTree)) {
    throw new Error('Test evidence source identity is invalid');
  }
  assertRequiredReleaseGates(input.suites);
  const testCount = input.suites.reduce((sum, suite) => sum + suite.testCount, 0);
  if (testCount < 1) throw new Error('Test evidence has no discovered tests');
  return {
    schemaVersion: '1.0.0',
    sourceCommit: input.sourceCommit,
    sourceTree: input.sourceTree,
    suites: input.suites.map((suite) => ({ ...suite })),
    suiteCount: input.suites.length,
    testCount,
    requiredGateDigest: digestJson(input.suites as unknown as JsonValue),
  };
}

export function writeTestEvidence(path: string, evidence: TestEvidenceIndex): void {
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
}
