# Standalone Baby v2 readiness and operating record

Updated: 2026-07-23.

This document records the accepted standalone operating boundary after production activation. Repository documentation commits may advance `main` without changing the installed release; active runtime identity must always be read from signed Baby discovery and the release manifest.

## Accepted production contract

- Baby owns the deployment database, state machine, build, stage, verify, activate, rollback, repair, prune, self-host source, acceptance, evidence, signatures, receipts, controller, and independent guard.
- Baby is the canonical owner-authorized authority for unrestricted UID-0 execution, host mutation, durable jobs, streams, PTYs, files, artifacts, production deployment, and recovery.
- The runtime registry exposes 42 unique internal operations behind one public `call_quirt` tool.
- Every discovered operation includes schema, version, authority, risk, mutation and idempotency class, errors, limits, support, cancellation and restart behavior, post-action verification, and Receipt v2 binding.
- The Gateway keeps exactly one public tool with exactly three arguments, annotation `{ idempotentHint: true }`, scope `baby.apply`, issuer `https://baby-quirt.stealtheye.io`, and resource `https://baby-quirt.stealtheye.io/mcp`.
- GitHub OAuth is bound to numeric owner identity `247854506`; owner login text is not authority and the gateway never persists a GitHub user token.
- Gateway-first activation, compatibility acceptance, Baby activation, signed runtime discovery, success marking, guard disarm, deterministic rollback, restart reconciliation, strict extraction, deterministic builds, and fixed break-glass recovery remain source gated.
- Releases `0.2.1` and `0.2.2` remain protected and are never reused or overwritten.

## Canonical execution path

The normal path is:

```text
ChatGPT
  -> bbyquirt.call_quirt
  -> authenticated baby-quirt-mcp
  -> signed QRT1 over the private Unix socket
  -> Baby Quirt as UID 0
```

The Fix operator, Fix broker, Termius, manual SSH, browser terminals, and user-pasted shell commands are not routine dependencies. Termius and manual SSH are break-glass only when Baby is unreachable.

## Canonical nspawn gate

Stock systemd-nspawn is the default isolated environment for build, test, certification, destructive rehearsal, staging, and production-shaped acceptance. An accepted run must:

1. bind exact Baby and Gateway commit and tree identities with clean source readback;
2. use the pinned Node runtime and verified dependency inputs;
3. boot real systemd in a disposable image or snapshot when lifecycle behavior matters;
4. prove root identity, user-namespace truth, capability masks, `NoNewPrivs`, UID `997`, systemd lifecycle, and Unix peer credentials;
5. run every required suite with no unexplained failure, cancel, skip, flake, or retry-converted pass;
6. compare independent builds for byte identity;
7. exercise coordinated success, rollback, restart, and reboot behavior;
8. bind evidence and source identities into independently verified Ed25519 receipts;
9. destroy the exact disposable machine and prove it stopped;
10. report the honest stock-nspawn seccomp and kernel limitations.

A sandbox limitation is recorded as evidence and never silently converted into a pass.

## Production mutation rule

Unrestricted root is the authorized capability, but production state remains artifact first:

- exact source identities;
- reproducible release artifacts;
- immutable release directories;
- guarded atomic pointer changes;
- service and public acceptance readback;
- signed durable evidence;
- deterministic rollback;
- source reconciliation after emergency repair.

Ad hoc live edits are not the canonical deployment path.

## Active production identity at this record

| Component | Active source commit |
| --- | --- |
| Baby Quirt runtime | `29fa50b56cee5fdad973d318fdb32c1d3e152e43` |
| Baby Quirt MCP gateway | `0bfcd99757afe198151e96b18771626388914205` |

The installed runtime reported release status `installed`. Future claims must re-read signed runtime identity, active pointers, service state, public acceptance, and receipt verification rather than relying on this historical row.

## Decision rule

Source readiness, nspawn certification, production deployment, and current runtime health are distinct facts. Never infer one from another. A result is complete only after terminal durable state, output inspection, task-specific readback, and verified signed evidence.
