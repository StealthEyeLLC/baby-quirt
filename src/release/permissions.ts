import { lstatSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ReleaseFileRecord } from './contracts.js';
import { fileMode } from './digest.js';

export const RELEASE_DIRECTORY_MODE = 0o555;

export const HOST_PERMISSION_CONTRACT = {
  configRoot: { owner: 'root', group: 'horsey', mode: '0750' },
  runtimeConfig: { owner: 'root', group: 'horsey', mode: '0640' },
  gatewayPublic: { owner: 'root', group: 'horsey', mode: '0640' },
  receiptPublic: { owner: 'root', group: 'horsey', mode: '0640' },
  receiptPrivate: { owner: 'root', group: 'root', mode: '0600' },
  stateRoot: { owner: 'root', group: 'root', mode: '0750' },
  socket: { owner: 'root', group: 'horsey', mode: '0660' },
  release: {
    owner: 'root',
    group: 'root',
    filesFromManifest: true,
    directories: '0555',
    immutable: true,
  },
} as const;

export function assertReleaseTreeModes(
  root: string,
  requiredFiles: readonly ReleaseFileRecord[],
): void {
  const expectedModes = new Map(requiredFiles.map((file) => [file.path, file.mode] as const));
  const visit = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Release tree contains a symbolic link: ${path}`);
    if (stat.isDirectory()) {
      if ((stat.mode & 0o7777) !== RELEASE_DIRECTORY_MODE) {
        throw new Error(`Release directory mode mismatch: ${path}`);
      }
      for (const name of readdirSync(path).sort()) visit(join(path, name));
      return;
    }
    if (!stat.isFile()) throw new Error(`Release tree contains a special entry: ${path}`);
    const relativePath = relative(root, path).split(sep).join('/');
    if (fileMode(path) !== expectedModes.get(relativePath)) {
      throw new Error(`Release file mode mismatch: ${relativePath}`);
    }
  };
  visit(root);
}
