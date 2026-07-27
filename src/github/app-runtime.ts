/** Minimal production GitHub App authority with memory-only tokens and a bounded write proof. */

import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createSign, type KeyObject } from 'node:crypto';
import { OperationError } from '../operations/errors.js';

export const PRODUCTION_GITHUB_APP_NAME = 'Baby Quirt GitHub Authority';
export const PRODUCTION_GITHUB_APP_ID = 4_380_878;
export const PRODUCTION_GITHUB_INSTALLATION_ID = 148_647_330;
export const PRODUCTION_GITHUB_ACCOUNT = 'StealthEyeLLC';
export const PRODUCTION_GITHUB_APP_CREDENTIAL_NAME = 'github-baby-quirt-app-private-key';
export const PRODUCTION_GITHUB_APP_CREDENTIAL_PATH = '/etc/credstore.encrypted/github-baby-quirt-app-private-key.cred';
export const PRODUCTION_GITHUB_PROOF_REPOSITORY = 'StealthEyeLLC/baby-x';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const GITHUB_USER_AGENT = 'baby-quirt-github-app/1.0';
const MAX_RESPONSE_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 30_000;

type JsonRecord = Record<string, unknown>;

interface GitHubResponse {
  status: number;
  body: JsonRecord;
  requestId?: string;
}

interface InstallationSession {
  token: string;
  expiresAt: string;
  app: JsonRecord;
  installation: JsonRecord;
  tokenPermissions: JsonRecord;
}

