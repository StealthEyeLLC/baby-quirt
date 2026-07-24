# ADR 0002: Universal GitHub Authority v1 boundary and credential model

- Status: Accepted for Checkpoint A
- Capability: Baby Quirt Universal GitHub Authority v1
- Contract version: 1.0.0
- Deployment state: Source-only; not active in production

## Context

Baby Quirt needs a repository-agnostic publication path that can materialize and verify exact Git objects, create verified commits, publish only fast-forward branch updates, read remote state back, manage draft pull requests, wait durably for CI, capture logs and artifacts, and verify the resulting evidence.

The capability must remain behind the existing single `call_quirt` tool and the existing signed QRT1 path. Local Git truth and GitHub API truth are separate authorities. A successful local command is not proof of remote state.

Checkpoint A freezes contracts and boundaries only. Its operations are marked `contract_only` and `executable: false`. They are not added to the live operation registry until later checkpoints provide handlers and durable implementations.

## Decision

### Authority split

- Baby Gateway owns public authentication and MCP transport only.
- Baby Quirt owns local workspaces, durable operation lifecycle, credential-reference resolution, jobs, events, artifacts, reconciliation, and Receipt v2 evidence.
- Git remotes own remote refs.
- GitHub owns repository metadata, pull requests, workflows, logs, and workflow artifacts.
- Baby Quirt verifies external state through provider readback before success.

No second scheduler, job database, artifact store, receipt type, privileged socket, public tool, root service, or Gateway-owned Git controller is introduced.

### Operation catalog

The v1 contract contains exactly 26 operations:

1. `baby.git.describe`
2. `baby.git.repository.materialize`
3. `baby.git.repository.verify`
4. `baby.git.repository.status`
5. `baby.git.fetch`
6. `baby.git.branch.create`
7. `baby.git.commit.create`
8. `baby.git.commit.verify`
9. `baby.git.push.preview`
10. `baby.git.push.apply`
11. `baby.git.push.verify`
12. `baby.github.describe`
13. `baby.github.auth.status`
14. `baby.github.repo.authority.get`
15. `baby.github.repo.authority.list`
16. `baby.github.remote.verify`
17. `baby.github.pr.upsert`
18. `baby.github.pr.get`
19. `baby.github.pr.verify`
20. `baby.github.workflow.find`
21. `baby.github.workflow.wait`
22. `baby.github.workflow.get`
23. `baby.github.workflow.logs`
24. `baby.github.workflow.artifacts`
25. `baby.github.artifact.verify`
26. `baby.github.delivery.publish`

The compound publication operation composes child operations. It does not duplicate their implementation or introduce a second workflow scheduler.

### Credential decision

Three credential approaches were evaluated.

| Approach | Decision | Reason |
|---|---|---|
| Repository-scoped SSH deploy key | Temporary current Git transport | Already encrypted, proven, repository-scoped, and sufficient to fast-forward the implementation branch. It does not provide complete GitHub API authority. |
| GitHub App installation credential | Permanent API model | Installation-scoped, permission-snapshotted, expiring, revocable, and repository-aware. Values remain outside SQLite, releases, workspaces, logs, receipts, and artifacts. |
| Delegated user OAuth or fine-grained token | Bounded fallback only | Useful when installation credentials are unavailable, but carries user coupling and broader lifecycle risk. It is never a universal plaintext credential. |

The Gateway identity application is not silently repurposed as the GitHub operator credential.

Credential records persist references, metadata, permission digests, encrypted-credential digests, expiry, revocation, and health only. Plaintext secret values are never part of operation payload history or durable state.

### Mutation truth

The normative mutation lifecycle is:

`intent_persisted -> local_prepared -> remote_attempted -> remote_reconciled -> verified`

Terminal or recovery truth is represented by `failed`, `ambiguous`, or `unknown`. A lost response is reconciled through exact remote readback before retry or success.

The full publication state machine is included in the machine-readable contract bundle. Queued, in-progress, partial, unknown, or ambiguous state is never converted to success.

### Safety exclusions

Universal GitHub Authority v1 does not support unconstrained force push, remote ref deletion, repository deletion or transfer, visibility changes, organization or collaborator administration, secret mutation, branch-protection or ruleset changes, deploy-key mutation, pull-request merge, auto-merge, release publication, package publication, or arbitrary GitHub administration.

## Consequences

- Later checkpoints can implement handlers without changing the public MCP schema.
- Runtime discovery remains truthful because Checkpoint A contracts are not executable registry entries.
- Git transport and GitHub API authority remain independently verifiable.
- The permanent provider can be packaged for the later coordinated five-capability release without any active production mutation in this mission.
- New operations may be advertised only after implementation, tests, packaging, and later deployment.
