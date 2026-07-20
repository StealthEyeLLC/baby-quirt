import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { safeExtractTarGz } from '../src/install/safe-extract.js';

describe('safe archive extraction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bq-safe-'));

  it('extracts a valid archive', async () => {
    const source = mkdtempSync(join(tmpdir(), 'bq-src-'));
    const prefix = 'baby-quirt-test';
    const root = join(source, prefix);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'hello.txt'), 'hello');
    const archive = join(dir, 'good.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', source, prefix]);
    const dest = mkdtempSync(join(tmpdir(), 'bq-dest-'));
    await safeExtractTarGz(archive, dest, prefix);
    assert.equal(readFileSync(join(dest, 'hello.txt'), 'utf8'), 'hello');
    rmSync(dest, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  });

  it('rejects traversal entries', async () => {
    const source = mkdtempSync(join(tmpdir(), 'bq-evil-'));
    writeFileSync(join(source, 'escape.txt'), 'x');
    const archive = join(dir, 'evil.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', source, '--transform', 's,^,../,', 'escape.txt']);
    await assert.rejects(
      () => safeExtractTarGz(archive, mkdtempSync(join(tmpdir(), 'bq-bad-')), 'prefix'),
      /Unsafe|outside|traversal|Forbidden/,
    );
    rmSync(source, { recursive: true, force: true });
  });
});
