# Baby Quirt Production State

**Effective date:** 2026-07-23  
**Canonical scope:** the deployed Baby runtime, gateway relationship, operating authority, isolation model, and known source-to-host differences.

Update this document whenever the active Baby release, gateway release, host identity, key identity, service topology, authority contract, or verification result changes.

## Deployed topology

```text
Authorized ChatGPT OAuth client
  -> https://baby-quirt.stealtheye.io/mcp
  -> baby-quirt-mcp.service as fix-mcp (UID 997)
  -> bbyquirt.call_quirt / call_quirt
  -> Ed25519-signed QRT1 over /run/horsey/baby-quirt.sock
  -> baby-quirt.service as root
  -> durable result plus supervisor-signed Receipt v2 evidence
```

Baby Quirt itself has no public listener. Caddy terminates public TLS only for the separately deployed gateway.

## Runtime inventory

| Component | Production value |
| --- | --- |
| Host | `vps-c9f04f5e` (`51.81.86.225`) |
| Machine identity SHA-256 | `cd189817b39fea60d338b73878240a6fe7db71374c7a0f35ad60f8eb641e8817` |
| Baby active release pointer | `/opt/baby-quirt/releases/0.2.3` |
| Baby installed manifest version | `0.1.0` |
| Baby source commit | `29fa50b56cee5fdad973d318fdb32c1d3e152e43` |
| Baby source tree | `70d179a8ec0b0fddb89152e7813fdbee24dc2630` |
| Baby service | `baby-quirt.service` |
| Socket activation | `baby-quirt.socket` |
| Private socket | `/run/horsey/baby-quirt.sock` |
| Gateway peer | `fix-mcp`, UID `997`, group `horsey` |
| Gateway active release pointer | `/opt/baby-quirt-mcp/releases/0.2.3` |
| Gateway source commit | `0bfcd99757afe198151e96b18771626388914205` |
| Public endpoint | `https://baby-quirt.stealtheye.io/mcp` |
| Required OAuth scope | `baby.apply` |
| Public tools | exactly one: `call_quirt` |
| Runtime operations | 42 discovered `baby.*` operations |
| Runtime release status | `installed` |

Repository documentation commits may advance `main` without changing these active release identities. Live signed discovery, the installed manifest, active pointers, systemd, and public acceptance are authoritative.

## Canonical authority

Baby Quirt is the canonical owner-authorized authority for unrestricted UID-0 execution, host files, packages, processes, networking, mounts, users, groups, permissions, systemd, durable jobs, streams, PTYs, artifacts, production deployment, release lifecycle, self-hosting, recovery, replay controls, and supervisor-signed receipts.

The gateway authenticates, signs, forwards, correlates, and verifies. It does not become a second executor, scheduler, release database, recovery authority, artifact authority, privileged boundary, or receipt signer.

Fix and the Fix broker do not participate in the normal Baby execution, deployment, or recovery path.

## Canonical isolation model

Stock systemd-nspawn is the default environment for clean builds, test execution, destructive engineering, release certification, production-shaped rehearsal, staging, and preactivation acceptance.

When lifecycle behavior matters, certification boots real systemd and records:

- root and UID `997` identity;
- user namespace, capability masks, `NoNewPrivs`, and seccomp truth;
- service, socket, timer, controller, and guard lifecycle;
- Unix peer credentials;
- restart and reboot reconciliation;
- success and rollback behavior;
- exact evidence binding;
- cleanup and proof that the machine stopped.

Direct host mutation is reserved for explicitly authorized host work, production activation, recovery, or behavior that cannot be proven in isolation.

## Verified production behavior

The accepted production state established:

1. `baby-quirt.socket`, `baby-quirt.service`, `baby-quirt-mcp.service`, and Caddy are active.
2. The active Baby and gateway pointers resolve to immutable `0.2.3` release directories.
3. Signed runtime discovery reports release status `installed`, the expected host identity, 42 operations, and the Baby source identity above.
4. A live `baby.health` call succeeds through the exact gateway peer and returns verified signed evidence.
5. Public DNS and TLS route `baby-quirt.stealtheye.io` to the authorized VPS.
6. Protected-resource metadata, authorization-server metadata, JWKS, challenge behavior, and the one-tool MCP catalog are reachable.
7. The gateway reports exactly one public tool while the signed runtime reports 42 internal operations.
8. Restart readback preserved the active deployment and release identity.

A claim about future health or deployment state must re-run the relevant checks rather than relying solely on this record.

## Manifest reconciliation

The active `0.2.3` Baby release archive did not originally contain the runtime `manifest.json` at the path required by signed release identity readback. Production reconciles that source gap without modifying immutable release contents by binding a root-owned verified manifest into:

```text
/opt/baby-quirt/current/manifest.json
```

through systemd read-only bind configuration.

The manifest identifies:

- version `0.1.0`;
- commit `29fa50b56cee5fdad973d318fdb32c1d3e152e43`;
- tree `70d179a8ec0b0fddb89152e7813fdbee24dc2630`;
- the recorded source date epoch.

Future release packaging must place the canonical manifest correctly so a clean replacement deployment does not depend on external reconciliation.

## Production mutation doctrine

Unrestricted root is the authorized execution capability; it does not justify undocumented live edits. Production mutation preserves:

- exact source commits and trees;
- reproducible artifacts;
- immutable release directories;
- guarded atomic pointer changes;
- service and public acceptance readback;
- signed durable evidence;
- deterministic rollback;
- source reconciliation after emergency repair.

Termius, manual SSH, browser terminals, and user-pasted commands are break-glass only when Baby itself is unreachable.

## Connected ChatGPT usage

The canonical connected tool is `bbyquirt.call_quirt`. Its exact action description is:

> Run one authorized Baby Quirt operation through the single authenticated Baby Quirt interface and return its durable result with verified signed evidence.

A fresh conversation calls `baby.describe` and uses the installed operation definitions. Execution operations return durable jobs; callers must wait for terminal state, read output, verify exit status, perform post-action readback, and retain signed evidence before reporting completion.

## Next clean-release requirements

A future replacement release must:

- package the manifest at the exact runtime lookup path;
- load the native peer-credential addon from the extracted archive;
- enforce the public-key permission contract without host-side repair;
- complete signed QRT1 health from the packaged runtime;
- preserve the one-tool/42-operation contract;
- pass disposable nspawn certification and cleanup;
- preserve distinct verified current and previous releases;
- prove guarded activation and deterministic rollback;
- report exact source, process, service, OAuth, MCP, and receipt identity.
