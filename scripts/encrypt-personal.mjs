/**
 * Builds the encrypted personal files the site serves.
 *
 * Reads the plaintext working copies under .local/ and writes envelopes to
 * public/data/personal/. Plaintext never leaves .local/, which is gitignored: the
 * repository is public and git history is append-only, so one careless commit would be
 * readable forever.
 *
 * Passwords come from the environment or a hidden prompt, never from a file and never
 * from an argument, so they stay out of shell history and out of `ps`.
 *
 *   PERSONAL_PASSWORD_ADMIN=… node scripts/encrypt-personal.mjs
 *
 * The read-only account lives in viewer-keyring.enc and is not touched here; it is set
 * and rotated by scripts/set-viewer-password.mjs.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { decrypt, encrypt, exportFileKey } from '../src/lib/crypto.mjs';
import { askHidden } from './lib/prompt.mjs';

const OUT = 'public/data/personal';
const LOCAL = '.local';

/**
 * Who can open what. `admin` files are wrapped under the owner's password; a friend's
 * file is wrapped under theirs. Every key also goes into the keyring, which is wrapped
 * under the admin password, so one password opens everything without any file needing to
 * know that.
 */
const FILES = [
  { id: 'collection', source: `${LOCAL}/collection.json`, owner: 'admin', blank: { version: 1, items: [] } },
  { id: 'valerio', source: `${LOCAL}/wishlists/valerio.json`, owner: 'admin', blank: { owner: 'Valerio', items: [], settlements: [] } },
  { id: 'tommy', source: `${LOCAL}/wishlists/tommy.json`, owner: 'tommy', blank: { owner: 'Tommy', items: [], settlements: [] } },
  { id: 'lotad', source: `${LOCAL}/wishlists/lotad.json`, owner: 'lotad', blank: { owner: 'Lotad', items: [], settlements: [] } },
];

async function passwordFor(owner) {
  const variable = `PERSONAL_PASSWORD_${owner.toUpperCase()}`;
  return process.env[variable] ?? askHidden(`Password for ${owner}: `);
}

const passwords = new Map();
for (const owner of new Set(FILES.map((file) => file.owner))) {
  passwords.set(owner, await passwordFor(owner));
}

const adminPassword = passwords.get('admin');
if (!adminPassword) throw new Error('The admin password is required: it wraps the keyring.');

await mkdir(OUT, { recursive: true });
await mkdir(`${LOCAL}/wishlists`, { recursive: true });

const keyring = {};

/** Files that had to be given a new key this run; the read-only keyring will not have it. */
const reissued = [];

/**
 * Reuses the key a file already has.
 *
 * A fresh key on every run would leave each past revision readable only by the keyring
 * that existed at the time, and git keeps those revisions forever — so scripts/audit.mjs
 * could never walk the history. Keeping the key means today's password opens every
 * version of the file that was ever committed.
 */
async function existingKey(file) {
  const target = `${OUT}/${file.id}.enc`;
  if (!existsSync(target)) return null;

  const opened = await decrypt(passwords.get(file.owner), JSON.parse(await readFile(target, 'utf8')));
  if (opened) return opened.key;

  console.warn(`  ${file.id}: the current password does not open the existing file; issuing a new key.`);
  return null;
}

for (const file of FILES) {
  const payload = existsSync(file.source) ? JSON.parse(await readFile(file.source, 'utf8')) : file.blank;

  if (!existsSync(file.source)) {
    await writeFile(file.source, `${JSON.stringify(payload, null, 2)}\n`);
  }

  const reused = await existingKey(file);
  if (!reused) reissued.push(file.id);
  const { envelope, key } = await encrypt(passwords.get(file.owner), payload, reused);
  keyring[file.id] = await exportFileKey(key);

  await writeFile(`${OUT}/${file.id}.enc`, `${JSON.stringify(envelope)}\n`);
  const size = Object.keys(payload).includes('items') ? payload.items.length : '-';
  const keyNote = reused ? 'key kept' : 'new key';
  console.log(`  ${file.id.padEnd(11)} opened by ${file.owner.padEnd(8)} ${String(size).padStart(3)} item(s)  ${keyNote}`);
}

const { envelope: keyringEnvelope } = await encrypt(adminPassword, keyring);
await writeFile(`${OUT}/keyring.enc`, `${JSON.stringify(keyringEnvelope)}\n`);

console.log(`  ${'keyring'.padEnd(11)} opened by admin    ${Object.keys(keyring).length} key(s)`);

/**
 * The read-only keyring holds a copy of these same keys, wrapped under its own password,
 * and cannot be rewrapped from here because that password is not asked for. A reissued
 * key therefore leaves it opening a file that no longer exists in that form, which would
 * otherwise only show up as a reader seeing stale data.
 */
if (reissued.length > 0 && existsSync(`${OUT}/viewer-keyring.enc`)) {
  console.warn(
    `\nNew key(s) for ${reissued.join(', ')}. The read-only account still holds the old ones — ` +
      'run scripts/set-viewer-password.mjs to bring it up to date.',
  );
}

console.log(`\nwritten to ${OUT}`);
