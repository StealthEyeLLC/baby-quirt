import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

describe('Universal GitHub Authority Checkpoint D architecture', () => {
  it('uses the existing Baby deployment database for immutable plans, durable intents, status, and events', () => {
    const database = read('src/deployment/database.ts');
    const publication = read('src/github/safe-publication.ts');
    assert.match(database, /githubSafePublications = new GitSafePublicationRegistry\(this\.database\)/u);
    assert.match(database, /GITHUB_SAFE_PUBLICATION_MIGRATION/u);
    assert.match(publication, /CREATE TABLE github_git_push_plans/u);
    assert.match(publication, /CREATE TABLE github_git_push_runs/u);
    assert.match(publication, /CREATE TABLE github_git_push_events/u);
    assert.doesNotMatch(publication, /new DatabaseSync/u);
  });

  it('persists intent before external mutation and uses exact precondition, fast-forward proof, CAS lease, and dual readback', () => {
    const publication = read('src/github/safe-publication.ts');
    assert.ok(publication.indexOf('reserveRun({') < publication.indexOf('transport.push({'));
    assert.match(publication, /merge-base.*--is-ancestor/u);
    assert.match(publication, /forceWithLease/u);
    assert.match(publication, /expectedOldObject/u);
    assert.match(publication, /response-lost-reconciled/u);
    assert.match(publication, /apiReadback\.verifyRemote/u);
    assert.match(publication, /git_api_disagreement/u);
  });

  it('binds encrypted credentials to the protected workspace and adds no force-push, delete, merge, service, socket, or public operation advertisement', () => {
    const credential = read('src/github/credential-execution.ts');
    const publication = read('src/github/safe-publication.ts');
    assert.match(credential, /WorkingDirectory=/u);
    assert.match(credential, /LoadCredentialEncrypted=/u);
    assert.doesNotMatch(publication, /--force(?!-with-lease)|branch delete|pull request merge|\.service|\.socket|scheduler|call_quirt|tool\.js/iu);
    assert.doesNotMatch(read('src/operations/definitions.ts'), /baby\.git\.push\.(?:preview|apply|verify)/u);
  });
});
