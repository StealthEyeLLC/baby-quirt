# Universal GitHub Authority v1 Operation Reference

## Support state

The contracts and source implementations are complete through Checkpoint G, but the operations are not registered in the active Baby runtime. `baby.describe` therefore must not advertise them until the later coordinated deployment. The public MCP surface remains one tool: `call_quirt`.

## Core contract operations

### Local Git authority

- `baby.git.describe` — contract and support discovery.
- `baby.git.repository.materialize` — create a confined exact workspace from an authorized remote and commit/tree.
- `baby.git.repository.verify` — re-read workspace, repository, commit, tree, branch, ancestry, and cleanliness truth.
- `baby.git.repository.status` — structured status including sequencer and conflict state.
- `baby.git.fetch` — fetch exact refs through a credential reference and verify resulting objects.
- `baby.git.branch.create` — create an authorized branch at an exact commit/tree.
- `baby.git.commit.create` — create a commit from declared staged paths under exact-parent preconditions.
- `baby.git.commit.verify` — verify commit, tree, parent, changed paths, identity, and signature policy.
- `baby.git.push.preview` — persist and return a non-mutating exact publication plan.
- `baby.git.push.apply` — perform one exact compare-and-swap publication under durable intent and idempotency.
- `baby.git.push.verify` — independently verify remote commit/tree and ancestry.

### GitHub provider authority

- `baby.github.describe` — provider contract and deployment state.
- `baby.github.auth.status` — metadata-only credential health and permission-snapshot truth.
- `baby.github.repo.authority.get` and `.list` — repository authorization records.
- `baby.github.remote.verify` — provider readback for repository/ref/content truth.
- `baby.github.pr.upsert`, `.get`, and `.verify` — durable draft pull-request reconciliation and exact readback.
- `baby.github.workflow.find`, `.get`, and `.wait` — workflow selection and bounded wait tied to an exact commit and selected jobs.
- `baby.github.workflow.logs` — bounded, redacted log capture into Baby artifacts.
- `baby.github.workflow.artifacts` — bounded artifact discovery and capture.
- `baby.github.artifact.verify` — source commit/tree, size, and digest verification.
- `baby.github.delivery.publish` — compound push, draft PR, exact workflow, and artifact publication with durable partial-success truth.

## Implemented working-tree operations

The deterministic G3 ledger also records implemented but unregistered status/diff/staging operations:

- `baby.git.status`
- `baby.git.diff`
- `baby.git.diff.stat`
- `baby.git.diff.name_status`
- `baby.git.add`
- `baby.git.ignore.check`
- `baby.git.attributes.check`

## Required request properties

Every future mutation request must carry a unique durable operation or delivery ID, a semantic idempotency fingerprint, a repository authority ID, an authorization reference, exact commit/tree/ref expectations, an expiry or deadline where applicable, and only credential references—never plaintext credentials.

## Success semantics

Command exit status is transport evidence, not final truth. Git publication succeeds only after remote Git object readback proves the exact commit and tree. GitHub mutations succeed only after provider readback proves the exact requested state. Compound delivery succeeds only after each completed child step is durably recorded and independently verified.

## Cancellation and partial success

Cancellation stops future work but never invents rollback. A verified push is not automatically reversed because a later PR, workflow, or artifact step fails. The result must identify partial success, the last verified external state, the safe retry point, and whether operator action is required.
