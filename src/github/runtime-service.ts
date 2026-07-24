/** Production runtime registration for the safely deployable GitHub read surface. */

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeConfig } from '../config.js';
import { OperationError } from '../operations/errors.js';
import { GITHUB_AUTHORITY_CONTRACT_VERSION } from './contracts.js';

export const PRODUCTION_GITHUB_AUTHORITY_ID = 'github-baby-quirt';
export const PRODUCTION_GITHUB_REMOTE = 'git@github.com:StealthEyeLLC/baby-quirt.git';
export const PRODUCTION_GITHUB_DEFAULT_BRANCH = 'main';
export const PRODUCTION_GITHUB_CREDENTIAL_NAME = 'github-baby-quirt-ssh';
export const PRODUCTION_GITHUB_CREDENTIAL_PATH = '/etc/credstore.encrypted/github-baby-quirt-ssh.cred';
export const PRODUCTION_GITHUB_KNOWN_HOSTS = 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n';

export interface GitHubRemoteVerifyInput {
  repositoryAuthorityId: string;
  branch: string;
  expectedCommit: string;
  expectedTree: string;
  expectedBaseBranch?: string;
}

export interface GitHubRuntimeServiceOptions {
  verifyRemote?: (requestId: string, input: GitHubRemoteVerifyInput) => Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new OperationError('invalid_request', `${key} must be a non-empty string`, false, { key });
  }
  return value;
}

export class GitHubRuntimeService {
  private readonly verifyRemoteImplementation: (requestId: string, input: GitHubRemoteVerifyInput) => Record<string, unknown>;

  constructor(private readonly config: RuntimeConfig, options: GitHubRuntimeServiceOptions = {}) {
    this.verifyRemoteImplementation = options.verifyRemote ?? ((requestId, input) => this.verifyRemote(requestId, input));
  }

  static handles(operation: string): boolean {
    return operation === 'baby.github.describe' || operation === 'baby.github.remote.verify';
  }

  execute(operation: string, requestId: string, body: Record<string, unknown>): Record<string, unknown> {
    if (operation === 'baby.github.describe') return this.describe();
    if (operation === 'baby.github.remote.verify') {
      return this.verifyRemoteImplementation(requestId, {
        repositoryAuthorityId: requiredString(body, 'repositoryAuthorityId'),
        branch: requiredString(body, 'branch'),
        expectedCommit: requiredString(body, 'expectedCommit'),
        expectedTree: requiredString(body, 'expectedTree'),
        ...(typeof body.expectedBaseBranch === 'string' ? { expectedBaseBranch: body.expectedBaseBranch } : {}),
      });
    }
    throw new OperationError('unknown_operation', `Unknown GitHub runtime operation: ${operation}`, false, { operation });
  }

  private describe(): Record<string, unknown> {
    return {
      providerVersion: '1.0.0',
      contractVersion: GITHUB_AUTHORITY_CONTRACT_VERSION,
      apiVersion: 'git-protocol-v2',
      host: 'github.com',
      credentialTypes: ['ssh_deploy_key'],
      supportedOperations: ['baby.github.describe', 'baby.github.remote.verify'],
      repositoryAuthorities: [{
        repositoryAuthorityId: PRODUCTION_GITHUB_AUTHORITY_ID,
        repository: 'StealthEyeLLC/baby-quirt',
        canonicalRemote: PRODUCTION_GITHUB_REMOTE,
        defaultBranch: PRODUCTION_GITHUB_DEFAULT_BRANCH,
        credentialReferenceId: PRODUCTION_GITHUB_CREDENTIAL_NAME,
        permissions: ['github.repository.metadata', 'github.contents.read'],
      }],
      permissionRequirements: {
        'baby.github.describe': ['github.discovery'],
        'baby.github.remote.verify': ['github.repository.metadata', 'github.contents.read'],
      },
      rateLimitBehavior: { transport: 'git_ssh', apiRateLimitConsumed: false },
      limits: { maximumOutputBytes: 65_536, maximumParents: 256 },
      supportState: 'production_enabled',
      acceptanceState: 'production_enabled',
      unavailableWithoutAdditionalCredential: ['github_api_operations'],
    };
  }

