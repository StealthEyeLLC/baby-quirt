# Baby Quirt

Baby Quirt is the standalone, private, UID-0 Unix-socket host-control runtime for bootstrapping and operating the full Quirt system. It provides authenticated host execution, durable jobs, file operations, PTY sessions, immutable artifacts, release installation, recovery, and signed evidence. It is not a public HTTP, OAuth, or MCP service.

## Production status

Baby Quirt is deployed on the authorized production VPS and is serving the private socket used by the Baby Quirt MCP gateway.

| Property | Production value |
| --- | --- |
| Release | `0.1.3` |
| Source commit | `6db0298758ef8080cd80adbce2b652333018e3f1` |
| Node runtime | `/opt/node-v24.18.0-linux-x64/bin/node` |
| Service | `baby-quirt.service` as root |
| Socket | `/run/horsey/baby-quirt.sock` |
| Authorized peer | `fix-mcp` UID `997`, group `horsey` |
| Public listener | None; forbidden by design |

The public remote surface is maintained separately in `StealthEyeLLC/baby-quirt-mcp`. Its gateway authenticates the owner with OAuth, then submits signed QRT1 requests through the private socket. See [Production State](docs/PRODUCTION.md) for the exact deployed topology, verification evidence, and known source-to-host deviations.

## Development

```bash
npm ci
npm run build:native
npm run build
npm run test:all
npm run test:contracts
```

Production requires Node.js `24.18.0`, the native Linux peer-credential addon, `tmux`, and systemd socket activation.

## Capabilities

- Authenticated private Unix-socket communication using QRT1
- Exact argv and shell execution with durable job lifecycle
- Interactive, restart-discoverable PTY sessions backed by tmux
- Binary-safe file stat, read, write, patch, copy, move, remove, and list
- Resumable artifact upload and download
- Ed25519-signed operation receipts bound to result digests
- Nonce replay checks and semantic idempotency caching
- Immutable release installation with rollback and repair
- Restart reconciliation for jobs and PTY sessions

## ChatGPT invocation

All Baby Quirt actions from ChatGPT use one external tool identity: `bbyquirt.call_quirt`.

Use this exact action description:

> Run any authorized Baby Quirt operation through the single authenticated Baby Quirt interface.

Only `operation`, `payload`, and `idempotencyKey` vary. A fresh conversation should call `baby.describe` before guessing operation names or payload fields. The complete canonical client procedure is [Using Baby Quirt from ChatGPT](docs/USING_WITH_CHATGPT.md).

## Operations

The runtime registers exactly 31 operations under the `baby.*` namespace. The canonical machine-readable list is [contracts/baby-quirt-contracts-v1.json](contracts/baby-quirt-contracts-v1.json); the executable registry is `src/operations/registry.ts`.

## Runtime layout

| Path | Purpose |
| --- | --- |
| `/run/horsey/baby-quirt.sock` | Private QRT1 Unix socket |
| `/etc/baby-quirt/` | Runtime configuration and Baby Quirt public/private key material |
| `/var/lib/baby-quirt/` | Job, stream, PTY, artifact, replay, and idempotency state |
| `/opt/baby-quirt/releases/` | Immutable releases |
| `/opt/baby-quirt/current` | Active release symlink |
| `/opt/baby-quirt/previous` | Rollback release symlink |

## Documentation

- [Production State](docs/PRODUCTION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Operational Runbook](docs/RUNBOOK.md)
- [Security](docs/SECURITY.md)
- [Protocol Schema](schemas/baby-quirt-protocol-v1.schema.json)
- [Contracts](contracts/baby-quirt-contracts-v1.json)

## Deployment

Deploy only an exact commit that is already an ancestor of `main`:

```bash
gh workflow run deploy.yml \
  --repo StealthEyeLLC/baby-quirt \
  -f version=<immutable-semver> \
  -f expected_commit=<40-character-main-commit>
```

The workflow builds and tests the exact source, creates a digest-pinned release, verifies the authorized host identity and gateway public key, installs an immutable release, activates systemd socket service, and verifies the installation. The full operator procedure and mandatory post-deployment signed smoke test are in [docs/RUNBOOK.md](docs/RUNBOOK.md).

## License

Proprietary — StealthEye LLC
