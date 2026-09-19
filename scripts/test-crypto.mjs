/**
 * Encryption tests.
 *
 * These check the property the whole design rests on: a friend's password opens exactly
 * one file and nothing else. Everything the site does about privacy is a consequence of
 * that, so it is asserted against the real files rather than a fixture.
 *
 * They also check that the read-only keyring, when one exists, carries the same keys as
 * the admin keyring. It is wrapped separately, so a reissued key can leave it opening an
 * older version of a file — which would show up as a reader quietly seeing stale data
 * rather than as any kind of error.
 *
 *   PERSONAL_PASSWORD_ADMIN=… node scripts/test-crypto.mjs
 *   node scripts/test-crypto.mjs --self
 *
 * `--self` builds a throwaway vault with known passwords and asserts the same
 * properties, so continuous integration can catch a regression without ever holding a
 * real password or a real file.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { encrypt, decrypt, decryptWithKey, exportFileKey, importFileKey, toBase64 } from '../src/lib/crypto.mjs';

const DIR = 'public/data/personal';
const FILES = ['collection', 'valerio', 'tommy', 'lotad', 'keyring'];

const { values: options } = parseArgs({ options: { self: { type: 'boolean', default: false } } });

/** The shape the assertions below rely on, built from scratch so CI needs no secrets. */
async function buildThrowawayVault() {
  const owners = { collection: 'test-admin', valerio: 'test-admin', tommy: 'tommy', lotad: 'lotad' };
  const contents = {
    collection: { version: 1, items: [{ id: 'itm_0001', nameJa: 'ギラティナVSTAR', purchase: { amountEur: 140 } }] },
    valerio: { owner: 'Valerio', items: [] },
    tommy: { owner: 'Tommy', items: [] },
    lotad: { owner: 'Lotad', items: [] },
  };

  const envelopes = {};
  const keyring = {};
  for (const [name, password] of Object.entries(owners)) {
    const { envelope, key } = await encrypt(password, contents[name]);
    envelopes[name] = envelope;
    keyring[name] = await exportFileKey(key);
  }
  envelopes.keyring = (await encrypt('test-admin', keyring)).envelope;
  envelopes['viewer-keyring'] = (await encrypt('test-viewer', keyring)).envelope;
  return { envelopes, admin: 'test-admin', viewer: 'test-viewer', collection: contents.collection };
}

/** Returns null rather than throwing: the read-only account is optional. */
async function readIfPresent(name) {
  try {
    return JSON.parse(await readFile(`${DIR}/${name}.enc`, 'utf8'));
  } catch {
    return null;
  }
}

let admin;
let viewer;
let envelopes;
let collection;

if (options.self) {
  ({ envelopes, admin, viewer, collection } = await buildThrowawayVault());
} else {
  admin = process.env.PERSONAL_PASSWORD_ADMIN;
  if (!admin) throw new Error('PERSONAL_PASSWORD_ADMIN is required, or pass --self');
  viewer = process.env.PERSONAL_PASSWORD_VIEWER ?? null;
  envelopes = Object.fromEntries(
    await Promise.all(FILES.map(async (name) => [name, JSON.parse(await readFile(`${DIR}/${name}.enc`, 'utf8'))])),
  );
  envelopes['viewer-keyring'] = await readIfPresent('viewer-keyring');
  collection = JSON.parse(await readFile('.local/collection.json', 'utf8'));
}

let failures = 0;
const check = (passed, description) => {
  if (passed) {
    console.log(`  ok    ${description}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${description}`);
  }
};

// The admin password opens the keyring, and the keyring opens everything else.
const keyring = await decrypt(admin, envelopes.keyring);
check(keyring !== null, 'the admin password opens the keyring');

for (const name of ['collection', 'valerio', 'tommy', 'lotad']) {
  const key = await importFileKey(keyring.payload[name]);
  check((await decryptWithKey(key, envelopes[name])) !== null, `the keyring opens ${name}.enc`);
}

