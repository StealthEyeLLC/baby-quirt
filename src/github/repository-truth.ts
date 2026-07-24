/** Exact repository materialization, workspace truth, and local Git operations. */

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { canonicalJson, sha256Hex } from '../crypto/canonical.js';
import type {
  GitCommitEvidence,
  GitSourceIdentity,
  GitWorkspaceIdentity,
  GitHubRepositoryAuthority,
} from './contracts.js';
import { GitHubAuthorityRegistry } from './authority-registry.js';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const OBJECT_PATTERN = /^[a-f0-9]{40}$/u;
const SAFE_REF_PATTERN = /^(?!-)(?!.*(?:\.\.|@\{|\\|\s|[~^:?*\[]))(?!.*\/$)(?!.*\/\.)[^\u0000-\u001f\u007f]+$/u;
const MAX_GIT_OUTPUT = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface GitWorkspaceRecord extends GitWorkspaceIdentity {
  repositoryAuthorityId: string;
  canonicalRemote: string;
  sourceRef: string;
  sourceCommit: string;
  sourceTree: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitRepositoryVerification {
  workspace: GitWorkspaceIdentity;
  source: GitSourceIdentity;
  canonicalRemoteVerified: boolean;
  ancestryVerified: boolean;
  objectAvailabilityVerified: boolean;
  submodulesDeclared: boolean;
  lfsDeclared: boolean;
  resultDigest: string;
}

export interface GitRepositoryStatus {
  workspace: GitWorkspaceIdentity;
  upstream?: string;
  ahead: number;
  behind: number;
  stagedPaths: string[];
  unstagedPaths: string[];
  untrackedPaths: string[];
  conflicts: string[];
  sequencerState: 'none' | 'merge' | 'rebase' | 'cherry_pick' | 'revert' | 'bisect';
  boundedDiffSummary: {
    pathCount: number;
    additions: number;
    deletions: number;
    truncated: boolean;
  };
}

export interface GitIdentity {
  name: string;
  email: string;
}

export interface GitRepositoryTruthOptions {
  storageRoot: string;
  authorityRegistry: GitHubAuthorityRegistry;
  workspaceRegistry: GitWorkspaceRegistry;
  gitPath?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  identityResolver?: (reference: string) => GitIdentity;
  now?: () => string;
  timeoutMs?: number;
}

export class GitRepositoryTruthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'GitRepositoryTruthError';
  }
}

export const GITHUB_REPOSITORY_TRUTH_MIGRATION = {
  version: 4,
  name: 'github_repository_truth_v1',
  sql: `
CREATE TABLE github_git_workspaces (
  workspace_id TEXT PRIMARY KEY,
  repository_authority_id TEXT NOT NULL REFERENCES github_repository_authorities(authority_id),
  repository_id TEXT NOT NULL,
  canonical_remote TEXT NOT NULL,
  mirror_path TEXT NOT NULL UNIQUE,
  worktree_path TEXT NOT NULL UNIQUE,
  source_ref TEXT NOT NULL,
  source_commit TEXT NOT NULL CHECK (length(source_commit) = 40),
  source_tree TEXT NOT NULL CHECK (length(source_tree) = 40),
  branch TEXT,
  head TEXT NOT NULL CHECK (length(head) = 40),
  tree TEXT NOT NULL CHECK (length(tree) = 40),
  clean INTEGER NOT NULL CHECK (clean IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64)
) STRICT;

CREATE INDEX github_git_workspaces_authority_idx
  ON github_git_workspaces(repository_authority_id, workspace_id);

CREATE TRIGGER github_git_workspaces_identity_immutable
BEFORE UPDATE ON github_git_workspaces
WHEN OLD.workspace_id != NEW.workspace_id
  OR OLD.repository_authority_id != NEW.repository_authority_id
  OR OLD.repository_id != NEW.repository_id
  OR OLD.canonical_remote != NEW.canonical_remote
  OR OLD.mirror_path != NEW.mirror_path
  OR OLD.worktree_path != NEW.worktree_path
  OR OLD.source_ref != NEW.source_ref
  OR OLD.source_commit != NEW.source_commit
  OR OLD.source_tree != NEW.source_tree
  OR OLD.created_at != NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'Git workspace identity is immutable');
END;
CREATE TRIGGER github_git_workspaces_no_delete
BEFORE DELETE ON github_git_workspaces BEGIN
  SELECT RAISE(ABORT, 'Git workspaces are durable records');
END;
`,
} as const;

type SqlRow = Record<string, unknown>;

function asString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new GitRepositoryTruthError('workspace_integrity_failed', `${key} is invalid`);
  }
  return value;
}

function asOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  return asString(row, key);
}

function asBoolean(row: SqlRow, key: string): boolean {
  const value = row[key];
  if (value !== 0 && value !== 1) {
    throw new GitRepositoryTruthError('workspace_integrity_failed', `${key} is invalid`);
  }
  return value === 1;
}

function sqlParameters(values: SQLInputValue[]): SQLInputValue[] {
  return values;
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new GitRepositoryTruthError('invalid_request', `${label} is invalid`);
  }
}

function assertObject(value: string, label: string): void {
  if (!OBJECT_PATTERN.test(value)) {
    throw new GitRepositoryTruthError('invalid_request', `${label} is not a SHA-1 Git object ID`);
  }
}

function assertRef(value: string, label: string): void {
  if (!SAFE_REF_PATTERN.test(value) || value.startsWith('/') || value.endsWith('.lock')) {
    throw new GitRepositoryTruthError('invalid_request', `${label} is not a safe Git ref`);
  }
}

