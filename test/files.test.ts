import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileManager } from '../src/files/manager.js';

describe('file manager', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bq-files-'));
  const fm = new FileManager();
  const testFile = join(dir, 'test.txt');

  before(() => {
    writeFileSync(testFile, 'hello world');
  });

  it('stats existing file', () => {
    const stat = fm.stat({ path: testFile });
    assert.equal(stat.exists, true);
    assert.equal(stat.type, 'file');
    assert.equal(stat.size, 11);
    assert.ok(stat.sha256);
  });

  it('reads file with offset', () => {
    const result = fm.read({ path: testFile, offset: 6, encoding: 'utf8' });
    assert.equal(result.data, 'world');
    assert.equal(result.eof, true);
  });

  it('writes and patches file', () => {
    const newFile = join(dir, 'write.txt');
    fm.write({ path: newFile, data: 'AAAA', encoding: 'utf8' });
    fm.patch({
      path: newFile,
      patches: [{ offset: 2, data: 'BB', encoding: 'utf8' }],
    });
    assert.equal(readFileSync(newFile, 'utf8'), 'AABB');
  });

  it('lists directory', () => {
    const result = fm.list({ path: dir });
    assert.ok(result.entries.length >= 2);
  });

  it('copies and removes file', () => {
    const src = join(dir, 'copy-src.txt');
    const dst = join(dir, 'copy-dst.txt');
    writeFileSync(src, 'copy me');
    fm.copy({ source: src, destination: dst });
    assert.equal(readFileSync(dst, 'utf8'), 'copy me');
    fm.remove({ path: dst });
    assert.ok(!existsSync(dst));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});
