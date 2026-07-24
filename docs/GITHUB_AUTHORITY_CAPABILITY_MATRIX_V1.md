# Universal GitHub Authority v1 capability matrix

Checkpoint A is a normative contract checkpoint. Every operation below is `contract_only` and `executable: false` until a later checkpoint implements and registers it.

| Operation | Owner | Risk | Mutation | Required authority families |
|---|---|---:|:---:|---|
| `baby.git.describe` | Local Git | Low | No | `git.discovery` |
| `baby.git.repository.materialize` | Local Git | Medium | Yes | `git.transport`, `git.repository.write` |
| `baby.git.repository.verify` | Local Git | Low | No | `git.repository.read` |
| `baby.git.repository.status` | Local Git | Low | No | `git.repository.read` |
| `baby.git.fetch` | Local Git | Medium | Yes | `git.transport`, `git.repository.write` |
| `baby.git.branch.create` | Local Git | Medium | Yes | `git.repository.write` |
| `baby.git.commit.create` | Local Git | High | Yes | `git.repository.write`, `git.commit` |
| `baby.git.commit.verify` | Local Git | Low | No | `git.repository.read` |
| `baby.git.push.preview` | Local Git | Low | No | `git.transport`, `git.remote.read` |
| `baby.git.push.apply` | Local Git | High | Yes | `git.transport`, `git.remote.write` |
| `baby.git.push.verify` | Local Git | Low | No | `git.transport`, `git.remote.read` |
| `baby.github.describe` | GitHub provider | Low | No | `github.discovery` |
| `baby.github.auth.status` | GitHub provider | Low | No | `github.auth.read` |
| `baby.github.repo.authority.get` | GitHub provider | Low | No | `github.repository.metadata` |
| `baby.github.repo.authority.list` | GitHub provider | Low | No | `github.repository.metadata` |
| `baby.github.remote.verify` | GitHub provider | Low | No | `github.repository.metadata`, `github.contents.read` |
| `baby.github.pr.upsert` | GitHub provider | High | Yes | `github.pull_requests.write` |
| `baby.github.pr.get` | GitHub provider | Low | No | `github.pull_requests.read` |
| `baby.github.pr.verify` | GitHub provider | Low | No | `github.pull_requests.read`, `github.contents.read` |
| `baby.github.workflow.find` | GitHub provider | Low | No | `github.actions.read` |
| `baby.github.workflow.wait` | GitHub provider | Medium | Yes | `github.actions.read` |
| `baby.github.workflow.get` | GitHub provider | Low | No | `github.actions.read` |
| `baby.github.workflow.logs` | GitHub provider | Medium | Yes | `github.actions.read`, `artifact.write` |
| `baby.github.workflow.artifacts` | GitHub provider | Medium | Yes | `github.actions.read`, `artifact.write` |
| `baby.github.artifact.verify` | GitHub provider | Low | No | `github.actions.read`, `artifact.read` |
| `baby.github.delivery.publish` | Compound | High | Yes | Local Git read/write transport, GitHub repository/PR/Actions read-write, Baby artifact read-write |

## Explicit exclusions

The v1 contract excludes force push without a lease, remote ref deletion, repository deletion or transfer, visibility changes, organization/team/collaborator administration, repository or Actions secret mutation, branch-protection or ruleset mutation, deploy-key rotation/deletion, PR merge, auto-merge, release/package publication, and arbitrary GitHub administration.

## Credential matrix

| Credential type | Intended use | Persistence | Current mission state |
|---|---|---|---|
| Repository-scoped encrypted SSH deploy key | Git transport | Encrypted systemd credential; reference and digest only in durable state | Authorized bootstrap for this repository branch only |
| GitHub App installation credential | GitHub API | Encrypted credential; installation/reference/permission snapshot only in durable state | Source model and nspawn fixture only; no production credential installation |
| Fine-grained token reference | Bounded API fallback | Reference only | Supported by contract, not preferred |
| Commit-signing credential | Optional signed commit creation | Reference only | Used only where configured |
