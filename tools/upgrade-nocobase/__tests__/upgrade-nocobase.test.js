const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bumpPackageJson, checkTarget, compareLicense, run } = require('..');

const LOCALES = 'packages/plugins/@persian-erp/plugin-fa/locales/fa-IR';

// A sample repository in a temp folder; install() stands in for yarn install by swapping the en-US files.
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-nocobase-'));
  const write = (rel, data) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  };
  write('NOCOBASE_VERSION', '2.2.22\n');
  write('package.json', {
    name: 'sample',
    dependencies: { '@nocobase/app': '2.2.22', pg: '^8.14.1' },
    devDependencies: { '@nocobase/devtools': '2.2.22' },
    resolutions: { '@nocobase/utils': '2.2.22', antd: '5.24.2' },
  });
  write('node_modules/@nocobase/plugin-acl/dist/locale/en-US.json', { Roles: 'Roles', Old: 'Old' });
  write(`${LOCALES}/acl.json`, { Roles: 'نقش‌ها', Fresh: 'تازه' });
  const install = () => {
    write('node_modules/@nocobase/plugin-acl/dist/locale/en-US.json', {
      Roles: 'Roles',
      Fresh: 'Fresh',
      Other: 'Other',
    });
    write('node_modules/@nocobase/plugin-new/dist/locale/en-US.json', { Hello: 'Hello' });
    return true;
  };
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  return { root, install, read, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function capture(argv, deps) {
  const out = [];
  const err = [];
  const code = run(argv, { log: (l) => out.push(l), error: (l) => err.push(l), ...deps });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('only newer patch releases of the same minor are accepted', () => {
  assert.strictEqual(checkTarget('2.2.22', '2.2.24'), null);
  assert.match(checkTarget('2.2.22', '2.3.0'), /not a patch upgrade/);
  assert.match(checkTarget('2.2.22', '3.0.0'), /not a patch upgrade/);
  assert.match(checkTarget('2.2.22', '2.2.22'), /not newer/);
  assert.match(checkTarget('2.2.22', '2.2.9'), /not newer/);
  assert.match(checkTarget('2.2.22', '2.2.24-beta.1'), /not a stable version/);
});

test('package.json: only @nocobase entries pinned to the old version change', () => {
  const pkg = {
    dependencies: { '@nocobase/app': '2.2.22', '@nocobase/other': '2.2.20', pg: '2.2.22' },
    resolutions: { '@nocobase/utils': '2.2.22' },
  };
  assert.deepStrictEqual(bumpPackageJson(pkg, '2.2.22', '2.2.24'), ['@nocobase/app', '@nocobase/utils']);
  assert.deepStrictEqual(pkg.dependencies, { '@nocobase/app': '2.2.24', '@nocobase/other': '2.2.20', pg: '2.2.22' });
});

test('LICENSE.txt comparison', () => {
  assert.deepStrictEqual(
    compareLicense('1', '2', () => 'same'),
    { status: 'unchanged' },
  );
  assert.strictEqual(compareLicense('1', '2', (url) => (url.includes('v1/') ? 'a\nb' : 'a\nc')).status, 'changed');
  assert.strictEqual(compareLicense('1', '2', () => null).status, 'unknown');
});

test('an upgrade rewrites the versions, installs and lists the new keys', () => {
  const repo = makeRepo();
  try {
    const report = path.join(repo.root, 'report.md');
    const { code, out } = capture(['v2.2.24', '--root', repo.root, '--report', report], {
      install: repo.install,
      fetchText: () => 'license',
    });
    assert.strictEqual(code, 0);
    assert.strictEqual(repo.read('NOCOBASE_VERSION'), '2.2.24\n');
    const pkg = JSON.parse(repo.read('package.json'));
    assert.strictEqual(pkg.dependencies['@nocobase/app'], '2.2.24');
    assert.strictEqual(pkg.devDependencies['@nocobase/devtools'], '2.2.24');
    assert.strictEqual(pkg.resolutions['@nocobase/utils'], '2.2.24');
    assert.strictEqual(pkg.resolutions.antd, '5.24.2');
    assert.match(out, /New translation keys: 3 \(2 untranslated\)/);
    assert.match(out, /- \[x\] Fresh/);
    assert.match(out, /- \[ \] Other/);
    assert.match(out, /- new\n {2}- \[ \] Hello/);
    assert.match(out, /Removed keys: 1/);
    assert.match(out, /- acl: Old/);
    assert.match(out, /LICENSE.txt: unchanged/);
    assert.strictEqual(repo.read('report.md').trim(), out.slice(out.indexOf('# NocoBase')).trim());
  } finally {
    repo.cleanup();
  }
});

test('a refused version changes nothing', () => {
  const repo = makeRepo();
  try {
    const { code, err } = capture(['2.3.0', '--root', repo.root], { install: repo.install, fetchText: () => '' });
    assert.strictEqual(code, 1);
    assert.match(err, /own epic/);
    assert.strictEqual(repo.read('NOCOBASE_VERSION'), '2.2.22\n');
  } finally {
    repo.cleanup();
  }
});

test('after a failed install, the same command resumes with the old keys', () => {
  const repo = makeRepo();
  try {
    const failed = capture(['2.2.24', '--root', repo.root], { install: () => false, fetchText: () => '' });
    assert.strictEqual(failed.code, 1);
    assert.match(failed.err, /run the same command again/);
    assert.strictEqual(repo.read('NOCOBASE_VERSION'), '2.2.24\n');

    const { code, out } = capture(['2.2.24', '--root', repo.root], { install: repo.install, fetchText: () => '' });
    assert.strictEqual(code, 0);
    assert.match(out, /resuming the upgrade 2.2.22 -> 2.2.24/);
    assert.match(out, /# NocoBase 2.2.22 -> 2.2.24/);
    assert.match(out, /package.json: @nocobase\/app, @nocobase\/devtools, @nocobase\/utils/);
    assert.match(out, /- acl: Old/);
    assert.ok(!fs.existsSync(path.join(repo.root, 'storage/upgrade-nocobase/keys-before-2.2.24.json')));
    // Done: running it again is refused like any other non-newer version.
    assert.strictEqual(capture(['2.2.24', '--root', repo.root], { install: repo.install }).code, 1);
  } finally {
    repo.cleanup();
  }
});

test('usage errors', () => {
  assert.strictEqual(capture([]).code, 2);
  assert.strictEqual(capture(['2.2.24', '--bogus']).code, 2);
});
