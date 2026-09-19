/**
 * CSV reader for the exported collection sheet.
 *
 * Written by hand rather than pulled in as a dependency because the input is one known
 * file: quoted fields, embedded commas inside quotes, no embedded newlines.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  return body
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => Object.fromEntries(header.map((name, index) => [name.trim(), (cells[index] ?? '').trim()])));
}

/** The sheet is Italian-formatted: "1.218,94" means one thousand two hundred eighteen. */
export function parseItalianNumber(value) {
  const cleaned = String(value).replace(/\./g, '').replace(',', '.').trim();
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Not a number: ${JSON.stringify(value)}`);
  }
  return parsed;
}
