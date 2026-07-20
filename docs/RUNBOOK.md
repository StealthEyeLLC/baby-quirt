# Baby Quirt Operational Runbook

## Prerequisites

- Ubuntu VPS at `51.81.86.225` (hostname `vps-c9f04f5e`)
- Node.js 24.18 at `/opt/node-v24.18.0-linux-x64/bin/node`
- `horsey` Unix group with `fix-mcp` member
- systemd

## Installation (automated)

Trigger the Deploy workflow from GitHub Actions with the desired version:

```
gh workflow run deploy.yml -f version=0.1.0
```

Required GitHub secrets (repository settings → Secrets):

| Secret | Description |
| --- | --- |
| `BABY_QUIRT_VPS_SSH_PRIVATE_KEY` | SSH private key for `ubuntu@51.81.86.225` |
| `BABY_QUIRT_VPS_SSH_KNOWN_HOSTS` | Pinned host key line for `51.81.86.225` |

Obtain the known_hosts entry:

```bash
ssh-keyscan -p 22 51.81.86.225
```

## Installation (manual)

```bash
# On build host
bash scripts/release.sh 0.1.0

# Copy to VPS
scp release/baby-quirt-0.1.0.tar.gz release/baby-quirt-0.1.0.sha256 ubuntu@51.81.86.225:/tmp/deploy/

# On VPS
cd /tmp/deploy
BABY_QUIRT_VERSION=0.1.0 \
BABY_QUIRT_STAGING_PATH=/tmp/deploy \
BABY_QUIRT_EXPECTED_HOSTNAME=vps-c9f04f5e \
BABY_QUIRT_EXPECTED_MACHINE_ID_SHA256=cd189817b39fea60d338b73878240a6fe7db71374c7a0f35ad60f8eb641e8817 \
bash /opt/baby-quirt/current/lib/scripts/remote-install.sh
```

## Service management

```bash
# Enable and start
sudo systemctl enable baby-quirt.socket
sudo systemctl start baby-quirt.socket

# Check status
sudo systemctl status baby-quirt.service
sudo systemctl status baby-quirt.socket

# View logs
sudo journalctl -u baby-quirt.service -f

# Restart
sudo systemctl restart baby-quirt.service
```

## Verification

```bash
sudo /opt/baby-quirt/current/bin/baby-quirt-verify
```

Expected output: all checks pass.

## Health check via CLI

```bash
sudo /opt/baby-quirt/current/bin/baby-quirt \
  --socket /run/horsey/baby-quirt.sock \
  --operation baby.health \
  --key /etc/baby-quirt/signing-private.pem
```

## Rollback

```bash
sudo /opt/baby-quirt/current/bin/baby-quirt-rollback
sudo systemctl restart baby-quirt.service
sudo /opt/baby-quirt/current/bin/baby-quirt-verify
```

## Repair

```bash
sudo /opt/baby-quirt/current/bin/baby-quirt-repair
sudo systemctl restart baby-quirt.service
```

## Troubleshooting

### Socket not found

```bash
sudo systemd-tmpfiles --create /etc/tmpfiles.d/baby-quirt.conf
sudo systemctl restart baby-quirt.socket
ls -la /run/horsey/baby-quirt.sock
```

### Permission denied on socket

```bash
# Verify group membership
groups fix-mcp
# Should include 'horsey'
sudo usermod -aG horsey fix-mcp
```

### Signing key issues

```bash
ls -la /etc/baby-quirt/signing-*.pem
# public: 644, private: 600
sudo /opt/baby-quirt/current/bin/baby-quirt-repair
```

### Job state recovery after crash

Baby Quirt automatically reconciles running jobs on restart. Check:

```bash
ls /var/lib/baby-quirt/jobs/
sudo journalctl -u baby-quirt.service | grep recovered
```

## Directory reference

| Path | Purpose |
| --- | --- |
| `/run/horsey/baby-quirt.sock` | Private Unix socket |
| `/etc/baby-quirt/` | Config and signing keys |
| `/var/lib/baby-quirt/` | Runtime state |
| `/opt/baby-quirt/current/` | Active release |
| `/opt/baby-quirt/previous/` | Rollback target |
| `/opt/baby-quirt/releases/` | Immutable releases |
