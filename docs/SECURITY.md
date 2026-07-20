# Baby Quirt Security

## Threat model

Baby Quirt operates as root on an authorized VPS. The primary threats are:

1. **Unauthorized access** — any party gaining execution authority without valid owner credentials
2. **Replay attacks** — re-submitting captured signed requests
3. **Secret exposure** — private keys or tokens appearing in logs, artifacts, or source
4. **Host impersonation** — deploying to or accepting connections from wrong machine
5. **Resource exhaustion** — unbounded output, jobs, or frame sizes

## Authentication

Every request requires:

- Exact principal subject: `stealtheye-owner`
- Exact authority class: `unrestricted-owner`
- Exact gateway ID: `stealtheye-horsey-gateway`
- Ed25519 signature over canonical signing document
- Independent nonce (replay protection)
- Timestamp within 5-minute window
- Target host matching machine hostname

## Key management

| Key | Location | Permissions | Lifecycle |
| --- | --- | --- | --- |
| Signing private key | `/etc/baby-quirt/signing-private.pem` | 0600, root | Generated on first install |
| Signing public key | `/etc/baby-quirt/signing-public.pem` | 0644, root | Generated on first install |
| OAuth JWKS | Remote (`mcp.stealtheye.io`) | N/A | Managed by Horsey |

Private runtime keys are never placed in Cursor, GitHub source, build artifacts, or CI logs.

## Network exposure

- No public HTTP/HTTPS/MCP listeners
- Communication only via private Unix socket at `/run/horsey/baby-quirt.sock`
- Socket group `horsey` restricts access to authorized gateway user

## Deployment security

The deployment workflow requires:

| Secret / input | Purpose | Status |
| --- | --- | --- |
| `BABY_QUIRT_VPS_SSH_PRIVATE_KEY` | SSH authentication to VPS | **Must be supplied** |
| `BABY_QUIRT_VPS_SSH_KNOWN_HOSTS` | SSH host key pinning | **Must be supplied** |
| `quirt_all_gh_token` | GitHub API (Cursor environment only) | Available in Cursor |

Host verification checks:

- SSH known_hosts pin (no `StrictHostKeyChecking=no`)
- Expected hostname: `vps-c9f04f5e`
- Expected machine-id SHA-256: `cd189817...e8817`
- Release archive SHA-256 digest verification

## Bounded resources

| Limit | Value |
| --- | --- |
| Max frame size | 16 MiB |
| Max job output | 64 MiB per stream |
| Max job queue | 256 |
| Max job retention | 1024 |
| Request max age | 5 minutes |
| Nonce retention | 24 hours |
| Idempotency retention | 24 hours |
| Stream chunk size | 64 KiB |

## Secret redaction

All log output passes through secret redaction that masks fields matching `secret`, `token`, `password`, `private`, `credential`, or `signature`.

## Rollback

Automatic rollback triggers on deployment verification failure. Manual rollback available via `baby-quirt-rollback` or `scripts/remote-rollback.sh`.
