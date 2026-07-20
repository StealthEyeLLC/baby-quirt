# Repository instructions

- Build Baby Quirt as a fresh standalone Linux service. Do not copy source from another repository.
- Keep the service on a private Unix-domain socket. Do not add a public network listener.
- Require signed requests, exact client identity, target-host binding, timestamp validation, and durable replay rejection.
- Keep ordinary pull-request and push CI secret-free and read-only.
- Any administrative workflow must be manually dispatched from the protected default branch, must not execute pull-request code, and must not expose credentials in logs or artifacts.
- Use Node.js 24 and built-in modules where practical. Keep the bootstrap runtime small and independently auditable.
- Produce deterministic release archives, manifests, checksums, installation scripts, verification scripts, and rollback instructions.
- No completion claim without tests, exact commit and tree identities, CI evidence, artifact digests, and readback verification.
