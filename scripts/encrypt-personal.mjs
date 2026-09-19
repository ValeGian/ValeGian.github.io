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
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { encrypt, exportFileKey } from '../src/lib/crypto.mjs';
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

for (const file of FILES) {
  const payload = existsSync(file.source) ? JSON.parse(await readFile(file.source, 'utf8')) : file.blank;

  if (!existsSync(file.source)) {
    await writeFile(file.source, `${JSON.stringify(payload, null, 2)}\n`);
  }

  const { envelope, key } = await encrypt(passwords.get(file.owner), payload);
  keyring[file.id] = await exportFileKey(key);

  await writeFile(`${OUT}/${file.id}.enc`, `${JSON.stringify(envelope)}\n`);
  const size = Object.keys(payload).includes('items') ? payload.items.length : '-';
  console.log(`  ${file.id.padEnd(11)} opened by ${file.owner.padEnd(8)} ${size} item(s)`);
}

const { envelope: keyringEnvelope } = await encrypt(adminPassword, keyring);
await writeFile(`${OUT}/keyring.enc`, `${JSON.stringify(keyringEnvelope)}\n`);

console.log(`  ${'keyring'.padEnd(11)} opened by admin    ${Object.keys(keyring).length} key(s)`);
console.log(`\nwritten to ${OUT}`);
