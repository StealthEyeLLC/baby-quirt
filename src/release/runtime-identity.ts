import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from './digest.js';
import { assertInternalReleaseManifest } from './internal-manifest.js';

export interface RuntimeReleaseIdentity {
  status: 'installed' | 'unknown';
  manifestPath: string;
  manifestSha256?: string;
  version?: string;
  commit?: string;
  tree?: string;
  sourceDateEpoch?: number;
}

export function runtimeManifestPath(): string {
  return process.env.BABY_QUIRT_RELEASE_MANIFEST_PATH
    ?? resolve(import.meta.dirname, '../../../manifest.json');
}

export function readRuntimeReleaseIdentity(): RuntimeReleaseIdentity {
  const manifestPath = runtimeManifestPath();
  try {
    if (!existsSync(manifestPath)) return { status: 'unknown', manifestPath };
    const raw = readFileSync(manifestPath);
    const manifest: unknown = JSON.parse(raw.toString('utf8'));
    assertInternalReleaseManifest(manifest);
    return {
      status: 'installed',
      manifestPath,
      manifestSha256: sha256(raw),
      version: manifest.releaseVersion,
      commit: manifest.source.commit,
      tree: manifest.source.tree,
      sourceDateEpoch: manifest.source.sourceDateEpoch,
    };
  } catch {
    return { status: 'unknown', manifestPath };
  }
}
