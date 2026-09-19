/**
 * Sets, rotates or removes the read-only password.
 *
 * The read-only account is the admin keyring wrapped a second time under its own
 * password. Both copies hold the same per-file keys, so both open every file; what the
 * reader never gets is a GitHub token, and publishing is the only way a change reaches
 * the repository. Read-only is therefore a property of what the account was given, not a
 * rule the interface is trusted to enforce.
 *
 * Kept apart from encrypt-personal.mjs so a routine re-encrypt can neither ask for this
 * password nor quietly drop the account by not being given it.
 *
 *   node scripts/set-viewer-password.mjs
 *   node scripts/set-viewer-password.mjs --remove
 */
import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { decrypt, encrypt } from '../src/lib/crypto.mjs';
import { askHidden } from './lib/prompt.mjs';

const OUT = 'public/data/personal';
const ADMIN_KEYRING = `${OUT}/keyring.enc`;
const VIEWER_KEYRING = `${OUT}/viewer-keyring.enc`;

/** Short enough to guess is the whole risk here: the ciphertext is in a public repository. */
const MINIMUM_LENGTH = 10;

if (process.argv.includes('--remove')) {
  if (!existsSync(VIEWER_KEYRING)) {
    console.log('There is no read-only account to remove.');
    process.exit(0);
  }

  await rm(VIEWER_KEYRING);
  console.log(
    `Removed ${VIEWER_KEYRING}. Commit the deletion, and note that anyone who kept a copy ` +
      'of the old file can still read every revision of it that git has.',
  );
  process.exit(0);
}

if (!existsSync(ADMIN_KEYRING)) {
  throw new Error(`${ADMIN_KEYRING} does not exist yet — run scripts/encrypt-personal.mjs first.`);
}

const adminPassword = process.env.PERSONAL_PASSWORD_ADMIN ?? (await askHidden('Admin password: '));
const keyring = await decrypt(adminPassword, JSON.parse(await readFile(ADMIN_KEYRING, 'utf8')));
if (!keyring) throw new Error('That password does not open the keyring.');

const viewerPassword = (
  process.env.PERSONAL_PASSWORD_VIEWER ?? (await askHidden('New read-only password: '))
).trim();

if (viewerPassword.length < MINIMUM_LENGTH) {
  throw new Error(`The read-only password must be at least ${MINIMUM_LENGTH} characters.`);
}

if (viewerPassword === adminPassword) {
  throw new Error('The read-only password must differ from the admin password, or it is the admin account.');
}

const isRotation = existsSync(VIEWER_KEYRING);
const { envelope } = await encrypt(viewerPassword, keyring.payload);
await writeFile(VIEWER_KEYRING, `${JSON.stringify(envelope)}\n`);

console.log(
  `${isRotation ? 'Updated' : 'Wrote'} ${VIEWER_KEYRING}: ${Object.keys(keyring.payload).length} key(s), read-only.`,
);
console.log('Rotating it does not retract the old one — git keeps every revision of this file.');
