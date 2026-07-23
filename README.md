# Baby Quirt

Baby Quirt is the standalone private UID-0 owner-authorized runtime for the StealthEye VPS. It provides unrestricted root execution, durable jobs, file operations, persistent PTYs, immutable artifacts, release lifecycle, self-hosting, recovery, replay protection, and supervisor-signed evidence over a private Unix socket. It is not a public HTTP, OAuth, or MCP service.

## Production status

Baby Quirt is deployed on the authorized production VPS and serves the private socket used by the Baby Quirt MCP gateway.

| Property | Production value |
| --- | --- |
| Active release pointer | `/opt/baby-quirt/releases/0.2.3` |
| Installed manifest version | `0.1.0` |
| Active source commit | `29fa50b56cee5fdad973d318fdb32c1d3e152e43` |
| Active source tree | `70d179a8ec0b0fddb89152e7813fdbee24dc2630` |
| Node runtime | `/opt/node-v24.18.0-linux-x64/bin/node` |
| Service | `baby-quirt.service` as root |
| Socket | `/run/horsey/baby-quirt.sock` |
| Authorized peer | `fix-mcp` UID `997`, group `horsey` |
| Public listener | none; forbidden by design |
| Runtime operation count | `42` behind one public gateway tool |

The public remote surface is maintained separately in `StealthEyeLLC/baby-quirt-mcp`. Its gateway authenticates the exact owner with OAuth and submits signed QRT1 requests through the private socket.

Repository documentation commits may advance `main` without changing the active release. Read signed runtime discovery and the installed manifest before making deployment claims.

## Canonical operating model

- Use `bbyquirt.call_quirt` for every connected Baby operation.
- Call `baby.describe` before guessing installed operations or payload fields.
- Baby is the canonical authority for unrestricted root, host mutation, systemd, packages, networking, files, jobs, PTYs, artifacts, deployment, recovery, and self-hosting.
- Stock `systemd-nspawn` is the default isolated environment for builds, tests, destructive engineering, certification, staging, and production-shaped acceptance.
- systemd is the durable host lifecycle manager.
- Production changes use exact source identities, deterministic artifacts, immutable releases, guarded atomic pointer changes, acceptance readback, signed evidence, and deterministic rollback.
- Termius, manual SSH, browser terminals, and user-pasted commands are break-glass only when Baby itself is unreachable.
- Fix and the Fix broker are not prerequisites for Baby-owned work.

## Development

```bash
npm ci
npm run build:native
npm run build
npm run test:all
npm run test:contracts
```

Production requires Node.js `24.18.0`, the native Linux peer-credential addon, `tmux`, and systemd socket activation. Production-shaped engineering and certification should run in disposable stock systemd-nspawn machines.

## Capabilities

- Authenticated private Unix-socket communication using QRT1.
- Exact argv and shell execution with durable jobs.
- Interactive restart-discoverable PTY sessions backed by tmux.
- Binary-safe file stat, read, write, atomic replacement, patch, copy, move, remove, and list.
- Resumable immutable artifacts.
- Ed25519-signed operation receipts bound to request, result, host, and release identity.
- Nonce replay checks and semantic idempotency.
- Coordinated release build, stage, verify, activate, rollback, repair, and prune.
- Self-host source materialization, acceptance, and evidence.
- Restart reconciliation for jobs and PTYs.

## ChatGPT invocation

All Baby actions use one external tool identity: `bbyquirt.call_quirt`.

Use this exact action description:

> Run one authorized Baby Quirt operation through the single authenticated Baby Quirt interface and return its durable result with verified signed evidence.

Only `operation`, `payload`, and `idempotencyKey` vary. A fresh conversation should call `baby.describe` before guessing operation names or payload fields.

Execution operations return durable jobs. A `jobId` is not completion evidence. Poll the job to terminal state, read stdout and stderr, verify exit status, perform post-action readback, and retain the signed receipt before reporting success.

## Operations

The installed runtime registers exactly 42 operations under the `baby.*` namespace:

- discovery and health: 2;
- execution: 2;
- jobs and streams: 5;
- files: 9;
- PTY: 5;
- artifacts: 8;
- releases: 8;
- self-hosting: 3.

Signed `baby.describe` output is authoritative. The machine-readable source contract is `contracts/baby-quirt-contracts-v1.json` and the executable registry is `src/operations/registry.ts`.

## Runtime layout

| Path | Purpose |
| --- | --- |
| `/run/horsey/baby-quirt.sock` | Private QRT1 Unix socket |
| `/etc/baby-quirt/` | Runtime configuration and key material |
| `/var/lib/baby-quirt/` | Jobs, streams, PTYs, artifacts, deployments, workspaces, replay, and idempotency state |
| `/opt/baby-quirt/releases/` | Immutable releases |
| `/opt/baby-quirt/current` | Active release pointer |
| `/opt/baby-quirt/previous` | Rollback release pointer |

## Documentation

- [Production State](docs/PRODUCTION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Operational Runbook](docs/RUNBOOK.md)
- [Using Baby from ChatGPT](docs/USING_WITH_CHATGPT.md)
- [Standalone v2 Readiness](docs/READINESS_V2.md)
- [Security](docs/SECURITY.md)
- [Protocol Schema](schemas/baby-quirt-protocol-v1.schema.json)
- [Contracts](contracts/baby-quirt-contracts-v1.json)

## Deployment

The canonical deployment path is Baby-owned standalone v2 release lifecycle, not an ad hoc SSH workflow. Use exact source commits and trees, deterministic builds, disposable nspawn certification, inactive staging, guarded activation, signed acceptance, and rollback protection.

Legacy workflow files may remain for historical or emergency recovery purposes, but they do not supersede Baby's active deployment authority.

## License

Proprietary — StealthEye LLC
