const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { orderLike, parseJsonReply, run } = require('..');

const EN = {
  Submit: 'Submit',
  'Delete plugin': 'Delete plugin',
  'Load {{count}} items': 'Load {{count}} items',
  Cancel: 'Cancel',
};

// Fixtures live under node_modules/ and dist/, which .gitignore excludes, so they are written per run.
function makeFixture(fa = { Submit: 'ثبت' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-translate-'));
  const write = (rel, data) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
    return file;
  };
  write('node_modules/@nocobase/plugin-client/dist/locale/en-US.json', EN);
  if (fa) write('fa-IR/client.json', fa);
  return {
    root,
    write,
    args: ['--node-modules', path.join(root, 'node_modules'), '--locales', path.join(root, 'fa-IR')],
    readFa: () => JSON.parse(fs.readFileSync(path.join(root, 'fa-IR', 'client.json'), 'utf8')),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

// A fake Claude API: each call takes the next reply from the list and records the request.
function fakeFetch(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const reply = replies[calls.length - 1];
    if (reply instanceof Error) return { ok: false, status: 500, text: async () => reply.message };
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(reply) }] }) };
  };
  return { calls, fetchImpl };
}

async function capture(argv, extra = {}) {
  const out = [];
  const err = [];
  const code = await run(argv, { log: (l) => out.push(l), error: (l) => err.push(l), env: {}, ...extra });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('without an API key it explains in Persian and changes nothing', async (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  const { code, err } = await capture(['client', ...f.args]);
  assert.strictEqual(code, 2);
  assert.match(err, /ANTHROPIC_API_KEY/);
  assert.match(err, /چیزی تغییر نکرد/);
  assert.deepStrictEqual(f.readFa(), { Submit: 'ثبت' });
});

test('translates only untranslated keys and caches the fixed prompt', async (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  const { calls, fetchImpl } = fakeFetch([
    { 'Delete plugin': 'حذف پلاگین', 'Load {{count}} items': 'بارگذاری {{count}} مورد', Cancel: 'انصراف' },
  ]);
  const { code, out } = await capture(['client', ...f.args], { env: { ANTHROPIC_API_KEY: 'test' }, fetchImpl });
  assert.strictEqual(code, 0, out);
  assert.strictEqual(calls.length, 1);
  assert.ok(!calls[0].messages[0].content.includes('"Submit"'), 'translated keys are not sent');
  assert.deepStrictEqual(calls[0].system[0].cache_control, { type: 'ephemeral' });
  assert.match(calls[0].system[0].text, /پلاگین/, 'glossary is in the system prompt');
  assert.deepStrictEqual(Object.keys(f.readFa()), Object.keys(EN), 'en-US order is kept');
  assert.strictEqual(f.readFa().Submit, 'ثبت');
});

test('retries keys that fail the checks, then reports the ones still failing', async (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  const { calls, fetchImpl } = fakeFetch([
    { 'Delete plugin': 'حذف پلاگین', 'Load {{count}} items': 'بارگذاری {{num}} مورد', Cancel: 'لغو كردن' },
    { 'Load {{count}} items': 'بارگذاری {{count}} مورد', Cancel: 'لغو كردن' },
  ]);
  const { code, out } = await capture(['client', ...f.args], { env: { ANTHROPIC_API_KEY: 'test' }, fetchImpl });
  assert.strictEqual(calls.length, 2);
  assert.match(calls[1].messages[0].content, /placeholders differ/);
  assert.strictEqual(code, 1);
  assert.match(out, /REJECTED \[Cancel\]/);
  const fa = f.readFa();
  assert.strictEqual(fa['Load {{count}} items'], 'بارگذاری {{count}} مورد');
  assert.ok(!('Cancel' in fa));
});

test('an API error leaves the file untouched', async (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  const { fetchImpl } = fakeFetch([new Error('overloaded')]);
  const { code, err } = await capture(['client', ...f.args], { env: { ANTHROPIC_API_KEY: 'test' }, fetchImpl });
  assert.strictEqual(code, 1);
  assert.match(err, /500/);
  assert.deepStrictEqual(f.readFa(), { Submit: 'ثبت' });
});

test('--export writes untranslated keys and --import merges checked translations', async (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  const exportFile = path.join(f.root, 'todo.json');
  assert.strictEqual((await capture(['client', ...f.args, '--export', exportFile])).code, 0);
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(exportFile, 'utf8'))), [
    'Delete plugin',
    'Load {{count}} items',
    'Cancel',
  ]);

  const importFile = f.write('done.json', {
    Submit: 'ارسال',
    'Delete plugin': 'حذف پلاگین',
    'Load {{count}} items': 'بارگذاری مورد',
    Cancel: 'انصراف',
    Unknown: 'ناشناخته',
  });
  const { code, out } = await capture(['client', ...f.args, '--import', importFile]);
  assert.strictEqual(code, 1);
  assert.match(out, /REJECTED \[Load \{\{count\}\} items\]/);
  assert.match(out, /skipped \(not in en-US\): Unknown/);
  assert.match(out, /1 key\(s\) already translated/);
  assert.deepStrictEqual(f.readFa(), { Submit: 'ثبت', 'Delete plugin': 'حذف پلاگین', Cancel: 'انصراف' });
});

test('--force replaces existing translations; --dry-run writes nothing', async (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  const importFile = f.write('done.json', { Submit: 'ارسال' });
  await capture(['client', ...f.args, '--import', importFile, '--force', '--dry-run']);
  assert.strictEqual(f.readFa().Submit, 'ثبت');
  await capture(['client', ...f.args, '--import', importFile, '--force']);
  assert.strictEqual(f.readFa().Submit, 'ارسال');
});

test('creates the locale file when the namespace has none yet', async (t) => {
  const f = makeFixture(null);
  t.after(f.cleanup);
  const importFile = f.write('done.json', { Cancel: 'انصراف' });
  assert.strictEqual((await capture(['client', ...f.args, '--import', importFile])).code, 0);
  assert.deepStrictEqual(f.readFa(), { Cancel: 'انصراف' });
});

test('rejects bad arguments and unknown namespaces', async (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  assert.strictEqual((await capture([...f.args])).code, 2);
  assert.strictEqual((await capture(['nope', ...f.args])).code, 2);
  assert.strictEqual((await capture(['client', '--limit', '0', ...f.args])).code, 2);
  assert.strictEqual((await capture(['client', '--export', 'a', '--import', 'b', ...f.args])).code, 2);
});

test('helpers', () => {
  assert.deepStrictEqual(Object.keys(orderLike(['b', 'a'], { a: 1, c: 3, b: 2 })), ['b', 'a', 'c']);
  assert.deepStrictEqual(parseJsonReply('Here:\n```json\n{"a":"ب"}\n```'), { a: 'ب' });
  assert.throws(() => parseJsonReply('no json'));
});
