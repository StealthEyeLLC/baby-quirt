/** Secure execution planning for encrypted GitHub credential references. */

import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { sha256Hex } from '../crypto/canonical.js';
import type { GitHubCredentialEnrollmentRecord, GitHubRepositoryAuthority } from './contracts.js';
import { GITHUB_HELPER_PROTOCOL_VERSION, type GitHubHelperGitOperation, type GitHubHelperRequest } from './helper.js';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

export interface EncryptedCredentialExecutionInput {
  requestId: string;
  authority: GitHubRepositoryAuthority;
  credential: GitHubCredentialEnrollmentRecord;
  encryptedCredentialPath: string;
  encryptedCredentialRoot?: string;
  knownHosts: string;
  git: GitHubHelperGitOperation;
  helperPath?: string;
  expectedOwnerUid?: number;
  maximumOutputBytes?: number;
}

export interface EncryptedCredentialExecutionPlan {
  requestId: string;
  credentialReferenceId: string;
  encryptedCredentialName: string;
  encryptedCredentialDigest: string;
  encryptedCredentialMode: number;
  encryptedCredentialOwnerUid: number;
  pinnedSshHostKeyDigest: string;
  helperPath: string;
  systemdRunArgv: string[];
  stdin: string;
  nonInteractive: true;
  plaintextPersisted: false;
}

function fail(message: string): never {
  throw new Error(message);
}

function confinedPath(rootPath: string, candidatePath: string): string {
  const root = realpathSync(rootPath);
  const candidate = resolve(candidatePath);
  const metadata = lstatSync(candidate);
  if (metadata.isSymbolicLink() || !metadata.isFile()) fail('Encrypted credential must be a regular non-symlink file');
  const real = realpathSync(candidate);
  if (real !== root && !real.startsWith(`${root}${sep}`)) fail('Encrypted credential path escapes approved root');
  return real;
}

export function createEncryptedCredentialExecutionPlan(input: EncryptedCredentialExecutionInput): EncryptedCredentialExecutionPlan {
  if (!IDENTIFIER_PATTERN.test(input.requestId)) fail('requestId is invalid');
  if (input.authority.credentialReferenceId !== input.credential.credentialReferenceId) fail('Authority and credential reference do not match');
  if (input.authority.credentialType !== input.credential.credentialType) fail('Authority and credential type do not match');
  if (input.authority.revoked || input.credential.revoked) fail('Authority or credential is revoked');
  if (input.credential.plaintextPersisted !== false) fail('Credential metadata violates plaintext persistence policy');
  if (!input.authority.pinnedSshHostKeyDigest || !DIGEST_PATTERN.test(input.authority.pinnedSshHostKeyDigest)) fail('Pinned SSH host-key digest is unavailable');
  if (sha256Hex(input.knownHosts) !== input.authority.pinnedSshHostKeyDigest) fail('Pinned SSH host-key digest mismatch');
  const approvedRoot = input.encryptedCredentialRoot ?? '/etc/credstore.encrypted';
  const credentialPath = confinedPath(approvedRoot, input.encryptedCredentialPath);
  if (basename(credentialPath) !== `${input.credential.encryptedCredentialName}.cred`) fail('Encrypted credential filename does not match registry metadata');
  const metadata = statSync(credentialPath);
  const mode = metadata.mode & 0o777;
  if ((mode & 0o077) !== 0) fail('Encrypted credential permissions are too broad');
  if (input.expectedOwnerUid !== undefined && metadata.uid !== input.expectedOwnerUid) fail('Encrypted credential owner does not match policy');
  const encryptedDigest = sha256Hex(readFileSync(credentialPath));
  if (encryptedDigest !== input.credential.encryptedCredentialDigest) fail('Encrypted credential digest mismatch');
  const helperPath = input.helperPath ?? '/usr/local/libexec/baby-quirt/baby-github';
  if (!helperPath.startsWith('/')) fail('Helper path must be absolute');
  const helperRequest: GitHubHelperRequest = {
    protocolVersion: GITHUB_HELPER_PROTOCOL_VERSION,
    requestId: input.requestId,
    operation: 'git',
    credentialName: input.credential.encryptedCredentialName,
    knownHosts: input.knownHosts,
    pinnedSshHostKeyDigest: input.authority.pinnedSshHostKeyDigest,
    git: input.git,
    maximumOutputBytes: input.maximumOutputBytes ?? 65_536,
  };
  const unit = `baby-github-${sha256Hex(input.requestId).slice(0, 20)}`;
  return {
    requestId: input.requestId,
    credentialReferenceId: input.credential.credentialReferenceId,
    encryptedCredentialName: input.credential.encryptedCredentialName,
    encryptedCredentialDigest: encryptedDigest,
    encryptedCredentialMode: mode,
    encryptedCredentialOwnerUid: metadata.uid,
    pinnedSshHostKeyDigest: input.authority.pinnedSshHostKeyDigest,
    helperPath,
    systemdRunArgv: [
      '/usr/bin/systemd-run',
      '--pipe',
      '--wait',
      '--collect',
      '--quiet',
      `--unit=${unit}`,
      '--property=Type=exec',
      '--property=NoNewPrivileges=yes',
      '--property=PrivateTmp=yes',
      '--property=ProtectSystem=strict',
      '--property=ProtectHome=yes',
      '--property=RestrictSUIDSGID=yes',
      `--property=LoadCredentialEncrypted=${input.credential.encryptedCredentialName}:${credentialPath}`,
      '--',
      helperPath,
    ],
    stdin: `${JSON.stringify(helperRequest)}\n`,
    nonInteractive: true,
    plaintextPersisted: false,
  };
}
