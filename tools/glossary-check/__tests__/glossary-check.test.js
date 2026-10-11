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
