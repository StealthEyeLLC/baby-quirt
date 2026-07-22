import { basename } from 'node:path';
import type { JsonValue } from './json.js';
import { sha256 } from './digest.js';

interface LockPackage {
  name?: string;
  version?: string;
  license?: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
}

interface PackageLock {
  name?: string;
  version?: string;
  packages?: Record<string, LockPackage>;
}

function spdxId(name: string, version: string, path: string): string {
  return `SPDXRef-Package-${sha256(`${name}\0${version}\0${path}`).slice(0, 24)}`;
}

function npmIntegrityChecksums(integrity: string | undefined): JsonValue[] {
  if (integrity === undefined) return [];
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  if (match === null) return [];
  const bytes = Buffer.from(match[1]!, 'base64');
  if (bytes.length !== 64) return [];
  return [{ algorithm: 'SHA512', checksumValue: bytes.toString('hex') }];
}

export function createSpdxSbom(input: {
  lockfile: PackageLock;
  version: string;
  commit: string;
  sourceDateEpoch: number;
}): JsonValue {
  const packages = Object.entries(input.lockfile.packages ?? {})
    .filter(([, pkg]) => typeof pkg.name === 'string' && typeof pkg.version === 'string')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, pkg]) => ({
      SPDXID: spdxId(pkg.name!, pkg.version!, path),
      name: pkg.name!,
      versionInfo: pkg.version!,
      downloadLocation: pkg.resolved ?? 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: typeof pkg.license === 'string' ? pkg.license : 'NOASSERTION',
      licenseDeclared: typeof pkg.license === 'string' ? pkg.license : 'NOASSERTION',
      copyrightText: 'NOASSERTION',
      checksums: npmIntegrityChecksums(pkg.integrity),
      comment: pkg.dev === true ? 'development dependency' : 'runtime dependency',
    }));
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `baby-quirt-${input.version}`,
    documentNamespace: `https://stealtheye.io/sbom/baby-quirt/${input.version}/${input.commit}`,
    creationInfo: {
      created: new Date(input.sourceDateEpoch * 1000).toISOString(),
      creators: ['Tool: baby-quirt-release-producer-v1'],
      licenseListVersion: '3.25',
    },
    documentDescribes: packages.map((pkg) => pkg.SPDXID),
    packages,
    annotations: [
      {
        annotationType: 'OTHER',
        annotator: 'Tool: baby-quirt-release-producer-v1',
        annotationDate: new Date(input.sourceDateEpoch * 1000).toISOString(),
        comment: `Source commit ${input.commit}; lockfile ${basename('package-lock.json')}`,
      },
    ],
  };
}
