#!/usr/bin/env node
// Release helpers for .github/workflows/release.yml (STORY-062).
//   check <tag>               the tag is v<NOCOBASE_VERSION>-fa.<n>; prints the version without the "v"
//   notes <tag> [--from <ref>] Persian release notes from the pull requests merged since the previous release tag
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TAG = /^v(\d+\.\d+\.\d+)-fa\.([1-9]\d*)$/;
const REPO = 'baryuc40-collab/persian-erp';

// Returns { version, nocobase, release } or throws with a message the workflow log can show as is.
function parseTag(tag, nocobaseVersion) {
  const m = TAG.exec(tag);
  if (!m) throw new Error(`tag ${tag} is not v<NocoBase version>-fa.<n>, for example v${nocobaseVersion}-fa.1`);
  if (m[1] !== nocobaseVersion) {
    throw new Error(`tag ${tag} is for NocoBase ${m[1]}, but NOCOBASE_VERSION is ${nocobaseVersion}`);
  }
  return { version: `${m[1]}-fa.${m[2]}`, nocobase: m[1], release: Number(m[2]) };
}

// GitHub merge commits: subject "Merge pull request #N from owner/branch", body = the pull request title.
function parseMerges(log) {
  return log
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject, body = ''] = entry.split('\x1f');
      const m = /^Merge pull request #(\d+) from \S+/.exec(subject);
      return m ? { number: Number(m[1]), title: body.trim().split('\n')[0] } : null;
    })
    .filter(Boolean)
    .reverse();
}

function formatNotes({ version, nocobase, previous, pulls }) {
  const stories = pulls.filter((p) => /STORY-\d+/.test(p.title));
  const others = pulls.filter((p) => !/STORY-\d+/.test(p.title));
  const item = (p) => `- ${p.title} (#${p.number})`;
  const lines = [
    `# نسخه‌ی ${version}`,
    '',
    `بر پایه‌ی NocoBase ${nocobase}.`,
    '',
    '## نصب و ارتقا',
    '',
    `- ایمیج Docker: \`ghcr.io/${REPO}:${version}\``,
    `- نصب تازه: [راهنمای نصب](https://github.com/${REPO}/blob/v${version}/docs/install/README.md)؛ در \`.env\` بنویسید \`IMAGE_TAG=${version}\`.`,
    `- نصب موجود: پیش از ارتقا پشتیبان بگیرید، سپس \`IMAGE_TAG=${version}\` و \`docker compose pull app && docker compose up -d\`.`,
    `- NocoBase رسمی ${nocobase}: فایل \`plugin-fa-${version}.tgz\` همین انتشار را از «مدیریت پلاگین‌ها» بارگذاری کنید.`,
    '',
    previous ? `## تغییرات از ${previous}` : '## تغییرات',
    '',
  ];
  if (!pulls.length) lines.push('تغییری در کد نیست؛ فقط ساخت دوباره.');
  if (stories.length) lines.push('### استوری‌ها', '', ...stories.map(item), '');
  if (others.length) lines.push('### دیگر تغییرات', '', ...others.map(item), '');
  return `${lines.join('\n').trimEnd()}\n`;
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// The latest release tag reachable from the commit before `tag`; null for the first release.
function previousTag(tag, cwd) {
  try {
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v*-fa.*', `${tag}^`], cwd);
  } catch {
    return null;
  }
}

function run(argv, { log = console.log, error = console.error, root = ROOT } = {}) {
  const [command, tag, ...rest] = argv;
  const nocobaseVersion = fs.readFileSync(path.join(root, 'NOCOBASE_VERSION'), 'utf8').trim();
  try {
    if (!tag || !['check', 'notes'].includes(command))
      throw new Error('usage: release check|notes <tag> [--from <ref>]');
    const parsed = parseTag(tag, nocobaseVersion);
    if (command === 'check') {
      log(parsed.version);
      return 0;
    }
    const fromIndex = rest.indexOf('--from');
    const previous = fromIndex >= 0 ? rest[fromIndex + 1] : previousTag(tag, root);
    const range = previous ? [`${previous}..${tag}`] : [tag];
    const pulls = parseMerges(git(['log', '--merges', '--first-parent', '--format=%s%x1f%b%x1e', ...range], root));
    log(formatNotes({ ...parsed, previous, pulls }));
    return 0;
  } catch (err) {
    error(err.message);
    return 1;
  }
}

module.exports = { formatNotes, parseMerges, parseTag, run };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
