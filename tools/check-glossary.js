// Validates glossary/fa-IR.csv: header, 4 columns per row, no duplicate English terms, no Arabic ي/ك.
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'glossary', 'fa-IR.csv');
const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '');

// Minimal CSV parser: supports quoted fields with commas and escaped quotes.
function parse(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

const errors = [];
const header = parse(lines[0]);
if (header.slice(0, 4).join(',') !== 'en,fa,category,note') {
  errors.push(`header must start with en,fa,category,note (got ${header.join(',')})`);
}

const seen = new Map();
lines.slice(1).forEach((line, index) => {
  const row = index + 2;
  const fields = parse(line);
  if (fields.length !== header.length) {
    errors.push(`line ${row}: expected ${header.length} columns, got ${fields.length}`);
    return;
  }
  const [en, fa] = fields;
  if (!en || !fa) errors.push(`line ${row}: en and fa must not be empty`);
  if (/[يك]/.test(fa)) errors.push(`line ${row}: "${fa}" uses Arabic ي or ك`);
  const key = en.toLowerCase();
  if (seen.has(key)) errors.push(`line ${row}: "${en}" duplicates line ${seen.get(key)}`);
  seen.set(key, row);
});

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`glossary/fa-IR.csv: ${lines.length - 1} terms OK.`);
