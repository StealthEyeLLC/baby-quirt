# Baby Quirt Operational Runbook

This runbook is the canonical operator procedure for building, deploying, verifying, repairing, and rolling back the private Baby Quirt runtime. The exact current deployment is recorded in [PRODUCTION.md](PRODUCTION.md).

## Safety boundary

Baby Quirt runs as root and intentionally provides unrestricted owner authority. Do not expose its Unix socket, gateway signing key, receipt private key, or service directly to the public network. The only supported remote path is the separate OAuth-protected `baby-quirt-mcp` gateway.

## Canonical ChatGPT invocation

Use only `bbyquirt.call_quirt` for connected Baby Quirt work. Use this exact action description:

> Run one authorized Baby Quirt operation through the single authenticated Baby Quirt interface and return its durable result with verified signed evidence.

Only `operation`, `payload`, and `idempotencyKey` vary. Call `baby.describe` first in a fresh conversation. Reuse an idempotency key only for an exact retry of the same operation and payload. Do not invent alternate Baby tool names or wrappers merely to describe file, shell, job, PTY, or artifact actions. Full examples and evidence requirements are in [Using Baby Quirt from ChatGPT](USING_WITH_CHATGPT.md).

## Production baseline

| Property | Value |
| --- | --- |
| VPS | `51.81.86.225` |
| Hostname | `vps-c9f04f5e` |
| Machine identity SHA-256 | `cd189817b39fea60d338b73878240a6fe7db71374c7a0f35ad60f8eb641e8817` |
| Node | `/opt/node-v24.18.0-linux-x64/bin/node` |
| Socket | `/run/horsey/baby-quirt.sock` |
| Gateway user | `fix-mcp` UID `997` |
| Socket group | `horsey` |
| Active release link | `/opt/baby-quirt/current` |
| Current source commit | `6db0298758ef8080cd80adbce2b652333018e3f1` |

## Deployment prerequisites

The target host must have:

- Ubuntu with systemd;
- Node.js `24.18.0` at the pinned path;
- `tmux`, Python 3, OpenSSL, tar, gzip, and standard GNU utilities;
- user `fix-mcp` with UID `997`;
- group `horsey`, with `fix-mcp` as a member;
- passwordless, tightly authorized `sudo` for the deployment user;
- the pinned SSH host key;
- no public listener for Baby Quirt.

## Automated deployment

Deploy an exact commit already contained in `main`:

```bash
gh workflow run deploy.yml \
  --repo StealthEyeLLC/baby-quirt \
  -f version=<immutable-semver> \
  -f expected_commit=<40-character-main-commit>
```

Required GitHub secrets:

| Secret | Purpose |
| --- | --- |
| `BABY_QUIRT_VPS_SSH_PRIVATE_KEY` | SSH authentication for the authorized deployment account |
| `BABY_QUIRT_VPS_SSH_KNOWN_HOSTS` | Pinned VPS host-key entry |

Required repository variables:

| Variable | Purpose |
| --- | --- |
| `BABY_QUIRT_VPS_HOST` | Authorized VPS address |
| `BABY_QUIRT_VPS_PORT` | SSH port, normally `22` |
| `BABY_QUIRT_VPS_USER` | Deployment account, normally `ubuntu` |
| `BABY_QUIRT_EXPECTED_HOSTNAME` | Exact hostname |
| `BABY_QUIRT_EXPECTED_MACHINE_ID_SHA256` | SHA-256 of normalized `/etc/machine-id` |
| `BABY_QUIRT_OWNER_PRINCIPAL_FINGERPRINT` | SHA-256 of the gateway authority public PEM |

The workflow checks out the exact commit, validates ancestry, builds the native addon, runs unit/integration/acceptance/contract tests, creates a deterministic release, pins its manifest and digest, verifies host identity over pinned SSH, stages the public gateway key, installs an immutable release, and runs the installed verifier.

## Local release build

From a Git checkout:

