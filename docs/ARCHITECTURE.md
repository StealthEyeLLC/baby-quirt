# Baby Quirt Architecture

**Product:** Baby Quirt  
**Repository:** StealthEyeLLC/baby-quirt  
**Owner subject:** `stealtheye-owner`  
**Authority class:** `unrestricted-owner`

## Purpose

Baby Quirt is a standalone UID-0 privileged local-machine authority designed to bootstrap and build the full Quirt system. It executes signed requests from authorized clients (primarily Horsey) over a private Unix socket. Baby Quirt is not a public control plane, OAuth server, or objective scheduler.

## Topology

```text
Authorized Horsey gateway client
        ↓
Signed private QRT1 protocol
        ↓
/run/horsey/baby-quirt.sock
        ↓
Standalone UID-0 Baby Quirt daemon
```

## Identity

| Property | Value |
| --- | --- |
| Daemon UID | 0 (root) |
| Socket path | `/run/horsey/baby-quirt.sock` |
| Socket owner | root |
| Socket group | horsey |
| Socket mode | 0660 |
| Gateway user | fix-mcp |
| Public listener | forbidden |

## Persistent layout

| Path | Purpose |
| --- | --- |
| `/etc/baby-quirt/` | Configuration and signing keys |
| `/var/lib/baby-quirt/` | Durable state (jobs, streams, PTY, artifacts, replay store) |
| `/opt/baby-quirt/releases/` | Immutable release directories |
| `/opt/baby-quirt/current` | Symlink to active release |
| `/opt/baby-quirt/previous` | Symlink to prior release (rollback) |

## Wire protocol

- Framing: binary `QRT1` header (32 bytes) + JSON payload
- Handshake: `hello` / `welcome` with feature and algorithm negotiation
- Authentication: Ed25519 request signing with canonical JSON signing documents
- Replay protection: independent nonce store with bounded retention
- Idempotency: semantic request hash deduplication
- Receipts: Ed25519-signed operation receipts bound to result digests

## Lifecycle model

All operations share one durable lifecycle model:

1. **Authentication** — verify principal, authority, signature, nonce, timestamp, target host
2. **Dispatch** — route to operation handler via unified registry
3. **Execution** — jobs, files, PTY, artifacts under bounded resource limits
4. **Persistence** — restart-safe state in `/var/lib/baby-quirt/`
5. **Receipt** — cryptographically signed evidence of operation result
6. **Recovery** — on restart, reconcile running jobs and PTY sessions

## Authority model

Only the exact configured StealthEye owner identity (`stealtheye-owner`) with authority class `unrestricted-owner` may obtain unrestricted host authority. No command allowlists, path restrictions, or per-operation grants.

## Security properties

- Fresh on-host Ed25519 key generation during installation
- Private keys never in source, CI artifacts, or logs
- Secret redaction in all log output
- Bounded frame sizes, output buffers, job queues, and retention
- Host verification during deployment (hostname + machine-id SHA-256)
- SSH host key pinning via known_hosts

## Relationship to Quirt

Baby Quirt is the bootstrap runtime that will build the full Quirt. It implements the core host-control capabilities needed for self-hosting development: execution, files, jobs, PTY, artifacts, releases, and rollback.
