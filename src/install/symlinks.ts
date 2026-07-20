/** Release pointer symlink management. */

import { readlinkSync, rmSync, symlinkSync, lstatSync } from 'node:fs';

export function readSymlinkTarget(linkPath: string): string | null {
  try {
    return readlinkSync(linkPath);
  } catch {
    return null;
  }
}

export function symlinkExists(linkPath: string): boolean {
  try {
    lstatSync(linkPath);
    return true;
  } catch {
    return false;
  }
}

export function atomicSwapSymlinks(
  currentLink: string,
  previousLink: string,
  newCurrentTarget: string,
): { previous: string | null; current: string } {
  const oldCurrent = symlinkExists(currentLink) ? readSymlinkTarget(currentLink) : null;

  if (oldCurrent) {
    rmSync(previousLink, { force: true });
    symlinkSync(oldCurrent, previousLink);
  }

  rmSync(currentLink, { force: true });
  symlinkSync(newCurrentTarget, currentLink);

  return { previous: oldCurrent, current: newCurrentTarget };
}

export function rollbackSymlinks(currentLink: string, previousLink: string): {
  current: string;
  previous: string | null;
} {
  if (!symlinkExists(previousLink)) {
    throw new Error('No previous release to roll back to');
  }

  const previousTarget = readlinkSync(previousLink);
  const currentTarget = symlinkExists(currentLink) ? readlinkSync(currentLink) : null;

  rmSync(currentLink, { force: true });
  symlinkSync(previousTarget, currentLink);

  if (currentTarget) {
    rmSync(previousLink, { force: true });
    symlinkSync(currentTarget, previousLink);
  }

  return { current: previousTarget, previous: currentTarget };
}