```bash
BABY_QUIRT_SOURCE_COMMIT=$(git rev-parse HEAD) \
  bash scripts/release.sh <version>
```

From a source archive without `.git`, the commit must be supplied explicitly:

```bash
BABY_QUIRT_SOURCE_COMMIT=<40-character-source-commit> \
  bash scripts/release.sh <version>
```

The release output is:

```text
release/baby-quirt-<version>.tar.gz
release/baby-quirt-<version>.sha256
release/baby-quirt-<version>.manifest.json
```

## Manual host staging and activation

The installer accepts only this staging directory:

```text
/tmp/baby-quirt-deploy-<version>
```

It must contain regular, non-symlink files with these names:

```text
baby-quirt-<version>.tar.gz
baby-quirt-<version>.sha256
baby-quirt-<version>.manifest.json
bootstrap-safe-extract.py
gateway-authority-public.pem
```

Run `scripts/remote-install.sh` from the exact source commit as the authorized non-root deployment user with passwordless sudo:

```bash
BABY_QUIRT_VERSION=<version> \
BABY_QUIRT_STAGING_PATH=/tmp/baby-quirt-deploy-<version> \
BABY_QUIRT_EXPECTED_COMMIT=<40-character-source-commit> \
BABY_QUIRT_EXPECTED_HOSTNAME=vps-c9f04f5e \
BABY_QUIRT_EXPECTED_MACHINE_ID_SHA256=cd189817b39fea60d338b73878240a6fe7db71374c7a0f35ad60f8eb641e8817 \
BABY_QUIRT_EXPECTED_GATEWAY_PUBLIC_KEY_SHA256=0288179e795a801111cebfbba1b43fd3792f08b38c861974eff4a915d61b1ed7 \
bash scripts/remote-install.sh
```

The installer refuses a wrong host, wrong machine identity, wrong public key, wrong version/commit/digest, unsafe archive, or pre-existing immutable target.

## Mandatory key permission contract

Before starting or restarting the MCP gateway, enforce and verify:

```bash
sudo install -d -o root -g horsey -m 0750 /etc/baby-quirt
sudo chown root:horsey \
  /etc/baby-quirt/gateway-authority-public.pem \
  /etc/baby-quirt/supervisor-receipt-public.pem
sudo chmod 0640 \
  /etc/baby-quirt/gateway-authority-public.pem \
  /etc/baby-quirt/supervisor-receipt-public.pem
sudo chown root:root /etc/baby-quirt/supervisor-receipt-private.pem
sudo chmod 0600 /etc/baby-quirt/supervisor-receipt-private.pem
sudo -u fix-mcp test -r /etc/baby-quirt/gateway-authority-public.pem
sudo -u fix-mcp test -r /etc/baby-quirt/supervisor-receipt-public.pem
```

The public PEM files are deliberately readable by the gateway; the supervisor receipt private key is not.

## Native peer-credential addon invariant

The compiled release loads:

```text
/opt/baby-quirt/current/lib/build/Release/peer_cred.node
```

For source commit `6db0298758ef8080cd80adbce2b652333018e3f1`, the archive places the same addon under `lib/native/build/Release`. Production contains a verified copy at the runtime lookup path. Until the packager is corrected, verify or repair the active release as follows:

```bash
B=$(sudo readlink -f /opt/baby-quirt/current)
sudo test -f "$B/lib/native/build/Release/peer_cred.node"
sudo install -d -o root -g root -m 0755 "$B/lib/build/Release"
sudo install -o root -g root -m 0755 \
  "$B/lib/native/build/Release/peer_cred.node" \
  "$B/lib/build/Release/peer_cred.node"
sudo cmp -s \
  "$B/lib/native/build/Release/peer_cred.node" \
  "$B/lib/build/Release/peer_cred.node"
sudo /opt/node-v24.18.0-linux-x64/bin/node -e \
  'const m=require(process.argv[1]); if (!m || !m.getPeerCred) process.exit(1)' \
  "$B/lib/build/Release/peer_cred.node"
```

