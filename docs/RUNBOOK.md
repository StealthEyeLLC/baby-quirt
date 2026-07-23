# Baby Quirt Operational Runbook

This runbook is the canonical procedure for operating, building, certifying, deploying, verifying, repairing, and rolling back the private Baby Quirt runtime. Exact current deployment identity is recorded in [PRODUCTION.md](PRODUCTION.md).

## Safety and authority boundary

Baby Quirt runs as UID 0 and intentionally provides unrestricted owner authority after exact OAuth owner, gateway, host, peer, signature, freshness, replay, and release checks succeed.

Do not expose the Baby Unix socket, gateway signing key, supervisor receipt private key, or root service to the public network. The supported remote path is the OAuth-protected `baby-quirt-mcp` gateway and its one public `call_quirt` action.

Fix and the Fix broker are not prerequisites for Baby-owned work. Termius, manual SSH, browser terminals, and user-pasted commands are break-glass only when Baby is unreachable.

## Canonical ChatGPT invocation

Use only `bbyquirt.call_quirt` for connected Baby work.

Exact action description:

> Run one authorized Baby Quirt operation through the single authenticated Baby Quirt interface and return its durable result with verified signed evidence.

Only `operation`, `payload`, and `idempotencyKey` vary.

At the start of a fresh conversation:

```json
{
  "operation": "baby.describe",
  "payload": {},
  "idempotencyKey": "baby-describe-<date>-001"
}
```

Signed runtime discovery is authoritative. Do not guess operation names, schemas, release identity, or limits from old documentation.

## Durable job completion

`baby.exec` and `baby.shell` return durable jobs. A returned `jobId` means accepted or started, not completed.

Before reporting success:

1. call `baby.job.wait` or `baby.job.get` until terminal;
2. verify status, exit code, signal, and completion time;
3. read stdout and stderr from their returned offsets or durable stream paths;
4. perform task-specific post-action readback;
5. retain request ID, job ID, result digest, receipt ID, verification state, and source identity.

Never report a running job as finished.

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
| Active Baby pointer | `/opt/baby-quirt/releases/0.2.3` |
| Active Baby source | `29fa50b56cee5fdad973d318fdb32c1d3e152e43` |
| Active Baby tree | `70d179a8ec0b0fddb89152e7813fdbee24dc2630` |
| Active gateway source | `0bfcd99757afe198151e96b18771626388914205` |

These are historical values at the document date. Re-read live signed identity before acting.

## Canonical isolation path

Stock systemd-nspawn is the default substrate for:

- clean source materialization;
- dependency installation;
- builds and tests;
- destructive engineering;
- release certification;
- production-shaped success and rollback rehearsal;
- staging and preactivation acceptance.

Use disposable images or snapshots. Boot real systemd when unit, socket, timer, reboot, recovery, guard, or peer-credential behavior matters.

Certification records:

- exact source commits and trees;
- clean source status;
- runtime and dependency versions;
- UID, user namespace, capability masks, `NoNewPrivs`, seccomp, mounts, and networking truth;
- systemd service, socket, timer, controller, and guard lifecycle;
- `fix-mcp` UID `997` and Unix `SO_PEERCRED` behavior;
- deterministic independent build digests;
- test counts, failures, skips, flakes, and durations;
- success, rollback, restart, and reboot behavior;
- signed evidence and artifact identities;
- cleanup and proof that the disposable machine stopped.

Record limitations honestly. A sandbox mismatch is evidence, not an assumed pass.

## Source materialization

For Baby and gateway source under a deployment-owned transaction, prefer the installed self-host operation:

```json
{
  "operation": "baby.selfhost.source.get",
  "payload": {
    "deploymentId": "<deployment-id>",
    "product": "baby-quirt"
  },
  "idempotencyKey": "<deployment-id>-baby-source"
}
```

Use the corresponding `baby-quirt-mcp` product call for the gateway. Verify returned repository, commit, tree, workspace reference, and clean state.

Repository connector materialization is acceptable for source work when host Git credentials are intentionally absent, but exact GitHub readback remains mandatory before commit or deployment claims.

## Coordinated release lifecycle

The canonical production lifecycle is Baby-owned standalone v2:

1. `baby.release.build`
2. `baby.release.stage`
3. `baby.release.verify`
4. `baby.release.activate`
5. `baby.selfhost.acceptance.run`
6. `baby.release.status` and `baby.release.verify` readback
7. `baby.release.rollback` or `baby.release.repair` when required
8. `baby.release.prune` only after protected-reference checks

Do not replace this lifecycle with ad hoc symlink changes or service restarts.

### Build

`baby.release.build` binds:

- deployment ID and generation;
- immutable plan digest;
- deadline;
- exact Baby commit and tree;
- exact gateway commit and tree.

Build must be reproducible and evidence backed.

### Stage

`baby.release.stage` verifies compatibility, host preconditions, signatures, and inactive create-once targets. It must not mutate active pointers.

### Verify

`baby.release.verify` checks deployment database integrity, exact source and product identity, evidence, candidates, guard state, and terminal truth.

### Activate

`baby.release.activate` requires the exact expected state sequence and confirmation digest. It snapshots production, arms and reads back the independent guard, activates the gateway first, proves compatibility, activates Baby, runs mandatory acceptance, records success, and disarms only after readback.

### Acceptance

