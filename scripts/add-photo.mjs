/**
 * Attaches a picture to a card from this machine.
 *
 * The site can do this from a phone; this is the same job from a laptop, for cards whose
 * only picture is a scan or a photograph already sitting in a folder.
 *
 * Shrinks with `sips`, which ships with macOS, so there is no image library to install
 * and keep current. The ceiling is the same 200 KB the browser enforces, for the same
 * reason: the repository keeps every version of everything, and an oversized image would
 * be permanent.
 *
 *   node scripts/add-photo.mjs <image> --card CLK-001
 *   node scripts/add-photo.mjs <image> --item itm_0035
 *
 * Afterwards: PERSONAL_PASSWORD_ADMIN=… npm run admin:commit
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const MAX_BYTES = 200 * 1024;
const MAX_EDGE = 1000;
const PHOTOS = 'public/data/photos';
const COLLECTION = '.local/collection.json';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: { card: { type: 'string' }, item: { type: 'string' } },
});

const [source] = positionals;
if (!source || !existsSync(source)) throw new Error('Give the path to an image file');
if (!options.card && !options.item) throw new Error('Name the card with --card <cardId> or --item <itemId>');

if (!existsSync(COLLECTION)) {
  throw new Error(`${COLLECTION} is missing. Run: PERSONAL_PASSWORD_ADMIN=… npm run data:decrypt`);
}

const collection = JSON.parse(await readFile(COLLECTION, 'utf8'));
const item = collection.items.find((candidate) =>
  options.item ? candidate.id === options.item : candidate.cardId === options.card,
);

if (!item) throw new Error(`No card matches ${options.item ?? options.card}`);

mkdirSync(PHOTOS, { recursive: true });
const target = `${PHOTOS}/${item.id}.jpg`;

// sips writes in place, so work on a copy and only keep it once it is small enough.
const scratch = `${target}.working.jpg`;
copyFileSync(source, scratch);
execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', String(MAX_EDGE), scratch, '--out', scratch], { stdio: 'ignore' });

let bytes = statSync(scratch).size;
for (const quality of ['high', 'normal', 'low']) {
  if (bytes <= MAX_BYTES) break;
  execFileSync('sips', ['-s', 'formatOptions', quality, scratch, '--out', scratch], { stdio: 'ignore' });
  bytes = statSync(scratch).size;
}

if (bytes > MAX_BYTES) {
  unlinkSync(scratch);
  throw new Error(`Still ${Math.round(bytes / 1024)} KB after shrinking. Crop it tighter and try again.`);
}

copyFileSync(scratch, target);
unlinkSync(scratch);

item.photoUrl = `/data/photos/${item.id}.jpg`;
await writeFile(COLLECTION, `${JSON.stringify(collection, null, 2)}\n`);

const dimensions = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', target], { encoding: 'utf8' })
  .match(/pixel(?:Width|Height): (\d+)/g)
  ?.map((line) => line.split(': ')[1])
  .join('×');

console.log(`  ${item.nameEn ?? item.nameJa ?? item.cardId}`);
console.log(`  ${dimensions}, ${Math.round(bytes / 1024)} KB → ${target}`);
console.log(`\nNow publish it:  PERSONAL_PASSWORD_ADMIN=… npm run admin:commit`);
