#!/usr/bin/env node
// Moves the repository to a new NocoBase patch release (docs/dev/upgrade.md, STORY-061):
// rewrites NOCOBASE_VERSION and the @nocobase/* versions in package.json, runs yarn install, then reports
// the translation keys the new release added or removed and whether LICENSE.txt changed.
// Usage: yarn upgrade:nocobase <version> [--skip-install] [--report <file>]
// If yarn install fails (often the network), fix it and run the same command again: the keys of the old release
// are kept in storage/upgrade-nocobase/, so the second run resumes after the version change.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadSources, loadTranslations } = require('../i18n-report');

const ROOT = path.resolve(__dirname, '..', '..');
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;
const LOCALES = path.join('packages', 'plugins', '@persian-erp', 'plugin-fa', 'locales', 'fa-IR');

// Only patch releases of the current minor go through this tool (decision 0002); anything else is its own epic.
function checkTarget(current, target) {
  const c = STABLE.exec(current);
  const t = STABLE.exec(target);
  if (!t) return `${target} is not a stable version (x.y.z); alpha and beta releases are never used`;
  if (!c) return `NOCOBASE_VERSION (${current}) is not a stable version`;
  if (t[1] !== c[1] || t[2] !== c[2]) {
    return `${current} -> ${target} is not a patch upgrade; a minor or major upgrade needs its own epic (docs/decisions/0002-version-policy.md)`;
  }
  if (Number(t[3]) <= Number(c[3])) return `${target} is not newer than ${current}`;
  return null;
}

// Rewrites every @nocobase/* entry pinned to `from`; returns the names it changed.
function bumpPackageJson(pkg, from, to) {
  const changed = [];
  for (const field of ['dependencies', 'devDependencies', 'resolutions']) {
    for (const [name, version] of Object.entries(pkg[field] || {})) {
      if (name.startsWith('@nocobase/') && version === from) {
        pkg[field][name] = to;
        changed.push(name);
      }
    }
  }
  return changed;
}

// Keys per namespace that the new release added or dropped, and whether the added ones are already translated.
function diffSources(before, after, translations) {
  const added = {};
  const removed = {};
  for (const [ns, { keys }] of Object.entries(after)) {
    const old = new Set(before[ns]?.keys || []);
    const fa = translations[ns] || {};
    const fresh = keys.filter((k) => !old.has(k));
    if (fresh.length) {
      added[ns] = fresh.map((key) => ({ key, translated: typeof fa[key] === 'string' && fa[key].trim() !== '' }));
    }
  }
  for (const [ns, { keys }] of Object.entries(before)) {
    const now = new Set(after[ns]?.keys || []);
    const gone = keys.filter((k) => !now.has(k));
    if (gone.length) removed[ns] = gone;
  }
  return { added, removed };
}

