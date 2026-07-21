# Baby Quirt Security

Baby Quirt is an intentionally privileged runtime. A valid request can execute arbitrary root commands and mutate arbitrary host paths. Security therefore depends on preserving the entire authentication, host, socket, key, and evidence chain; there is no lower-privilege policy layer inside the runtime.

## Threat model

Primary threats are:

1. unauthorized use of the owner or gateway identity;
2. theft or disclosure of the gateway authority private key or supervisor receipt private key;
3. access to the private Unix socket by an unexpected local process;
4. replay or duplication of signed requests;
5. host impersonation or deployment to the wrong machine;
6. release substitution, archive traversal, or rollback to an unverified target;
7. secret material persisted in job state, streams, artifacts, or logs;
8. resource exhaustion through frames, output, jobs, files, PTYs, or artifacts;
9. false assurance caused by source tests that do not execute the packaged runtime.

## Authentication and authorization chain

Every production request must satisfy all of the following:

- exact principal subject `stealtheye-owner`;
- exact authority class `unrestricted-owner`;
- exact issuer, resource, and audience `https://mcp.stealtheye.io`;
- principal type `owner` with no workspace authority;
- exact owner principal fingerprint;
- exact gateway ID `stealtheye-horsey-gateway`;
- exact key ID `gateway-authority-v1`;
- Ed25519 signature over the canonical request document;
- fresh timestamp within the configured five-minute window;
- previously unseen nonce or an exact idempotent request hash;
- target hostname and machine identity matching the production VPS;
- Linux `SO_PEERCRED` UID matching `fix-mcp` UID `997`;
- access through `/run/horsey/baby-quirt.sock`, owned by `root:horsey` with mode `0660`.

OAuth is enforced by the separate MCP gateway before a QRT1 request is constructed. Baby Quirt validates the resulting owner principal and cryptographic gateway authority; it does not parse bearer tokens itself.

## Key management

| Material | Location | Owner:group | Mode | Purpose |
| --- | --- | --- | --- | --- |
| Gateway authority public key | `/etc/baby-quirt/gateway-authority-public.pem` | `root:horsey` | `0640` | Verify gateway request signatures |
| Gateway authority private key | `/etc/baby-quirt-mcp/gateway-authority-private.pem` | `fix-mcp:horsey` | `0600` | Sign QRT1 requests; never read by Baby Quirt |
| Supervisor receipt private key | `/etc/baby-quirt/supervisor-receipt-private.pem` | `root:root` | `0600` | Sign operation receipts |
| Supervisor receipt public key | `/etc/baby-quirt/supervisor-receipt-public.pem` | `root:horsey` | `0640` | Verify receipts in the gateway |
| OAuth JWKS | `https://mcp.stealtheye.io/oauth/jwks.json` | Remote | N/A | Verify owner bearer tokens in the gateway |

`/etc/baby-quirt` must be `root:horsey` mode `0750` so the gateway can traverse the directory to read only the two public keys. Neither private key may be committed, uploaded as a release artifact, printed, or made group-readable.

The SHA-256 fingerprint of the deployed gateway authority public PEM is:

```text
0288179e795a801111cebfbba1b43fd3792f08b38c861974eff4a915d61b1ed7
```

## Network exposure

- Baby Quirt has no TCP, HTTP, HTTPS, OAuth, or MCP listener.
- The only runtime transport is the private Unix socket.
- Caddy routes only to the unprivileged `baby-quirt-mcp` loopback listener.
- The Unix socket must never be proxied, bind-mounted into an untrusted workload, or exposed through a public tunnel.

## Stable client tool identity

The ChatGPT integration uses the single external tool `bbyquirt.call_quirt` with the canonical description:

> Run any authorized Baby Quirt operation through the single authenticated Baby Quirt interface.

Using one tool identity reduces unnecessary permission-surface variation, but it is not a security bypass. The platform remains authoritative over confirmation prompts. Baby Quirt still verifies the complete signed request, exact owner and authority, target host, nonce, peer UID, and result receipt. Changed operations or payloads require a new idempotency key. See [Using Baby Quirt from ChatGPT](USING_WITH_CHATGPT.md).

## Receipt and response assurance

A successful operation response may include a supervisor receipt containing the request ID, operation, owner identity, authority class, canonical result digest, timestamp, machine identity, hostname, receipt ID, key ID, and Ed25519 signature. The gateway must reject a response if correlation, host identity, key ID, result digest, or signature verification fails.

Receipts prove that the configured supervisor signed a result; they do not prove that every host side effect was semantically correct.

## Replay and idempotency

- Nonces and request-hash responses are retained for 24 hours.
- An exact signed request hash may return its cached response.
- A reused nonce with a different request is rejected.
- The current replay store is a JSON file written after successful dispatch. A crash between accepting a request and persisting the store can create a replay window; this is a known hardening item in [PRODUCTION.md](PRODUCTION.md).

## Secret handling

Use the structured `environment` input with `secretReference` for secret job environment values. Resolved secret values are supplied to the child process, while the durable job record stores the reference and `redacted: true`.

Literal `env` values and literal `environment[].value` values are persisted in job JSON. They must not contain credentials, tokens, passwords, private keys, or other secret material. Secret-shaped output may also be written to stdout, stderr, PTY streams, files, or artifacts. Redaction is defense in depth and must not be treated as a complete data-loss-prevention boundary.

## Resource controls

Implemented controls include:

| Control | Value |
| --- | --- |
| Maximum QRT1 frame payload | 16 MiB |
| Maximum captured job output | 64 MiB per stream |
| Maximum job queue | 256 |
| Maximum retained terminal jobs | 1024 |
| Stream and PTY read page | 64 KiB |
| File list depth | 32 |
| File list entries | 4096 |
| Request age | 5 minutes |
| Nonce retention | 24 hours |
| Idempotency retention | 24 hours |

Configured archive limits are not currently enforced by `ArtifactManager`, and `baby.artifact.create` reads the source file into memory. Treat large artifact operations as a known denial-of-service risk until the source is hardened.

## Deployment security

Production deployment requires:

- exact 40-character source commit already contained in `main`;
- pinned GitHub Actions revisions;
- pinned SSH host key with strict checking;
- exact hostname and normalized machine-id SHA-256;
- exact gateway public-key SHA-256;
- deterministic archive, manifest, and digest agreement;
- safe extraction that rejects absolute paths and traversal;
- an absent immutable target directory;
- exact active release pointer after installation;
- installed-runtime verification and a signed QRT1 live smoke.

The source-tree test suite is not sufficient by itself. The extracted release must load `lib/build/Release/peer_cred.node` and successfully observe the `fix-mcp` peer UID.

## Rollback and repair

Rollback is allowed only to the existing, distinct `/opt/baby-quirt/previous` release. First installation has no valid rollback target and must fail closed rather than invent one. After rollback or repair, repeat the native-addon load, key permission, socket identity, installed verifier, and signed `baby.health` checks.

## Reporting

Report suspected vulnerabilities privately to StealthEye LLC. Do not place bearer tokens, private keys, request signatures, raw credentials, unredacted process output, or live secret values in GitHub issues or pull-request comments.
