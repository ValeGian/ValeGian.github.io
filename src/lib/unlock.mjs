/**
 * Works out who is at the keyboard from the password alone.
 *
 * There is no account list and no login endpoint. A password is tried against the files
 * it could plausibly open, and whichever one opens decides the role. The admin keyring is
 * tried first because it is the common case and because opening it grants everything in
 * one step; a friend's password then costs one attempt per remaining file.
 *
 * Each attempt is a PBKDF2 run at 600k iterations, deliberately slow, so the order is
 * what decides how this feels. Measured in Chrome on a ten-core laptop: one derivation
 * 194ms, four in sequence 642ms, four concurrently 804ms — running them in parallel is
 * slower, because WebCrypto serialises PBKDF2 anyway and only adds overhead. So they run
 * in order, cheapest-first for the common case: unlocking as admin costs one derivation,
 * a friend up to three. Expect roughly four times those figures on a 2019 phone.
 */
import { decrypt, decryptWithKey, importFileKey } from './crypto.mjs';

const BASE = '/data/personal';

/** Files a friend password may be tried against. The keyring is handled separately. */
const FRIEND_FILES = ['tommy', 'lotad'];

async function load(name) {
  const response = await fetch(`${BASE}/${name}.enc`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load ${name}.enc (${response.status})`);
  return response.json();
}

/**
 * @returns {Promise<null | {role: 'admin', files: Record<string, unknown>} | {role: 'friend', owner: string, list: unknown}>}
 */
export async function unlock(password) {
  const keyring = await decrypt(password, await load('keyring'));

  if (keyring) {
    const files = {};
    for (const [name, rawKey] of Object.entries(keyring.payload)) {
      const key = await importFileKey(rawKey);
      files[name] = await decryptWithKey(key, await load(name));
    }
    return { role: 'admin', files };
  }

  for (const owner of FRIEND_FILES) {
    const opened = await decrypt(password, await load(owner));
    if (opened) return { role: 'friend', owner, list: opened.payload };
  }

  return null;
}