A release is not qualified merely because the source-tree native tests pass; the addon must load from the extracted archive.

## Service management

```bash
sudo systemctl daemon-reload
sudo systemctl enable baby-quirt.socket
sudo systemctl restart baby-quirt.socket baby-quirt.service
sudo systemctl status baby-quirt.socket baby-quirt.service --no-pager
sudo journalctl -u baby-quirt.service -n 100 --no-pager
```

The service is socket-activated. `baby-quirt.socket` must be active even if the service has not yet handled a connection.

## Required verification

### Installed runtime verifier

```bash
sudo /opt/baby-quirt/current/bin/baby-quirt-verify
```

### Exact release pointer

```bash
sudo readlink -f /opt/baby-quirt/current
python3 -c 'import json; print(json.load(open("/opt/baby-quirt/current/manifest.json")))'
```

The active path, version, commit, and manifest must agree with the intended immutable release.

### Signed live QRT1 smoke

Run the gateway-owned smoke as the exact socket peer:

```bash
sudo -u fix-mcp -- /bin/bash -c '
  set -a
  . /etc/baby-quirt-mcp/environment
  set +a
  exec /opt/node-v24.18.0-linux-x64/bin/node \
    /opt/baby-quirt-mcp/current/scripts/live-smoke.js
'
```

Success requires `status: ok`, operation `baby.health`, exact host and machine identity, and `receiptVerified: true`. This check is mandatory because it covers the native peer credential, request signature, private socket, supervisor dispatch, result correlation, and receipt verification in one call.

## Rollback

Preferred installed command:

```bash
sudo /opt/baby-quirt/current/bin/baby-quirt-rollback
sudo systemctl restart baby-quirt.socket baby-quirt.service
sudo /opt/baby-quirt/current/bin/baby-quirt-verify
```

Repository recovery script:

```bash
sudo bash scripts/remote-rollback.sh
```

Rollback requires `/opt/baby-quirt/previous` to resolve to a distinct existing release. Never invent a previous target on first install.

## Repair

```bash
sudo /opt/baby-quirt/current/bin/baby-quirt-repair
sudo systemctl restart baby-quirt.socket baby-quirt.service
sudo /opt/baby-quirt/current/bin/baby-quirt-verify
```

Repair does not replace the mandatory key-permission, native-addon, or signed live-smoke checks above.

## Troubleshooting

### Socket missing or inaccessible

```bash
sudo systemd-tmpfiles --create /etc/tmpfiles.d/baby-quirt.conf
sudo systemctl restart baby-quirt.socket
sudo stat /run/horsey/baby-quirt.sock
id fix-mcp
```

Expected socket ownership is `root:horsey` with mode `0660`, and `fix-mcp` must belong to `horsey`.

### `Unix peer credentials unavailable`

Verify that `lib/build/Release/peer_cred.node` exists and loads, then restart `baby-quirt.service`. Do not disable peer-credential enforcement in production.

### `EACCES` reading a public key

Verify directory traversal and public-key modes with the permission contract above. Do not make either private key group-readable.

### Job recovery

```bash
sudo journalctl -u baby-quirt.service | grep recovered
sudo find /var/lib/baby-quirt/jobs -maxdepth 1 -type f -name '*.json' -print
```

Running jobs are reconciled to `adopted` or `lost`; tmux-backed PTYs are reconciled to `active` or `lost`.

## Directory reference

| Path | Purpose |
| --- | --- |
| `/run/horsey/baby-quirt.sock` | Private QRT1 socket |
| `/etc/baby-quirt/` | Runtime config and key material |
| `/var/lib/baby-quirt/` | Jobs, streams, PTYs, artifacts, replay state |
| `/opt/baby-quirt/releases/` | Immutable releases |
| `/opt/baby-quirt/current` | Active release |
| `/opt/baby-quirt/previous` | Rollback target |
