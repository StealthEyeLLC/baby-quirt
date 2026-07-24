import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { canonicalJson, sha256Hex } from '../src/crypto/canonical.js';
import { DeploymentDatabase } from '../src/deployment/database.js';
import { computePermissionSnapshotDigest } from '../src/github/authority-registry.js';
import {
  GITHUB_AUTHORITY_CONTRACT_VERSION,
  type GitHubCredentialEnrollmentRecord,
  type GitHubPermissionSnapshot,
  type GitHubRepositoryAuthority,
  type GitHubWorkflowIdentity,
  type GitPushPlan,
} from '../src/github/contracts.js';
import {
  GitHubDeliveryPublisher,
  GitHubProvider,
  GitHubProviderError,
  type GitHubArtifactSink,
  type GitHubContentReference,
  type GitHubProviderTransport,
  type GitHubPullRequestReadback,
  type GitHubWorkflowArtifactDescriptor,
  type GitHubWorkflowRunReadback,
} from '../src/github/provider-delivery.js';
import type { GitSafePublication } from '../src/github/safe-publication.js';
import { OPERATION_DEFINITIONS } from '../src/operations/definitions.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const AUTHORITY_ID = 'checkpoint-f-authority';
const CREDENTIAL_ID = 'checkpoint-f-credential';
const HEAD = '1'.repeat(40);
const TREE = '2'.repeat(40);
const BASE = '3'.repeat(40);
const CHANGED_PATHS_DIGEST = sha256Hex('changed-paths');
const ARTIFACT_BYTES = Buffer.from('checkpoint-f-artifact\n', 'utf8');
const ARTIFACT_DIGEST = sha256Hex(ARTIFACT_BYTES);

interface Fixture {
  root: string;
  database: DeploymentDatabase;
  authority: GitHubRepositoryAuthority;
  transport: FakeTransport;
  sink: MemoryArtifactSink;
  provider: GitHubProvider;
}

class MemoryArtifactSink implements GitHubArtifactSink {
  readonly entries: Array<{ kind: string; name: string; bytes: Buffer; metadata: Record<string, unknown> }> = [];

  put(input: {
    kind: 'workflow_log' | 'workflow_artifact';
    name: string;
    bytes: Buffer;
    metadata: Record<string, unknown>;
  }): GitHubContentReference {
    this.entries.push({ ...input, bytes: Buffer.from(input.bytes) });
    return {
      reference: `artifact://checkpoint-f/${this.entries.length}/${input.name}`,
      digest: sha256Hex(input.bytes),
      size: input.bytes.length,
    };
  }
}

class FakeTransport implements GitHubProviderTransport {
  pullRequest?: GitHubPullRequestReadback;
  pullRequestWriteCount = 0;
  pullRequestResponseLoss = false;
  pullRequestFailure = false;
  workflowReadCount = 0;
  workflowIndex = 0;
  workflowSequence: GitHubWorkflowRunReadback[] = [];
  artifacts: GitHubWorkflowArtifactDescriptor[] = [];
  artifactBytes = new Map<number, Buffer>();
  logBytes = Buffer.from('checkpoint-f-log\n', 'utf8');

  findPullRequest(): GitHubPullRequestReadback | undefined {
    return this.pullRequest;
  }

  getPullRequest(): GitHubPullRequestReadback {
    if (!this.pullRequest) throw new Error('pull request missing');
    return this.pullRequest;
  }

  upsertPullRequest(input: Parameters<GitHubProviderTransport['upsertPullRequest']>[0]): ReturnType<GitHubProviderTransport['upsertPullRequest']> {
    this.pullRequestWriteCount += 1;
    if (this.pullRequestFailure) return { outcome: 'failed', evidenceReferences: ['pr-write:failed'] };
    this.pullRequest = {
      repositoryId: input.authority.repository.repositoryId,
      number: 18,
      nodeId: 'PR_checkpoint_f',
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      headCommit: input.headCommit,
      headTree: input.headTree,
      title: input.title,
      body: input.body,
      draft: true,
      state: 'open',
      changedPathsDigest: CHANGED_PATHS_DIGEST,
      observedAt: '2026-07-24T13:00:00.000Z',
      evidenceReferences: ['github-pr-readback:18'],
    };
    if (this.pullRequestResponseLoss) return { outcome: 'unknown', evidenceReferences: ['pr-response:lost'] };
    return { outcome: 'completed', readback: this.pullRequest, evidenceReferences: ['pr-write:completed'] };
  }

