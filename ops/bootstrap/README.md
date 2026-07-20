# Baby Quirt Bootstrap Lane

This directory contains only non-secret public bootstrap material used to pin the production deployment and gateway authority. Private deployment and signing material must remain outside the repository.

## Committed public material

| Asset | Path |
| --- | --- |
| CI deploy SSH public key | `ops/bootstrap/baby-quirt-ci-deploy.pub` |
| Gateway authority public key | `ops/bootstrap/gateway-authority-public.pem` |

## Pinned fingerprints

| Asset | Fingerprint |
| --- | --- |
| Gateway authority public PEM SHA-256 | `0288179e795a801111cebfbba1b43fd3792f08b38c861974eff4a915d61b1ed7` |
| CI deploy SSH public key | `SHA256:G/canENPq2U6Ak5tb4PsCQPjtfLC1RSifjYwKycCTRA` |
| VPS SSH host key (Ed25519) | `SHA256:hTe07vTyIU1bZ6C56+58+T2PgctkQ+RYkepn/5j+aaE` |

Set repository variable `BABY_QUIRT_OWNER_PRINCIPAL_FINGERPRINT` to the gateway authority public PEM SHA-256 above.

## GitHub deployment secrets

The current `.github/workflows/deploy.yml` consumes exactly these secrets:

- `BABY_QUIRT_VPS_SSH_PRIVATE_KEY`
- `BABY_QUIRT_VPS_SSH_KNOWN_HOSTS`

A repository secret named `BABY_QUIRT_GATEWAY_SIGNING_PRIVATE_KEY` may exist from an earlier bootstrap procedure, but the Baby Quirt deploy workflow does not consume it. Gateway private-key custody belongs to the separate `StealthEyeLLC/baby-quirt-mcp` deployment and the authorized host. Do not add that private key to a Baby Quirt release bundle.

## Supervisor receipt key

The supervisor receipt key pair is generated on the VPS during first installation:

| Material | Production path | Access |
| --- | --- | --- |
| Private key | `/etc/baby-quirt/supervisor-receipt-private.pem` | `root:root`, `0600` |
| Public key | `/etc/baby-quirt/supervisor-receipt-public.pem` | `root:horsey`, `0640` |

Only the public key is readable by the `fix-mcp` gateway for receipt verification.

## VPS authorization

Authorize the committed CI deploy public key for the controlled deployment account on `51.81.86.225` through the existing StealthEye host-control path. Keep strict host-key checking enabled and verify the expected hostname and normalized machine-id SHA-256 before every mutation.
