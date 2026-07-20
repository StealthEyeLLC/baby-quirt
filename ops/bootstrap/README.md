# Baby Quirt Bootstrap Lane

Temporary development/bootstrap credentials for CI and gateway authority.

## Committed Public Material

| Asset | Path |
|---|---|
| CI deploy SSH public key | `ops/bootstrap/baby-quirt-ci-deploy.pub` |
| Gateway authority public key | `ops/bootstrap/gateway-authority-public.pem` |

## Fingerprints (non-secret)

| Asset | SHA-256 fingerprint |
|---|---|
| Gateway authority public key | `cd495d69248349eed51906db3cd9aa1d20b7065adc006d5dcad988c09a0a9984` |
| CI deploy SSH public key | `SHA256:3vOomr9RWI6kWD6CTc3rehHkAGIZjzoNCJWzuMDhMNI` |
| VPS SSH host key (ed25519) | `SHA256:hTe07vTyIU1bZ6C56+58+T2PgctkQ+RYkepn/5j+aaE` |

## Owner Principal Fingerprint

Set repository variable `BABY_QUIRT_OWNER_PRINCIPAL_FINGERPRINT` to the gateway authority public key SHA-256 above.

## Required GitHub Secrets

- `BABY_QUIRT_VPS_SSH_PRIVATE_KEY`
- `BABY_QUIRT_VPS_SSH_KNOWN_HOSTS`
- `BABY_QUIRT_GATEWAY_SIGNING_PRIVATE_KEY`

## Supervisor Receipt Key

The supervisor receipt private key (`supervisor-receipt-v1`) is generated on the VPS during first installation only. Only the public key fingerprint is returned as installation evidence.

## VPS Authorization

Authorize the CI deploy public key for `ubuntu@51.81.86.225` through the existing StealthEye control path before deployment.
