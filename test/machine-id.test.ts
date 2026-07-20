import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('machine identity', () => {
  it('hashes raw machine-id bytes without trimming', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bq-mid-'));
    const path = join(dir, 'machine-id');
    const raw = Buffer.from('abc\n');
    writeFileSync(path, raw);
    const expected = createHash('sha256').update(raw).digest('hex');
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
    assert.equal(hash, expected);
    assert.notEqual(hash, createHash('sha256').update('abc').digest('hex'));
    rmSync(dir, { recursive: true, force: true });
  });
});