// The read-only account reads everything and is a separate password from the admin one.
// Skipped when there is no such account, or when its password was not supplied.
if (envelopes['viewer-keyring'] && viewer) {
  const viewerKeyring = await decrypt(viewer, envelopes['viewer-keyring']);
  check(viewerKeyring !== null, 'the read-only password opens the read-only keyring');

  check(
    JSON.stringify(viewerKeyring?.payload) === JSON.stringify(keyring.payload),
    'the read-only keyring carries exactly the keys the admin keyring carries',
  );

  for (const name of ['collection', 'valerio', 'tommy', 'lotad', 'keyring']) {
    check((await decrypt(viewer, envelopes[name])) === null, `the read-only password does NOT open ${name}.enc`);
  }

  check(
    (await decrypt(admin, envelopes['viewer-keyring'])) === null,
    'the read-only keyring is a distinct password from the admin one',
  );
} else {
  console.log('  skip  read-only account (none configured)');
}

// A friend's password opens their own file.
check((await decrypt('tommy', envelopes.tommy)) !== null, "Tommy's password opens tommy.enc");
check((await decrypt('lotad', envelopes.lotad)) !== null, "Lotad's password opens lotad.enc");

// And nothing else. This is the property the design rests on.
for (const name of ['collection', 'valerio', 'lotad', 'keyring']) {
  check((await decrypt('tommy', envelopes[name])) === null, `Tommy's password does NOT open ${name}.enc`);
}
for (const name of ['collection', 'valerio', 'tommy', 'keyring']) {
  check((await decrypt('lotad', envelopes[name])) === null, `Lotad's password does NOT open ${name}.enc`);
}

// A near-miss password is rejected, and rejection is a null rather than a throw.
check((await decrypt(`${admin} `, envelopes.keyring)) === null, 'a password with a trailing space is rejected');
check((await decrypt(admin.toUpperCase(), envelopes.keyring)) === null, 'the password is case sensitive');

// Tampering must be detected, not silently decrypted into something else.
const tamperedPayload = structuredClone(envelopes.tommy);
const bytes = Uint8Array.from(atob(tamperedPayload.payload.data), (c) => c.charCodeAt(0));
bytes[0] ^= 0xff;
tamperedPayload.payload.data = toBase64(bytes);
check((await decrypt('tommy', tamperedPayload)) === null, 'a flipped byte in the payload is detected');

const tamperedSalt = structuredClone(envelopes.tommy);
tamperedSalt.kdf.salt = toBase64(new Uint8Array(16));
check((await decrypt('tommy', tamperedSalt)) === null, 'a replaced salt is detected');

let threw = false;
try {
  await decrypt('tommy', { ...envelopes.tommy, v: 2 });
} catch {
  threw = true;
}
check(threw, 'an unknown envelope version throws rather than failing quietly');

// Identical input must not produce identical output, or repeated saves would leak that
// nothing changed.
const first = await encrypt('same', { a: 1 });
const second = await encrypt('same', { a: 1 });
check(first.envelope.payload.data !== second.envelope.payload.data, 'the same payload encrypts differently each time');
check(first.envelope.kdf.salt !== second.envelope.kdf.salt, 'each file gets a fresh salt');

// Nothing recognisable may survive into the envelope.
const serialised = JSON.stringify(envelopes.collection);
const needles = ['itm_0001', 'amountEur', 'ギラティナ', String(collection.items[0].purchase.amountEur)];
check(
  needles.every((needle) => !serialised.includes(needle)),
  'no field name, card name or amount appears in the ciphertext',
);

// The round trip must be lossless, or the migration quietly loses data.
const opened = await decryptWithKey(await importFileKey(keyring.payload.collection), envelopes.collection);
check(JSON.stringify(opened) === JSON.stringify(collection), 'collection.enc decrypts back to exactly the source file');

if (failures > 0) {
  console.error(`\n${failures} encryption test(s) failed`);
  process.exit(1);
}
console.log('\nall encryption tests passed');
