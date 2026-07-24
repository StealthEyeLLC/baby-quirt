/** Isolated structured Git/GitHub transport helper. */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256Hex } from '../crypto/canonical.js';
import { redactGitHubText } from './redaction.js';

export const GITHUB_HELPER_PROTOCOL_VERSION = '1.0.0' as const;

export type GitHubHelperGitOperation =
  | { kind: 'ls-remote'; remote: string; refs?: string[] }
  | { kind: 'fetch'; remote: string; refspecs: string[]; prune?: boolean }
  | { kind: 'push'; remote: string; refspecs: string[]; forceWithLease?: string };

export interface GitHubHelperRequest {
  protocolVersion: typeof GITHUB_HELPER_PROTOCOL_VERSION;
  requestId: string;
  operation: 'health' | 'git';
  credentialName?: string;
  knownHosts?: string;
  pinnedSshHostKeyDigest?: string;
  git?: GitHubHelperGitOperation;
  maximumOutputBytes?: number;
}

export interface GitHubHelperResult {
  protocolVersion: typeof GITHUB_HELPER_PROTOCOL_VERSION;
  requestId: string;
  operation: 'health' | 'git';
  status: 'healthy' | 'completed' | 'failed';
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  redacted: true;
  cleanup: 'not_required' | 'completed' | 'failed';
}

