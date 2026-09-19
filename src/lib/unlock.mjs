/**
 * Works out who is at the keyboard from the password alone.
 *
 * There is no account list and no login endpoint. A password is tried against the files
 * it could plausibly open, and whichever one opens decides the role. The keyrings are
 * tried first because they are the common case and because opening one grants everything
 * in a single step; a friend's password then costs one attempt per remaining file.
 *
 * Each attempt is a PBKDF2 run at 600k iterations, deliberately slow, so the order is
 * what decides how this feels. Measured in Chrome on a ten-core laptop: one derivation
 * 194ms, four in sequence 642ms, four concurrently 804ms — running them in parallel is
 * slower, because WebCrypto serialises PBKDF2 anyway and only adds overhead. So they run
 * in order, cheapest-first for the common case: unlocking as admin costs one derivation,
 * a viewer two, a friend up to four. Expect roughly four times those figures on a 2019 phone.
 *
 * The file keys and the original envelopes come back with the contents, because saving
 * reseals a payload under the key it already holds and must never need the password
 * again. That is also what lets `resume` reopen a vault from keys a reload kept, with no
 * password and no PBKDF2 at all.
 */
import { decrypt, decryptWithKey, importFileKey } from './crypto.mjs';

const BASE = '/data/personal';

/** Files a friend password may be tried against. The keyrings are handled separately. */
const FRIEND_FILES = ['tommy', 'lotad'];

/**
 * The two keyrings, in the order they are tried.
 *
 * Both hold the same file keys, so both read everything; they differ only in the role
 * they report. Writing is not a matter of role at all — publishing needs a GitHub token,
 * which only the owner's device has — so the viewer keyring hands out reading and has no
 * way to hand out anything else.
 */
const KEYRINGS = [
  { file: 'keyring', role: 'admin' },
  { file: 'viewer-keyring', role: 'viewer' },
];

async function load(name) {
  const response = await fetch(`${BASE}/${name}.enc`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load ${name}.enc (${response.status})`);
  return response.json();
}

/** Missing is not an error: a viewer keyring only exists once a password has been set. */
async function loadIfPresent(name) {
  try {
    return await load(name);
  } catch {
    return null;
  }
}

async function openKeyring(keyring) {
  const files = {};
  const keys = new Map();
  const envelopes = new Map();

  for (const [name, rawKey] of Object.entries(keyring.payload)) {
    const key = await importFileKey(rawKey);
    const envelope = await load(name);
    files[name] = await decryptWithKey(key, envelope);
    keys.set(name, key);
    envelopes.set(name, envelope);
  }

  return { files, keys, envelopes };
}

/**
 * Reopens a vault from keys that survived a reload.
 *
 * Same result as `unlock`, minus the password and the derivation it pays for. The
 * envelopes are fetched again rather than stored, so a file published from another
 * device is picked up on the refresh instead of being served from a stale copy.
 *
 * Returns null on any failure — a key that no longer opens its file, a file that has
 * gone — and the caller falls back to asking for the password.
 */
export async function resume(saved, keys) {
  try {
    if (saved.role === 'friend') {
      const envelope = await load(saved.owner);
      const list = await decryptWithKey(keys.get(saved.owner), envelope);
      return list ? { role: 'friend', owner: saved.owner, list } : null;
    }

    const files = {};
    const envelopes = new Map();

    for (const [name, key] of keys) {
      const envelope = await load(name);
      const opened = await decryptWithKey(key, envelope);
      if (!opened) return null;
      files[name] = opened;
      envelopes.set(name, envelope);
    }

    return { role: saved.role, files, keys, envelopes };
  } catch {
    return null;
  }
}

export async function unlock(password) {
  for (const { file, role } of KEYRINGS) {
    const envelope = await loadIfPresent(file);
    if (!envelope) continue;

    const keyring = await decrypt(password, envelope);
    if (keyring) return { role, ...(await openKeyring(keyring)) };
  }

  for (const owner of FRIEND_FILES) {
    const envelope = await load(owner);
    const opened = await decrypt(password, envelope);
    if (opened) return { role: 'friend', owner, list: opened.payload, key: opened.key };
  }

  return null;
}
