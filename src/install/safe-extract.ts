/** One strict extraction implementation, shared with bootstrap and packaged verification. */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULTS } from '../config.js';
import { RELEASE_VERSION_PATTERN } from '../release/contracts.js';

const execFileAsync = promisify(execFile);

export function assertSafeVersion(version: string): void {
  if (!RELEASE_VERSION_PATTERN.test(version)) throw new Error(`Invalid release version: ${version}`);
}

export interface SafeExtractOptions {
  maxArchiveBytes?: number;
  maxFileBytes?: number;
  maxDecompressedBytes?: number;
  maxMembers?: number;
  extractorPath?: string;
}

function extractorPath(override?: string): string {
  const candidates = [
    override,
    process.env.BABY_QUIRT_STRICT_EXTRACTOR,
    resolve(process.cwd(), 'scripts/bootstrap-safe-extract.py'),
    resolve(import.meta.dirname, '../../../libexec/bootstrap-safe-extract.py'),
  ].filter((value): value is string => value !== undefined && value.length > 0);
  const match = candidates.find((candidate) => existsSync(candidate));
  if (match === undefined) throw new Error('Strict release extractor is unavailable');
  return match;
}

export async function safeExtractTarGz(
  archivePath: string,
  destRoot: string,
  expectedPrefix: string,
  options: SafeExtractOptions = {},
): Promise<string> {
  const env = {
    ...process.env,
    BABY_QUIRT_MAX_ARCHIVE_BYTES: String(options.maxArchiveBytes ?? DEFAULTS.maxArchiveBytes),
    BABY_QUIRT_MAX_ARCHIVE_FILE_BYTES: String(options.maxFileBytes ?? DEFAULTS.maxArchiveFileBytes),
    BABY_QUIRT_MAX_DECOMPRESSED_BYTES: String(options.maxDecompressedBytes ?? DEFAULTS.maxArchiveBytes),
    BABY_QUIRT_MAX_ARCHIVE_MEMBERS: String(options.maxMembers ?? 20_000),
  };
  try {
    await execFileAsync(
      'python3',
      [extractorPath(options.extractorPath), archivePath, destRoot, expectedPrefix],
      { env, timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    const detail = error as { stderr?: string; message?: string };
    throw new Error((detail.stderr ?? detail.message ?? 'Strict release extraction failed').trim());
  }
  return resolve(destRoot, expectedPrefix);
}