  private verifyRemote(_requestId: string, input: GitHubRemoteVerifyInput): Record<string, unknown> {
    if (input.repositoryAuthorityId !== PRODUCTION_GITHUB_AUTHORITY_ID) {
      throw new OperationError('github_authority_not_found', 'Repository authority is not registered', false, {
        repositoryAuthorityId: input.repositoryAuthorityId,
      });
    }
    if (input.expectedBaseBranch !== undefined && input.expectedBaseBranch !== PRODUCTION_GITHUB_DEFAULT_BRANCH) {
      throw new OperationError('github_remote_mismatch', 'Expected base branch does not match the registered authority', false, {
        expected: PRODUCTION_GITHUB_DEFAULT_BRANCH,
        actual: input.expectedBaseBranch,
      });
    }

    const runtimeRoot = join(this.config.stateRoot, 'github-runtime');
    mkdirSync(runtimeRoot, { recursive: true, mode: 0o750 });
    const temporary = mkdtempSync(join(runtimeRoot, 'verify-'));
    const repository = join(temporary, 'repository.git');
    try {
      execFileSync('/usr/bin/git', ['init', '--bare', '--quiet', repository], { stdio: 'pipe' });
      const destination = 'refs/heads/baby-runtime-verify';
      const keyPath = join(temporary, 'github-ssh-key');
      const knownHostsPath = join(temporary, 'known_hosts');
      chmodSync(temporary, 0o700);
      execFileSync('/usr/bin/systemd-creds', [
        'decrypt',
        `--name=${PRODUCTION_GITHUB_CREDENTIAL_NAME}`,
        PRODUCTION_GITHUB_CREDENTIAL_PATH,
        keyPath,
      ], { stdio: 'pipe' });
      chmodSync(keyPath, 0o600);
      writeFileSync(knownHostsPath, PRODUCTION_GITHUB_KNOWN_HOSTS, { mode: 0o600 });
      const sshCommand = [
        '/usr/bin/ssh',
        '-i', keyPath,
        '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes',
        '-o', 'StrictHostKeyChecking=yes',
        '-o', `UserKnownHostsFile=${knownHostsPath}`,
      ].join(' ');
      const execution = spawnSync('/usr/bin/git', [
        '--git-dir', repository,
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        PRODUCTION_GITHUB_REMOTE,
        `+refs/heads/${input.branch}:${destination}`,
      ], {
        encoding: 'utf8',
        maxBuffer: 1_048_576,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: temporary,
          GIT_ASKPASS: '/bin/false',
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: sshCommand,
        },
      });
      if (execution.status !== 0) {
        throw new OperationError('github_remote_unavailable', 'GitHub remote verification failed', true, {
          exitCode: execution.status,
          stderr: (execution.stderr ?? '').slice(0, 65_536),
        });
      }
      const commit = execFileSync('/usr/bin/git', ['--git-dir', repository, 'rev-parse', destination], { encoding: 'utf8' }).trim();
      const tree = execFileSync('/usr/bin/git', ['--git-dir', repository, 'rev-parse', `${destination}^{tree}`], { encoding: 'utf8' }).trim();
      const parentLine = execFileSync('/usr/bin/git', ['--git-dir', repository, 'rev-list', '--parents', '-n', '1', destination], { encoding: 'utf8' }).trim();
      const parents = parentLine.split(/\s+/u).slice(1, 257);
      const comparison = {
        expectedCommit: input.expectedCommit,
        actualCommit: commit,
        commitMatches: commit === input.expectedCommit,
        expectedTree: input.expectedTree,
        actualTree: tree,
        treeMatches: tree === input.expectedTree,
        baseBranchMatches: input.expectedBaseBranch === undefined || input.expectedBaseBranch === PRODUCTION_GITHUB_DEFAULT_BRANCH,
      };
      if (!comparison.commitMatches || !comparison.treeMatches || !comparison.baseBranchMatches) {
        throw new OperationError('github_remote_mismatch', 'GitHub remote identity does not match the expected source', false, comparison);
      }
      return {
        repository: {
          repositoryId: 'StealthEyeLLC/baby-quirt',
          owner: 'StealthEyeLLC',
          name: 'baby-quirt',
          canonicalRemote: PRODUCTION_GITHUB_REMOTE,
        },
        branch: input.branch,
        commit,
        tree,
        parents,
        defaultBranch: PRODUCTION_GITHUB_DEFAULT_BRANCH,
        archived: false,
        visibility: 'private',
        comparison,
        rateLimit: { transport: 'git_ssh', apiRateLimitConsumed: false },
        credentialReferenceId: PRODUCTION_GITHUB_CREDENTIAL_NAME,
        plaintextCredentialPersisted: false,
      };
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw new OperationError('github_remote_unavailable', 'GitHub remote verification failed', true, {
        message: error instanceof Error ? error.message : 'unknown failure',
      });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}
