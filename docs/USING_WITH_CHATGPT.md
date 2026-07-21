# Using Baby Quirt from ChatGPT

This document is the canonical instruction for invoking Baby Quirt from ChatGPT, Horsey, or any connected StealthEye engineering conversation.

## One external tool identity

Use exactly one external tool for every Baby Quirt action:

```text
bbyquirt.call_quirt
```

Use this exact action description whenever a client or permission surface asks what the tool does:

> Run any authorized Baby Quirt operation through the single authenticated Baby Quirt interface.

Do not create, request, rediscover, rename, or wrap separate Baby Quirt tools for files, shells, jobs, PTYs, artifacts, health, or discovery. Those are internal `baby.*` operations submitted through the one authenticated tool.

Only these call fields vary:

- `operation`
- `payload`
- `idempotencyKey`

Canonical call shape:

```json
{
  "operation": "baby.health",
  "payload": {},
  "idempotencyKey": "health-20260721-001"
}
```

The outer tool remains `bbyquirt.call_quirt` for every operation.

## Permission and Always Allow behavior

Keeping one tool identity and one broad action description gives ChatGPT's permission system the best opportunity to treat Baby Quirt as one remembered integration instead of many unrelated tools.

The ChatGPT platform controls whether an individual request is shown for confirmation. Baby Quirt cannot guarantee that a sensitive payload will never prompt again. Clients must not attempt to evade platform confirmation. They must instead preserve the stable tool identity and stable action wording above and let the platform apply its policy.

## Idempotency keys

Use a readable, unique idempotency key for each logical action. A recommended form is:

```text
<purpose>-<date>-<sequence>
```

Examples:

```text
checkpoint-d-fetch-20260721-001
checkpoint-d-test-20260721-001
baby-health-20260721-001
```

Rules:

1. Reuse the same key only when retrying the exact same logical request.
2. The operation and complete payload must remain unchanged when a key is reused.
3. Use a new key whenever the operation or payload changes.
4. Never use one permanent key for unrelated work.
5. Treat `idempotency_conflict` as evidence that the key was reused incorrectly; do not bypass it by silently changing the request.

## Discover before guessing

A fresh conversation should call:

```json
{
  "operation": "baby.describe",
  "payload": {},
  "idempotencyKey": "baby-describe-<date>-001"
}
```

`baby.describe` returns the installed protocol and contract versions, release identity, host identity, limits, operation definitions, input schemas, risk and mutation metadata, and these canonical invocation rules.

Do not guess field names. For example, file writes use `data`, not `content`.

## Recommended operation patterns

### Health

```json
{
  "operation": "baby.health",
  "payload": {},
  "idempotencyKey": "baby-health-<date>-001"
}
```

### Exact executable and argv

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

### Shell script

Use `baby.shell` for a bounded script. Keep scripts reasonably small; use files or multiple explicit operations instead of one oversized command string.

```json
{
  "operation": "baby.shell",
  "payload": {
    "shell": "/bin/bash",
    "script": "set -euo pipefail\nprintf 'ok\\n'",
    "cwd": "/path/to/workspace"
  },
  "idempotencyKey": "bounded-shell-<date>-001"
}
```

### Durable jobs

Execution operations return a `jobId`. Use:

- `baby.job.get` for current durable state
- `baby.job.wait` for bounded waiting
- `baby.job.stream.read` for stdout or stderr by byte offset
- `baby.job.cancel` for explicit cancellation
- `baby.job.list` for bounded discovery

Job streams are base64-encoded and offset-addressable. Continue from the returned offset; do not repeatedly reread from zero unless deliberate.

### Files

Use:

- `baby.file.stat`
- `baby.file.read`
- `baby.file.write`
- `baby.file.patch`
- `baby.file.copy`
- `baby.file.move`
- `baby.file.remove`
- `baby.file.list`

Binary data uses base64. Text may use `utf8`. Prefer the compare-and-swap atomic replacement operation when `baby.describe` reports `baby.file.replace`; use legacy whole-file writes only when their overwrite semantics are intentional.

### Interactive PTY

Use:

- `baby.pty.create`
- `baby.pty.input`
- `baby.pty.resize`
- `baby.pty.read`
- `baby.pty.close`

PTY output contains raw terminal bytes and may include ANSI control sequences. It is not sanitized plain text. Always preserve the returned byte offset.

### Artifacts

Use the explicit upload lifecycle when `baby.describe` reports it:

1. `baby.artifact.begin`
2. one or more `baby.artifact.upload` chunks at the required contiguous offsets
3. `baby.artifact.finalize` with expected size and SHA-256
4. `baby.artifact.get`, `baby.artifact.list`, or `baby.artifact.download`

A finalized artifact is immutable. A changed payload is a new artifact, not a mutation of a finalized artifact.

## Evidence expectations

A successful connected call returns durable result data and a supervisor-signed receipt. Before claiming high-impact work completed, retain or report:

- operation
- request ID
- idempotency key
- job, PTY, or artifact ID when applicable
- terminal status and exit code
- result digest
- receipt ID
- receipt verification state
- exact source commit/tree and remote readback for repository changes

Do not claim a commit, push, deployment, service change, artifact, or validation result without direct evidence.

## Fresh-conversation handoff

A new engineering conversation should be told:

1. Use only `bbyquirt.call_quirt` for Baby Quirt.
2. Use the exact canonical action description from this document.
3. Call `baby.describe` before guessing available operations or payload fields.
4. Reuse an idempotency key only for an exact retry.
5. Resume durable jobs, streams, PTYs, and artifacts by their IDs and returned offsets.
6. Keep production activation separate from source development unless deployment is explicitly authorized.

This document governs client invocation wording. Runtime authority, transport, authentication, release, and recovery requirements remain governed by the architecture, security, production, and runbook documents.
