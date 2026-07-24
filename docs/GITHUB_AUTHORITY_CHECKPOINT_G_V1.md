# Universal GitHub Authority Checkpoint G

Status: source-complete candidate; deliberately unregistered and undeployed.

Checkpoint G closes Universal GitHub Authority v1 with operator documentation, deterministic completion evidence, disposable systemd-nspawn certification, reproducible candidate builds, exact-head CI and artifact verification, and a machine-readable batch-of-five release entry. It does not activate the provider or change Baby's one-tool public interface.

## Completion boundary

The implementation remains owned by Baby Quirt. Baby Gateway continues to provide public authentication and MCP transport only. Local Git owns repository object truth. GitHub owns remote refs, pull requests, workflow runs, logs, and workflow artifacts. Success requires exact readback from the authority that owns each fact.

Checkpoint G does not install a GitHub App, rotate or broaden credentials, register `baby.git.*` or `baby.github.*` operations, deploy a provider, change a release pointer, or mutate production services. The existing repository-scoped encrypted SSH deploy credential may be used only to publish this source branch under an exact old-ref precondition.

## Final documentation set

- [Operation reference](GITHUB_AUTHORITY_OPERATION_REFERENCE_V1.md)
- [Credential, authorization, and provider setup](GITHUB_AUTHORITY_CREDENTIALS_V1.md)
- [Publication, recovery, and rate-limit runbook](GITHUB_AUTHORITY_RUNBOOK_V1.md)
- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [ChatGPT usage](USING_WITH_CHATGPT.md)
- [Checkpoint F provider design](GITHUB_AUTHORITY_CHECKPOINT_F_V1.md)
- [G3 coverage ledger](GITHUB_AUTHORITY_G3_COVERAGE_V1.md)

## Three-cycle disposable certification

The fixed host-certification harness runs in a fresh ZFS clone of the pinned Ubuntu systemd-nspawn image. Exact Baby and Gateway source bundles are mounted read-only. Each cycle rematerializes source and dependencies independently.

1. **Successful publication** — exact compare-and-swap Git publication, compound delivery, draft pull-request reconciliation, exact workflow identity, artifact digest verification, helper redaction, pinned trust validation, and real disposable `systemd` encrypted-credential injection.
2. **Response loss and restart reconciliation** — a completed remote push with a lost transport response is reconciled from remote Git truth; the deployment database is closed and reopened; the exact mutation is replayed without a second push; pull-request response loss is also reconciled without a duplicate write.
3. **Failure truth** — a non-fast-forward publication is rejected before mutation and a post-push provider failure is recorded as terminal partial success without repeating the verified push.

The harness writes `github-authority-cycles.json`. The outer nspawn runner inventories and SHA-256 digests every evidence file, signs the receipt with the host-managed nspawn evidence key, verifies cleanup, and destroys the disposable clone.

## Completion gates

Checkpoint G is complete only when all of the following are true for the final exact head:

- working tree and index are clean;
- protected public runtime and protocol files are unchanged;
- no basename `tool.js` changed;
- contract, focused, unit, integration, acceptance, and aggregate tests pass;
- secret-pattern and credential-path scans pass;
- two isolated candidate builds are byte-identical;
- the candidate archive and build record verify against the exact commit and tree;
- the three-cycle nspawn receipt is signature-verified and reports cleanup complete;
- the branch is published with exact old-ref protection;
- a fresh bare fetch proves the remote commit, tree, parent, and object integrity;
- PR #18 remains open, draft, and unmerged;
- exact-head CI succeeds and the verified candidate artifact is bound to that exact head;
- Markdown and JSON readiness reports identify all evidence and remaining deployment work.

## Batch-of-five boundary

The machine-readable batch entry records Universal GitHub Authority v1 as a source-complete, certified, undeployed candidate for a later coordinated five-capability release. It is not an activation instruction. A future deployment must separately authorize credential installation, provider registration, packaging, active release changes, production acceptance, and rollback protection.
