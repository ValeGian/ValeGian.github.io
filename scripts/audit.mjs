/**
 * What changed in an encrypted file, and when.
 *
 * Git keeps every revision, but an encrypted file changes completely on every write, so
 * GitHub's diff view shows one opaque blob replacing another. This decrypts each revision
 * and prints a readable diff of the contents.
 *
 * It reads what was actually stored rather than anything a client claimed, so it cannot
 * be talked out of the truth by a buggy save or a stale queue flushing an old copy.
 *
 *   PERSONAL_PASSWORD_ADMIN=… node scripts/audit.mjs [--file collection] [--limit 20]
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { decrypt, decryptWithKey, importFileKey } from '../src/lib/crypto.mjs';

const { values: options } = parseArgs({
  options: {
    file: { type: 'string', default: 'collection' },
    limit: { type: 'string', default: '20' },
  },
});

const password = process.env.PERSONAL_PASSWORD_ADMIN;
if (!password) throw new Error('PERSONAL_PASSWORD_ADMIN is required');

const path = `public/data/personal/${options.file}.enc`;
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const revisions = git(['log', '--format=%H%x09%aI%x09%s', `-n${options.limit}`, '--', path])
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [sha, date, subject] = line.split('\t');
    return { sha, date, subject };
  })
  .reverse();

if (revisions.length === 0) {
  console.log(`No history for ${path}`);
  process.exit(0);
}

// The keyring opens every file, so one password is enough whatever --file names.
const keyringEnvelope = JSON.parse(git(['show', `${revisions.at(-1).sha}:public/data/personal/keyring.enc`]));
const keyring = await decrypt(password, keyringEnvelope);
if (!keyring) throw new Error('That password does not open the keyring');
const key = await importFileKey(keyring.payload[options.file]);

const index = (payload) => {
  const items = payload?.items ?? [];
  return new Map(items.map((item) => [item.id, item]));
};

const label = (item) =>
  item.nameEn ?? item.nameJa ?? item.hint?.nameJa ?? item.hint?.nameEn ?? item.cardId ?? item.id;

let previous = null;

for (const revision of revisions) {
  let payload = null;
  try {
    payload = await decryptWithKey(key, JSON.parse(git(['show', `${revision.sha}:${path}`])));
  } catch {
    payload = null;
  }

  if (payload === null) {
    // Written before the key was pinned, or with a different password entirely.
    console.log(`${revision.date.slice(0, 10)}  ${revision.sha.slice(0, 7)}  unreadable with the current key`);
    continue;
  }

  if (previous === null) {
    console.log(`${revision.date.slice(0, 10)}  ${revision.sha.slice(0, 7)}  first revision, ${index(payload).size} item(s)`);
    previous = payload;
    continue;
  }

  const before = index(previous);
  const after = index(payload);
  const changes = [];

  for (const [id, item] of after) {
    if (!before.has(id)) {
      changes.push(`+ ${label(item)} (${id})`);
      continue;
    }
    const was = JSON.stringify(before.get(id));
    if (was !== JSON.stringify(item)) changes.push(`~ ${label(item)} (${id})`);
  }
  for (const [id, item] of before) {
    if (!after.has(id)) changes.push(`- ${label(item)} (${id})`);
  }

  console.log(`${revision.date.slice(0, 10)}  ${revision.sha.slice(0, 7)}  ${revision.subject}`);
  for (const change of changes) console.log(`    ${change}`);
  if (changes.length === 0) console.log('    (no change to the items)');

  previous = payload;
}
