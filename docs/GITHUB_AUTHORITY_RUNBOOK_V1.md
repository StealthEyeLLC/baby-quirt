# Universal GitHub Authority v1 Publication and Recovery Runbook

## Preflight

1. Call `baby.describe`; do not assume source-only operations are deployed.
2. Verify the exact workspace branch, commit, tree, status, parent, and changed paths.
3. Verify repository authority, credential reference, branch policy, operation family, expiry, revocation, and permission-snapshot digest.
4. Observe the exact destination ref through Git transport and, where applicable, GitHub API readback.
5. Persist the immutable semantic intent before any external mutation.
6. Use a fresh idempotency key unless retrying the exact same logical request.

## Safe branch publication

Preview must prove the source commit/tree, expected old remote object, destination ref, ancestry, object transfer set, and fast-forward policy. Apply must compare all preview identities, persist `push_attempted`, execute noninteractive Git with exact lease protection, then reconcile the remote ref and tree. A lost process response is not failure if exact remote readback proves the intended commit/tree. A mismatched destination is `remote_base_mismatch`; a divergent source is `non_fast_forward`; neither may be bypassed by unconstrained force.

## Draft PR and exact-head CI

Create or reconcile a draft PR by exact base branch, head branch, head commit, title, body, and draft state. On response loss, discover the matching PR and verify it instead of writing a duplicate. Find workflow runs by the exact pushed commit, workflow identity, event, and selected jobs. Poll within a bounded deadline, preserve rate-limit state, and treat absent, ambiguous, cancelled, timed-out, or failed workflows as explicit non-success states. Never accept a successful workflow for a different head SHA.

Capture logs with byte bounds and redaction. Capture candidate artifacts only when workflow and artifact metadata bind them to the exact source commit/tree. Verify archive digest, size, member safety, and the candidate build record. Store large content in Baby's artifact authority, not the deployment database.

## Response loss and restart

After any ambiguous transport result:

1. stop issuing new mutations for that semantic ID;
2. reopen the existing durable database after restart;
3. read the persisted intent and last event;
4. read the remote ref or GitHub object from its owning authority;
5. if exact intended state exists, record reconciliation and continue without repeating the mutation;
6. if exact pre-state remains, a bounded retry may be safe under the same idempotency key;
7. if neither state is provable, return an ambiguous/operator-required state.

Never change the idempotency fingerprint to escape an ambiguous result.

## Rate-limit behavior

Record provider limit, remaining quota, reset time, resource family, and observation time without storing tokens. Honor `Retry-After` and provider reset metadata. Read operations may wait within their caller deadline. Mutations must not spin, cross their expiry, or multiply writes. Secondary-rate-limit or abuse responses are durable provider failures with a safe retry time. If the deadline expires first, return a timeout/rate-limited state while preserving already verified partial success.

## Failure and partial success

A verified push followed by PR, workflow, log, or artifact failure is terminal partial success. Do not automatically delete the branch, close the PR, or reverse the push. Report exact external state, evidence references, retry-safe child operations, and required operator decisions. Provider readback disagreement is retained as evidence and may reconcile later; it is never silently converted into success.

## Recovery order

1. preserve database, events, streams, artifacts, and remote observations;
2. verify credential and repository authority health;
3. verify local workspace and remote ref identities;
4. resume the exact persisted operation;
5. capture missing provider readback or artifacts;
6. verify final state independently;
7. only then retire temporary workspaces or evidence.

## Future coordinated deployment

Checkpoint G is not a deployment. A later batch-of-five release must package the provider, register only implemented operations, install approved encrypted credentials and permission snapshots, run production-shaped preactivation acceptance, atomically activate immutable releases, verify live discovery and exact-head publication behavior, and preserve deterministic rollback. The batch manifest entry is a candidate record, not activation authority.
