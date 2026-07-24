export const G3_COVERAGE_LEDGER_VERSION = '1.0.0' as const;

export const G3_COVERAGE_STATUSES = [
  'contract_only',
  'partially_implemented',
  'implemented_but_not_registered',
  'executable_and_tested',
  'intentionally_deferred',
  'unavailable_missing_production_provider_credential',
  'not_applicable',
] as const;

export type G3CoverageStatus = (typeof G3_COVERAGE_STATUSES)[number];

export const G3_CAPABILITY_GROUPS = {
  '6.1 Discovery and repository lifecycle': [
    'baby.git.describe', 'baby.git.version.get', 'baby.git.repository.init', 'baby.git.repository.clone',
    'baby.git.repository.open', 'baby.git.repository.get', 'baby.git.repository.list',
    'baby.git.repository.close', 'baby.git.repository.verify',
  ],
  '6.2 Mirrors, acquisition, and materialization': [
    'baby.git.mirror.create', 'baby.git.mirror.update', 'baby.git.mirror.verify', 'baby.git.mirror.list',
    'baby.git.materialize', 'baby.git.fetch', 'baby.git.pull.preview', 'baby.git.pull.apply',
    'baby.git.checkout', 'baby.git.switch', 'baby.git.sparse.set', 'baby.git.partial.configure',
    'baby.git.shallow.deepen', 'baby.git.unshallow',
  ],
  '6.3 Remotes and credentials': [
    'baby.git.remote.list', 'baby.git.remote.get', 'baby.git.remote.add', 'baby.git.remote.update',
    'baby.git.remote.remove', 'baby.git.remote.rename', 'baby.git.remote.prune', 'baby.git.remote.refs',
    'baby.git.credential.status', 'baby.git.credential.bind', 'baby.git.credential.unbind',
  ],
  '6.4 Object and history inspection': [
    'baby.git.object.get', 'baby.git.object.verify', 'baby.git.commit.get', 'baby.git.commit.list',
    'baby.git.tree.get', 'baby.git.tree.list', 'baby.git.blob.get', 'baby.git.log', 'baby.git.show',
    'baby.git.name_rev', 'baby.git.describe.ref', 'baby.git.ancestry.verify', 'baby.git.merge_base',
    'baby.git.rev_parse', 'baby.git.cat_file',
  ],
  '6.5 Status, diff, staging, and working tree': [
    'baby.git.status', 'baby.git.diff', 'baby.git.diff.stat', 'baby.git.diff.name_status', 'baby.git.add',
    'baby.git.add.patch', 'baby.git.restore.staged', 'baby.git.restore.worktree', 'baby.git.clean.preview',
    'baby.git.clean.apply', 'baby.git.rm', 'baby.git.mv', 'baby.git.ignore.check', 'baby.git.attributes.check',
  ],
  '6.6 Commits and signatures': [
    'baby.git.commit.create', 'baby.git.commit.amend', 'baby.git.commit.verify', 'baby.git.commit.sign',
    'baby.git.commit.signature.verify', 'baby.git.commit.message.validate', 'baby.git.commit.fixup',
    'baby.git.commit.squash.prepare',
  ],
  '6.7 Branches and refs': [
    'baby.git.branch.list', 'baby.git.branch.get', 'baby.git.branch.create', 'baby.git.branch.rename',
    'baby.git.branch.delete', 'baby.git.branch.set_upstream', 'baby.git.branch.unset_upstream',
    'baby.git.branch.divergence', 'baby.git.ref.get', 'baby.git.ref.list', 'baby.git.ref.update',
    'baby.git.ref.delete', 'baby.git.ref.verify',
  ],
  '6.8 Worktrees': [
    'baby.git.worktree.create', 'baby.git.worktree.list', 'baby.git.worktree.get', 'baby.git.worktree.lock',
    'baby.git.worktree.unlock', 'baby.git.worktree.move', 'baby.git.worktree.repair',
    'baby.git.worktree.prune', 'baby.git.worktree.remove',
  ],
  '6.9 Merge and conflicts': [
    'baby.git.merge.preview', 'baby.git.merge.start', 'baby.git.merge.status', 'baby.git.merge.continue',
    'baby.git.merge.abort', 'baby.git.conflict.list', 'baby.git.conflict.get', 'baby.git.conflict.resolve',
    'baby.git.mergetool.run', 'baby.git.rerere.status', 'baby.git.rerere.forget',
  ],
  '6.10 Rebase': [
    'baby.git.rebase.preview', 'baby.git.rebase.start', 'baby.git.rebase.status', 'baby.git.rebase.continue',
    'baby.git.rebase.skip', 'baby.git.rebase.abort', 'baby.git.rebase.edit_todo',
  ],
  '6.11 Cherry-pick, revert, reset, and restore': [
    'baby.git.cherry_pick.preview', 'baby.git.cherry_pick.start', 'baby.git.cherry_pick.continue',
    'baby.git.cherry_pick.abort', 'baby.git.revert.preview', 'baby.git.revert.start',
    'baby.git.revert.continue', 'baby.git.revert.abort', 'baby.git.reset.preview', 'baby.git.reset.apply',
  ],
  '6.12 Tags': [
    'baby.git.tag.list', 'baby.git.tag.get', 'baby.git.tag.create', 'baby.git.tag.sign',
    'baby.git.tag.verify', 'baby.git.tag.delete',
  ],
  '6.13 Push and remote mutation': [
    'baby.git.push.preview', 'baby.git.push.apply', 'baby.git.push.verify', 'baby.git.push.tags',
    'baby.git.remote_ref.delete', 'baby.git.force_with_lease.preview', 'baby.git.force_with_lease.apply',
  ],
  '6.14 Submodules, subtrees, and LFS': [
    'baby.git.submodule.list', 'baby.git.submodule.add', 'baby.git.submodule.sync',
    'baby.git.submodule.update', 'baby.git.submodule.deinit', 'baby.git.submodule.remove',
    'baby.git.subtree.add', 'baby.git.subtree.pull', 'baby.git.subtree.push', 'baby.git.lfs.status',
    'baby.git.lfs.fetch', 'baby.git.lfs.pull', 'baby.git.lfs.push', 'baby.git.lfs.track',
    'baby.git.lfs.untrack', 'baby.git.lfs.locks',
  ],
  '6.15 Patch, mail, bundle, and archive': [
    'baby.git.patch.create', 'baby.git.patch.apply', 'baby.git.patch.check', 'baby.git.format_patch',
    'baby.git.am.start', 'baby.git.am.continue', 'baby.git.am.skip', 'baby.git.am.abort',
    'baby.git.bundle.create', 'baby.git.bundle.verify', 'baby.git.bundle.unbundle', 'baby.git.archive.create',
  ],
  '6.16 Diagnostics and maintenance': [
    'baby.git.bisect.start', 'baby.git.bisect.good', 'baby.git.bisect.bad', 'baby.git.bisect.run',
    'baby.git.bisect.reset', 'baby.git.blame', 'baby.git.reflog.list', 'baby.git.reflog.expire.preview',
    'baby.git.reflog.expire.apply', 'baby.git.notes.list', 'baby.git.notes.add', 'baby.git.notes.remove',
    'baby.git.fsck', 'baby.git.gc.preview', 'baby.git.gc.run', 'baby.git.maintenance.status',
    'baby.git.maintenance.run', 'baby.git.count_objects', 'baby.git.verify_pack',
  ],
  '6.17 Hooks, config, and policy': [
    'baby.git.hook.list', 'baby.git.hook.inspect', 'baby.git.hook.install', 'baby.git.hook.remove',
    'baby.git.config.get', 'baby.git.config.list', 'baby.git.config.set', 'baby.git.config.unset',
    'baby.git.policy.validate',
  ],
} as const;