  findWorkflow(input: Parameters<GitHubProviderTransport['findWorkflow']>[0]): GitHubWorkflowRunReadback | undefined {
    const found = this.workflowSequence[0];
    if (!found || found.workflow.headSha !== input.exactCommit) return undefined;
    return found;
  }

  getWorkflow(): GitHubWorkflowRunReadback {
    this.workflowReadCount += 1;
    const index = Math.min(this.workflowIndex, Math.max(this.workflowSequence.length - 1, 0));
    const value = this.workflowSequence[index];
    if (!value) throw new Error('workflow missing');
    this.workflowIndex += 1;
    return value;
  }

  getWorkflowLogs(): Buffer {
    return Buffer.from(this.logBytes);
  }

  listWorkflowArtifacts(): GitHubWorkflowArtifactDescriptor[] {
    return this.artifacts.map((artifact) => ({ ...artifact }));
  }

  downloadWorkflowArtifact(input: Parameters<GitHubProviderTransport['downloadWorkflowArtifact']>[0]): Buffer {
    const bytes = this.artifactBytes.get(input.artifactId);
    if (!bytes) throw new Error('artifact bytes missing');
    return Buffer.from(bytes);
  }
}

function workflow(status: 'queued' | 'in_progress' | 'completed', conclusion?: 'success' | 'failure'): GitHubWorkflowRunReadback {
  const identity: GitHubWorkflowIdentity = {
    repository: {
      repositoryId: 'fixture-checkpoint-f',
      canonicalRemote: 'git@fixture.local:fixture/repository.git',
      host: 'fixture.local',
      owner: 'fixture',
      name: 'repository',
    },
    workflowId: 'checkpoint-f.yml',
    workflowName: 'Checkpoint F',
    runId: 501,
    attempt: 1,
    headSha: HEAD,
    event: 'pull_request',
  };
  return {
    workflow: identity,
    status,
    ...(conclusion ? { conclusion } : {}),
    jobs: [{
      jobId: 601,
      name: 'validate',
      status,
      ...(conclusion ? { conclusion } : {}),
    }],
    rateLimit: {
      limit: 5000,
      remaining: 4999,
      used: 1,
      resetsAt: '2026-07-24T14:00:00.000Z',
      secondaryLimited: false,
      observedAt: '2026-07-24T13:00:00.000Z',
    },
    observedAt: '2026-07-24T13:00:00.000Z',
    evidenceReferences: [`workflow-readback:${status}:${conclusion ?? 'none'}`],
  };
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'bq-checkpoint-f-'));
  roots.push(root);
  const database = new DeploymentDatabase(join(root, 'state', 'deployment.sqlite'));
  const snapshotBody = {
    snapshotId: 'checkpoint-f-permissions',
    repositoryPermissions: { contents: 'write', pull_requests: 'write', actions: 'read' } as const,
    organizationPermissions: {} as const,
    capturedAt: '2026-07-24T12:59:00.000Z',
  };
  const permissions: GitHubPermissionSnapshot = {
    ...snapshotBody,
    digest: computePermissionSnapshotDigest(snapshotBody),
  };
  const families = [
    'git.transport',
    'git.repository.read',
    'git.repository.write',
    'git.commit',
    'git.remote.read',
    'git.remote.write',
    'github.pull_requests.write',
    'github.pull_requests.read',
    'github.actions.read',
    'artifact.write',
  ];
  const credential: GitHubCredentialEnrollmentRecord = {
    enrollmentId: 'checkpoint-f-enrollment',
    schemaVersion: GITHUB_AUTHORITY_CONTRACT_VERSION,
    ownerPrincipal: 'stealtheye-owner',
    provider: 'github',
    credentialType: 'ssh_deploy_key',
    credentialReferenceId: CREDENTIAL_ID,
    accountOrInstallationId: 'fixture/repository',
    repositoryAuthorityIds: [AUTHORITY_ID],
    allowedOperationFamilies: families,
    permissionSnapshotDigest: permissions.digest,
    encryptedCredentialName: 'checkpoint-f-fixture',
    encryptedCredentialDigest: sha256Hex('encrypted-checkpoint-f-fixture'),
    createdAt: '2026-07-24T12:59:01.000Z',
    expiresAt: '2027-07-24T12:59:01.000Z',
    revoked: false,
    plaintextPersisted: false,
  };
  const authority: GitHubRepositoryAuthority = {
    authorityId: AUTHORITY_ID,
    schemaVersion: GITHUB_AUTHORITY_CONTRACT_VERSION,
    principal: 'stealtheye-owner',
    repository: {
      repositoryId: 'fixture-checkpoint-f',
      canonicalRemote: 'git@fixture.local:fixture/repository.git',
      host: 'fixture.local',
      owner: 'fixture',
      name: 'repository',
    },
    credentialReferenceId: CREDENTIAL_ID,
    credentialType: 'ssh_deploy_key',
    readWriteClassification: 'read_write',
    allowedBranchPatterns: ['refs/heads/build/*'],
    allowedOperationFamilies: families,
    permissionSnapshot: permissions,
    createdAt: '2026-07-24T12:59:02.000Z',
    expiresAt: '2027-07-24T12:59:02.000Z',
    revoked: false,
    lastVerifiedAt: '2026-07-24T12:59:03.000Z',
    health: 'healthy',
  };
  database.githubAuthorities.registerPermissionSnapshot(permissions);
  database.githubAuthorities.registerCredentialEnrollment(credential);
  database.githubAuthorities.registerRepositoryAuthority(authority);
  const transport = new FakeTransport();
  transport.workflowSequence = [workflow('completed', 'success')];
  transport.artifacts = [{
    artifactId: 701,
    name: 'checkpoint-f-evidence.zip',
    size: ARTIFACT_BYTES.length,
    sourceCommit: HEAD,
    sourceTree: TREE,
    expired: false,
  }];
  transport.artifactBytes.set(701, ARTIFACT_BYTES);
  const sink = new MemoryArtifactSink();
  const provider = new GitHubProvider({
    authorityRegistry: database.githubAuthorities,
    registry: database.githubProviderRuns,
    transport,
    artifactSink: sink,
    now: () => '2026-07-24T13:00:00.000Z',
  });
  return { root, database, authority, transport, sink, provider };
}