export interface GitHubHelperDependencies {
  gitPath?: string;
  credentialDirectory?: string;
  temporaryRoot?: string;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const SSH_REMOTE = /^(?:git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git|ssh:\/\/git@github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git)$/u;

function fail(message: string): never {
  throw new Error(message);
}

function validateRef(value: string): void {
  if (!value || value.startsWith('-') || /[\0\r\n\t ]/u.test(value)) fail('Git ref or refspec is invalid');
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

function confinedCredentialPath(directory: string, name: string): string {
  if (!ID_PATTERN.test(name) || basename(name) !== name) fail('credentialName is invalid');
  const root = realpathSync(directory);
  const candidate = resolve(root, name);
  const real = realpathSync(candidate);
  if (real !== root && !real.startsWith(`${root}${sep}`)) fail('Credential path escapes credential directory');
  const metadata = lstatSync(candidate);
  if (metadata.isSymbolicLink() || !metadata.isFile()) fail('Credential must be a regular non-symlink file');
  return real;
}

function validateRequest(request: GitHubHelperRequest): void {
  if (request.protocolVersion !== GITHUB_HELPER_PROTOCOL_VERSION) fail('Unsupported helper protocol version');
  if (!ID_PATTERN.test(request.requestId)) fail('requestId is invalid');
  if (request.operation === 'health') return;
  if (request.operation !== 'git' || !request.git) fail('Structured git operation is required');
  if (!['ls-remote', 'fetch', 'push'].includes(request.git.kind)) fail('Structured git operation is unsupported');
  if (!request.credentialName || !request.knownHosts || !request.pinnedSshHostKeyDigest) fail('Credential and pinned host-key metadata are required');
  if (!DIGEST_PATTERN.test(request.pinnedSshHostKeyDigest)) fail('Pinned SSH host-key digest is invalid');
  if (sha256Hex(request.knownHosts) !== request.pinnedSshHostKeyDigest) fail('Pinned SSH host-key digest mismatch');
  if (!SSH_REMOTE.test(request.git.remote)) fail('Only credential-free SSH remotes on github.com are allowed');
  if (request.git.kind === 'ls-remote') for (const ref of request.git.refs ?? []) validateRef(ref);
  if (request.git.kind === 'fetch' || request.git.kind === 'push') for (const refspec of request.git.refspecs) validateRef(refspec);
  if (request.git.kind === 'push' && request.git.forceWithLease !== undefined) validateRef(request.git.forceWithLease);
}

function gitArguments(operation: GitHubHelperGitOperation): string[] {
  if (operation.kind === 'ls-remote') return ['ls-remote', '--', operation.remote, ...(operation.refs ?? [])];
  if (operation.kind === 'fetch') return ['fetch', ...(operation.prune ? ['--prune'] : []), '--', operation.remote, ...operation.refspecs];
  return ['push', ...(operation.forceWithLease ? [`--force-with-lease=${operation.forceWithLease}`] : []), '--porcelain', '--', operation.remote, ...operation.refspecs];
}

function boundedResult(request: GitHubHelperRequest, status: GitHubHelperResult['status'], exitCode: number, stdout: string, stderr: string, cleanup: GitHubHelperResult['cleanup']): GitHubHelperResult {
  const maximumBytes = request.maximumOutputBytes ?? 65_536;
  const out = redactGitHubText(stdout, { maximumBytes });
  const err = redactGitHubText(stderr, { maximumBytes });
  return {
    protocolVersion: GITHUB_HELPER_PROTOCOL_VERSION,
    requestId: request.requestId,
    operation: request.operation,
    status,
    exitCode,
    stdout: out.text,
    stderr: err.text,
    stdoutTruncated: out.truncated,
    stderrTruncated: err.truncated,
    redacted: true,
    cleanup,
  };
}

export function runGitHubHelper(request: GitHubHelperRequest, dependencies: GitHubHelperDependencies = {}): GitHubHelperResult {
  validateRequest(request);
  if (request.operation === 'health') return boundedResult(request, 'healthy', 0, 'baby-github helper healthy\n', '', 'not_required');

  const operation = request.git as GitHubHelperGitOperation;
  const credentialDirectory = dependencies.credentialDirectory ?? process.env.CREDENTIALS_DIRECTORY;
  if (!credentialDirectory) fail('CREDENTIALS_DIRECTORY is unavailable');
  const credentialPath = confinedCredentialPath(credentialDirectory, request.credentialName as string);
  const temporary = mkdtempSync(join(dependencies.temporaryRoot ?? tmpdir(), 'baby-github-'));
  chmodSync(temporary, 0o700);
  let cleanup: GitHubHelperResult['cleanup'] = 'completed';
  let stdout = '';
  let stderr = '';
  let exitCode = 70;
  try {
    const knownHostsPath = join(temporary, 'known_hosts');
    writeFileSync(knownHostsPath, request.knownHosts as string, { mode: 0o600, flag: 'wx' });
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: temporary,
      XDG_CONFIG_HOME: join(temporary, 'config'),
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '/bin/false',
      SSH_ASKPASS: '/bin/false',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'core.askPass',
      GIT_CONFIG_VALUE_1: '/bin/false',
      GIT_SSH_VARIANT: 'ssh',
      GIT_SSH_COMMAND: [
        'ssh',
        '-i', quoteShell(credentialPath),
        '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes',
        '-o', 'StrictHostKeyChecking=yes',
        '-o', `UserKnownHostsFile=${quoteShell(knownHostsPath)}`,
      ].join(' '),
    };
    const result = spawnSync(dependencies.gitPath ?? '/usr/bin/git', gitArguments(operation), {
      env: environment,
      encoding: 'utf8',
      maxBuffer: Math.max((request.maximumOutputBytes ?? 65_536) * 4, 262_144),
      shell: false,
    });
    stdout = result.stdout ?? '';
    stderr = `${result.stderr ?? ''}${result.error ? `${result.error.message}\n` : ''}`;
    exitCode = typeof result.status === 'number' ? result.status : 70;
  } finally {
    try {
      rmSync(temporary, { recursive: true, force: true });
    } catch {
      cleanup = 'failed';
    }
  }
  return boundedResult(request, exitCode === 0 ? 'completed' : 'failed', exitCode, stdout, stderr, cleanup);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    length += bytes.length;
    if (length > 1_048_576) throw new Error('Helper request exceeds maximum size');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  let requestId = 'invalid-request';
  let operation: GitHubHelperRequest['operation'] = 'health';
  try {
    const request = JSON.parse(await readStdin()) as GitHubHelperRequest;
    requestId = typeof request.requestId === 'string' ? request.requestId : requestId;
    operation = request.operation === 'git' ? 'git' : 'health';
    const result = runGitHubHelper(request);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown helper failure';
    const result = boundedResult({ protocolVersion: GITHUB_HELPER_PROTOCOL_VERSION, requestId, operation }, 'failed', 64, '', message, 'not_required');
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 64;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
