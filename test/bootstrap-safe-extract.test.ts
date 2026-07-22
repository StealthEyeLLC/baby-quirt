import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

describe('retired v1 bootstrap extractor', () => {
  it('fails closed without parsing or writing an archive', () => {
    const source = readFileSync('scripts/bootstrap-safe-extract.py', 'utf8');
    assert.doesNotMatch(source, /tarfile|extractall|\.extract\(|open\(/u);
    const result = spawnSync(
      'python3',
      ['scripts/bootstrap-safe-extract.py', '/does/not/exist.tar.gz', '/tmp/forbidden', 'prefix'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 64);
    assert.match(result.stderr, /fixed Baby deployment controller/u);
  });
});
