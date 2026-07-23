# Baby Quirt Architecture

**Product:** Baby Quirt  
**Repository:** `StealthEyeLLC/baby-quirt`  
**Owner subject:** `stealtheye-owner`  
**Authority class:** `unrestricted-owner`  
**Wire protocol:** `QRT1/1.0.0`

## Purpose

Baby Quirt is the standalone UID-0 owner-authorized authority for the StealthEye VPS, production deployment, recovery, and unrestricted host operation. It executes exact signed requests over a private Unix socket and owns privileged process execution, durable jobs, streams, PTYs, host file operations, artifacts, release lifecycle, self-hosting, replay state, recovery, and supervisor-signed receipts.

Baby Quirt is intentionally not a constrained command broker, executable allowlist, path allowlist, rootless-only workspace, or mandatory plan/apply wrapper. Once the exact owner, gateway, host, peer, freshness, signature, replay, and release checks pass, the installed `unrestricted-owner` class provides full root authority.

Baby Quirt is not a public root service, OAuth server, public MCP listener, model service, or second public product surface.

## Canonical operating doctrine

- Every connected Baby action uses the single `bbyquirt.call_quirt` interface and one installed `baby.*` operation.
- Stock `systemd-nspawn` is the default isolated environment for builds, tests, destructive engineering, certification, production-shaped rehearsal, staging, and preactivation acceptance.
- systemd is the canonical durable host lifecycle manager for Baby, the gateway, sockets, timers, guards, and production services.
- Direct host mutation is appropriate for explicitly authorized host work, production activation, recovery, or behavior that cannot be proven in isolation.
- Production changes use exact source identities, reproducible artifacts, immutable release directories, guarded atomic pointer changes, post-action readback, signed evidence, and deterministic rollback.
- Termius, manual SSH, browser terminals, and user-pasted commands are break-glass only when Baby itself is unreachable. They are not routine dependencies.
- The Fix operator and Fix broker do not participate in the normal Baby execution, deployment, or recovery path.

## Production topology

```text
Authorized OAuth MCP client
        |
        | OAuth-authenticated MCP
        v
baby-quirt-mcp.service as fix-mcp (UID 997)
        |
        | Ed25519-signed QRT1 request
        v
/run/horsey/baby-quirt.sock
        |
        | systemd socket activation + SO_PEERCRED
        v
baby-quirt.service as root
        |
        +-- jobs / streams / PTYs / files / artifacts
        +-- release / self-host / recovery lifecycle
        +-- result bound to supervisor-signed receipt
```

A ChatGPT custom app can be that client after workspace registration and authenticated acceptance. `StealthEyeLLC/baby-quirt-mcp` owns the remote OAuth/MCP boundary. Baby itself binds no TCP port and is not routed by Caddy.

## Identity and transport

| Property | Value |
| --- | --- |
| Daemon UID | `0` (`root`) |
| Service | `baby-quirt.service` |
| Socket unit | `baby-quirt.socket` |
| Socket path | `/run/horsey/baby-quirt.sock` |
| Socket owner | `root` |
| Socket group | `horsey` |
| Socket mode | `0660` |
| Required peer | `fix-mcp` UID `997` |
| Gateway ID | `stealtheye-horsey-gateway` |
| Gateway key ID | `gateway-authority-v1` |
| Receipt key ID | `supervisor-receipt-v1` |
| Public listener | forbidden |

Linux peer identity is read with native `SO_PEERCRED`. A request is accepted only when the signed gateway identity and kernel-reported peer identity both match the configured authority.

## Persistent layout

| Path | Purpose |
| --- | --- |
| `/etc/baby-quirt/` | Runtime configuration, gateway public key, supervisor receipt key pair |
| `/var/lib/baby-quirt/jobs/` | Durable job records |
| `/var/lib/baby-quirt/streams/` | Binary stdout, stderr, and PTY streams |
| `/var/lib/baby-quirt/pty/` | Durable PTY session records |
| `/var/lib/baby-quirt/artifacts/` | Artifact blobs and manifests |
| `/var/lib/baby-quirt/deployments/` | Standalone v2 deployment state and evidence |
| `/var/lib/baby-quirt/workspaces/` | Baby-owned source and engineering workspaces |
| `/var/lib/baby-quirt/replay-store.json` | Nonce and idempotency state |
| `/opt/baby-quirt/releases/` | Immutable release directories |
| `/opt/baby-quirt/current` | Active release pointer |
| `/opt/baby-quirt/previous` | Rollback release pointer |

