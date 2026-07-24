# Universal GitHub Authority Checkpoint F

Checkpoint F adds the durable GitHub provider substrate and the compound publication workflow represented by `baby.github.delivery.publish`.

The implementation is **source-complete, unregistered, and undeployed**. It does not change the public `call_quirt` surface, `tool.js`, the active operation registry, credentials, services, release pointers, or production state.

The machine-readable checkpoint ledger is `contracts/github-authority-checkpoint-f-v1.json`.

## Provider substrate

`src/github/provider-delivery.ts` implements durable source operations for draft pull requests, workflow discovery and polling, workflow logs, workflow artifacts, provider status/events, and compound publication.

Every provider mutation persists immutable intent before remote dispatch. Reuse of an idempotency key with changed semantic intent is rejected. Stored runs carry a canonical record digest, and provider events are append-only.

Pull-request upsert reconciles a lost write response by independently reading the exact base branch, head branch, commit, tree, title, body, draft state, and open state. A verified replay does not issue a duplicate remote write.

Workflow waits are bound to the exact run ID, attempt, and pushed commit. They use a caller-supplied deadline and bounded attempt count, verify selected jobs, preserve the latest readback durably, and replay a completed result without further polling.

Workflow logs and artifacts are bounded. Artifact capture verifies the source commit and tree, archive size, and optional expected digest before storing a digest-checked Baby artifact reference.

## Compound publication

`GitHubDeliveryPublisher` composes the existing `GitSafePublication.preview/apply` push boundary with the GitHub provider:

1. Persist the compound delivery intent.
2. Preview and apply an exact-lease Git push.
3. Verify the pushed commit and tree.
4. Create or reconcile a draft pull request and verify exact readback.
5. Find the workflow run for the exact pushed commit.
6. Wait for the selected workflow jobs under bounded polling.
7. Capture requested artifacts with exact source and digest checks.
8. Record the completed evidence bundle.

Each completed child step is recorded in the same Baby deployment database, allowing restart-safe continuation without repeating the push, pull-request mutation, completed workflow wait, or artifact capture.

If a later step fails after a verified push, the delivery is recorded as `cancelled` with `partialSuccess: true`. The implementation does not claim rollback and does not repeat the already verified push on terminal replay.

## Persistence

Deployment database migration 6, `github_provider_delivery_v1`, adds:

- `github_provider_runs`
- `github_provider_events`

The migration includes immutable identity triggers, durable-run deletion guards, and append-only event guards. It reuses Baby's existing deployment SQLite ledger; it introduces no alternate scheduler, worker, persistence authority, artifact authority, or recovery lane.

## Verification

The focused suite `test/github-provider-delivery.test.ts` proves:

- immutable intent, exact replay, and changed-intent rejection;
- lost pull-request response reconciliation without a duplicate write;
- durable workflow completion replay;
- exact-source, digest-verified artifact capture and replay;
- complete push, draft PR, workflow, and artifact publication with no duplicate child mutation on replay;
- terminal partial success after a verified push without repeating that push;
- no `baby.github.*` operation is registered in the active runtime.

Focused result: 6 tests, 1 suite, 6 passed, 0 failed.

## Boundaries

This checkpoint performs no deployment, merge, active-pointer change, credential installation or rotation, service mutation, or production provider call. The existing G3 coverage ledger remains scoped to local Git and is intentionally unchanged.
