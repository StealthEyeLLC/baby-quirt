# Standalone Deployment and Self-Hosting v2

This document is the source architecture contract for Baby Quirt deployment and self-hosting. It supersedes every design that assigned Baby Quirt deployment ownership to Fix, the Fix privilege broker, the operator product, or the currently active Baby Quirt release.

## Authority

The owner authorizes an exact deployment objective through ChatGPT/Horsey. The gateway authenticates the owner and transports one signed `call_quirt` request. Baby Quirt validates and durably executes the exact authorized operation. A Baby-owned fixed-function host controller and guard performs the finite privileged host transaction independently of the active Baby and gateway releases.

Baby Quirt owns source materialization, builds, tests, packages, manifests, compatibility, inactive installation, snapshots, generations, activation intent, acceptance, rollback intent, reconciliation, evidence, receipts, repair, pruning, and self-hosting handoff state.

## Forbidden dependencies

The runtime, controller, guard, schemas, packages, scripts, units, tests, and normal operating path must not require:

- the Fix package, service, state, OAuth service, plan hash, artifact store, success marker, or deployment generation;
- the Fix privilege broker or any broker socket;
- the operator product or repository;
- GitHub Actions as the only build or deployment path;
- SSH, Termius, or the currently running Baby process for routine deployment, rollback, repair, or recovery.

The existing gateway Unix identity `fix-mcp` UID 997 is an operating-system account name, not a Fix runtime dependency. Its name does not grant authority.

## Durable ownership

Deployment authority lives in a transactional SQLite database outside immutable releases. The target path is `/var/lib/baby-quirt/deployment-state.sqlite`. Migrations are strict and ordered; foreign keys and integrity checks are mandatory; mutations use explicit transactions; terminal history and signed evidence are append-only.

The fixed controller and guard are installed outside product release pointers under Baby-owned paths such as `/usr/libexec/baby-quirt-deploy`, `/etc/baby-quirt/deployment`, and `/var/lib/baby-quirt/deployments`. They expose no public listener, general shell, arbitrary argv, arbitrary path copy, or arbitrary service manager.

A product activation transaction may never replace the controller that protects it. Controller A/B upgrades are separate transactions with an independently retained known-good controller.

## Mutation fence

Build, test, package, verify, stage, and inactive install are nonproduction operations and cannot change product pointers, services, Caddy, OAuth state, listeners, or live configuration. The first active mutation is forbidden until a generation-bound rollback guard is durably armed and read back.

Cancellation before arming cleans staging and terminalizes without production mutation. Cancellation after arming becomes rollback intent. Caller loss, Baby loss, gateway loss, reboot, deadline expiry, or mandatory acceptance failure must leave the independent guard able to restore the exact snapshot.

## Public operation family

The standalone release and self-hosting family contains exactly these eleven new operations:

1. `baby.release.status`
2. `baby.release.build`
3. `baby.release.stage`
4. `baby.release.verify`
5. `baby.release.activate`
6. `baby.release.rollback`
7. `baby.release.repair`
8. `baby.release.prune`
9. `baby.selfhost.source.get`
10. `baby.selfhost.acceptance.run`
11. `baby.selfhost.evidence.get`

Each operation is versioned and schema-defined, has typed errors, explicit risk and authority, semantic idempotency, durable restart and cancellation behavior, bounded evidence retrieval, secret redaction, `local_zero` normal-path cost, post-action verification, and Receipt v2 binding.

## Coordinated activation

One parent deployment ID and generation coordinate both products. Final candidate manifests and compatibility are verified first. The dual-compatible gateway activates before Baby and must continue to accept the known legacy Baby contract. Baby then activates, signed runtime-native discovery replaces the labeled legacy fallback, every mandatory acceptance gate runs, and one marker binds the generation, both manifests, and the accepted evidence digest. Success is terminal only after the guard verifies the marker and disarm is independently read back.

## Production freeze

Implementation and rehearsal use an isolated production-shaped fixture root. Source work does not authorize deployment, service restart, pointer mutation, Caddy or OAuth mutation, host package changes, identity changes, permission changes, key changes, networking changes, or any other production mutation. Production requires a later, separate owner authorization after the readiness report.
