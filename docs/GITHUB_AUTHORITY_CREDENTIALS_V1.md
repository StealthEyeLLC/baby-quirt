# Universal GitHub Authority v1 Credentials and Repository Authorization

## Credential principles

Baby stores credential metadata and references, not plaintext material. Encrypted credentials are host managed and injected into a transient, noninteractive process through `systemd` `LoadCredentialEncrypted`. Temporary `HOME`, SSH configuration, known-hosts data, and helper state are confined and removed after execution. Streams, database rows, artifacts, receipts, and errors must remain redacted.

Credential authority is the intersection of the owner authorization, the credential enrollment, the repository authority record, the allowed operation family, the allowed branch pattern, expiry/revocation state, and the latest permission snapshot. A broad credential does not broaden the operation request.

## Repository authorization record

A repository authority record binds:

- canonical repository ID, owner, name, host, and remote;
- credential reference and credential type;
- read-only or read-write classification;
- allowed branch patterns;
- allowed operation families;
- captured provider permission snapshot and digest;
- owner principal, creation, expiry, revocation, health, and last verification.

Materialization or mutation must fail closed on remote mismatch, embedded credentials, wrong host, branch outside policy, expired/revoked enrollment, missing operation family, or permission drift.

## Existing SSH deploy-key lane

The current source publication lane uses the existing repository-scoped encrypted SSH deploy credential. It is suitable only for the repository and ref policy already authorized. Required controls are strict pinned `github.com` Ed25519 host-key checking, `BatchMode=yes`, no prompts, no agent forwarding, no URL userinfo, exact remote-old-ref observation, and `--force-with-lease` only when the expected old object is exact. Unconstrained force is prohibited.

## Future GitHub App setup

A future production deployment should prefer a dedicated GitHub App for provider API operations. Create it outside this source-only checkpoint with only the permissions required by the deployed operation families: repository metadata read, contents read/write as authorized, pull requests read/write, and actions read. Install it only on explicitly authorized repositories. Store the App private key as an encrypted systemd credential; persist only installation/account IDs, permission snapshots, key fingerprints/digests, references, expiry, and revocation metadata. Never persist an installation token. Mint bounded tokens just in time, keep them memory-only, redact all transport output, and verify installation permissions before each mutation family.

The App is intentionally not installed by Checkpoint G. Its absence does not block source completion or certification.

## Future deploy-key setup

For a repository-specific Git transport lane, create a dedicated Ed25519 deploy key, add the public key only to the intended repository, and grant write access only when publication is required. Encrypt the private key with `systemd-creds`, store it under an opaque credential name, record its public-key fingerprint and encrypted-file digest, and register a narrow repository authority. Do not reuse personal SSH keys, broad organization keys, agent sockets, or interactive passphrases.

## Rotation and revocation

Rotation creates a new encrypted credential and permission snapshot before changing the reference. Verify the new credential read-only first, then exact write authority, then atomically update the repository authority reference. Revoke the old credential at the provider and mark its enrollment revoked locally. Reconciliation after ambiguous rotation must use provider and remote readback; it must never guess which key succeeded.
