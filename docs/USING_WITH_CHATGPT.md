# Using Baby Quirt from ChatGPT

This document is the canonical instruction for invoking Baby Quirt from ChatGPT, Horsey, or any connected StealthEye engineering conversation.

## One external tool identity

Use exactly one external tool for every Baby Quirt action:

```text
bbyquirt.call_quirt
```

Use this exact action description whenever a client or permission surface asks what the tool does:

> Run one authorized Baby Quirt operation through the single authenticated Baby Quirt interface and return its durable result with verified signed evidence.

Do not create, request, rediscover, rename, or wrap separate Baby Quirt tools for files, shells, jobs, PTYs, artifacts, health, discovery, releases, or self-hosting. Those are internal `baby.*` operations submitted through the one authenticated tool.

Only these call fields vary:

- `operation`;
- `payload`;
- `idempotencyKey`.

Canonical call shape:

```json
{
  "operation": "baby.health",
  "payload": {},
  "idempotencyKey": "health-20260723-001"
}
```

## Canonical operating path

For routine VPS, root, production, and recovery work:

1. use `bbyquirt.call_quirt`;
2. call `baby.describe` before guessing capabilities;
3. use the installed `baby.*` operation that directly matches the task;
4. use stock `systemd-nspawn` for isolated build, test, certification, destructive rehearsal, staging, and production-shaped acceptance;
5. use systemd for durable host services, sockets, timers, and recovery controllers;
6. mutate the host directly only when the task is explicitly host-scoped or cannot be proven in isolation;
7. use Termius, manual SSH, browser terminals, or pasted commands only as break glass when Baby is unreachable.

The Fix operator and Fix broker are not prerequisites for Baby-owned work.

## Permission and confirmation behavior

Keeping one tool identity and one broad action description gives ChatGPT's permission system the best opportunity to treat Baby Quirt as one remembered integration instead of many unrelated tools.

The ChatGPT platform controls whether an individual request is shown for confirmation. Baby Quirt cannot guarantee that a sensitive payload will never prompt again. Clients must not attempt to evade platform confirmation.

Once the owner explicitly authorizes a defined production or repository transaction, do not repeatedly ask for routine confirmation inside that scope unless a genuinely new destructive boundary appears.

## Idempotency keys

Use a readable unique idempotency key for each logical action:

```text
<purpose>-<date>-<sequence>
```

Rules:

1. Reuse the same key only when retrying the exact same logical request.
2. The operation and complete payload must remain unchanged when a key is reused.
3. Use a new key whenever the operation or payload changes.
4. Never use one permanent key for unrelated work.
5. Treat `idempotency_conflict` as evidence of incorrect reuse; do not bypass it by silently changing the request.

## Discover before guessing

A fresh conversation should call:

```json
{
  "operation": "baby.describe",
  "payload": {},
  "idempotencyKey": "baby-describe-<date>-001"
}
```

`baby.describe` returns the installed protocol and contract versions, release identity, host identity, limits, operation definitions, input schemas, risk and mutation metadata, and canonical invocation rules.

Installed signed discovery is authoritative. Repository source, documentation, earlier chats, and stale tool catalogs do not override it.

## Durable execution rule

`baby.exec` and `baby.shell` create durable jobs. A returned `jobId` means the work was accepted or started; it does **not** by itself mean the work completed.

Before reporting completion:

1. call `baby.job.wait` or `baby.job.get` until the job is terminal;
2. verify status, exit code, signal, and completion time;
3. read stdout and stderr using `baby.job.stream.read` or the durable stream file paths;
4. perform task-specific post-action readback;
5. retain the request ID, job ID, result digest, receipt ID, receipt verification, and source identity.

Never say a push, test, deployment, service change, file mutation, or validation succeeded while its job is still running or before its direct readback exists.

## Recommended operation patterns

### Health and discovery

Use `baby.describe` for capability discovery and `baby.health` for runtime and host identity.

### Exact executable and arguments

Prefer `baby.exec` when shell parsing is unnecessary:

```json
{
  "operation": "baby.exec",
  "payload": {
    "argv": ["/usr/bin/git", "status", "--short", "--branch"],
    "cwd": "/path/to/repository"
  },
  "idempotencyKey": "repo-status-<date>-001"
}
```

### Shell scripts

Use `baby.shell` for bounded scripts. Keep scripts reviewable and use files or multiple explicit operations instead of one oversized opaque command string.

```json
{
  "operation": "baby.shell",
  "payload": {
    "shell": "/bin/bash",
    "script": "set -Eeuo pipefail\nprintf 'ok\\n'",
    "cwd": "/path/to/workspace"
  },
  "idempotencyKey": "bounded-shell-<date>-001"
}
```

### Jobs and streams

Use:

- `baby.job.get` for current durable state;
- `baby.job.wait` for bounded waiting;
- `baby.job.stream.read` for stdout or stderr by byte offset;
- `baby.job.cancel` for explicit cancellation;
- `baby.job.list` for bounded discovery.

Preserve returned offsets. Do not reread from zero repeatedly unless deliberate.

### Files

Use the installed file operations reported by `baby.describe`, including atomic compare-and-swap replacement when available. Binary data uses base64; text may use UTF-8. Prefer `baby.file.replace` for whole-file changes that require preconditions.

### Interactive PTY

Use `baby.pty.create`, `baby.pty.input`, `baby.pty.resize`, `baby.pty.read`, and `baby.pty.close` for persistent interactive root sessions. Preserve offsets and treat terminal output as raw bytes that may contain ANSI sequences.

### Artifacts

Use `baby.artifact.begin`, chunked `baby.artifact.upload`, and `baby.artifact.finalize` for explicit immutable uploads. A changed payload creates a new artifact.

### Releases and self-hosting

Use the `baby.release.*` and `baby.selfhost.*` operations for coordinated exact-source deployment, staging, verification, activation, rollback, repair, pruning, source materialization, acceptance, and evidence.

Do not replace that durable lifecycle with ad hoc pointer edits. Emergency root repair must be captured into source and deployment evidence afterward.

## systemd-nspawn standard

Use disposable stock systemd-nspawn machines for clean builds and production-shaped validation. When service behavior matters, boot real systemd and verify:

- UID and capability masks;
- namespace and seccomp truth;
- service, socket, and timer lifecycle;
- Unix peer credentials;
- restart and reboot behavior;
- rollback behavior;
- artifact and receipt binding;
- cleanup and proof that the machine stopped.

Record limitations honestly. A sandbox mismatch is evidence, not something to hide.

## Evidence expectations

Before claiming high-impact work completed, retain or report:

- operation;
- request ID;
- idempotency key;
- job, PTY, artifact, or deployment ID;
- terminal status and exit code;
- result digest;
- receipt ID and verification state;
- exact source commit and tree;
- remote branch, pointer, service, or public readback as applicable.

## Fresh-conversation handoff

A new engineering conversation should be told:

1. Use only `bbyquirt.call_quirt` for Baby Quirt.
2. Use the exact canonical action description from this document.
3. Call `baby.describe` before guessing operations or payload fields.
4. Reuse an idempotency key only for an exact retry.
5. Poll every durable job to a terminal state and read its output before reporting completion.
6. Use systemd-nspawn for isolated engineering and certification.
7. Use Baby unrestricted root for host and production work.
8. Treat Termius and manual SSH as break-glass only.
9. Keep production changes reproducible, immutable, guarded, verified, and rollback protected.
