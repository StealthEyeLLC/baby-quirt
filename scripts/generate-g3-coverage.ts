import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { G3_CAPABILITY_COVERAGE_BUNDLE } from '../src/github/g3-capability-catalog.js';

const output = join(import.meta.dirname, '..', 'contracts', 'github-authority-g3-coverage-v1.json');
writeFileSync(output, `${JSON.stringify(G3_CAPABILITY_COVERAGE_BUNDLE, null, 2)}\n`, 'utf8');