function fetchWithCurl(url) {
  const res = spawnSync('curl', ['-fsSL', url], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout : null;
}

const licenseUrl = (version) => `https://raw.githubusercontent.com/nocobase/nocobase/v${version}/LICENSE.txt`;

function compareLicense(from, to, fetchText) {
  const before = fetchText(licenseUrl(from));
  const after = fetchText(licenseUrl(to));
  if (before == null || after == null)
    return { status: 'unknown', note: 'could not download LICENSE.txt; compare it by hand' };
  if (before === after) return { status: 'unchanged' };
  const a = before.split('\n');
  const b = after.split('\n');
  const changedLines = b.filter((line, i) => line !== a[i]).length + Math.max(0, a.length - b.length);
  return { status: 'changed', note: `${changedLines} line(s) differ; read the new text before merging` };
}

function formatReport({ from, to, changed, diff, license }) {
  const lines = [`# NocoBase ${from} -> ${to}`, '', `package.json: ${changed.join(', ') || 'nothing to change'}`, ''];
  const untranslated = Object.values(diff.added)
    .flat()
    .filter((k) => !k.translated).length;
  const addedCount = Object.values(diff.added).flat().length;
  lines.push(`## New translation keys: ${addedCount} (${untranslated} untranslated)`, '');
  for (const [ns, keys] of Object.entries(diff.added)) {
    lines.push(`- ${ns}`);
    for (const { key, translated } of keys) lines.push(`  - [${translated ? 'x' : ' '}] ${key}`);
  }
  const removed = Object.entries(diff.removed);
  if (removed.length) {
    lines.push('', `## Removed keys: ${removed.reduce((n, [, keys]) => n + keys.length, 0)}`, '');
    for (const [ns, keys] of removed) lines.push(`- ${ns}: ${keys.join(', ')}`);
  }
  lines.push('', `## LICENSE.txt: ${license.status}${license.note ? ` (${license.note})` : ''}`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const opts = { target: null, install: true, report: null, root: ROOT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-install') opts.install = false;
    else if (arg === '--report' || arg === '--root') {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      opts[arg.slice(2)] = path.resolve(argv[++i]);
    } else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else if (opts.target) throw new Error('only one version');
    else opts.target = arg.replace(/^v/, '');
  }
  if (!opts.target) throw new Error('a version is needed');
  return opts;
}

const USAGE = 'usage: upgrade:nocobase <version> [--skip-install] [--report <file>]';

function yarnInstall(root) {
  const args = ['install', '--ignore-engines', '--network-timeout', '600000'];
  return spawnSync('yarn', args, { cwd: root, stdio: 'inherit' }).status === 0;
}

const snapshotFile = (root, target) => path.join(root, 'storage', 'upgrade-nocobase', `keys-before-${target}.json`);

function run(
  argv,
  { log = console.log, error = console.error, install = yarnInstall, fetchText = fetchWithCurl } = {},
) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    error(`${err.message}\n${USAGE}`);
    return 2;
  }
  const versionFile = path.join(opts.root, 'NOCOBASE_VERSION');
  const pkgFile = path.join(opts.root, 'package.json');
  const nodeModules = path.join(opts.root, 'node_modules');
  const current = fs.readFileSync(versionFile, 'utf8').trim();
  const snapshot = snapshotFile(opts.root, opts.target);
  let from;
  let before;
  let changed;
  if (current === opts.target && fs.existsSync(snapshot)) {
    // A second run after a failed install: the versions are already changed.
    ({ from, sources: before, changed } = JSON.parse(fs.readFileSync(snapshot, 'utf8')));
    log(`resuming the upgrade ${from} -> ${opts.target}`);
  } else {
    from = current;
    const problem = checkTarget(from, opts.target);
    if (problem) {
      error(problem);
      return 1;
    }
    before = loadSources(nodeModules);
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    changed = bumpPackageJson(pkg, from, opts.target);
    fs.mkdirSync(path.dirname(snapshot), { recursive: true });
    fs.writeFileSync(snapshot, JSON.stringify({ from, changed, sources: before }));
    fs.writeFileSync(versionFile, `${opts.target}\n`);
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
    log(`NOCOBASE_VERSION and package.json: ${from} -> ${opts.target}`);
  }

  if (opts.install) {
    if (!install(opts.root)) {
      error('yarn install failed; fix it (often the network) and run the same command again to resume');
      return 1;
    }
  }
  const after = loadSources(nodeModules);
  const diff = diffSources(before, after, loadTranslations(path.join(opts.root, LOCALES)));
  const report = formatReport({
    from,
    to: opts.target,
    changed,
    diff,
    license: compareLicense(from, opts.target, fetchText),
  });
  log(report);
  if (opts.report) fs.writeFileSync(opts.report, `${report}\n`);
  fs.rmSync(snapshot, { force: true });
  return 0;
}

module.exports = { bumpPackageJson, checkTarget, compareLicense, diffSources, formatReport, parseArgs, run };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