const implementedEvidence: Readonly<Record<string, string>> = {
  'baby.git.repository.verify': 'GitRepositoryTruth.verify and deterministic repository-truth fixtures',
  'baby.git.fetch': 'GitRepositoryTruth.fetch and exact-ref fixture coverage',
  'baby.git.status': 'GitRepositoryTruth.status with structured sequencer, paths, bounded summary, and digest',
  'baby.git.diff': 'GitRepositoryTruth.diff with bounded patch and full-content digest',
  'baby.git.diff.stat': 'GitRepositoryTruth.diffStat with structured numstat readback',
  'baby.git.diff.name_status': 'GitRepositoryTruth.diffNameStatus with structured path status',
  'baby.git.add': 'GitRepositoryTruth.add with exact HEAD and status-digest preconditions',
  'baby.git.ignore.check': 'GitRepositoryTruth.checkIgnore with structured provenance',
  'baby.git.attributes.check': 'GitRepositoryTruth.checkAttributes with structured values',
  'baby.git.commit.create': 'GitRepositoryTruth.createCommit with declared paths and explicit identities',
  'baby.git.commit.verify': 'GitRepositoryTruth.verifyCommit with exact commit, tree, parent, path, identity, and signature status',
  'baby.git.branch.create': 'GitRepositoryTruth.createBranch with clean-worktree and exact object preconditions',
  'baby.git.push.preview': 'GitSafePublication.preview with exact local and remote state',
  'baby.git.push.apply': 'GitSafePublication.apply with durable intent, exact lease, and reconciliation',
  'baby.git.push.verify': 'GitSafePublication.verify with Git transport and API readback truth',
};

