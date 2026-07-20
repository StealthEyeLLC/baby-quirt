# Baby Quirt Production State

**Effective date:** 2026-07-20  
**Canonical scope:** the currently deployed Baby Quirt runtime, its gateway relationship, and any known differences between repository source and the live host.

Update this document whenever the active Baby Quirt release, gateway release, host identity, key identities, service topology, or verification result changes.

## Deployed topology

```text
ChatGPT custom app
  -> OAuth issuer and JWKS at https://mcp.stealtheye.io
  -> https://baby-quirt.stealtheye.io/mcp
  -> baby-quirt-mcp.service as fix-mcp (UID 997)
  -> signed QRT1 over /run/horsey/baby-quirt.sock
  -> baby-quirt.service as root
  -> durable result plus supervisor-signed receipt
```

Baby Quirt itself has no public listener. Caddy terminates public TLS only for the separately deployed MCP gateway.

## Runtime inventory

| Component | Production value |
| --- | --- |
| Host | `vps-c9f04f5e` (`51.81.86.225`) |
| Machine identity SHA-256 | `cd189817b39fea60d338b73878240a6fe7db71374c7a0f35ad60f8eb641e8817` |
| Baby Quirt release | `0.1.3` |
| Baby Quirt source commit | `6db0298758ef8080cd80adbce2b652333018e3f1` |
| Baby Quirt service | `baby-quirt.service` |
| Socket activation | `baby-quirt.socket` |
| Private socket | `/run/horsey/baby-quirt.sock` |
| Gateway peer | `fix-mcp`, UID `997`, group `horsey` |
| Gateway release | `0.1.2-20260720164826.1053861.938` |
| Gateway source commit | `115eecbf74e5ce9fa0979c151946c9864ab10e40` |
| Gateway public endpoint | `https://baby-quirt.stealtheye.io/mcp` |
| Required OAuth scope | `fix.apply` |
| Gateway authority public-key SHA-256 | `0288179e795a801111cebfbba1b43fd3792f08b38c861974eff4a915d61b1ed7` |

## Verified production behavior

The final production verification established all of the following:

1. `baby-quirt.socket`, `baby-quirt.service`, `baby-quirt-mcp.service`, and Caddy are active.
2. The gateway process is launched by Node.js through `/opt/baby-quirt-mcp/current/src/main.js`; the obsolete `--preserve-symlinks-main` and `src/server.js` launch path are absent.
3. Local gateway health on `127.0.0.1:2096` reports status `ok`, one public tool, and gateway commit `115eecbf74e5ce9fa0979c151946c9864ab10e40`.
4. A live `baby.health` QRT1 request succeeds as `fix-mcp`, returns the expected host identity, and verifies the supervisor receipt signature and result digest.
5. Public DNS resolves `baby-quirt.stealtheye.io` to `51.81.86.225`.
6. Caddy presents a valid public TLS route for `baby-quirt.stealtheye.io`.
7. Public `/healthz` and `/.well-known/oauth-protected-resource` responses are correct.
8. The OAuth JWKS is reachable from `https://mcp.stealtheye.io/oauth/jwks.json`.
9. An unauthenticated MCP initialize request returns HTTP `401` with the expected protected-resource challenge and `fix.apply` scope.

## Host remediations applied during first production activation

The production host currently contains two deliberate corrections that are not fully represented by the Baby Quirt source release process:

### Native peer-credential addon path

The compiled runtime loads the Linux addon from:

```text
/opt/baby-quirt/current/lib/build/Release/peer_cred.node
```

Commit `6db0298758ef8080cd80adbce2b652333018e3f1` packages the addon under `lib/native/build/Release/peer_cred.node`. Production contains an identical root-owned copy at the runtime lookup path. The release packager and a packaged-runtime test must be corrected before the next clean Baby Quirt deployment.

### Gateway-readable public verification material

The production permission contract is:

| Path | Owner:group | Mode |
| --- | --- | --- |
| `/etc/baby-quirt` | `root:horsey` | `0750` |
| `/etc/baby-quirt/gateway-authority-public.pem` | `root:horsey` | `0640` |
| `/etc/baby-quirt/supervisor-receipt-public.pem` | `root:horsey` | `0640` |
| `/etc/baby-quirt/supervisor-receipt-private.pem` | `root:root` | `0600` |

The current installer creates the configuration directory and public keys without fully enforcing this group-readable contract. Production was corrected so `fix-mcp` can traverse the directory and read only the public keys.

## Known source follow-ups

These items are source defects or assurance gaps, not current production outages:

1. **Release layout:** package and test `peer_cred.node` at the exact path loaded by the compiled release.
2. **Install permissions:** enforce `root:horsey` traversal and `0640` public-key modes during install and repair.
3. **Packaged live test:** load the native addon and complete a signed QRT1 health call from the extracted release before activation.
4. **Contract algorithms:** `contracts/baby-quirt-contracts-v1.json` advertises `hmac-sha256`, while the live authenticator accepts Ed25519 only; make the contract and runtime agree.
5. **State durability:** job, PTY, artifact, replay, and idempotency records use direct JSON-file writes rather than atomic transactional updates; document and harden crash semantics.
6. **Replay persistence window:** a nonce is persisted after successful dispatch, leaving a crash window between acceptance and durable replay recording.
7. **Artifact bounds:** configured archive-size limits are not enforced by `ArtifactManager`; large `baby.artifact.create` calls can read an entire file into memory.
8. **Secret inputs:** literal environment values are persisted in job JSON. Secret values must use `secretReference`; this should be enforced more strongly.
9. **PTY input fidelity:** the tmux input path performs shell-style apostrophe escaping even though `execFileSync` does not invoke a shell, which can alter literal input.
10. **Version metadata:** package metadata remains `0.1.0` while the documented deployed Baby Quirt release is `0.1.3`; release identity should have one canonical source.

## Acceptance gate for the next Baby Quirt release

A future release is not production-ready until all of these pass against the extracted archive, not merely the source checkout:

- native addon loads from the compiled runtime lookup path;
- exact `fix-mcp` peer credentials are observable through `SO_PEERCRED`;
- the public-key permission contract is enforced without a host-side repair;
- `baby.health` completes over the private socket and its receipt verifies;
- the active release symlink resolves to the expected immutable version;
- rollback points to a distinct verified previous release;
- the MCP gateway still reports the new Baby Quirt version and source commit accurately.
