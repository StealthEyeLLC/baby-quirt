import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('Universal GitHub Authority Checkpoint C architecture', () => {
  it('uses the existing deployment database for durable Git workspace metadata', () => {
    const database = read('src/deployment/database.ts');
    assert.match(database, /githubGitWorkspaces = new GitWorkspaceRegistry\(this\.database\)/u);
    assert.match(database, /GITHUB_REPOSITORY_TRUTH_MIGRATION/u);
    assert.match(read('src/github/repository-truth.ts'), /CREATE TABLE github_git_workspaces/u);
  });

  it('enforces deterministic protected mirror and worktree roots with exact object and ancestry checks', () => {
    const truth = read('src/github/repository-truth.ts');
    assert.match(truth, /mirrors.*repositoryId/u);
    assert.match(truth, /worktrees.*workspaceId/u);
    assert.match(truth, /isSymbolicLink/u);
    assert.match(truth, /merge-base.*--is-ancestor/u);
    assert.match(truth, /cat-file.*-e/u);
    assert.match(truth, /expectedCommit/u);
    assert.match(truth, /expectedTree/u);
  });

  it('does not add another scheduler, service, socket, database, or public operation advertisement', () => {
    const truth = read('src/github/repository-truth.ts');
    assert.doesNotMatch(truth, /new DatabaseSync|\.service|\.socket|scheduler|call_quirt|tool\.js/u);
    assert.doesNotMatch(read('src/operations/definitions.ts'), /baby\.git\.repository\.materialize/u);
  });
});
