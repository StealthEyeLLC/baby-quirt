export function parseLongOptions(argv: readonly string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name?.startsWith('--') || name === '--') throw new Error(`Unexpected argument: ${name ?? ''}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
    if (options.has(name)) throw new Error(`Duplicate option: ${name}`);
    options.set(name, value);
    index += 1;
  }
  return options;
}

export function requiredOption(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name);
  if (value === undefined || value.length === 0) throw new Error(`Required option is missing: ${name}`);
  return value;
}

export function assertExactOptions(
  options: ReadonlyMap<string, string>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const name of options.keys()) {
    if (!allowedSet.has(name)) throw new Error(`Unknown option: ${name}`);
  }
}

export function integerOption(options: ReadonlyMap<string, string>, name: string): number {
  const raw = requiredOption(options, name);
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) throw new Error(`Option must be a non-negative integer: ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`Option is outside the safe integer range: ${name}`);
  return value;
}