Use `baby.selfhost.acceptance.run` with `preactivation`, `postactivation`, or `full` as required. Acceptance includes packaged runtime identity, signed discovery, signed health, one-tool/42-operation behavior, service restart, OAuth/MCP behavior, and public readback.

### Rollback and repair

Use `baby.release.rollback` for deterministic restoration of the exact guarded snapshot. Use `baby.release.repair` to reconcile incomplete, conflicting, ambiguous, unknown, or rollback-failed state by exact readback.

Manual pointer mutation is break glass, not the normal path.

## Production mutation doctrine

Unrestricted root is the execution capability; production state remains artifact first.

Every production mutation preserves:

- exact source commit and tree;
- reproducible artifact digests;
- immutable release targets;
- guarded atomic pointer changes;
- service, process, socket, and public acceptance readback;
- signed durable evidence;
- deterministic rollback;
- reconciliation of emergency host fixes into source.

Do not leave undocumented live edits.

## Service management

systemd is the durable host lifecycle manager.

The expected units include:

```text
baby-quirt.socket
baby-quirt.service
baby-quirt-mcp.service
```

Additional standalone deployment controllers, timers, and guards must be exact, generation fenced, and read back after mutation.

Normal service inspection and mutation should run through Baby, for example with `baby.exec` or `baby.shell`, then be polled to terminal state.

Required readback includes:

- unit active and enabled state;
- exact `ExecStart` process;
- UID and group;
- socket path, owner, group, mode, and peer;
- recent bounded journal output;
- active release pointer and manifest;
- signed health and receipt verification.

## Key and permission contract

| Path | Owner:group | Mode | Purpose |
| --- | --- | --- | --- |
| `/etc/baby-quirt` | `root:horsey` | `0750` | Runtime verification material root |
| `gateway-authority-public.pem` | `root:horsey` | `0640` | Verify gateway QRT1 requests |
| `supervisor-receipt-public.pem` | `root:horsey` | `0640` | Gateway receipt verification |
| `supervisor-receipt-private.pem` | `root:root` | `0600` | Baby receipt signing only |

The gateway must read only public verification material. Private keys remain least-readable and never enter logs, source, evidence, or prompts.

## Manifest invariant

The active runtime reads:

```text
/opt/baby-quirt/current/manifest.json
```

The manifest must identify version, commit, tree, and source date epoch and must agree with the intended immutable release.

The current `0.2.3` deployment uses a systemd read-only bind to reconcile a packaging omission without changing immutable release contents. Future clean releases must package the manifest at the exact runtime path and eliminate that external dependency.

## Native peer-credential invariant

The extracted packaged runtime must load the Linux peer-credential addon at its compiled lookup path and prove `SO_PEERCRED` against the exact gateway peer. Source-tree tests alone are insufficient.

Never disable peer-credential enforcement in production.

## Required live verification

A complete verification includes:

1. `baby.describe` — exact installed protocol, operations, host, release, and authority.
2. `baby.health` — runtime health and exact host identity.
3. `baby.release.status` — deployment state and evidence index.
4. `baby.release.verify` — deployment integrity when a deployment ID exists.
5. active Baby and gateway pointer readback.
6. systemd service and socket readback.
7. local gateway health.
8. signed `baby.health` through the gateway with `receiptVerified: true`.
9. public TLS, protected-resource metadata, authorization-server metadata, JWKS, challenge, authenticated initialize, and one-tool catalog as applicable.
10. restart readback proving the deployment stuck.

## Evidence record

For each meaningful operation retain:

- operation and payload identity;
- idempotency key;
- request and job IDs;
- terminal status and exit code;
- stdout and stderr references;
- result digest;
- receipt ID and verification state;
- exact source commit and tree;
- before and after pointers or service state;
- public acceptance readback where applicable.

## Break-glass recovery

Use Termius, manual SSH, browser terminals, or user-pasted commands only when Baby itself cannot be reached or durable signed failure evidence establishes that the normal path cannot repair itself.

Break-glass procedure:

1. preserve current pointers, unit files, manifests, and failure evidence;
2. make the minimum reversible repair;
3. restore Baby connectivity;
4. verify signed health and release identity;
5. capture the repair into source, release packaging, and durable evidence;
6. remove temporary access or overrides.

Break glass must never become the routine workflow.

## Directory reference

| Path | Purpose |
| --- | --- |
| `/run/horsey/baby-quirt.sock` | Private QRT1 socket |
| `/etc/baby-quirt/` | Runtime configuration and key material |
| `/var/lib/baby-quirt/jobs/` | Durable jobs |
| `/var/lib/baby-quirt/streams/` | Job and PTY streams |
| `/var/lib/baby-quirt/pty/` | PTY state |
| `/var/lib/baby-quirt/artifacts/` | Artifacts and manifests |
| `/var/lib/baby-quirt/deployments/` | Standalone deployment state and evidence |
| `/var/lib/baby-quirt/workspaces/` | Baby-owned engineering and source workspaces |
| `/opt/baby-quirt/releases/` | Immutable Baby releases |
| `/opt/baby-quirt/current` | Active Baby pointer |
| `/opt/baby-quirt/previous` | Baby rollback pointer |
| `/opt/baby-quirt-mcp/releases/` | Immutable gateway releases |
| `/opt/baby-quirt-mcp/current` | Active gateway pointer |
| `/opt/baby-quirt-mcp/previous` | Gateway rollback pointer |
