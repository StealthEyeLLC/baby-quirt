# Standalone Baby v2 readiness record

Updated: 2026-07-22. This document defines the source-tree readiness boundary. Exact remote commit/tree IDs, CI run URLs, two-build digests, signed nspawn receipt/artifact IDs, counts, and PR review state belong in the coordinated draft PR descriptions because authorization and retirement commits intentionally reuse this implementation tree.

## Implemented contract

- Baby owns the deployment database, state machine, build/stage/verify/activate/rollback/repair/prune intent, self-host source/acceptance/evidence readback, signatures, receipts, controller and guard.
- The runtime registry has 42 unique operations: 31 preserved operations plus 8 `baby.release.*` and 3 `baby.selfhost.*` operations.
- Every discovered operation includes input/output schema, version, authority, risk, mutation/idempotency class, errors, limits, support, cancellation/restart behavior, post-action verification, and Receipt v2 binding.
- The Gateway keeps exactly one public tool with exactly three arguments, annotations `{ idempotentHint: true }`, scope `baby.apply`, issuer `https://baby-quirt.stealtheye.io`, and resource `https://baby-quirt.stealtheye.io/mcp`.
- GitHub mode is direct and bound to numeric user ID `247854506`; the installer never enables password mode as an intermediate state and never persists a GitHub user token.
- Gateway-first activation, legacy compatibility, Baby activation, signed runtime discovery, success marking, guard disarm, deterministic rollback, restart reconciliation, create-once inactive install, strict extraction, two-build comparison, and fixed manual recovery are source-gated.
- Releases `0.2.1` and `0.2.2` are protected and are never reused or overwritten.
- The complete 94-scenario live ledger is `docs/FAILURE_RISK_REGISTER_V2.md`.

## Exact-head certification gate

The accepted certification path is a one-time, expiring, exact-source authorization commit followed by the existing Actions-to-VPS runner. It must:

1. bind exact Baby and Gateway commit/tree IDs and a clean source readback;
2. build with Node `24.18.0` and the verified offline dependency cache;
3. boot real systemd in a disposable ZFS clone under stock systemd-nspawn;
4. prove root, no user namespace, all capability masks through `cap_last_cap=40`, `NoNewPrivs=0`, UID `997`, systemd lifecycle, and SO_PEERCRED;
5. run every Baby and Gateway suite with no unexplained fail, cancel, skip, flake, or retry-converted pass;
6. run two independent builds for each product and compare byte digests;
7. run three clean-clone coordinated success/rollback/reboot cycles;
8. bind all evidence files and source identities into one independently verified Ed25519 receipt;
9. destroy the exact clone and prove the machine stopped;
10. report the honest stock-nspawn `Seccomp=2` limitation.

## Not authorized by readiness

Readiness does not authorize merge, production deployment, production mutation, ChatGPT app refresh/recreation/publication, OAuth credential changes, service restart, pointer change, Caddy/DNS change, or manual SSH/Termius. Those remain later owner decisions. Production remains untouched until separately authorized.

## Decision rule

The coordinated PRs remain draft and **not ready to merge** until exact-head remote CI, exact-head disposable certification, independent evidence verification, PR review/thread inspection, and secret-pattern scans are all green and recorded. Any missing evidence or identity mismatch is a blocker, not an assumed pass.