function prFingerprint(input: {
  headBranch: string;
  title: string;
  body: string;
}): string {
  return sha256Hex(canonicalJson({
    operation: 'baby.github.pr.upsert',
    repositoryAuthorityId: AUTHORITY_ID,
    headBranch: input.headBranch,
    headCommit: HEAD,
    headTree: TREE,
    baseBranch: 'refs/heads/main',
    expectedPreviousStateDigest: null,
    title: input.title,
    body: input.body,
    draft: true,
    authorizationReference: 'owner-authority-f',
  }));
}

function makeFakeSafePublication(authority: GitHubRepositoryAuthority): {
  service: GitSafePublication;
  previewCount: () => number;
  pushCount: () => number;
} {
  let previews = 0;
  let pushes = 0;
  const plan: GitPushPlan = {
    planId: 'checkpoint-f-push-plan',
    planDigest: sha256Hex('checkpoint-f-push-plan'),
    principal: 'stealtheye-owner',
    repositoryAuthorityId: AUTHORITY_ID,
    workspace: {
      workspaceId: 'checkpoint-f-workspace',
      repositoryAuthorityId: AUTHORITY_ID,
      worktreePath: '/fixture/checkpoint-f',
      gitDirectoryPath: '/fixture/checkpoint-f/.git',
      sourceRef: 'refs/heads/main',
      head: HEAD,
      tree: TREE,
      clean: true,
    },
    credentialReferenceId: CREDENTIAL_ID,
    sourceRef: 'refs/heads/main',
    expectation: {
      remote: authority.repository.canonicalRemote,
      destinationRef: 'refs/heads/build/feature',
      expectedOldObject: BASE,
      newObject: HEAD,
      newTree: TREE,
      fastForwardOnly: true,
    },
    mergeBase: BASE,
    objectsToTransfer: [HEAD],
    createdAt: '2026-07-24T13:00:00.000Z',
    expiresAt: '2026-07-25T13:00:00.000Z',
  };
  const service = {
    preview(): GitPushPlan {
      previews += 1;
      return plan;
    },
    apply(input: { mutationId: string }) {
      pushes += 1;
      return {
        mutationId: input.mutationId,
        state: 'verified',
        readback: {
          repository: authority.repository,
          remote: authority.repository.canonicalRemote,
          destinationRef: 'refs/heads/build/feature',
          observedObject: HEAD,
          observedCommit: HEAD,
          observedTree: TREE,
          expectedObject: HEAD,
          expectedTree: TREE,
          ancestryVerified: true,
          observedAt: '2026-07-24T13:00:00.000Z',
        },
        evidenceReferences: ['git-push:verified'],
        events: [],
      };
    },
  } as unknown as GitSafePublication;
  return { service, previewCount: () => previews, pushCount: () => pushes };
}

