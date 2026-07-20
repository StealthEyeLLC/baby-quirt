#!/usr/bin/env bash
# Configure GitHub repository secrets and variables for Baby Quirt bootstrap lane.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"

REPO="${BABY_QUIRT_REPOSITORY:-StealthEyeLLC/baby-quirt}"
BOOTSTRAP="${HOME}/.baby-quirt-bootstrap"

set_secret() {
  if gh secret set "$1" --repo "$REPO" < "$2"; then
    echo "configured secret $1"
  else
    echo "warning: could not configure secret $1 (token may lack actions secret scope)" >&2
  fi
}

set_secret BABY_QUIRT_VPS_SSH_PRIVATE_KEY "$BOOTSTRAP/ci-deploy"
set_secret BABY_QUIRT_VPS_SSH_KNOWN_HOSTS "$BOOTSTRAP/known_hosts"
set_secret BABY_QUIRT_GATEWAY_SIGNING_PRIVATE_KEY "$BOOTSTRAP/gateway-authority-private.pem"

gh variable set BABY_QUIRT_VPS_HOST --repo "$REPO" --body "51.81.86.225"
gh variable set BABY_QUIRT_VPS_PORT --repo "$REPO" --body "22"
gh variable set BABY_QUIRT_VPS_USER --repo "$REPO" --body "ubuntu"
gh variable set BABY_QUIRT_EXPECTED_HOSTNAME --repo "$REPO" --body "vps-c9f04f5e"
gh variable set BABY_QUIRT_EXPECTED_MACHINE_ID_SHA256 --repo "$REPO" --body "cd189817b39fea60d338b73878240a6fe7db71374c7a0f35ad60f8eb641e8817"
gh variable set BABY_QUIRT_GATEWAY_USER --repo "$REPO" --body "fix-mcp"
gh variable set BABY_QUIRT_GATEWAY_UID --repo "$REPO" --body "997"
gh variable set BABY_QUIRT_GATEWAY_ID --repo "$REPO" --body "stealtheye-horsey-gateway"
gh variable set BABY_QUIRT_EXPECTED_SUBJECT --repo "$REPO" --body "stealtheye-owner"
gh variable set BABY_QUIRT_AUTHORITY_CLASS --repo "$REPO" --body "unrestricted-owner"
gh variable set BABY_QUIRT_OAUTH_ISSUER --repo "$REPO" --body "https://mcp.stealtheye.io"
gh variable set BABY_QUIRT_OAUTH_RESOURCE --repo "$REPO" --body "https://mcp.stealtheye.io"
gh variable set BABY_QUIRT_OAUTH_AUDIENCE --repo "$REPO" --body "https://mcp.stealtheye.io"
gh variable set BABY_QUIRT_OAUTH_JWKS_URI --repo "$REPO" --body "https://mcp.stealtheye.io/oauth/jwks.json"

GATEWAY_FP=$(sha256sum "$BOOTSTRAP/gateway-authority-public.pem" | awk '{print $1}')
gh variable set BABY_QUIRT_OWNER_PRINCIPAL_FINGERPRINT --repo "$REPO" --body "$GATEWAY_FP"

echo "Configured variables for $REPO"