export interface GitHubAppRuntimeOptions {
  verifyApp?: (requestId: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
  runProof?: (requestId: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, field: string): JsonRecord {
  if (!isRecord(value)) {
    throw new OperationError('github_api_invalid_response', `GitHub response field ${field} is invalid`, false, { field });
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OperationError('github_api_invalid_response', `GitHub response field ${field} is invalid`, false, { field });
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new OperationError('github_api_invalid_response', `GitHub response field ${field} is invalid`, false, { field });
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function createAppJwt(privateKey: KeyObject): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iat: now - 60,
    exp: now + 540,
    iss: String(PRODUCTION_GITHUB_APP_ID),
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
}

function repositoryParts(repository: string): { owner: string; name: string } {
  const separator = repository.indexOf('/');
  if (separator <= 0 || separator === repository.length - 1) {
    throw new OperationError('invalid_request', 'Repository must be in owner/name form', false, { repository });
  }
  return { owner: repository.slice(0, separator), name: repository.slice(separator + 1) };
}

function encodedRef(ref: string): string {
  return ref.split('/').map((component) => encodeURIComponent(component)).join('/');
}

function operationCode(error: unknown): string {
  return error instanceof OperationError ? error.code : 'operation_failed';
}

export class GitHubAppRuntime {
  private readonly verifyImplementation: (requestId: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
  private readonly proofImplementation: (requestId: string) => Promise<Record<string, unknown>> | Record<string, unknown>;

  constructor(options: GitHubAppRuntimeOptions = {}) {
    this.verifyImplementation = options.verifyApp ?? ((requestId) => this.verifyApp(requestId));
    this.proofImplementation = options.runProof ?? ((requestId) => this.runProof(requestId));
  }

  static handles(operation: string): boolean {
    return operation === 'baby.github.app.verify' || operation === 'baby.github.app.proof';
  }

  execute(operation: string, requestId: string): Promise<Record<string, unknown>> | Record<string, unknown> {
    if (operation === 'baby.github.app.verify') return this.verifyImplementation(requestId);
    if (operation === 'baby.github.app.proof') return this.proofImplementation(requestId);
    throw new OperationError('unknown_operation', `Unknown GitHub App operation: ${operation}`, false, { operation });
  }

  private loadPrivateKey(): KeyObject {
    const execution = spawnSync('/usr/bin/systemd-creds', [
      'decrypt',
      `--name=${PRODUCTION_GITHUB_APP_CREDENTIAL_NAME}`,
      PRODUCTION_GITHUB_APP_CREDENTIAL_PATH,
      '-',
    ], {
      encoding: null,
      maxBuffer: MAX_RESPONSE_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const plaintext = Buffer.isBuffer(execution.stdout) ? execution.stdout : Buffer.alloc(0);
    const stderr = Buffer.isBuffer(execution.stderr) ? execution.stderr : Buffer.alloc(0);
    try {
      if (execution.status !== 0 || plaintext.length === 0) {
        throw new OperationError('github_credential_unavailable', 'Encrypted GitHub App credential is unavailable', false, {
          credentialReferenceId: PRODUCTION_GITHUB_APP_CREDENTIAL_NAME,
          credentialPath: PRODUCTION_GITHUB_APP_CREDENTIAL_PATH,
        });
      }
      const privateKey = createPrivateKey({ key: plaintext, format: 'pem' });
      if (privateKey.asymmetricKeyType !== 'rsa') {
        throw new OperationError('github_credential_invalid', 'GitHub App credential is not an RSA private key', false, {
          credentialReferenceId: PRODUCTION_GITHUB_APP_CREDENTIAL_NAME,
        });
      }
      return privateKey;
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw new OperationError('github_credential_invalid', 'Encrypted GitHub App credential could not be parsed', false, {
        credentialReferenceId: PRODUCTION_GITHUB_APP_CREDENTIAL_NAME,
      });
    } finally {
      plaintext.fill(0);
      stderr.fill(0);
    }
  }

  private async request(
    path: string,
    bearer: string,
    options: {
      method?: string;
      body?: JsonRecord;
      expectedStatuses?: readonly number[];
    } = {},
  ): Promise<GitHubResponse> {
    const method = options.method ?? 'GET';
    const expectedStatuses = options.expectedStatuses ?? [200];
    let response: Response;
    try {
      response = await fetch(`${GITHUB_API_ORIGIN}${path}`, {
        method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${bearer}`,
          'User-Agent': GITHUB_USER_AGENT,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      throw new OperationError('github_api_unavailable', 'GitHub API request failed before a response was received', true, {
        method,
        path,
      });
    }

    const requestId = response.headers.get('x-github-request-id') ?? undefined;
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new OperationError('github_api_invalid_response', 'GitHub API response exceeded the bounded size', false, {
        method,
        path,
        status: response.status,
        requestId,
      });
    }
    let parsed: unknown = {};
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = {};
      }
    }
    const body = isRecord(parsed) ? parsed : {};
    if (!expectedStatuses.includes(response.status)) {
      const code = response.status === 401 || response.status === 403
        ? 'github_permission_denied'
        : 'github_api_unavailable';
      throw new OperationError(code, 'GitHub API request returned an unexpected status', response.status >= 500, {
        method,
        path,
        status: response.status,
        requestId,
      });
    }
    return { status: response.status, body, ...(requestId ? { requestId } : {}) };
  }

  private async authenticate(repositoryName: string, contentsPermission: 'read' | 'write'): Promise<InstallationSession> {
    const privateKey = this.loadPrivateKey();
    const appJwt = createAppJwt(privateKey);
    const appResponse = await this.request('/app', appJwt);
    const app = appResponse.body;
    const appOwner = requiredRecord(app.owner, 'app.owner');
    const observedAppId = requiredNumber(app.id, 'app.id');
    const observedAppName = requiredString(app.name, 'app.name');
    const observedOwner = requiredString(appOwner.login, 'app.owner.login');
    if (
      observedAppId !== PRODUCTION_GITHUB_APP_ID
      || observedAppName !== PRODUCTION_GITHUB_APP_NAME
      || observedOwner !== PRODUCTION_GITHUB_ACCOUNT
    ) {
      throw new OperationError('github_app_identity_mismatch', 'GitHub App identity does not match the configured authority', false, {
        expectedAppId: PRODUCTION_GITHUB_APP_ID,
        observedAppId,
        expectedName: PRODUCTION_GITHUB_APP_NAME,
        observedName: observedAppName,
        expectedOwner: PRODUCTION_GITHUB_ACCOUNT,
        observedOwner,
      });
    }

    const installationResponse = await this.request(`/app/installations/${PRODUCTION_GITHUB_INSTALLATION_ID}`, appJwt);
    const installation = installationResponse.body;
    const installationAccount = requiredRecord(installation.account, 'installation.account');
    const observedInstallationId = requiredNumber(installation.id, 'installation.id');
    const observedInstallationAppId = requiredNumber(installation.app_id, 'installation.app_id');
    const observedAccount = requiredString(installationAccount.login, 'installation.account.login');
    if (
      observedInstallationId !== PRODUCTION_GITHUB_INSTALLATION_ID
      || observedInstallationAppId !== PRODUCTION_GITHUB_APP_ID
      || observedAccount !== PRODUCTION_GITHUB_ACCOUNT
    ) {
      throw new OperationError('github_installation_mismatch', 'GitHub App installation does not match the configured authority', false, {
        expectedInstallationId: PRODUCTION_GITHUB_INSTALLATION_ID,
        observedInstallationId,
        expectedAppId: PRODUCTION_GITHUB_APP_ID,
        observedAppId: observedInstallationAppId,
        expectedAccount: PRODUCTION_GITHUB_ACCOUNT,
        observedAccount,
      });
    }

    const tokenResponse = await this.request(
      `/app/installations/${PRODUCTION_GITHUB_INSTALLATION_ID}/access_tokens`,
      appJwt,
      {
        method: 'POST',
        expectedStatuses: [201],
        body: {
          repositories: [repositoryName],
          permissions: { contents: contentsPermission },
        },
      },
    );
    return {
      token: requiredString(tokenResponse.body.token, 'token'),
      expiresAt: requiredString(tokenResponse.body.expires_at, 'expires_at'),
      app,
      installation,
      tokenPermissions: isRecord(tokenResponse.body.permissions) ? tokenResponse.body.permissions : {},
    };
  }

  private async verifyApp(_requestId: string): Promise<Record<string, unknown>> {
    const { owner, name } = repositoryParts(PRODUCTION_GITHUB_PROOF_REPOSITORY);
    const session = await this.authenticate(name, 'read');
    try {
      const repositoryResponse = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, session.token);
      const repository = repositoryResponse.body;
      const repositoryOwner = requiredRecord(repository.owner, 'repository.owner');
      const fullName = requiredString(repository.full_name, 'repository.full_name');
      const ownerLogin = requiredString(repositoryOwner.login, 'repository.owner.login');
      if (fullName !== PRODUCTION_GITHUB_PROOF_REPOSITORY || ownerLogin !== PRODUCTION_GITHUB_ACCOUNT) {
        throw new OperationError('github_installation_mismatch', 'Installation token repository scope does not match the proof repository', false, {
          expectedRepository: PRODUCTION_GITHUB_PROOF_REPOSITORY,
          observedRepository: fullName,
          expectedOwner: PRODUCTION_GITHUB_ACCOUNT,
          observedOwner: ownerLogin,
        });
      }
      return {
        providerVersion: '1.0.0',
        app: {
          id: PRODUCTION_GITHUB_APP_ID,
          name: PRODUCTION_GITHUB_APP_NAME,
          owner: PRODUCTION_GITHUB_ACCOUNT,
          ...(typeof session.app.slug === 'string' ? { slug: session.app.slug } : {}),
        },
        installation: {
          id: PRODUCTION_GITHUB_INSTALLATION_ID,
          account: PRODUCTION_GITHUB_ACCOUNT,
          repositorySelection: session.installation.repository_selection,
          permissions: isRecord(session.installation.permissions) ? session.installation.permissions : {},
        },
        token: {
          permissions: session.tokenPermissions,
          expiresAt: session.expiresAt,
          persisted: false,
        },
        repository: {
          fullName,
          defaultBranch: repository.default_branch,
          archived: repository.archived,
          visibility: repository.visibility,
        },
        credentialReferenceId: PRODUCTION_GITHUB_APP_CREDENTIAL_NAME,
        plaintextCredentialPersisted: false,
        verified: true,
      };
    } finally {
      session.token = '';
    }
  }

  private async runProof(requestId: string): Promise<Record<string, unknown>> {
    const repository = PRODUCTION_GITHUB_PROOF_REPOSITORY;
    const { owner, name } = repositoryParts(repository);
    const session = await this.authenticate(name, 'write');
    const branch = `baby-authority-proof/${sha256(requestId).slice(0, 24)}`;
    const encodedBranch = encodedRef(branch);
    const refGetPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${encodedBranch}`;
    const refMutationPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs/heads/${encodedBranch}`;
    let branchCreated = false;
    let branchDeleted = false;
    let primaryError: unknown;
    let proofResult: Record<string, unknown> | undefined;

    const removeBranch = async (): Promise<void> => {
      await this.request(refMutationPath, session.token, { method: 'DELETE', expectedStatuses: [204, 404] });
      const readback = await this.request(refGetPath, session.token, { expectedStatuses: [200, 404] });
      if (readback.status !== 404) {
        throw new OperationError('github_proof_cleanup_failed', 'Temporary proof branch still exists after deletion', false, {
          repository,
          branch,
          requestId: readback.requestId,
        }, true);
      }
      branchDeleted = true;
    };

    try {
      const repositoryResponse = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, session.token);
      const defaultBranch = requiredString(repositoryResponse.body.default_branch, 'repository.default_branch');
      const existing = await this.request(refGetPath, session.token, { expectedStatuses: [200, 404] });
      if (existing.status === 200) await removeBranch();
      branchDeleted = false;

      const baseRefPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${encodedRef(defaultBranch)}`;
      const baseRefResponse = await this.request(baseRefPath, session.token);
      const baseObject = requiredRecord(baseRefResponse.body.object, 'baseRef.object');
      const baseCommit = requiredString(baseObject.sha, 'baseRef.object.sha');
      const baseCommitResponse = await this.request(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/commits/${encodeURIComponent(baseCommit)}`,
        session.token,
      );
      const baseTree = requiredRecord(baseCommitResponse.body.tree, 'baseCommit.tree');
      const baseTreeSha = requiredString(baseTree.sha, 'baseCommit.tree.sha');

      await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs`, session.token, {
        method: 'POST',
        expectedStatuses: [201],
        body: { ref: `refs/heads/${branch}`, sha: baseCommit },
      });
      branchCreated = true;

      const marker = `${JSON.stringify({
        schemaVersion: '1.0.0',
        purpose: 'Baby Quirt GitHub App authority proof',
        appId: PRODUCTION_GITHUB_APP_ID,
        installationId: PRODUCTION_GITHUB_INSTALLATION_ID,
        account: PRODUCTION_GITHUB_ACCOUNT,
        repository,
        requestDigest: sha256(requestId),
        createdAt: new Date().toISOString(),
      })}\n`;
      const blobResponse = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/blobs`, session.token, {
        method: 'POST',
        expectedStatuses: [201],
        body: { content: marker, encoding: 'utf-8' },
      });
      const blobSha = requiredString(blobResponse.body.sha, 'blob.sha');
      const treeResponse = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees`, session.token, {
        method: 'POST',
        expectedStatuses: [201],
        body: {
          base_tree: baseTreeSha,
          tree: [{
            path: '.baby-quirt/github-authority-proof.json',
            mode: '100644',
            type: 'blob',
            sha: blobSha,
          }],
        },
      });
      const treeSha = requiredString(treeResponse.body.sha, 'tree.sha');
      const commitResponse = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/commits`, session.token, {
        method: 'POST',
        expectedStatuses: [201],
        body: {
          message: 'test: verify Baby Quirt GitHub App authority',
          tree: treeSha,
          parents: [baseCommit],
        },
      });
      const commitSha = requiredString(commitResponse.body.sha, 'commit.sha');
      await this.request(refMutationPath, session.token, {
        method: 'PATCH',
        body: { sha: commitSha, force: false },
      });

      const refReadback = await this.request(refGetPath, session.token);
      const refObject = requiredRecord(refReadback.body.object, 'proofRef.object');
      const observedCommit = requiredString(refObject.sha, 'proofRef.object.sha');
      const commitReadback = await this.request(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/commits/${encodeURIComponent(commitSha)}`,
        session.token,
      );
      const observedTree = requiredRecord(commitReadback.body.tree, 'proofCommit.tree');
      const observedTreeSha = requiredString(observedTree.sha, 'proofCommit.tree.sha');
      if (observedCommit !== commitSha || observedTreeSha !== treeSha) {
        throw new OperationError('github_remote_mismatch', 'Temporary proof branch readback did not match the created commit and tree', false, {
          repository,
          branch,
          expectedCommit: commitSha,
          observedCommit,
          expectedTree: treeSha,
          observedTree: observedTreeSha,
        }, true);
      }

      await removeBranch();
      proofResult = {
        repository,
        baseBranch: defaultBranch,
        baseCommit,
        branch,
        commit: commitSha,
        tree: treeSha,
        markerSha256: sha256(marker),
        exactReadback: true,
        branchDeleted: true,
        credentialReferenceId: PRODUCTION_GITHUB_APP_CREDENTIAL_NAME,
        installationTokenPersisted: false,
        plaintextCredentialPersisted: false,
      };
    } catch (error) {
      primaryError = error;
    }

    if (branchCreated && !branchDeleted) {
      try {
        await removeBranch();
      } catch (cleanupError) {
        session.token = '';
        throw new OperationError('github_proof_cleanup_failed', 'Temporary proof branch cleanup failed', false, {
          repository,
          branch,
          primaryError: operationCode(primaryError),
          cleanupError: operationCode(cleanupError),
        }, true);
      }
    }
    session.token = '';
    if (primaryError) throw primaryError;
    if (!proofResult) {
      throw new OperationError('github_api_unavailable', 'GitHub App proof ended without a result', false, { repository, branch });
    }
    return proofResult;
  }
}