function deliveryInput(overrides: Record<string, unknown> = {}) {
  const body = {
    deliveryId: 'checkpoint-f-delivery',
    idempotencyKey: 'checkpoint-f-delivery-key',
    repositoryAuthorityId: AUTHORITY_ID,
    workspaceId: 'checkpoint-f-workspace',
    credentialReferenceId: CREDENTIAL_ID,
    sourceRef: 'refs/heads/main',
    destinationRef: 'refs/heads/build/feature',
    expectedRemoteOldObject: BASE,
    expiresAt: '2026-07-25T13:00:00.000Z',
    authorizationReference: 'owner-authority-f',
    headBranch: 'refs/heads/build/feature',
    baseBranch: 'refs/heads/main',
    title: 'Checkpoint F delivery',
    body: 'Durable provider and compound publication.',
    draft: true as const,
    expectedChangedPathsDigest: CHANGED_PATHS_DIGEST,
    workflowId: 'checkpoint-f.yml',
    workflowEvent: 'pull_request',
    workflowDeadline: '2026-07-24T13:10:00.000Z',
    maximumWorkflowAttempts: 4,
    selectedJobIds: [601],
    artifactNames: ['checkpoint-f-evidence.zip'],
    expectedArtifactDigests: { 'checkpoint-f-evidence.zip': ARTIFACT_DIGEST },
    maximumArtifactBytes: 4096,
    ...overrides,
  };
  const request = {
    operation: 'baby.github.delivery.publish',
    repositoryAuthorityId: body.repositoryAuthorityId,
    workspaceId: body.workspaceId,
    credentialReferenceId: body.credentialReferenceId,
    sourceRef: body.sourceRef,
    destinationRef: body.destinationRef,
    expectedRemoteOldObject: body.expectedRemoteOldObject ?? null,
    expiresAt: body.expiresAt,
    authorizationReference: body.authorizationReference,
    headBranch: body.headBranch,
    baseBranch: body.baseBranch,
    title: body.title,
    body: body.body,
    draft: true,
    expectedChangedPathsDigest: body.expectedChangedPathsDigest,
    workflowId: body.workflowId ?? null,
    workflowEvent: body.workflowEvent ?? null,
    workflowDeadline: body.workflowDeadline,
    maximumWorkflowAttempts: body.maximumWorkflowAttempts,
    selectedJobIds: [...new Set(body.selectedJobIds as number[])].sort((left, right) => left - right),
    artifactNames: [...new Set(body.artifactNames as string[])].sort(),
    expectedArtifactDigests: body.expectedArtifactDigests,
    maximumArtifactBytes: body.maximumArtifactBytes,
  };
  return { ...body, semanticIdempotencyFingerprint: sha256Hex(canonicalJson(request)) };
}

function assertProviderCode(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof GitHubProviderError);
    assert.equal(error.code, code);
    return true;
  });
}