Persistent state never belongs inside a release directory. Corrupt or ambiguous state must be reported and reconciled, never converted into invented success.

## Wire protocol

- Fixed 32-byte binary `QRT1` header plus JSON payload.
- `hello` / `welcome` negotiation before requests.
- Ed25519 request signatures and supervisor receipts.
- Canonical request binding for protocol, request ID, operation, principal, authority, target host, timestamp, payload, and binary length.
- Maximum frame payload of 16 MiB.
- Exact request ID and operation correlation.
- Receipt binding for request digest, semantic fingerprint, result digest, host identity, release identity, and timestamp.

## Request lifecycle

1. Validate frame and payload bounds.
2. Negotiate protocol and return exact supervisor, release, and host identity.
3. Require exact issuer, resource, audience, subject, owner authority class, and principal fingerprint.
4. Require exact gateway ID, key ID, fresh timestamp, nonce, target host, signature, and machine identity.
5. Require the expected Unix peer UID.
6. Apply replay and idempotency checks.
7. Dispatch one of the installed `baby.*` operations through the unified registry.
8. Persist jobs, streams, PTYs, artifacts, release state, and replay state.
9. Sign a receipt over the canonical result.
10. Reconcile durable work after service or host restart.

## Capability families

The installed runtime exposes one public ChatGPT tool and 42 internal operations:

| Family | Operations |
| --- | ---: |
| Discovery and health | 2 |
| Execution | 2 |
| Jobs and streams | 5 |
| Files | 9 |
| PTY | 5 |
| Artifacts | 8 |
| Releases | 8 |
| Self-hosting | 3 |

The installed runtime returned by `baby.describe` is authoritative. Documentation and repository source do not override signed runtime discovery.

## ChatGPT invocation boundary

The remote client exposes one generic external tool, `bbyquirt.call_quirt`. Only `operation`, `payload`, and `idempotencyKey` vary.

The canonical action description is:

> Run one authorized Baby Quirt operation through the single authenticated Baby Quirt interface and return its durable result with verified signed evidence.

Clients must not create alternate Baby tool identities or attempt to evade platform confirmation. See [Using Baby Quirt from ChatGPT](USING_WITH_CHATGPT.md).

## Authority model

Only the exact configured owner identity may exercise `unrestricted-owner`. There are intentionally no executable, argument, path, package, service, or destination allowlists inside this authority class. The security boundary is the complete authenticated chain and its signed evidence, not command restriction after authorization.

Structured release and self-host operations are durable accelerators. They do not remove the underlying root execution and PTY capabilities.

## Isolation and certification

Stock systemd-nspawn is the canonical disposable Linux substrate. Certification must use exact clean source, real systemd where needed, honest capability and seccomp readback, UID `997`, Unix peer credentials, deterministic builds, restart and reboot tests, rollback tests, evidence signing, cleanup, and proof that the disposable machine stopped.

A sandbox limitation must be recorded as a limitation, not silently treated as a pass.

## Release model

- Releases are deterministic archives with manifests and SHA-256 digests.
- Source identities are exact commits and trees.
- Installation verifies host, machine, release, gateway key, manifest, and immutable target identity.
- Activation changes pointers atomically and preserves rollback state.
- Independent guards protect coordinated activation.
- Acceptance exercises the packaged runtime, signed discovery, signed health, gateway behavior, public OAuth/MCP behavior, restart, and rollback.
- Emergency host repairs must be captured back into reproducible source and release evidence.

## Security properties

- No public listener in the privileged process.
- Exact owner, gateway, host, machine, key, peer, request, and release identities.
- Ed25519 request signatures and supervisor receipts.
- Private keys remain host managed.
- Bounded frames, queues, streams, artifacts, retention, and evidence pages.
- Replay and semantic idempotency protection.
- Immutable releases and deterministic rollback.
- No dependency on Termius, manual SSH, GitHub Actions, Fix, or the Fix broker for normal runtime operation.

## Production qualification

The deployed runtime and gateway have passed local health, signed `baby.health`, receipt verification, public TLS, protected-resource metadata, JWKS reachability, OAuth/MCP challenge behavior, and release-identity readback. Current production truth must always be read directly from `baby.describe`, `baby.health`, `baby.release.status`, systemd, active pointers, and signed evidence before making a deployment claim.
