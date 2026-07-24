# Universal GitHub Authority G3 Coverage Ledger v1

This ledger audits every local Git operation in sections 6.1 through 6.17 of the controlling maximum-capability plan.

The canonical machine-readable ledger is `contracts/github-authority-g3-coverage-v1.json`. Its source is `src/github/g3-capability-catalog.ts`, and `scripts/generate-g3-coverage.ts` deterministically regenerates it.

## This checkpoint

This smallest coherent checkpoint adds source implementation and tests for:

- `baby.git.status`
- `baby.git.diff`
- `baby.git.diff.stat`
- `baby.git.diff.name_status`
- `baby.git.add`
- `baby.git.ignore.check`
- `baby.git.attributes.check`

The operations are implemented but deliberately not registered or deployed. The frozen Checkpoint A contract remains unchanged. The public MCP surface remains one `call_quirt` action with the same three arguments, and no `tool.js` file changes.

`baby.git.add` binds the exact observed HEAD and status digest, stages only declared observed changes, rejects conflicts and active sequencers, and verifies the staged result. Diff output is bounded while retaining a digest of the complete result.

## Truthful status

G3 is not complete. Every remaining operation is explicitly classified as contract-only, partially implemented, implemented but not registered, intentionally deferred, unavailable because of a missing production provider credential, or not applicable. No operation in this source checkpoint is advertised as executable in the active production runtime.

This is a build-only checkpoint. It performs no provider deployment, no active-pointer change, no credential installation or rotation, and no production service mutation.
