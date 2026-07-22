import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import {
  COMPATIBILITY_SCHEMA_SHA256,
  RELEASE_MANIFEST_SCHEMA_SHA256,
} from './contracts.js';
import { sha256 } from './digest.js';
import { isJsonObject, type JsonValue } from './json.js';

const SCHEMA_FILES = {
  release: ['release-manifest.schema.json', RELEASE_MANIFEST_SCHEMA_SHA256],
  compatibility: ['compatibility.schema.json', COMPATIBILITY_SCHEMA_SHA256],
} as const;

export function deploymentSchemaRoot(): string {
  const override = process.env.BABY_QUIRT_DEPLOYMENT_SCHEMA_ROOT;
  const candidates = [
    override,
    resolve(import.meta.dirname, '../../schemas/deployment'),
    resolve(import.meta.dirname, '../../../schemas/deployment'),
    resolve(process.cwd(), 'schemas/deployment'),
  ].filter((value): value is string => value !== undefined && value.length > 0);
  for (const candidate of candidates) {
    try {
      readFileSync(resolve(candidate, SCHEMA_FILES.release[0]));
      return candidate;
    } catch {
      // Try the next source or packaged layout.
    }
  }
  throw new Error('Frozen deployment schemas are unavailable');
}

export function loadFrozenSchema(kind: keyof typeof SCHEMA_FILES): Record<string, JsonValue> {
  const [filename, expectedDigest] = SCHEMA_FILES[kind];
  const bytes = readFileSync(resolve(deploymentSchemaRoot(), filename));
  if (sha256(bytes) !== expectedDigest) throw new Error(`Frozen ${kind} schema digest mismatch`);
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (!isJsonObject(value)) throw new Error(`Frozen ${kind} schema is not an object`);
  return value;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ');
}

export function assertReleaseManifestSchema(value: unknown): void {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(loadFrozenSchema('release'));
  if (!validate(value)) throw new Error(`Release manifest schema validation failed: ${formatErrors(validate.errors)}`);
}

export function assertCompatibilitySchema(value: unknown): void {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(loadFrozenSchema('compatibility'));
  if (!validate(value)) throw new Error(`Compatibility schema validation failed: ${formatErrors(validate.errors)}`);
}
