/**
 * Keys must survive a rewrite, or every past revision becomes unreadable and the audit
 * trail is worthless. Git keeps those revisions forever, so this cannot be fixed later.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, decryptWithKey, exportFileKey, resealPayload } from '../src/lib/crypto.mjs';

test('re-encrypting with the same key keeps every older revision readable', async () => {
  const first = await encrypt('cvalgian', { items: ['a'] });
  const second = await encrypt('cvalgian', { items: ['a', 'b'] }, first.key);

  assert.equal(await exportFileKey(second.key), await exportFileKey(first.key));

  const keyringKey = await decryptWithKey(second.key, first.envelope);
  assert.deepEqual(keyringKey, { items: ['a'] }, 'the key from today opens what was written yesterday');
});

test('re-encrypting without passing the key issues a new one, which orphans the past', async () => {
  const first = await encrypt('cvalgian', { items: ['a'] });
  const second = await encrypt('cvalgian', { items: ['a', 'b'] });

  assert.notEqual(await exportFileKey(second.key), await exportFileKey(first.key));
  assert.equal(
    await decryptWithKey(second.key, first.envelope),
    null,
    'this is the failure the key reuse in encrypt-personal.mjs exists to prevent',
  );
});

test('resealing keeps the wrapping, so saving never needs the password', async () => {
  const { envelope, key } = await encrypt('cvalgian', { items: [] });
  const next = await resealPayload(envelope, key, { items: ['added'] });

  assert.equal(next.kdf.salt, envelope.kdf.salt);
  assert.equal(next.wrapped.data, envelope.wrapped.data);
  assert.notEqual(next.payload.iv, envelope.payload.iv, 'a fresh nonce every write');
  assert.deepEqual((await decrypt('cvalgian', next))?.payload, { items: ['added'] });
});
