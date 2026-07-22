import {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  assertReleaseVersion,
  type ReleaseManifest,
} from './contracts.js';
import { sha256FileSync, walkRegularFiles } from './digest.js';
import { RELEASE_DIRECTORY_MODE } from './permissions.js';

function fsyncDirectory(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function visitTree(path: string, callback: (path: string, directory: boolean) => void): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`Inactive release contains a symbolic link: ${path}`);
  if (stat.isDirectory()) {
    for (const name of readdirSync(path).sort()) visitTree(join(path, name), callback);
    callback(path, true);
    return;
  }
  if (!stat.isFile()) throw new Error(`Inactive release contains a special entry: ${path}`);
  callback(path, false);
}

function assertOwnerId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function assertReleaseRoot(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Release root must be a real directory');
}

function copyAndVerifyCandidate(
  source: string,
  temporary: string,
  manifest: ReleaseManifest,
): void {
  const expected = new Map(manifest.requiredFiles.map((file) => [file.path, file] as const));
  const sourceFiles = walkRegularFiles(source);
  if (sourceFiles.length !== expected.size) throw new Error('Verified candidate file inventory count changed');
  mkdirSync(temporary, { mode: 0o700 });
  for (const sourceFile of sourceFiles) {
    const record = expected.get(sourceFile.relativePath);
    if (record === undefined) throw new Error(`Verified candidate contains an undeclared file: ${sourceFile.relativePath}`);
    if (sourceFile.mode !== record.mode) throw new Error(`Verified candidate mode changed: ${sourceFile.relativePath}`);
    const destination = join(temporary, ...sourceFile.relativePath.split('/'));
    if (!destination.startsWith(`${temporary}${sep}`)) throw new Error('Inactive release path escaped target');
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(sourceFile.absolutePath, destination, constants.COPYFILE_EXCL);
    const copied = statSync(destination);
    if (copied.size !== record.sizeBytes || sha256FileSync(destination) !== record.sha256) {
      throw new Error(`Verified candidate bytes changed during installation: ${sourceFile.relativePath}`);
    }
  }
  if (walkRegularFiles(temporary).length !== expected.size) {
    throw new Error('Inactive release copy contains unexpected files');
  }
}

export interface InactiveInstallResult {
  version: string;
  target: string;
  activated: false;
  pointersChanged: false;
  servicesChanged: false;
}

export function installInactiveRelease(input: {
  verifiedCandidateRoot: string;
  releaseRoot: string;
  manifest: ReleaseManifest;
  ownerUid?: number;
  ownerGid?: number;
}): InactiveInstallResult {
  const version = input.manifest.releaseVersion;
  assertReleaseVersion(version);
  const source = resolve(input.verifiedCandidateRoot);
  const releaseRoot = resolve(input.releaseRoot);
  const target = join(releaseRoot, version);
  if (dirname(target) !== releaseRoot || basename(target) !== version) throw new Error('Inactive release target escaped root');
  if (basename(source) !== `baby-quirt-${version}`) throw new Error('Verified candidate root does not match release identity');
  mkdirSync(releaseRoot, { recursive: true, mode: 0o755 });
  assertReleaseRoot(releaseRoot);
  if (existsSync(target)) throw new Error(`Immutable release target already exists: ${target}`);
  const temporary = join(releaseRoot, `.incoming-${version}-${process.pid}`);
  const claim = join(releaseRoot, `.installing-${version}`);
  if (existsSync(temporary)) throw new Error(`Inactive install staging target already exists: ${temporary}`);
  const modes = new Map(input.manifest.requiredFiles.map((file) => [file.path, Number.parseInt(file.mode, 8)]));
  const uid = input.ownerUid ?? 0;
  const gid = input.ownerGid ?? 0;
  assertOwnerId(uid, 'owner UID');
  assertOwnerId(gid, 'owner GID');
  let claimFd: number | undefined;
  let claimOwned = false;
  try {
    claimFd = openSync(claim, 'wx', 0o600);
    claimOwned = true;
    fsyncSync(claimFd);
    fsyncDirectory(releaseRoot);
    if (existsSync(target)) throw new Error(`Immutable release target already exists: ${target}`);
    copyAndVerifyCandidate(source, temporary, input.manifest);
    visitTree(temporary, (path, directory) => {
      const relative = path.slice(temporary.length + 1);
      const mode = directory ? RELEASE_DIRECTORY_MODE : modes.get(relative);
      if (!directory && mode === undefined) throw new Error(`Inactive release contains undeclared file: ${relative}`);
      chownSync(path, uid, gid);
      chmodSync(path, mode ?? RELEASE_DIRECTORY_MODE);
      if (!directory) {
        const fd = openSync(path, 'r');
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
    });
    fsyncDirectory(temporary);
    if (existsSync(target)) throw new Error(`Immutable release target already exists: ${target}`);
    renameSync(temporary, target);
    fsyncDirectory(releaseRoot);
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    if (claimFd !== undefined) closeSync(claimFd);
    if (claimOwned && existsSync(claim)) unlinkSync(claim);
    fsyncDirectory(releaseRoot);
  }
  return {
    version,
    target,
    activated: false,
    pointersChanged: false,
    servicesChanged: false,
  };
}
