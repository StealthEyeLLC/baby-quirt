# Baby Quirt repository instructions

## Scope

This repository contains the standalone Baby Quirt private host-control runtime. It is a separate owner-authorized runtime authority, but it does not own its deployment lifecycle.

## Deployment authority

- Fix owns durable deployment plans, attempts, state, evidence, cancellation, reconciliation, and terminal engineering truth.
- The Fix privilege broker is the only authority allowed to mutate production release pointers, units, tmpfiles, configuration, permissions, or services.
- The generation-bound deployment guard is the only automatic rollback authority after it is armed.
- Baby Quirt may build, verify, and immutably install an inactive release target. Product code must not activate, restart, or roll back production.
- Existing release directories `0.2.1` and `0.2.2` are reserved and must never be overwritten, relabeled, activated, or reused.

## Release invariants

- Release identity is bound to the exact repository, commit, Git tree, source-date epoch, archive digest, internal manifest, external signed manifest, SBOM, test evidence, and compatibility declaration.
- Two isolated builds with identical frozen inputs must produce byte-identical archives.
- Archives contain only declared regular files and directories beneath one exact top-level prefix. Links, devices, FIFOs, sockets, sparse entries, special bits, unsafe metadata, traversal, duplicates, conflicts, and trailing nonzero data are forbidden.
- The canonical native addon path is `lib/build/Release/peer_cred.node`.
- Packaged entrypoints resolve their release root from their own location and never depend on `/opt/baby-quirt/current` during candidate verification.
- Inactive installation is create-once. An existing target is always a conflict, even when its bytes appear identical.

## Runtime invariants

- QRT1 remains version `1.0.0`.
- The source operation catalog remains exactly the declared 31-operation Baby Quirt catalog. Do not expand to Full Quirt or the 838-operation target.
- Receipt v2 binds the exact request, result, timing, source commit, source tree, and release identity; correctly signed Receipt v1 remains readable for the coordinated gateway-first upgrade.
- The private socket remains `/run/horsey/baby-quirt.sock`, owned `root:horsey`, mode `0660`.
- The gateway peer is exactly UID 997 in production.

## Change discipline

- Preserve authority boundaries, strict extraction, immutable targets, permission separation, and rollback requirements.
- Never commit secrets, private keys, bearer tokens, OAuth material, live state, or unredacted evidence.
- Tests may use isolated fixture roots and ephemeral keys only.
- Production deployment requires a separate explicit owner authorization after the complete cross-repository readiness gate.