describe('GitHub provider and compound delivery', () => {
  it('persists immutable intent, replays exact intent, and rejects changed idempotency intent', () => {
    const fixture = makeFixture();
    const request = { operation: 'fixture', value: 1 };
    const semanticDigest = sha256Hex(canonicalJson(request));
    const first = fixture.database.githubProviderRuns.reserve({
      runId: 'checkpoint-f-registry-run',
      idempotencyKey: 'checkpoint-f-registry-key',
      semanticDigest,
      operation: 'fixture',
      authorityId: AUTHORITY_ID,
      state: 'intent_persisted',
      request,
      result: { started: true },
      attempt: 0,
      partialSuccess: false,
      createdAt: '2026-07-24T13:00:00.000Z',
      updatedAt: '2026-07-24T13:00:00.000Z',
    });
    assert.equal(first.created, true);
    assert.deepEqual(first.record.result, { started: true });
    const replay = fixture.database.githubProviderRuns.reserve({ ...first.record });
    assert.equal(replay.created, false);
    assert.equal(replay.record.semanticDigest, semanticDigest);
    assertProviderCode(() => fixture.database.githubProviderRuns.reserve({
      ...first.record,
      semanticDigest: sha256Hex('changed-intent'),
    }), 'idempotency_conflict');
    fixture.database.close();
  });

  it('reconciles a lost pull-request response and replays without a duplicate write', () => {
    const fixture = makeFixture();
    fixture.transport.pullRequestResponseLoss = true;
    const headBranch = 'refs/heads/build/feature';
    const title = 'Checkpoint F PR';
    const body = 'Provider reconciliation';
    const input = {
      runId: 'checkpoint-f-pr-run',
      idempotencyKey: 'checkpoint-f-pr-key',
      semanticIdempotencyFingerprint: prFingerprint({ headBranch, title, body }),
      repositoryAuthorityId: AUTHORITY_ID,
      headBranch,
      headCommit: HEAD,
      headTree: TREE,
      baseBranch: 'refs/heads/main',
      title,
      body,
      draft: true as const,
      authorizationReference: 'owner-authority-f',
    };
    const result = fixture.provider.upsertPullRequest(input);
    assert.equal(result.state, 'verified');
    assert.equal(result.readback.number, 18);
    assert.equal(fixture.transport.pullRequestWriteCount, 1);
    assert.ok(result.events.some((event) => event.kind === 'pull_request_response_loss_reconciled'));
    const replay = fixture.provider.upsertPullRequest(input);
    assert.equal(replay.readback.headCommit, HEAD);
    assert.equal(fixture.transport.pullRequestWriteCount, 1);
    fixture.database.close();
  });

  it('persists workflow completion and captures exact-source artifacts idempotently', () => {
    const fixture = makeFixture();
    fixture.transport.workflowSequence = [workflow('in_progress'), workflow('completed', 'success')];
    const workflowIdentity = fixture.transport.workflowSequence[0]!.workflow;
    const waitRequest = {
      operation: 'baby.github.workflow.wait',
      repositoryAuthorityId: AUTHORITY_ID,
      workflow: workflowIdentity,
      selectedJobIds: [601],
      deadline: '2026-07-24T13:10:00.000Z',
      maximumAttempts: 4,
    };
    const waited = fixture.provider.waitWorkflow({
      runId: 'checkpoint-f-workflow-run',
      idempotencyKey: 'checkpoint-f-workflow-key',
      semanticIdempotencyFingerprint: sha256Hex(canonicalJson(waitRequest)),
      repositoryAuthorityId: AUTHORITY_ID,
      workflow: workflowIdentity,
      selectedJobIds: [601],
      deadline: '2026-07-24T13:10:00.000Z',
      maximumAttempts: 4,
    });
    assert.equal(waited.conclusion, 'success');
    assert.equal(fixture.transport.workflowReadCount, 2);
    const replay = fixture.provider.waitWorkflow({
      runId: 'checkpoint-f-workflow-run',
      idempotencyKey: 'checkpoint-f-workflow-key',
      semanticIdempotencyFingerprint: sha256Hex(canonicalJson(waitRequest)),
      repositoryAuthorityId: AUTHORITY_ID,
      workflow: workflowIdentity,
      selectedJobIds: [601],
      deadline: '2026-07-24T13:10:00.000Z',
      maximumAttempts: 4,
    });
    assert.equal(replay.conclusion, 'success');
    assert.equal(fixture.transport.workflowReadCount, 2);

    const captureRequest = {
      operation: 'baby.github.workflow.artifacts.capture',
      repositoryAuthorityId: AUTHORITY_ID,
      workflow: workflowIdentity,
      artifactNames: ['checkpoint-f-evidence.zip'],
      maximumArchiveBytes: 4096,
      expectedSourceCommit: HEAD,
      expectedSourceTree: TREE,
      expectedDigests: { 'checkpoint-f-evidence.zip': ARTIFACT_DIGEST },
    };
    const captureInput = {
      runId: 'checkpoint-f-artifact-run',
      idempotencyKey: 'checkpoint-f-artifact-key',
      semanticIdempotencyFingerprint: sha256Hex(canonicalJson(captureRequest)),
      repositoryAuthorityId: AUTHORITY_ID,
      workflow: workflowIdentity,
      artifactNames: ['checkpoint-f-evidence.zip'],
      maximumArchiveBytes: 4096,
      expectedSourceCommit: HEAD,
      expectedSourceTree: TREE,
      expectedDigests: { 'checkpoint-f-evidence.zip': ARTIFACT_DIGEST },
    };
    const captured = fixture.provider.captureWorkflowArtifacts(captureInput);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.identity.archiveDigest, ARTIFACT_DIGEST);
    assert.equal(fixture.sink.entries.length, 1);
    fixture.provider.captureWorkflowArtifacts(captureInput);
    assert.equal(fixture.sink.entries.length, 1);
    fixture.database.close();
  });

  it('publishes push, draft PR, exact workflow, and artifacts once, then replays completed evidence', () => {
    const fixture = makeFixture();
    const safe = makeFakeSafePublication(fixture.authority);
    const publisher = new GitHubDeliveryPublisher({
      safePublication: safe.service,
      provider: fixture.provider,
      registry: fixture.database.githubProviderRuns,
      now: () => '2026-07-24T13:00:00.000Z',
    });
    const input = deliveryInput();
    const result = publisher.publish(input);
    assert.equal(result.state, 'completed');
    assert.equal(result.push?.commit, HEAD);
    assert.equal(result.push?.tree, TREE);
    assert.equal(result.pullRequest?.number, 18);
    assert.equal(result.workflow?.workflow.headSha, HEAD);
    assert.equal(result.artifacts?.[0]?.identity.archiveDigest, ARTIFACT_DIGEST);
    assert.equal(safe.previewCount(), 1);
    assert.equal(safe.pushCount(), 1);
    assert.equal(fixture.transport.pullRequestWriteCount, 1);
    assert.equal(fixture.sink.entries.length, 1);
    assert.deepEqual(publisher.events(input.deliveryId).map((event) => event.state), [
      'intent_persisted',
      'push_verified',
      'pr_verified',
      'workflow_verified',
      'artifacts_verified',
      'completed',
    ]);

    const replay = publisher.publish(input);
    assert.equal(replay.state, 'completed');
    assert.equal(safe.previewCount(), 1);
    assert.equal(safe.pushCount(), 1);
    assert.equal(fixture.transport.pullRequestWriteCount, 1);
    assert.equal(fixture.sink.entries.length, 1);
    fixture.database.close();
  });

  it('records partial success after a verified push and never repeats that push on terminal replay', () => {
    const fixture = makeFixture();
    fixture.transport.pullRequestFailure = true;
    const safe = makeFakeSafePublication(fixture.authority);
    const publisher = new GitHubDeliveryPublisher({
      safePublication: safe.service,
      provider: fixture.provider,
      registry: fixture.database.githubProviderRuns,
      now: () => '2026-07-24T13:00:00.000Z',
    });
    const input = deliveryInput({
      deliveryId: 'checkpoint-f-partial-delivery',
      idempotencyKey: 'checkpoint-f-partial-delivery-key',
    });
    assertProviderCode(() => publisher.publish(input), 'delivery_partial_failure');
    const status = publisher.status(input.deliveryId);
    assert.equal(status.state, 'cancelled');
    assert.equal(status.partialSuccess, true);
    assert.equal(safe.pushCount(), 1);
    assert.equal(fixture.transport.pullRequestWriteCount, 1);
    assert.ok(publisher.events(input.deliveryId).some((event) => event.kind === 'delivery_cancelled_after_partial_success'));
    assertProviderCode(() => publisher.publish(input), 'delivery_partial_failure');
    assert.equal(safe.pushCount(), 1);
    assert.equal(fixture.transport.pullRequestWriteCount, 1);
    fixture.database.close();
  });

  it('keeps GitHub mutations unregistered while enabling the production read surface', () => {
    const registered = new Set(OPERATION_DEFINITIONS.map((definition) => definition.operation));
    assert.equal(registered.has('baby.github.describe'), true);
    assert.equal(registered.has('baby.github.remote.verify'), true);
    assert.equal(registered.has('baby.github.pr.upsert'), false);
    assert.equal(registered.has('baby.github.delivery.publish'), false);
  });
});
