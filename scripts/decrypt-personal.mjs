/**
 * Brings the published files back down to plaintext under .local/.
 *
 * The counterpart of encrypt-personal.mjs, and the reason the laptop path works at all:
 * what is in the repository is ciphertext, so anything written from a browser has to be
 * decrypted before it can be edited here. Without this, working from a laptop means
 * overwriting whatever the phone published.
 *
 * Output goes to .local/, which is gitignored. The repository is public and git history
 * is append-only, so a plaintext commit would stay readable forever.
 *
 *   PERSONAL_PASSWORD_ADMIN=… node scripts/decrypt-personal.mjs [--dry-run]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decrypt, decryptWithKey, importFileKey } from '../src/lib/crypto.mjs';

const IN = 'public/data/personal';
const LOCAL = '.local';

const TARGETS = [
  { id: 'collection', out: `${LOCAL}/collection.json` },
  { id: 'valerio', out: `${LOCAL}/wishlists/valerio.json` },
  { id: 'tommy', out: `${LOCAL}/wishlists/tommy.json` },
  { id: 'lotad', out: `${LOCAL}/wishlists/lotad.json` },
];

const { values: options } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });

const password = process.env.PERSONAL_PASSWORD_ADMIN;
if (!password) throw new Error('PERSONAL_PASSWORD_ADMIN is required');

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const keyring = await decrypt(password, await readJson(`${IN}/keyring.enc`));
if (!keyring) throw new Error('That password does not open the keyring');

await mkdir(`${LOCAL}/wishlists`, { recursive: true });

for (const target of TARGETS) {
  const source = `${IN}/${target.id}.enc`;
  if (!existsSync(source)) {
    console.log(`  ${target.id.padEnd(11)} not published yet, skipped`);
    continue;
  }

  const key = await importFileKey(keyring.payload[target.id]);
  const payload = await decryptWithKey(key, await readJson(source));
  if (payload === null) throw new Error(`${target.id}.enc could not be opened with the keyring`);

  const count = Array.isArray(payload.items) ? payload.items.length : 0;
  if (!options['dry-run']) {
    await writeFile(target.out, `${JSON.stringify(payload, null, 2)}\n`);
  }
  console.log(`  ${target.id.padEnd(11)} ${String(count).padStart(3)} item(s) → ${target.out}`);
}

console.log(options['dry-run'] ? '\ndry run, nothing written' : '\nplaintext is in .local/ and must stay there');