const partialEvidence: Readonly<Record<string, string>> = {
  'baby.git.materialize': 'Implemented as frozen compatibility operation baby.git.repository.materialize',
  'baby.git.remote.refs': 'Exact remote refs are observed through fetch and safe-publication readback, without a dedicated operation',
  'baby.git.credential.status': 'Credential metadata and health are persisted in the authority registry, without a dedicated local-Git operation',
  'baby.git.credential.bind': 'Metadata-only enrollment and repository authority binding exist, without a dedicated local-Git operation',
  'baby.git.credential.unbind': 'Revocation exists in the authority registry, without a dedicated local-Git operation',
  'baby.git.object.verify': 'Repository verification proves object availability, without a dedicated object operation',
  'baby.git.ancestry.verify': 'Repository and publication verification prove ancestry, without a dedicated operation',
  'baby.git.ref.verify': 'Safe publication verifies exact destination refs, without a dedicated local-ref operation',
  'baby.git.commit.signature.verify': 'Commit evidence reports verified, unsigned, or not_configured; configured signing provider is not yet implemented',
  'baby.git.force_with_lease.preview': 'Push planning binds the exact observed old object; dedicated force-with-lease operation remains absent',
  'baby.git.force_with_lease.apply': 'Push transport uses an exact lease and forbids unconstrained force; dedicated operation remains absent',
};

const contractOnly = new Set<string>(['baby.git.describe']);

export interface G3CapabilityCoverageEntry {
  group: keyof typeof G3_CAPABILITY_GROUPS;
  operation: string;
  status: G3CoverageStatus;
  evidence: string;
  registered: boolean;
  deployed: boolean;
}

export const G3_CAPABILITY_COVERAGE: readonly G3CapabilityCoverageEntry[] = Object.entries(
  G3_CAPABILITY_GROUPS,
).flatMap(([group, operations]) => operations.map((operation): G3CapabilityCoverageEntry => {
  if (implementedEvidence[operation]) {
    return {
      group: group as keyof typeof G3_CAPABILITY_GROUPS,
      operation,
      status: 'implemented_but_not_registered',
      evidence: implementedEvidence[operation],
      registered: false,
      deployed: false,
    };
  }
  if (partialEvidence[operation]) {
    return {
      group: group as keyof typeof G3_CAPABILITY_GROUPS,
      operation,
      status: 'partially_implemented',
      evidence: partialEvidence[operation],
      registered: false,
      deployed: false,
    };
  }
  if (contractOnly.has(operation)) {
    return {
      group: group as keyof typeof G3_CAPABILITY_GROUPS,
      operation,
      status: 'contract_only',
      evidence: 'Frozen discovery semantics exist; broad G3 support is not advertised or registered',
      registered: false,
      deployed: false,
    };
  }
  return {
    group: group as keyof typeof G3_CAPABILITY_GROUPS,
    operation,
    status: 'intentionally_deferred',
    evidence: 'Not included in this smallest coherent G3 source checkpoint',
    registered: false,
    deployed: false,
  };
}));

const statusCounts = Object.fromEntries(G3_COVERAGE_STATUSES.map((status) => [
  status,
  G3_CAPABILITY_COVERAGE.filter((entry) => entry.status === status).length,
]));

export const G3_CAPABILITY_COVERAGE_BUNDLE = {
  schemaVersion: G3_COVERAGE_LEDGER_VERSION,
  controllingCatalog: 'Baby Quirt Git and GitHub Maximum-Capability Plan section 6.1-6.17',
  checkpointBase: '96b06ced72e0f35cb7df9614e441f37c6c370441',
  scope: 'G3 local Git mutation and history capability coverage',
  publicToolChanged: false,
  toolJsChanged: false,
  providerDeployed: false,
  productionCredentialRequiredForThisCheckpoint: false,
  complete: false,
  operationCount: G3_CAPABILITY_COVERAGE.length,
  statusCounts,
  entries: G3_CAPABILITY_COVERAGE,
} as const;
