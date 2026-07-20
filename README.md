# Baby Quirt

Baby Quirt is a fresh, standalone, private Unix-socket host-control runtime designed to bootstrap and build the full Quirt system. It provides authenticated host execution, durable jobs, file operations, PTY sessions, immutable artifacts, release installation, recovery, and self-hosting development workflows.

## Status

Active development. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details.

## Quick start (development)

```bash
npm ci
npm run build
npm run test:all
```

## Capabilities

- Authenticated private Unix-socket communication (QRT1 wire protocol)
- Exact argv and shell execution with durable job lifecycle
- Interactive PTY sessions with resize and cancellation
- Binary-safe file stat, read, write, patch, copy, move, remove, list
- Resumable artifact upload and download
- Cryptographically signed operation receipts
- Replay protection and semantic idempotency
- Immutable release installation with rollback and repair
- Restart-safe job and session state recovery

## Operations

26 operations registered under the `baby.*` namespace. See [contracts/baby-quirt-contracts-v1.json](contracts/baby-quirt-contracts-v1.json).

## Installation paths

| Path | Purpose |
| --- | --- |
| `/run/horsey/baby-quirt.sock` | Private Unix socket |
| `/etc/baby-quirt/` | Configuration and signing keys |
| `/var/lib/baby-quirt/` | Runtime state |
| `/opt/baby-quirt/current/` | Active release |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Operational Runbook](docs/RUNBOOK.md)
- [Protocol Schema](schemas/baby-quirt-protocol-v1.schema.json)
- [Contracts](contracts/baby-quirt-contracts-v1.json)

## Deployment

See [docs/RUNBOOK.md](docs/RUNBOOK.md) for deployment instructions. Required GitHub secrets:

- `BABY_QUIRT_VPS_SSH_PRIVATE_KEY`
- `BABY_QUIRT_VPS_SSH_KNOWN_HOSTS`

## License

Proprietary — StealthEye LLC
