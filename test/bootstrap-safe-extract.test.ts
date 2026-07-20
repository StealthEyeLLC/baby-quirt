import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('bootstrap safe extractor', () => {
  it('extracts a bounded regular-file release and preserves executable mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-bootstrap-extract-'));
    try {
      const source = join(root, 'source');
      const prefix = 'baby-quirt-0.1.1';
      const bin = join(source, prefix, 'bin');
      mkdirSync(bin, { recursive: true });
      const daemon = join(bin, 'baby-quirt-daemon');
      writeFileSync(daemon, '#!/usr/bin/env bash\necho ok\n');
      chmodSync(daemon, 0o755);

      const archive = join(root, 'release.tar.gz');
      execFileSync('tar', ['-czf', archive, '-C', source, prefix]);

      const destination = join(root, 'out');
      const result = spawnSync(
        'python3',
        [join(process.cwd(), 'scripts/bootstrap-safe-extract.py'), archive, destination, prefix],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);

      const extracted = join(destination, prefix, 'bin', 'baby-quirt-daemon');
      assert.equal(readFileSync(extracted, 'utf8'), '#!/usr/bin/env bash\necho ok\n');
      assert.notEqual(statSync(extracted).mode & 0o111, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects symbolic links and removes partial output', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-bootstrap-reject-'));
    try {
      const source = join(root, 'source');
      const prefix = 'baby-quirt-0.1.1';
      mkdirSync(join(source, prefix), { recursive: true });
      symlinkSync('/etc/passwd', join(source, prefix, 'escape'));

      const archive = join(root, 'malicious.tar.gz');
      execFileSync('tar', ['-czf', archive, '-C', source, prefix]);

      const destination = join(root, 'out');
      const result = spawnSync(
        'python3',
        [join(process.cwd(), 'scripts/bootstrap-safe-extract.py'), archive, destination, prefix],
        { encoding: 'utf8' },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /forbidden archive entry type/i);
      assert.equal(existsSync(destination), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