function workspaceDigest(record: GitWorkspaceRecord): string {
  return sha256Hex(canonicalJson(record));
}

function mapWorkspace(row: SqlRow): GitWorkspaceRecord {
  return {
    workspaceId: asString(row, 'workspace_id'),
    repositoryAuthorityId: asString(row, 'repository_authority_id'),
    repositoryId: asString(row, 'repository_id'),
    canonicalRemote: asString(row, 'canonical_remote'),
    mirrorPath: asString(row, 'mirror_path'),
    worktreePath: asString(row, 'worktree_path'),
    sourceRef: asString(row, 'source_ref'),
    sourceCommit: asString(row, 'source_commit'),
    sourceTree: asString(row, 'source_tree'),
    ...(asOptionalString(row, 'branch') ? { branch: asOptionalString(row, 'branch') } : {}),
    head: asString(row, 'head'),
    tree: asString(row, 'tree'),
    clean: asBoolean(row, 'clean'),
    createdAt: asString(row, 'created_at'),
    updatedAt: asString(row, 'updated_at'),
  };
}

export class GitWorkspaceRegistry {
  constructor(private readonly database: DatabaseSync) {}

  register(record: GitWorkspaceRecord): GitWorkspaceRecord {
    assertIdentifier(record.workspaceId, 'workspaceId');
    assertIdentifier(record.repositoryAuthorityId, 'repositoryAuthorityId');
    assertIdentifier(record.repositoryId, 'repositoryId');
    assertObject(record.sourceCommit, 'sourceCommit');
    assertObject(record.sourceTree, 'sourceTree');
    assertObject(record.head, 'head');
    assertObject(record.tree, 'tree');
    const digest = workspaceDigest(record);
    this.database.prepare(`INSERT OR IGNORE INTO github_git_workspaces(
      workspace_id, repository_authority_id, repository_id, canonical_remote,
      mirror_path, worktree_path, source_ref, source_commit, source_tree,
      branch, head, tree, clean, created_at, updated_at, record_digest
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...sqlParameters([
        record.workspaceId,
        record.repositoryAuthorityId,
        record.repositoryId,
        record.canonicalRemote,
        record.mirrorPath,
        record.worktreePath,
        record.sourceRef,
        record.sourceCommit,
        record.sourceTree,
        record.branch ?? null,
        record.head,
        record.tree,
        record.clean ? 1 : 0,
        record.createdAt,
        record.updatedAt,
        digest,
      ]));
    const stored = this.get(record.workspaceId);
    if (!stored || workspaceDigest(stored) !== digest) {
      throw new GitRepositoryTruthError('workspace_conflict', 'Workspace identity conflicts with durable state');
    }
    return stored;
  }

  get(workspaceId: string): GitWorkspaceRecord | undefined {
    assertIdentifier(workspaceId, 'workspaceId');
    const row = this.database
      .prepare('SELECT * FROM github_git_workspaces WHERE workspace_id = ?')
      .get(workspaceId) as SqlRow | undefined;
    if (!row) return undefined;
    const record = mapWorkspace(row);
    if (workspaceDigest(record) !== asString(row, 'record_digest')) {
      throw new GitRepositoryTruthError('workspace_integrity_failed', 'Workspace record digest mismatch');
    }
    return record;
  }

  updateObservation(input: {
    workspaceId: string;
    branch?: string;
    head: string;
    tree: string;
    clean: boolean;
    updatedAt: string;
  }): GitWorkspaceRecord {
    const current = this.get(input.workspaceId);
    if (!current) throw new GitRepositoryTruthError('workspace_not_found', 'Workspace does not exist');
    assertObject(input.head, 'head');
    assertObject(input.tree, 'tree');
    const updated: GitWorkspaceRecord = {
      ...current,
      ...(input.branch ? { branch: input.branch } : { branch: undefined }),
      head: input.head,
      tree: input.tree,
      clean: input.clean,
      updatedAt: input.updatedAt,
    };
    this.database.prepare(`UPDATE github_git_workspaces
      SET branch = ?, head = ?, tree = ?, clean = ?, updated_at = ?, record_digest = ?
      WHERE workspace_id = ?`).run(
      updated.branch ?? null,
      updated.head,
      updated.tree,
      updated.clean ? 1 : 0,
      updated.updatedAt,
      workspaceDigest(updated),
      updated.workspaceId,
    );
    return this.get(input.workspaceId) as GitWorkspaceRecord;
  }
}

interface GitResult {
  stdout: string;
  stderr: string;
  status: number;
}

interface StatusParts {
  stagedPaths: string[];
  unstagedPaths: string[];
  untrackedPaths: string[];
  conflicts: string[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function parseParents(value: string): string[] {
  if (!value.trim()) return [];
  return value.trim().split(/\s+/u).filter((entry) => OBJECT_PATTERN.test(entry));
}

function safeRelativePath(value: string): string {
  if (!value || isAbsolute(value) || value.includes('\0')) {
    throw new GitRepositoryTruthError('invalid_request', 'Declared path must be a relative path');
  }
  const normalized = value.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (
    normalized === '.git' ||
    normalized.startsWith('.git/') ||
    normalized.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new GitRepositoryTruthError('invalid_request', `Declared path is unsafe: ${value}`);
  }
  return normalized;
}

function remoteHasCredentials(remote: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/@]+:[^/@]+@/iu.test(remote);
}

function resultDigest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export class GitRepositoryTruth {
  private readonly storageRoot: string;
  private readonly gitPath: string;
  private readonly timeoutMs: number;
  private readonly now: () => string;

  constructor(private readonly options: GitRepositoryTruthOptions) {
    if (!isAbsolute(options.storageRoot)) {
      throw new GitRepositoryTruthError('invalid_request', 'Repository storage root must be absolute');
    }
    mkdirSync(options.storageRoot, { recursive: true, mode: 0o750 });
    this.storageRoot = realpathSync(options.storageRoot);
    this.gitPath = options.gitPath ?? '/usr/bin/git';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date().toISOString());
    mkdirSync(join(this.storageRoot, 'mirrors'), { recursive: true, mode: 0o750 });
    mkdirSync(join(this.storageRoot, 'worktrees'), { recursive: true, mode: 0o750 });
    this.assertPathProtected(join(this.storageRoot, 'mirrors'));
    this.assertPathProtected(join(this.storageRoot, 'worktrees'));
  }

  materialize(input: {
    repositoryAuthorityId: string;
    credentialReferenceId: string;
    canonicalRemote: string;
    expectedCommit: string;
    expectedTree: string;
    sourceRef: string;
    workspaceId: string;
  }): { workspace: GitWorkspaceIdentity; source: GitSourceIdentity; resultDigest: string } {
    assertIdentifier(input.workspaceId, 'workspaceId');
    assertObject(input.expectedCommit, 'expectedCommit');
    assertObject(input.expectedTree, 'expectedTree');
    assertRef(input.sourceRef, 'sourceRef');
    if (!input.canonicalRemote || input.canonicalRemote.startsWith('-') || remoteHasCredentials(input.canonicalRemote)) {
      throw new GitRepositoryTruthError('invalid_request', 'canonicalRemote is unsafe');
    }
    const { authority } = this.options.authorityRegistry.resolveAuthorizedCredential({
      authorityId: input.repositoryAuthorityId,
      credentialReferenceId: input.credentialReferenceId,
      operationFamily: 'git.transport',
    });
    this.assertCanonicalAuthority(authority, input.canonicalRemote);

    const mirrorPath = this.mirrorPath(authority.repository.repositoryId);
    const worktreePath = this.worktreePath(input.workspaceId);
    const existing = this.options.workspaceRegistry.get(input.workspaceId);
    if (existing) {
      if (
        existing.repositoryAuthorityId !== input.repositoryAuthorityId ||
        existing.canonicalRemote !== input.canonicalRemote ||
        existing.sourceCommit !== input.expectedCommit ||
        existing.sourceTree !== input.expectedTree ||
        existing.sourceRef !== input.sourceRef
      ) {
        throw new GitRepositoryTruthError('workspace_conflict', 'Workspace ID has changed materialization intent');
      }
      const verified = this.verify({
        repositoryAuthorityId: input.repositoryAuthorityId,
        workspaceId: input.workspaceId,
      });
      return {
        workspace: verified.workspace,
        source: verified.source,
        resultDigest: resultDigest({ workspace: verified.workspace, source: verified.source }),
      };
    }

    return this.withGitEnvironment((environment) => {
      if (!existsSync(mirrorPath)) {
        this.assertPathProtected(dirname(mirrorPath));
        this.runGit(['clone', '--mirror', '--no-tags', '--', input.canonicalRemote, mirrorPath], this.storageRoot, environment);
      } else {
        this.assertPathProtected(mirrorPath);
        const bare = this.runGit([`--git-dir=${mirrorPath}`, 'rev-parse', '--is-bare-repository'], undefined, environment).stdout.trim();
        if (bare !== 'true') throw new GitRepositoryTruthError('repository_mismatch', 'Mirror path is not a bare repository');
      }
      this.assertPathProtected(mirrorPath);
      const observedRemote = this.runGit([`--git-dir=${mirrorPath}`, 'remote', 'get-url', 'origin'], undefined, environment).stdout.trim();
      if (observedRemote !== input.canonicalRemote) {
        throw new GitRepositoryTruthError('repository_mismatch', 'Mirror origin does not match canonical remote', {
          observedRemote,
        });
      }
      this.runGit([`--git-dir=${mirrorPath}`, 'fetch', '--no-tags', '--force', '--', 'origin', input.sourceRef], undefined, environment);
      const fetched = this.runGit([`--git-dir=${mirrorPath}`, 'rev-parse', 'FETCH_HEAD^{commit}'], undefined, environment).stdout.trim();
      if (fetched !== input.expectedCommit) {
        throw new GitRepositoryTruthError('ref_mismatch', 'Fetched ref does not equal expected commit', { fetched });
      }
      const tree = this.objectTree(mirrorPath, input.expectedCommit, environment);
      if (tree !== input.expectedTree) {
        throw new GitRepositoryTruthError('repository_mismatch', 'Expected commit tree does not match', { tree });
      }
      this.assertObjectAvailable(mirrorPath, input.expectedCommit, input.expectedTree, environment);

      if (!existsSync(worktreePath)) {
        this.assertPathProtected(dirname(worktreePath));
        this.runGit([`--git-dir=${mirrorPath}`, 'worktree', 'add', '--detach', '--', worktreePath, input.expectedCommit], undefined, environment);
      } else {
        this.assertPathProtected(worktreePath);
      }
      const head = this.runGit(['rev-parse', 'HEAD^{commit}'], worktreePath, environment).stdout.trim();
      const worktreeTree = this.runGit(['rev-parse', 'HEAD^{tree}'], worktreePath, environment).stdout.trim();
      if (head !== input.expectedCommit || worktreeTree !== input.expectedTree) {
        throw new GitRepositoryTruthError('repository_mismatch', 'Existing worktree does not match expected source');
      }
      const status = this.readStatus(worktreePath, environment);
      if (!this.isClean(status)) throw new GitRepositoryTruthError('workspace_dirty', 'Materialized worktree is not clean');
      const createdAt = this.now();
      const record = this.options.workspaceRegistry.register({
        workspaceId: input.workspaceId,
        repositoryAuthorityId: input.repositoryAuthorityId,
        repositoryId: authority.repository.repositoryId,
        canonicalRemote: input.canonicalRemote,
        mirrorPath,
        worktreePath,
        sourceRef: input.sourceRef,
        sourceCommit: input.expectedCommit,
        sourceTree: input.expectedTree,
        head,
        tree: worktreeTree,
        clean: true,
        createdAt,
        updatedAt: createdAt,
      });
      const source = this.sourceIdentity(authority, input.sourceRef, head, worktreeTree, mirrorPath, environment);
      const workspace = this.publicWorkspace(record);
      return { workspace, source, resultDigest: resultDigest({ workspace, source }) };
    });
  }

  verify(input: { repositoryAuthorityId: string; workspaceId: string }): GitRepositoryVerification {
    const record = this.loadWorkspace(input);
    const authority = this.requireAuthority(record.repositoryAuthorityId);
    return this.withGitEnvironment((environment) => {
      this.assertWorkspacePaths(record);
      const observedRemote = this.runGit([`--git-dir=${record.mirrorPath}`, 'remote', 'get-url', 'origin'], undefined, environment).stdout.trim();
      const canonicalRemoteVerified = observedRemote === record.canonicalRemote && observedRemote === authority.repository.canonicalRemote;
      if (!canonicalRemoteVerified) throw new GitRepositoryTruthError('repository_mismatch', 'Canonical remote verification failed');
      this.runGit([`--git-dir=${record.mirrorPath}`, 'fsck', '--connectivity-only', '--no-dangling'], undefined, environment);
      const head = this.runGit(['rev-parse', 'HEAD^{commit}'], record.worktreePath, environment).stdout.trim();
      const tree = this.runGit(['rev-parse', 'HEAD^{tree}'], record.worktreePath, environment).stdout.trim();
      this.assertObjectAvailable(record.mirrorPath, head, tree, environment);
      const ancestry = this.runGit([`--git-dir=${record.mirrorPath}`, 'merge-base', '--is-ancestor', record.sourceCommit, head], undefined, environment, [0, 1]);
      const ancestryVerified = ancestry.status === 0;
      if (!ancestryVerified) throw new GitRepositoryTruthError('repository_mismatch', 'Workspace HEAD is not descended from materialized source');
      const status = this.readStatus(record.worktreePath, environment);
      const branch = this.currentBranch(record.worktreePath, environment);
      const updated = this.options.workspaceRegistry.updateObservation({
        workspaceId: record.workspaceId,
        ...(branch ? { branch } : {}),
        head,
        tree,
        clean: this.isClean(status),
        updatedAt: this.now(),
      });
      const source = this.sourceIdentity(authority, record.sourceRef, head, tree, record.mirrorPath, environment);
      const submodulesDeclared = this.pathExistsInTree(record.mirrorPath, head, '.gitmodules', environment);
      const attributes = this.readTreePath(record.mirrorPath, head, '.gitattributes', environment);
      const lfsDeclared = attributes.includes('filter=lfs');
      const workspace = this.publicWorkspace(updated);
      const body = {
        workspace,
        source,
        canonicalRemoteVerified,
        ancestryVerified,
        objectAvailabilityVerified: true,
        submodulesDeclared,
        lfsDeclared,
      };
      return { ...body, resultDigest: resultDigest(body) };
    });
  }

  status(input: { repositoryAuthorityId: string; workspaceId: string }): GitRepositoryStatus {
    const record = this.loadWorkspace(input);
    return this.withGitEnvironment((environment) => {
      this.assertWorkspacePaths(record);
      const parts = this.readStatus(record.worktreePath, environment);
      const head = this.runGit(['rev-parse', 'HEAD^{commit}'], record.worktreePath, environment).stdout.trim();
      const tree = this.runGit(['rev-parse', 'HEAD^{tree}'], record.worktreePath, environment).stdout.trim();
      const branch = this.currentBranch(record.worktreePath, environment);
      const upstreamResult = this.runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], record.worktreePath, environment, [0, 128]);
      const upstream = upstreamResult.status === 0 ? upstreamResult.stdout.trim() : undefined;
      let ahead = 0;
      let behind = 0;
      if (upstream) {
        const counts = this.runGit(['rev-list', '--left-right', '--count', `HEAD...${upstream}`], record.worktreePath, environment).stdout.trim().split(/\s+/u);
        ahead = Number.parseInt(counts[0] ?? '0', 10);
        behind = Number.parseInt(counts[1] ?? '0', 10);
      }
      const summary = this.diffSummary(record.worktreePath, parts, environment);
      const updated = this.options.workspaceRegistry.updateObservation({
        workspaceId: record.workspaceId,
        ...(branch ? { branch } : {}),
        head,
        tree,
        clean: this.isClean(parts),
        updatedAt: this.now(),
      });
      return {
        workspace: this.publicWorkspace(updated),
        ...(upstream ? { upstream } : {}),
        ahead,
        behind,
        ...parts,
        sequencerState: this.sequencerState(record.worktreePath, environment),
        boundedDiffSummary: summary,
      };
    });
  }

  fetch(input: {
    repositoryAuthorityId: string;
    workspaceId: string;
    credentialReferenceId: string;
    exactRefs: string[];
    prune: false;
  }): { fetched: Record<string, string>; resultDigest: string } {
    const record = this.loadWorkspace(input);
    if (input.prune !== false || input.exactRefs.length === 0) {
      throw new GitRepositoryTruthError('invalid_request', 'Fetch requires exact refs and prune=false');
    }
    this.options.authorityRegistry.resolveAuthorizedCredential({
      authorityId: input.repositoryAuthorityId,
      credentialReferenceId: input.credentialReferenceId,
      operationFamily: 'git.transport',
    });
    const refs = sortedUnique(input.exactRefs);
    refs.forEach((ref) => assertRef(ref, 'exact ref'));
    return this.withGitEnvironment((environment) => {
      this.assertWorkspacePaths(record);
      const fetched: Record<string, string> = {};
      for (const ref of refs) {
        this.runGit([`--git-dir=${record.mirrorPath}`, 'fetch', '--no-tags', '--force', '--', 'origin', ref], undefined, environment);
        const commit = this.runGit([`--git-dir=${record.mirrorPath}`, 'rev-parse', 'FETCH_HEAD^{commit}'], undefined, environment).stdout.trim();
        assertObject(commit, 'fetched commit');
        fetched[ref] = commit;
      }
      return { fetched, resultDigest: resultDigest(fetched) };
    });
  }

  createBranch(input: {
    repositoryAuthorityId: string;
    workspaceId: string;
    branch: string;
    expectedCommit: string;
    expectedTree: string;
  }): GitWorkspaceIdentity {
    const record = this.loadWorkspace(input);
    assertObject(input.expectedCommit, 'expectedCommit');
    assertObject(input.expectedTree, 'expectedTree');
    const authorizationBranch = input.branch.startsWith('refs/heads/') ? input.branch : `refs/heads/${input.branch}`;
    const localBranch = input.branch.replace(/^refs\/heads\//u, '');
    assertRef(authorizationBranch, 'branch');
    this.options.authorityRegistry.resolveAuthorizedCredential({
      authorityId: input.repositoryAuthorityId,
      credentialReferenceId: this.requireAuthority(input.repositoryAuthorityId).credentialReferenceId,
      operationFamily: 'git.repository.write',
      branch: authorizationBranch,
      requireWrite: true,
    });
    return this.withGitEnvironment((environment) => {
      this.assertWorkspacePaths(record);
      const status = this.readStatus(record.worktreePath, environment);
      if (!this.isClean(status)) throw new GitRepositoryTruthError('workspace_dirty', 'Branch creation requires a clean worktree');
      const head = this.runGit(['rev-parse', 'HEAD^{commit}'], record.worktreePath, environment).stdout.trim();
      const tree = this.runGit(['rev-parse', 'HEAD^{tree}'], record.worktreePath, environment).stdout.trim();
      if (head !== input.expectedCommit || tree !== input.expectedTree) {
        throw new GitRepositoryTruthError('repository_mismatch', 'Branch base does not match expected commit and tree');
      }
      this.runGit(['check-ref-format', '--branch', localBranch], record.worktreePath, environment);
      const localRef = `refs/heads/${localBranch}`;
      const existing = this.runGit(['show-ref', '--verify', '--quiet', localRef], record.worktreePath, environment, [0, 1]);
      if (existing.status === 0) {
        const existingCommit = this.runGit(['rev-parse', `${localRef}^{commit}`], record.worktreePath, environment).stdout.trim();
        if (existingCommit !== head) {
          throw new GitRepositoryTruthError('ref_mismatch', 'Existing branch points to a different commit');
        }
        this.runGit(['switch', localBranch], record.worktreePath, environment);
      } else {
        this.runGit(['switch', '--create', localBranch, input.expectedCommit], record.worktreePath, environment);
      }
      const updated = this.options.workspaceRegistry.updateObservation({
        workspaceId: record.workspaceId,
        branch: localBranch,
        head,
        tree,
        clean: true,
        updatedAt: this.now(),
      });
      return this.publicWorkspace(updated);
    });
  }

  createCommit(input: {
    repositoryAuthorityId: string;
    workspaceId: string;
    expectedParent: string;
    declaredPaths: string[];
    authorIdentityReference: string;
    committerIdentityReference: string;
    message: string;
    signingCredentialReferenceId?: string;
  }): GitCommitEvidence {
    const record = this.loadWorkspace(input);
    assertObject(input.expectedParent, 'expectedParent');
    if (!input.message.trim() || input.message.length > 10_000 || input.message.includes('\0')) {
      throw new GitRepositoryTruthError('invalid_commit_message', 'Commit message is invalid');
    }
    if (input.signingCredentialReferenceId) {
      throw new GitRepositoryTruthError('not_configured', 'Commit signing is not configured in Checkpoint C');
    }
    const resolver = this.options.identityResolver;
    if (!resolver) throw new GitRepositoryTruthError('not_configured', 'Git identity resolver is not configured');
    const author = resolver(input.authorIdentityReference);
    const committer = resolver(input.committerIdentityReference);
    this.assertIdentity(author, 'author');
    this.assertIdentity(committer, 'committer');
    this.options.authorityRegistry.resolveAuthorizedCredential({
      authorityId: input.repositoryAuthorityId,
      credentialReferenceId: this.requireAuthority(input.repositoryAuthorityId).credentialReferenceId,
      operationFamily: 'git.commit',
      branch: record.branch ? `refs/heads/${record.branch}` : undefined,
      requireWrite: true,
    });
    const declaredPaths = sortedUnique(input.declaredPaths.map(safeRelativePath));
    if (declaredPaths.length === 0) throw new GitRepositoryTruthError('invalid_request', 'At least one declared path is required');

    return this.withGitEnvironment((environment) => {
      this.assertWorkspacePaths(record);
      const head = this.runGit(['rev-parse', 'HEAD^{commit}'], record.worktreePath, environment).stdout.trim();
      if (head !== input.expectedParent) {
        throw new GitRepositoryTruthError('expected_parent_mismatch', 'Workspace HEAD does not equal expected parent', { head });
      }
      if (this.sequencerState(record.worktreePath, environment) !== 'none') {
        throw new GitRepositoryTruthError('workspace_dirty', 'Git sequencer state is active');
      }
      const status = this.readStatus(record.worktreePath, environment);
      if (status.conflicts.length > 0) throw new GitRepositoryTruthError('workspace_dirty', 'Workspace has conflicts');
      const observed = sortedUnique([...status.stagedPaths, ...status.unstagedPaths, ...status.untrackedPaths]);
      if (canonicalJson(observed) !== canonicalJson(declaredPaths)) {
        throw new GitRepositoryTruthError('undeclared_path_change', 'Changed paths do not exactly match declared paths', {
          declaredPaths,
          observed,
        });
      }
      this.runGit(['add', '--', ...declaredPaths], record.worktreePath, environment);
      const staged = sortedUnique(this.runGit(['diff', '--cached', '--name-only', '-z', '--'], record.worktreePath, environment).stdout.split('\0').filter(Boolean));
      if (canonicalJson(staged) !== canonicalJson(declaredPaths)) {
        throw new GitRepositoryTruthError('undeclared_path_change', 'Staged paths do not exactly match declared paths', { staged });
      }
      const commitEnvironment = {
        ...environment,
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: committer.name,
        GIT_COMMITTER_EMAIL: committer.email,
      };
      this.runGit(['commit', '--no-verify', '--no-gpg-sign', '-m', input.message], record.worktreePath, commitEnvironment);
      const commit = this.runGit(['rev-parse', 'HEAD^{commit}'], record.worktreePath, environment).stdout.trim();
      const tree = this.runGit(['rev-parse', 'HEAD^{tree}'], record.worktreePath, environment).stdout.trim();
      const evidence = this.commitEvidence(record, commit, tree, input.authorIdentityReference, input.committerIdentityReference, input.message, environment);
      if (!evidence.parents.includes(input.expectedParent)) {
        throw new GitRepositoryTruthError('expected_parent_mismatch', 'Created commit does not contain expected parent');
      }
      const branch = this.currentBranch(record.worktreePath, environment);
      this.options.workspaceRegistry.updateObservation({
        workspaceId: record.workspaceId,
        ...(branch ? { branch } : {}),
        head: commit,
        tree,
        clean: true,
        updatedAt: this.now(),
      });
      return evidence;
    });
  }

  verifyCommit(input: {
    repositoryAuthorityId: string;
    workspaceId: string;
    expectedCommit: string;
    expectedTree: string;
    expectedBase: string;
    authorIdentityReference?: string;
    committerIdentityReference?: string;
  }): GitCommitEvidence {
    const record = this.loadWorkspace(input);
    assertObject(input.expectedCommit, 'expectedCommit');
    assertObject(input.expectedTree, 'expectedTree');
    assertObject(input.expectedBase, 'expectedBase');
    return this.withGitEnvironment((environment) => {
      this.assertWorkspacePaths(record);
      this.assertObjectAvailable(record.mirrorPath, input.expectedCommit, input.expectedTree, environment);
      const baseAvailable = this.runGit(
        [`--git-dir=${record.mirrorPath}`, 'cat-file', '-e', `${input.expectedBase}^{commit}`],
        undefined,
        environment,
        [0, 1, 128],
      );
      if (baseAvailable.status !== 0) {
        throw new GitRepositoryTruthError('object_missing', 'Expected base commit is unavailable');
      }
      const head = this.runGit(['rev-parse', 'HEAD^{commit}'], record.worktreePath, environment).stdout.trim();
      if (head !== input.expectedCommit) throw new GitRepositoryTruthError('ref_mismatch', 'Workspace HEAD does not equal expected commit');
      const tree = this.objectTree(record.mirrorPath, input.expectedCommit, environment);
      if (tree !== input.expectedTree) throw new GitRepositoryTruthError('repository_mismatch', 'Commit tree does not equal expected tree');
      const ancestry = this.runGit([`--git-dir=${record.mirrorPath}`, 'merge-base', '--is-ancestor', input.expectedBase, input.expectedCommit], undefined, environment, [0, 1]);
      if (ancestry.status !== 0) throw new GitRepositoryTruthError('repository_mismatch', 'Expected base is not an ancestor of commit');
      const message = this.runGit([`--git-dir=${record.mirrorPath}`, 'show', '-s', '--format=%B', input.expectedCommit], undefined, environment).stdout.replace(/\n+$/u, '');
      return this.commitEvidence(
        record,
        input.expectedCommit,
        input.expectedTree,
        input.authorIdentityReference ?? 'verified-author',
        input.committerIdentityReference ?? 'verified-committer',
        message,
        environment,
      );
    });
  }

  private requireAuthority(authorityId: string): GitHubRepositoryAuthority {
    const authority = this.options.authorityRegistry.getRepositoryAuthority(authorityId);
    if (!authority) throw new GitRepositoryTruthError('authority_missing', 'Repository authority does not exist');
    return authority;
  }

  private loadWorkspace(input: { repositoryAuthorityId: string; workspaceId: string }): GitWorkspaceRecord {
    const record = this.options.workspaceRegistry.get(input.workspaceId);
    if (!record) throw new GitRepositoryTruthError('workspace_not_found', 'Workspace does not exist');
    if (record.repositoryAuthorityId !== input.repositoryAuthorityId) {
      throw new GitRepositoryTruthError('repository_mismatch', 'Workspace belongs to another repository authority');
    }
    return record;
  }

  private publicWorkspace(record: GitWorkspaceRecord): GitWorkspaceIdentity {
    return {
      workspaceId: record.workspaceId,
      repositoryId: record.repositoryId,
      mirrorPath: record.mirrorPath,
      worktreePath: record.worktreePath,
      ...(record.branch ? { branch: record.branch } : {}),
      head: record.head,
      tree: record.tree,
      clean: record.clean,
    };
  }

  private sourceIdentity(
    authority: GitHubRepositoryAuthority,
    ref: string,
    commit: string,
    tree: string,
    mirrorPath: string,
    environment: NodeJS.ProcessEnv,
  ): GitSourceIdentity {
    const parents = parseParents(this.runGit([`--git-dir=${mirrorPath}`, 'show', '-s', '--format=%P', commit], undefined, environment).stdout);
    return { repository: authority.repository, ref, commit, tree, parents };
  }

  private commitEvidence(
    record: GitWorkspaceRecord,
    commit: string,
    tree: string,
    authorIdentityReference: string,
    committerIdentityReference: string,
    message: string,
    environment: NodeJS.ProcessEnv,
  ): GitCommitEvidence {
    const parents = parseParents(this.runGit([`--git-dir=${record.mirrorPath}`, 'show', '-s', '--format=%P', commit], undefined, environment).stdout);
    const changedPaths = sortedUnique(this.runGit([
      `--git-dir=${record.mirrorPath}`,
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      commit,
    ], undefined, environment).stdout.split('\0').filter(Boolean));
    return {
      commit,
      tree,
      parents,
      authorIdentityReference,
      committerIdentityReference,
      messageDigest: createHash('sha256').update(message, 'utf8').digest('hex'),
      changedPaths,
      signatureStatus: 'not_configured',
    };
  }

  private assertCanonicalAuthority(authority: GitHubRepositoryAuthority, canonicalRemote: string): void {
    if (authority.repository.canonicalRemote !== canonicalRemote) {
      throw new GitRepositoryTruthError('repository_mismatch', 'Requested remote differs from repository authority');
    }
  }

  private mirrorPath(repositoryId: string): string {
    assertIdentifier(repositoryId, 'repositoryId');
    const path = resolve(this.storageRoot, 'mirrors', `${repositoryId}.git`);
    this.assertConfined(path);
    return path;
  }

  private worktreePath(workspaceId: string): string {
    const path = resolve(this.storageRoot, 'worktrees', workspaceId);
    this.assertConfined(path);
    return path;
  }

  private assertWorkspacePaths(record: GitWorkspaceRecord): void {
    const expectedMirror = this.mirrorPath(record.repositoryId);
    const expectedWorktree = this.worktreePath(record.workspaceId);
    if (record.mirrorPath !== expectedMirror || record.worktreePath !== expectedWorktree) {
      throw new GitRepositoryTruthError('workspace_outside_root', 'Workspace paths do not equal protected deterministic paths');
    }
    this.assertPathProtected(record.mirrorPath);
    this.assertPathProtected(record.worktreePath);
  }

  private assertConfined(path: string): void {
    const resolved = resolve(path);
    if (resolved !== this.storageRoot && !resolved.startsWith(`${this.storageRoot}${sep}`)) {
      throw new GitRepositoryTruthError('workspace_outside_root', 'Path escapes repository storage root');
    }
  }

  private assertPathProtected(path: string): void {
    this.assertConfined(path);
    const rel = relative(this.storageRoot, path);
    let current = this.storageRoot;
    for (const component of rel.split(sep).filter(Boolean)) {
      current = join(current, component);
      if (!existsSync(current)) break;
      if (lstatSync(current).isSymbolicLink()) {
        throw new GitRepositoryTruthError('workspace_outside_root', `Symlink component is forbidden: ${current}`);
      }
    }
    if (existsSync(path)) {
      const real = realpathSync(path);
      this.assertConfined(real);
    }
  }

  private withGitEnvironment<T>(callback: (environment: NodeJS.ProcessEnv) => T): T {
    const home = mkdtempSync(join(tmpdir(), 'baby-git-home-'));
    try {
      const base = this.options.environment ?? {};
      const environment: NodeJS.ProcessEnv = {
        PATH: base.PATH ?? '/usr/bin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
        HOME: home,
        XDG_CONFIG_HOME: home,
        TMPDIR: base.TMPDIR ?? tmpdir(),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '/bin/false',
        SSH_ASKPASS: '/bin/false',
        ...(base.GIT_SSH_COMMAND ? { GIT_SSH_COMMAND: base.GIT_SSH_COMMAND } : {}),
        ...(base.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: base.SSH_AUTH_SOCK } : {}),
        ...(base.SSL_CERT_FILE ? { SSL_CERT_FILE: base.SSL_CERT_FILE } : {}),
        ...(base.HTTPS_PROXY ? { HTTPS_PROXY: base.HTTPS_PROXY } : {}),
        ...(base.NO_PROXY ? { NO_PROXY: base.NO_PROXY } : {}),
      };
      return callback(environment);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  private runGit(
    args: string[],
    cwd: string | undefined,
    environment: NodeJS.ProcessEnv,
    allowedStatuses: readonly number[] = [0],
  ): GitResult {
    const result = spawnSync(this.gitPath, ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=always', ...args], {
      ...(cwd ? { cwd } : {}),
      env: environment,
      encoding: 'utf8',
      timeout: this.timeoutMs,
      maxBuffer: MAX_GIT_OUTPUT,
      windowsHide: true,
    });
    if (result.error) {
      throw new GitRepositoryTruthError('unknown', 'Git process failed to start', { message: result.error.message });
    }
    const status = result.status ?? 128;
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    if (!allowedStatuses.includes(status)) {
      throw new GitRepositoryTruthError('unknown', 'Git operation failed', {
        executable: basename(this.gitPath),
        status,
        stderr: stderr.slice(0, 4096),
      });
    }
    return { stdout, stderr, status };
  }

  private objectTree(mirrorPath: string, commit: string, environment: NodeJS.ProcessEnv): string {
    return this.runGit([`--git-dir=${mirrorPath}`, 'rev-parse', `${commit}^{tree}`], undefined, environment).stdout.trim();
  }

  private assertObjectAvailable(mirrorPath: string, commit: string, tree: string, environment: NodeJS.ProcessEnv): void {
    const commitResult = this.runGit([`--git-dir=${mirrorPath}`, 'cat-file', '-e', `${commit}^{commit}`], undefined, environment, [0, 1, 128]);
    const treeResult = this.runGit([`--git-dir=${mirrorPath}`, 'cat-file', '-e', `${tree}^{tree}`], undefined, environment, [0, 1, 128]);
    if (commitResult.status !== 0 || treeResult.status !== 0) {
      throw new GitRepositoryTruthError('object_missing', 'Expected Git commit or tree is unavailable');
    }
  }

  private pathExistsInTree(mirrorPath: string, commit: string, path: string, environment: NodeJS.ProcessEnv): boolean {
    return this.runGit([`--git-dir=${mirrorPath}`, 'cat-file', '-e', `${commit}:${path}`], undefined, environment, [0, 1, 128]).status === 0;
  }

  private readTreePath(mirrorPath: string, commit: string, path: string, environment: NodeJS.ProcessEnv): string {
    if (!this.pathExistsInTree(mirrorPath, commit, path, environment)) return '';
    return this.runGit([`--git-dir=${mirrorPath}`, 'show', `${commit}:${path}`], undefined, environment).stdout.slice(0, 1_048_576);
  }

  private readStatus(worktreePath: string, environment: NodeJS.ProcessEnv): StatusParts {
    const output = this.runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], worktreePath, environment).stdout;
    const stagedPaths: string[] = [];
    const unstagedPaths: string[] = [];
    const untrackedPaths: string[] = [];
    const conflicts: string[] = [];
    const entries = output.split('\0').filter(Boolean);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] as string;
      const xy = entry.slice(0, 2);
      const path = entry.slice(3);
      if (xy === '??') {
        untrackedPaths.push(path);
        continue;
      }
      if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(xy)) conflicts.push(path);
      if (xy[0] !== ' ' && xy[0] !== '?') stagedPaths.push(path);
      if (xy[1] !== ' ' && xy[1] !== '?') unstagedPaths.push(path);
      if ((xy[0] === 'R' || xy[0] === 'C') && entries[index + 1]) index += 1;
    }
    return {
      stagedPaths: sortedUnique(stagedPaths),
      unstagedPaths: sortedUnique(unstagedPaths),
      untrackedPaths: sortedUnique(untrackedPaths),
      conflicts: sortedUnique(conflicts),
    };
  }

  private isClean(status: StatusParts): boolean {
    return status.stagedPaths.length === 0 && status.unstagedPaths.length === 0 && status.untrackedPaths.length === 0 && status.conflicts.length === 0;
  }

  private currentBranch(worktreePath: string, environment: NodeJS.ProcessEnv): string | undefined {
    const result = this.runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], worktreePath, environment, [0, 1]);
    return result.status === 0 ? result.stdout.trim() : undefined;
  }

  private sequencerState(worktreePath: string, environment: NodeJS.ProcessEnv): GitRepositoryStatus['sequencerState'] {
    const candidates: Array<[GitRepositoryStatus['sequencerState'], string]> = [
      ['merge', 'MERGE_HEAD'],
      ['rebase', 'rebase-merge'],
      ['rebase', 'rebase-apply'],
      ['cherry_pick', 'CHERRY_PICK_HEAD'],
      ['revert', 'REVERT_HEAD'],
      ['bisect', 'BISECT_LOG'],
    ];
    for (const [state, gitPath] of candidates) {
      const path = this.runGit(['rev-parse', '--git-path', gitPath], worktreePath, environment).stdout.trim();
      if (existsSync(resolve(worktreePath, path))) return state;
    }
    return 'none';
  }

  private diffSummary(worktreePath: string, status: StatusParts, environment: NodeJS.ProcessEnv): GitRepositoryStatus['boundedDiffSummary'] {
    const output = this.runGit(['diff', '--numstat', 'HEAD', '--'], worktreePath, environment).stdout;
    let additions = 0;
    let deletions = 0;
    for (const line of output.split('\n').filter(Boolean).slice(0, 1000)) {
      const [add, remove] = line.split('\t');
      if (/^\d+$/u.test(add ?? '')) additions += Number.parseInt(add as string, 10);
      if (/^\d+$/u.test(remove ?? '')) deletions += Number.parseInt(remove as string, 10);
    }
    const paths = sortedUnique([...status.stagedPaths, ...status.unstagedPaths, ...status.untrackedPaths]);
    return { pathCount: paths.length, additions, deletions, truncated: paths.length > 1000 };
  }

  private assertIdentity(identity: GitIdentity, label: string): void {
    if (!identity.name.trim() || !/^[^\s@]+@[^\s@]+$/u.test(identity.email)) {
      throw new GitRepositoryTruthError('invalid_request', `${label} identity is invalid`);
    }
  }
}
