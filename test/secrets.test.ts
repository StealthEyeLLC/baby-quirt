import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MapSecretProvider,
  resolveEnvironment,
  toPersistedSecretReference,
} from '../src/secrets/provider.js';
import { redactSecrets } from '../src/crypto/canonical.js';

const CANARY = 'bq-canary-secret-value-7f3a9c2d';

describe('secret references', () => {
  it('resolves references and persists redacted metadata only', async () => {
    const provider = new MapSecretProvider(new Map([['github:test_canary', CANARY]]));
    const resolved = await resolveEnvironment(
      [{ name: 'GH_TOKEN', secretReference: 'github:test_canary' }],
      provider,
    );
    assert.equal(resolved.env.GH_TOKEN, CANARY);
    assert.deepEqual(resolved.persisted, [
      toPersistedSecretReference('GH_TOKEN', 'github:test_canary'),
    ]);
    assert.ok(!JSON.stringify(resolved.persisted).includes(CANARY));
  });

  it('redacts secret-like fields', () => {
    const redacted = redactSecrets({
      environment: [{ name: 'GH_TOKEN', secretReference: 'github:test', redacted: true }],
      token: CANARY,
    });
    const serialized = JSON.stringify(redacted);
    assert.ok(!serialized.includes(CANARY));
    assert.match(serialized, /REDACTED/);
  });
});
