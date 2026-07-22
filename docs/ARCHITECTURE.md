# Baby Quirt Architecture

**Product:** Baby Quirt  
**Repository:** `StealthEyeLLC/baby-quirt`  
**Owner subject:** `stealtheye-owner`  
**Authority class:** `unrestricted-owner`  
**Wire protocol:** `QRT1/1.0.0`

## Purpose

Baby Quirt is the standalone UID-0 local-machine authority for the StealthEye recovery and bootstrap plane. It executes exact, signed requests over a private Unix socket and owns privileged process execution, durable job records, stream files, PTY sessions, host file operations, artifacts, release installation, rollback, replay state, and supervisor-signed receipts.

Baby Quirt is not a public control plane, OAuth server, public MCP server, general objective scheduler, or second execution kernel.

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
        +-- result bound to supervisor-signed receipt
```

A ChatGPT custom app can be that client after separate workspace registration and authenticated acceptance. The separate `StealthEyeLLC/baby-quirt-mcp` repository owns the remote OAuth/MCP boundary. Baby Quirt itself binds no TCP port and is not routed by Caddy.

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
| Public listener | Forbidden |

Linux peer identity is read with the native `SO_PEERCRED` addon. The authenticated request is accepted only when the signed identity and kernel-reported peer UID both match the configured gateway.

## Persistent layout and data model

| Path | Purpose |
| --- | --- |
| `/etc/baby-quirt/` | Runtime configuration, gateway public key, supervisor receipt key pair |
| `/var/lib/baby-quirt/jobs/` | One JSON record per job |
| `/var/lib/baby-quirt/streams/` | Binary stdout, stderr, and PTY output files |
| `/var/lib/baby-quirt/pty/` | One JSON record per PTY session |
| `/var/lib/baby-quirt/artifacts/` | Artifact blobs plus JSON manifest |
| `/var/lib/baby-quirt/replay-store.json` | Nonce and idempotency cache |
| `/opt/baby-quirt/releases/` | Immutable release directories |
| `/opt/baby-quirt/current` | Active release symlink |
| `/opt/baby-quirt/previous` | Rollback release symlink |

The current persistence implementation uses root-owned JSON files and binary stream/blob files. It is restart-readable but is not a transactional database; direct writes can leave a corrupt record after a host or process crash. Corrupt job or PTY records are skipped during listing.

## Wire protocol

- Fixed 32-byte binary `QRT1` header plus JSON payload
- `hello` / `welcome` negotiation before requests
- Ed25519 is the accepted production request-signing algorithm
- Canonical JSON signing document binds protocol, request ID, operation, principal, authority, target host, timestamp, payload, and binary length
- Maximum frame payload: 16 MiB
- Response correlation by request ID and operation
- Ed25519 supervisor receipt binds request, authority identity, host identity, result digest, and timestamp

## Request lifecycle

1. **Frame validation** — verify QRT1 framing and payload bounds.
2. **Handshake** — require Ed25519 support and return exact supervisor and host identity.
3. **Principal validation** — require exact issuer, resource, audience, subject, owner authority class, principal type, and principal fingerprint.
4. **Authority validation** — require exact gateway ID, key ID, fresh timestamp, nonce, target host, signature, and machine identity.
5. **Peer validation** — require the Unix peer UID to equal `997` unless an explicit test-only bypass is enabled.
6. **Replay and idempotency** — return a cached response for an identical signed request hash or commit a new nonce.
7. **Dispatch** — route one of the 42 unique `baby.*` operations through the unified registry.
8. **Persistence** — update job, stream, PTY, artifact, and replay state.
9. **Evidence** — sign a receipt over the canonical result digest.
10. **Recovery** — reconcile running jobs, detached jobs, and tmux-backed PTYs on service restart.

## Capability families

| Family | Operations | Implementation |
| --- | ---: | --- |
| Health | 1 | Runtime and host identity |
| Execution | 2 | Exact argv or shell as root jobs |
| Jobs and streams | 6 | Status, list, wait, cancel, offset reads |
| Files | 8 | Stat, read, write, patch, copy, move, remove, list |
| PTY | 5 | tmux-backed create, input, resize, read, close |
| Artifacts | 5 | Create, resumable upload/download, list, get |

The canonical operation names are in `contracts/baby-quirt-contracts-v1.json` and `src/operations/registry.ts`.

## ChatGPT and Horsey invocation boundary

The remote client exposes one generic external tool, `bbyquirt.call_quirt`. Every health, execution, job, file, PTY, artifact, and discovery request is an internal signed `baby.*` operation submitted through that one tool.

The canonical action description is:

> Run one authorized Baby Quirt operation through the single authenticated Baby Quirt interface and return its durable result with verified signed evidence.

This stable tool identity is a client-integration rule; it does not weaken Baby Quirt authentication, authorization, replay checks, host identity, peer credentials, or receipts. ChatGPT controls its own confirmation UI and may still require confirmation for sensitive payloads. See [Using Baby Quirt from ChatGPT](USING_WITH_CHATGPT.md).

## Authority model

Only the exact configured owner identity may exercise the unrestricted authority class. There are intentionally no command allowlists, path allowlists, per-operation grants, or lower-privilege execution profiles inside Baby Quirt. The security boundary is therefore the complete chain of OAuth owner authentication, gateway private-key custody, private socket access, kernel peer credentials, exact host identity, request signature verification, replay controls, and verified receipts.

## Release model

- Releases are deterministic tar archives with manifest and SHA-256 digest.
- Deployment is pinned to an exact 40-character commit already contained in `main`.
- The installer verifies host identity, release identity, digest, gateway public-key fingerprint, and immutable target absence.
- Activation swaps `/opt/baby-quirt/current` atomically and preserves `/opt/baby-quirt/previous` for rollback.
- systemd units and tmpfiles configuration are installed from the active release.
- Verification must exercise the extracted packaged runtime, including the native peer-credential addon and a signed QRT1 health request.

## Security properties

- No public listener in the privileged process
- Ed25519 gateway request signatures and supervisor receipts
- Exact owner, gateway, host, machine, key, and peer identities
- Private keys generated or installed only on the host
- Pinned SSH host key and exact machine identity during deployment
- Bounded frames, job output streams, job queue, retention, and stream pages
- Secret-reference support for job environment variables
- Immutable releases with explicit rollback pointer

## Current production qualification

The deployed runtime and gateway have passed local health, signed `baby.health`, receipt verification, public gateway TLS, protected-resource metadata, JWKS reachability, and unauthenticated MCP challenge checks. The exact deployment and remaining source gaps are maintained in [PRODUCTION.md](PRODUCTION.md). Those gaps must not be mistaken for current service outages, but they must be resolved before a clean replacement release is considered fully reproducible.
