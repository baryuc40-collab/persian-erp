#!/usr/bin/env node
// Reports how much of each NocoBase package is translated in plugin-fa's locale pack.
// Source keys: node_modules/@nocobase/plugin-*/dist/locale/en-US.json (namespace = name without the prefix).
// Translations: packages/plugins/@persian-erp/plugin-fa/locales/fa-IR/<namespace>.json (ADR 0003).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PLUGIN_PREFIX = 'plugin-';
const DEFAULTS = {
  nodeModules: path.join(ROOT, 'node_modules'),
  locales: path.join(ROOT, 'packages', 'plugins', '@persian-erp', 'plugin-fa', 'locales', 'fa-IR'),
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const isTranslated = (value) => typeof value === 'string' && value.trim() !== '';

// { namespace: { package, keys: string[] } } for every installed package that ships en-US strings.
function loadSources(nodeModules) {
  const scope = path.join(nodeModules, '@nocobase');
  const sources = {};
  if (!fs.existsSync(scope)) return sources;
  for (const dir of fs.readdirSync(scope).sort()) {
    if (!dir.startsWith(PLUGIN_PREFIX)) continue;
    const file = path.join(scope, dir, 'dist', 'locale', 'en-US.json');
    if (!fs.existsSync(file)) continue;
    const keys = Object.entries(readJson(file))
      .filter(([, v]) => typeof v === 'string')
      .map(([k]) => k);
    if (keys.length) sources[dir.slice(PLUGIN_PREFIX.length)] = { package: `@nocobase/${dir}`, keys };
  }
  return sources;
}

function loadTranslations(localesDir) {
  const translations = {};
  if (!fs.existsSync(localesDir)) return translations;
  for (const file of fs.readdirSync(localesDir).sort()) {
    if (file.endsWith('.json')) translations[file.slice(0, -'.json'.length)] = readJson(path.join(localesDir, file));
  }
  return translations;
}

const percent = (done, total) => (total ? Math.round((done / total) * 1000) / 10 : 100);

function buildReport(sources, translations) {
  const packages = Object.entries(sources).map(([namespace, { package: pkg, keys }]) => {
    const fa = translations[namespace] || {};
    const missing = keys.filter((k) => !isTranslated(fa[k]));
    const known = new Set(keys);
    return {
      namespace,
      package: pkg,
      total: keys.length,
      translated: keys.length - missing.length,
      coverage: percent(keys.length - missing.length, keys.length),
      missing,
      extra: Object.keys(fa).filter((k) => !known.has(k)),
    };
  });
  packages.sort((a, b) => b.total - a.total || a.namespace.localeCompare(b.namespace));
  const total = packages.reduce((n, p) => n + p.total, 0);
  const translated = packages.reduce((n, p) => n + p.translated, 0);
  return {
    total,
    translated,
    coverage: percent(translated, total),
    packages,
    // Locale files with no installed package behind them: a typo, or a plugin that was removed.
    orphans: Object.keys(translations).filter((ns) => !sources[ns]),
  };
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS, json: false, missing: false, min: null, only: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === '--json') opts.json = true;
    else if (arg === '--missing') opts.missing = true;
    else if (arg === '--min') {
      opts.min = Number(value());
      if (!Number.isFinite(opts.min)) throw new Error('--min needs a number');
    } else if (arg === '--package') opts.only.push(value());
    else if (arg === '--node-modules') opts.nodeModules = path.resolve(value());
    else if (arg === '--locales') opts.locales = path.resolve(value());
    else throw new Error(`unknown option ${arg}`);
  }
  return opts;
}

const USAGE =
  'usage: i18n-report [--json] [--missing] [--min <percent>] [--package <namespace>]... [--node-modules <dir>] [--locales <dir>]';

function run(argv, log = console.log) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`${err.message}\n${USAGE}`);
    return 2;
  }
  let sources = loadSources(opts.nodeModules);
  if (!Object.keys(sources).length) {
    console.error(`no @nocobase/plugin-*/dist/locale/en-US.json under ${opts.nodeModules}; run yarn install first`);
    return 2;
  }
  if (opts.only.length) {
    const unknown = opts.only.filter((ns) => !sources[ns]);
    if (unknown.length) {
      console.error(`unknown namespace(s): ${unknown.join(', ')}`);
      return 2;
    }
    sources = Object.fromEntries(opts.only.map((ns) => [ns, sources[ns]]));
  }
  const report = buildReport(sources, loadTranslations(opts.locales));

  if (opts.json) {
    log(JSON.stringify(report, null, 2));
  } else {
    const width = Math.max(...report.packages.map((p) => p.namespace.length), 'namespace'.length);
    log(`${'namespace'.padEnd(width)}  ${'done'.padStart(5)} / ${'keys'.padStart(5)}  coverage`);
    for (const p of report.packages) {
      log(
        `${p.namespace.padEnd(width)}  ${String(p.translated).padStart(5)} / ${String(p.total).padStart(
          5,
        )}  ${p.coverage.toFixed(1).padStart(6)}%`,
      );
      if (opts.missing) for (const k of p.missing) log(`  - ${k}`);
      for (const k of p.extra) log(`  ! not in en-US: ${k}`);
    }
    for (const ns of report.orphans) log(`! ${ns}.json has no installed @nocobase/plugin-${ns}`);
    log(
      `total: ${report.translated} / ${report.total} keys (${report.coverage.toFixed(1)}%) in ${
        report.packages.length
      } package(s)`,
    );
  }

  if (opts.min !== null && report.coverage < opts.min) {
    console.error(`coverage ${report.coverage}% is below --min ${opts.min}%`);
    return 1;
  }
  return 0;
}

module.exports = { buildReport, loadSources, loadTranslations, parseArgs, run };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
