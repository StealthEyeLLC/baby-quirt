import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('Universal GitHub Authority Checkpoint B architecture', () => {
  it('packages the isolated helper at the frozen internal path', () => {
    assert.match(read('scripts/build-bundle.sh'), /libexec\/baby-quirt\/baby-github/u);
    assert.match(read('scripts/create-package-spec.ts'), /libexec\/baby-quirt\/baby-github/u);
    assert.match(read('src/github/credential-execution.ts'), /\/usr\/local\/libexec\/baby-quirt\/baby-github/u);
  });

  it('uses the existing deployment database and does not introduce another scheduler, receipt, artifact, service, or socket lane', () => {
    const database = read('src/deployment/database.ts');
    assert.match(database, /githubAuthorities = new GitHubAuthorityRegistry\(this\.database\)/u);
    for (const path of [
      'src/github/authority-registry.ts',
      'src/github/credential-execution.ts',
      'src/github/helper.ts',
      'src/github/redaction.ts',
    ]) {
      assert.doesNotMatch(path, /\.service$|\.socket$|scheduler|receipt-v3|artifact-store|github-state\.sqlite/u);
    }
  });

  it('keeps runtime operation advertisement contract-only and does not create tool.js', () => {
    const architecture = read('test/github-authority-architecture.test.ts');
    assert.match(architecture, /does not advertise contract-only operations/u);
    assert.doesNotMatch(read('src/github/helper.ts'), /call_quirt|publicTool/u);
  });
});
