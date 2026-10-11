const test = require('node:test');
const assert = require('node:assert');
const { checkPair, loadGlossary } = require('..');

const glossary = loadGlossary();

test('accepts a correct translation', () => {
  const en = { 'Delete collection': 'Delete collection', 'Add {{type}} after "{{title}}"': 'Add {{type}} after "{{title}}"' };
  const fa = { 'Delete collection': 'حذف مجموعه', 'Add {{type}} after "{{title}}"': 'افزودن {{type}} پس از «{{title}}»' };
  const { errors, warnings } = checkPair(en, fa, glossary);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(warnings, []);
});

test('reports missing or renamed placeholders', () => {
  const { errors } = checkPair({ 'Load {{count}} items': 'Load {{count}} items' }, { 'Load {{count}} items': 'بارگذاری {{num}} مورد' }, glossary);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0].message, /placeholders/);
});

test('reports changed HTML tags', () => {
  const { errors } = checkPair({ k: 'See <a href="x">docs</a>' }, { k: 'مستندات را ببینید' }, glossary);
  assert.match(errors[0].message, /HTML tags/);
});

test('reports Arabic yeh and kaf', () => {
  const { errors } = checkPair({ Delete: 'Delete' }, { Delete: 'حذف كردن' }, glossary);
  assert.match(errors[0].message, /Arabic/);
});

test('warns when a glossary term is translated differently', () => {
  const { errors, warnings } = checkPair({ 'Delete plugin': 'Delete plugin' }, { 'Delete plugin': 'حذف افزونه' }, glossary);
  assert.deepStrictEqual(errors, []);
  assert.ok(warnings.some((w) => w.message.includes('پلاگین')));
});

test('prefers the longest glossary term', () => {
  const { warnings } = checkPair({ 'Data source': 'Data source' }, { 'Data source': 'منبع داده' }, glossary);
  assert.deepStrictEqual(warnings, []);
});

test('warns about keys missing from en-US', () => {
  const { warnings } = checkPair({}, { Extra: 'اضافه' }, glossary);
  assert.ok(warnings.some((w) => w.message.includes('not in en-US')));
});

test('does not warn about unknown keys when the source is not installed', () => {
  const { warnings } = checkPair({}, { Extra: 'اضافه' }, glossary, { sourceKnown: false });
  assert.deepStrictEqual(warnings, []);
});

test('without the source, identifier keys only warn about placeholders; text keys still fail', () => {
  const fa = { 'RunJS deprecated since': 'از {{since}}', 'Load {{count}} items': 'بارگذاری موارد' };
  const { errors, warnings } = checkPair({}, fa, glossary, { sourceKnown: false });
  assert.ok(warnings.some((w) => w.key === 'RunJS deprecated since' && w.message.includes('placeholders differ')));
  assert.deepStrictEqual(
    errors.map((e) => e.key),
    ['Load {{count}} items'],
  );
  // With the source installed the same mismatch is an error.
  const known = checkPair({ 'RunJS deprecated since': 'Since {{version}}' }, fa, glossary);
  assert.ok(known.errors.some((e) => e.key === 'RunJS deprecated since'));
});

test('finds locale pack files and maps them to their @nocobase/plugin-* source', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { findFaFiles, sourceFile } = require('..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glossary-check-'));
  try {
    fs.mkdirSync(path.join(root, 'locales', 'fa-IR'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'locale'), { recursive: true });
    fs.writeFileSync(path.join(root, 'locales', 'fa-IR', 'client.json'), '{}');
    fs.writeFileSync(path.join(root, 'src', 'locale', 'fa-IR.json'), '{}');
    fs.writeFileSync(path.join(root, 'src', 'locale', 'en-US.json'), '{}');
    const files = findFaFiles(root).map((f) => path.relative(root, f)).sort();
    assert.deepStrictEqual(files, [path.join('locales', 'fa-IR', 'client.json'), path.join('src', 'locale', 'fa-IR.json')]);
    assert.strictEqual(
      sourceFile(path.join(root, 'locales', 'fa-IR', 'client.json'), '/nm'),
      path.join('/nm', '@nocobase', 'plugin-client', 'dist', 'locale', 'en-US.json'),
    );
    assert.strictEqual(sourceFile(path.join(root, 'src', 'locale', 'fa-IR.json'), '/nm'), path.join(root, 'src', 'locale', 'en-US.json'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('accepts plural and ezafe forms of a multi-word term', () => {
  const en = { 'Data blocks': 'Data blocks', 'Association fields filter': 'Association fields filter' };
  const fa = { 'Data blocks': 'بلوک‌های داده', 'Association fields filter': 'فیلتر فیلدهای ارتباطی' };
  assert.deepStrictEqual(checkPair(en, fa, glossary).warnings, []);
});
