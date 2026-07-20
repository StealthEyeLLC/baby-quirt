/** Protocol helper utilities for acceptance tests. */

import type { BabyQuirtTestClient } from '../../test/helpers/client.js';

export async function writeFile(
  client: BabyQuirtTestClient,
  path: string,
  content: string,
): Promise<void> {
  await client.request('baby.file.write', {
    path,
    data: Buffer.from(content).toString('base64'),
    encoding: 'base64',
  });
}

export async function readFile(client: BabyQuirtTestClient, path: string): Promise<string> {
  const response = await client.request('baby.file.read', { path, encoding: 'utf8' });
  return (response.result as { data: string }).data;
}

export async function shellWait(
  client: BabyQuirtTestClient,
  script: string,
  cwd: string,
  timeoutMs = 300_000,
): Promise<{ stdout: string; stderr: string; jobId: string }> {
  const started = await client.request('baby.shell', { script, cwd });
  const jobId = (started.result as { jobId: string }).jobId;
  const completed = await client.request('baby.job.wait', { jobId, timeoutMs });
  const status = (completed.result as { status: string }).status;
  if (!['completed', 'cancelled', 'detached', 'adopted'].includes(status)) {
    throw new Error(`shell failed with status ${status}`);
  }

  const stdout = await readStream(client, jobId, 'stdout');
  const stderr = await readStream(client, jobId, 'stderr');
  return { stdout, stderr, jobId };
}

export async function readStream(
  client: BabyQuirtTestClient,
  jobId: string,
  stream: 'stdout' | 'stderr',
  offset = 0,
): Promise<string> {
  let pos = offset;
  const chunks: string[] = [];
  while (true) {
    const part = await client.request('baby.job.stream.read', { jobId, stream, offset: pos });
    const result = part.result as { data: string; offset: number; eof: boolean };
    const previousPos = pos;
    if (result.data) {
      chunks.push(Buffer.from(result.data, 'base64').toString('utf8'));
    }
    pos = result.offset;
    if (result.eof) break;
    if (!result.data && result.offset === previousPos) break;
  }
  return chunks.join('');
}

export function assertNoSecretLeak(serialized: string, secret: string, label: string): void {
  if (serialized.includes(secret)) {
    throw new Error(`secret leaked in ${label}`);
  }
}
