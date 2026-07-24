/** Bounded redaction for Git and GitHub helper output. */

export interface RedactedText {
  text: string;
  originalBytes: number;
  truncated: boolean;
  redacted: boolean;
}

const REDACTION = '[REDACTED]';

export function redactGitHubText(value: string, options: { secretValues?: readonly string[]; maximumBytes?: number } = {}): RedactedText {
  const maximumBytes = options.maximumBytes ?? 65_536;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > 1_048_576) {
    throw new Error('maximumBytes is invalid');
  }
  let text = value;
  const originalBytes = Buffer.byteLength(value, 'utf8');
  const before = text;
  text = text
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu, REDACTION)
    .replace(/\b(?:Authorization\s*:\s*)?Bearer\s+[A-Za-z0-9._~+\/-]+=*/giu, `Bearer ${REDACTION}`)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu, REDACTION)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/giu, `$1${REDACTION}@`)
    .replace(/\/run\/credentials\/[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+/gu, '/run/credentials/[REDACTED]');
  for (const secret of [...(options.secretValues ?? [])].filter((item) => item.length > 0).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join(REDACTION);
  }
  const bytes = Buffer.from(text, 'utf8');
  const truncated = bytes.length > maximumBytes;
  if (truncated) text = bytes.subarray(0, maximumBytes).toString('utf8');
  return { text, originalBytes, truncated, redacted: before !== text || truncated };
}
