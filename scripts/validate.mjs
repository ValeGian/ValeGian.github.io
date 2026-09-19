/**
 * Validates every data file that exists against its schema.
 *
 * Personal files live under .local/ and are absent in CI, so they are checked when
 * present and skipped when not. The public files must always be there and must always
 * pass.
 *
 *   node scripts/validate.mjs
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const SCHEMAS = ['common', 'collection', 'catalog-overrides', 'watchlist'];

const TARGETS = [
  { file: 'public/data/catalog-overrides.json', schema: 'catalog-overrides', required: true },
  { file: 'public/data/watchlist.json', schema: 'watchlist', required: true },
  { file: '.local/collection.json', schema: 'collection', required: false },
];

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

// strictRequired would reject `required` inside an if/then branch unless the branch
// restates every property, which only duplicates the definitions above it. The typo it
// guards against is already caught by `additionalProperties: false` on each object.
const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);

for (const name of SCHEMAS) {
  ajv.addSchema(await readJson(`schemas/${name}.schema.json`), `${name}.schema.json`);
}

let failures = 0;

for (const target of TARGETS) {
  if (!existsSync(target.file)) {
    if (target.required) {
      console.error(`MISSING  ${target.file}`);
      failures += 1;
    } else {
      console.log(`skipped  ${target.file} (not present)`);
    }
    continue;
  }

  const validate = ajv.getSchema(`${target.schema}.schema.json`);
  const data = await readJson(target.file);

  if (validate(data)) {
    console.log(`ok       ${target.file}`);
    continue;
  }

  failures += 1;
  console.error(`FAILED   ${target.file}`);
  for (const error of validate.errors ?? []) {
    console.error(`           ${error.instancePath || '/'} ${error.message}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} file(s) failed validation`);
  process.exit(1);
}
console.log('\nall data files valid');
