/** Contract validation script. */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATIONS } from '../src/operations/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function main(): void {
  const contractPath = join(root, 'contracts', 'baby-quirt-contracts-v1.json');
  const schemaPath = join(root, 'schemas', 'baby-quirt-protocol-v1.schema.json');

  if (!existsSync(contractPath)) {
    console.error('Contract bundle not found');
    process.exit(1);
  }
  if (!existsSync(schemaPath)) {
    console.error('Protocol schema not found');
    process.exit(1);
  }

  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

  const contractOps = contract.operations.map((o: { operation: string }) => o.operation);
  const missing = OPERATIONS.filter((op) => !contractOps.includes(op));
  const extra = contractOps.filter((op: string) => !OPERATIONS.includes(op as never));

  if (missing.length > 0) {
    console.error('Operations in registry but not in contract:', missing);
    process.exit(1);
  }
  if (extra.length > 0) {
    console.error('Operations in contract but not in registry:', extra);
    process.exit(1);
  }

  console.log(`Contract validation passed: ${contractOps.length} operations, schema v${schema.title}`);
}

main();
