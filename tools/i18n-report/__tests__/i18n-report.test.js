const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildReport, loadSources, run } = require('..');

// Fixtures live under node_modules/ and dist/, which .gitignore excludes, so they are written per run.
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-report-'));
  const write = (rel, data) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };
  write('node_modules/@nocobase/plugin-client/dist/locale/en-US.json', {
    Submit: 'Submit',
    Cancel: 'Cancel',
    Delete: 'Delete',
    Save: 'Save',
  });
  write('node_modules/@nocobase/plugin-workflow/dist/locale/en-US.json', { Workflow: 'Workflow', Trigger: 'Trigger' });
  write('node_modules/@nocobase/plugin-no-strings/dist/locale/en-US.json', {});
  write('node_modules/@nocobase/utils/dist/locale/en-US.json', { Ignored: 'Ignored' });
  write('fa-IR/client.json', { Submit: 'ثبت', Cancel: 'انصراف', Delete: ' ', 'Old key': 'کلید قدیمی' });
  write('fa-IR/removed-plugin.json', { Hello: 'سلام' });
  return {
    nodeModules: path.join(root, 'node_modules'),
    locales: path.join(root, 'fa-IR'),
    args: ['--node-modules', path.join(root, 'node_modules'), '--locales', path.join(root, 'fa-IR')],
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function capture(argv) {
  const lines = [];
  const code = run(argv, (line) => lines.push(line));
  return { code, out: lines.join('\n') };
}

test('reads only @nocobase/plugin-* packages that ship strings', (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  assert.deepStrictEqual(Object.keys(loadSources(f.nodeModules)), ['client', 'workflow']);
});

test('counts translated, missing and extra keys per namespace', () => {
  const report = buildReport(
    {
      client: { package: '@nocobase/plugin-client', keys: ['Submit', 'Cancel', 'Delete', 'Save'] },
      workflow: { package: '@nocobase/plugin-workflow', keys: ['Workflow', 'Trigger'] },
    },
    { client: { Submit: 'ثبت', Cancel: 'انصراف', Delete: ' ', 'Old key': 'کلید قدیمی' }, gone: { Hello: 'سلام' } },
  );
  const client = report.packages.find((p) => p.namespace === 'client');
  assert.strictEqual(client.translated, 2);
  assert.strictEqual(client.coverage, 50);
  assert.deepStrictEqual(client.missing, ['Delete', 'Save']);
  assert.deepStrictEqual(client.extra, ['Old key']);
  assert.strictEqual(report.packages.find((p) => p.namespace === 'workflow').coverage, 0);
  assert.strictEqual(report.total, 6);
  assert.strictEqual(report.translated, 2);
  assert.strictEqual(report.coverage, 33.3);
  assert.deepStrictEqual(report.orphans, ['gone']);
  assert.strictEqual(report.packages[0].namespace, 'client', 'largest package first');
});

test('prints a table with totals', (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  const { code, out } = capture(f.args);
  assert.strictEqual(code, 0);
  assert.match(out, /client\s+2 \/\s+4\s+50\.0%/);
  assert.match(out, /not in en-US: Old key/);
  assert.match(out, /removed-plugin\.json has no installed/);
  assert.match(out, /total: 2 \/ 6 keys \(33\.3%\)/);
});

test('--json prints the report as JSON', (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  const { code, out } = capture([...f.args, '--json']);
  assert.strictEqual(code, 0);
  const report = JSON.parse(out);
  assert.strictEqual(report.coverage, 33.3);
  assert.strictEqual(report.packages.length, 2);
});

test('--min fails when coverage is below the threshold', (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  assert.strictEqual(capture([...f.args, '--min', '50']).code, 1);
  assert.strictEqual(capture([...f.args, '--min', '30']).code, 0);
  assert.strictEqual(capture([...f.args, '--package', 'client', '--min', '50']).code, 0);
  assert.doesNotMatch(capture([...f.args, '--package', 'workflow']).out, /client\.json has no installed/);
});

test('--missing lists untranslated keys', (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  assert.match(capture([...f.args, '--missing']).out, /- Save/);
});

test('rejects bad arguments', (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  assert.strictEqual(capture([...f.args, '--min', 'x']).code, 2);
  assert.strictEqual(capture([...f.args, '--package', 'nope']).code, 2);
  assert.strictEqual(capture(['--bogus']).code, 2);
  assert.strictEqual(capture(['--node-modules', path.join(os.tmpdir(), 'does-not-exist')]).code, 2);
});
