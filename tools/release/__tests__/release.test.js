const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseTag, run } = require('..');

test('the tag must name NOCOBASE_VERSION and a release number', () => {
  assert.deepStrictEqual(parseTag('v2.2.24-fa.1', '2.2.24'), {
    version: '2.2.24-fa.1',
    nocobase: '2.2.24',
    release: 1,
  });
  assert.throws(() => parseTag('v2.2.22-fa.1', '2.2.24'), /NocoBase 2.2.22, but NOCOBASE_VERSION is 2.2.24/);
  assert.throws(() => parseTag('v2.2.24', '2.2.24'), /not v<NocoBase version>-fa.<n>/);
  assert.throws(() => parseTag('v2.2.24-fa.0', '2.2.24'), /not v<NocoBase version>-fa.<n>/);
  assert.throws(() => parseTag('2.2.24-fa.1', '2.2.24'), /not v<NocoBase version>-fa.<n>/);
});

// A sample repository with GitHub-style merge commits and one earlier release tag.
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(root, 'NOCOBASE_VERSION'), '2.2.24\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  const merge = (number, branch, title) => {
    git('checkout', '-q', '-b', branch);
    git('commit', '-q', '--allow-empty', '-m', `work on ${branch}`);
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', branch, '-m', `Merge pull request #${number} from owner/${branch}`, '-m', title);
  };
  merge(1, 'story/001', 'STORY-001: نخستین استوری');
  git('tag', 'v2.2.24-fa.1');
  merge(2, 'story/002', 'STORY-002: ایمیج Docker فارسی');
  merge(3, 'docs/epic', 'اپیک توزیع (EPIC-014)');
  git('tag', 'v2.2.24-fa.2');
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function capture(argv, root) {
  const out = [];
  const err = [];
  const code = run(argv, { log: (l) => out.push(l), error: (l) => err.push(l), root });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('notes list the pull requests merged since the previous release', () => {
  const repo = makeRepo();
  try {
    const { code, out } = capture(['notes', 'v2.2.24-fa.2'], repo.root);
    assert.strictEqual(code, 0);
    assert.match(out, /^# نسخه‌ی 2\.2\.24-fa\.2$/m);
    assert.match(out, /بر پایه‌ی NocoBase 2\.2\.24/);
    assert.match(out, /ghcr\.io\/baryuc40-collab\/persian-erp:2\.2\.24-fa\.2/);
    assert.match(out, /## تغییرات از v2\.2\.24-fa\.1/);
    assert.match(out, /### استوری‌ها\n\n- STORY-002: ایمیج Docker فارسی \(#2\)/);
    assert.match(out, /### دیگر تغییرات\n\n- اپیک توزیع \(EPIC-014\) \(#3\)/);
    assert.doesNotMatch(out, /STORY-001/);

    const first = capture(['notes', 'v2.2.24-fa.1'], repo.root);
    assert.match(first.out, /## تغییرات\n/);
    assert.match(first.out, /- STORY-001: نخستین استوری \(#1\)/);
  } finally {
    repo.cleanup();
  }
});

test('check prints the version or stops with a clear error', () => {
  const repo = makeRepo();
  try {
    assert.deepStrictEqual(capture(['check', 'v2.2.24-fa.2'], repo.root), { code: 0, out: '2.2.24-fa.2', err: '' });
    const wrong = capture(['check', 'v2.2.22-fa.1'], repo.root);
    assert.strictEqual(wrong.code, 1);
    assert.match(wrong.err, /NOCOBASE_VERSION is 2\.2\.24/);
    assert.strictEqual(capture(['publish', 'v2.2.24-fa.1'], repo.root).code, 1);
  } finally {
    repo.cleanup();
  }
});
