#!/usr/bin/env node
// Fills untranslated keys of one namespace in plugin-fa's locale pack (ADR 0003).
//
//   i18n-translate <namespace>                 translate with the Claude API (ANTHROPIC_API_KEY)
//   i18n-translate <namespace> --export <file> write the untranslated keys to a JSON file
//   i18n-translate <namespace> --import <file> merge translations from a JSON file
//
// Every new translation is checked with glossary-check; ones with errors are retried once
// (API mode) or left out and reported. Existing translations are kept unless --force is given.
const fs = require('fs');
const path = require('path');
const { checkPair, loadGlossary } = require('../glossary-check');
const { loadSources, loadTranslations } = require('../i18n-report');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULTS = {
  nodeModules: path.join(ROOT, 'node_modules'),
  locales: path.join(ROOT, 'packages', 'plugins', '@persian-erp', 'plugin-fa', 'locales', 'fa-IR'),
  styleGuide: path.join(ROOT, 'docs', 'style-guide-fa.md'),
  glossaryCsv: path.join(ROOT, 'glossary', 'fa-IR.csv'),
  model: process.env.I18N_TRANSLATE_MODEL || 'claude-sonnet-5-5',
  batchSize: 60,
};
const API_URL = 'https://api.anthropic.com/v1/messages';

const isTranslated = (value) => typeof value === 'string' && value.trim() !== '';

function parseArgs(argv) {
  const opts = {
    ...DEFAULTS,
    force: false,
    dryRun: false,
    limit: Infinity,
    namespace: null,
    exportFile: null,
    importFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    const number = () => {
      const n = Number(value());
      if (!Number.isInteger(n) || n <= 0) throw new Error(`${arg} needs a positive integer`);
      return n;
    };
    if (arg === '--force') opts.force = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--limit') opts.limit = number();
    else if (arg === '--batch-size') opts.batchSize = number();
    else if (arg === '--model') opts.model = value();
    else if (arg === '--export') opts.exportFile = path.resolve(value());
    else if (arg === '--import') opts.importFile = path.resolve(value());
    else if (arg === '--node-modules') opts.nodeModules = path.resolve(value());
    else if (arg === '--locales') opts.locales = path.resolve(value());
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else if (!opts.namespace) opts.namespace = arg;
    else throw new Error(`unexpected argument ${arg}`);
  }
  if (!opts.namespace) throw new Error('namespace is required');
  if (opts.exportFile && opts.importFile) throw new Error('use either --export or --import');
  return opts;
}

const USAGE =
  'usage: i18n-translate <namespace> [--export <file> | --import <file>] [--force] [--limit <n>] [--batch-size <n>] [--model <id>] [--dry-run]';

// Keys in en-US order first, so diffs stay stable; keys en-US no longer has go last.
function orderLike(keys, map) {
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(map, k)) out[k] = map[k];
  for (const k of Object.keys(map)) if (!(k in out)) out[k] = map[k];
  return out;
}

function writeLocale(file, keys, map) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(orderLike(keys, map), null, 2) + '\n');
}

// Splits new translations into ones that pass glossary-check errors and ones that do not.
function validate(enMap, candidates, glossary) {
  const { errors, warnings } = checkPair(enMap, candidates, glossary);
  const bad = {};
  for (const e of errors) (bad[e.key] = bad[e.key] || []).push(e.message);
  const good = Object.fromEntries(Object.entries(candidates).filter(([k, v]) => isTranslated(v) && !bad[k]));
  return { good, bad, warnings };
}

function systemPrompt(opts) {
  const style = fs.readFileSync(opts.styleGuide, 'utf8');
  const glossary = fs.readFileSync(opts.glossaryCsv, 'utf8');
  return [
    'You translate the user interface of NocoBase, a no-code platform, from English to Persian (fa-IR).',
    'Follow the style guide and use the glossary equivalents exactly. Keep {{placeholders}}, HTML tags,',
    'Markdown and URLs unchanged. Use Persian ی and ک, never Arabic ي or ك. Use the zero-width non-joiner',
    'where Persian spelling needs it (e.g. می‌شود). Product names stay in English.',
    'Reply with one JSON object mapping each given key to its Persian translation and nothing else.',
    '',
    '# Style guide',
    style,
    '',
    '# Glossary (CSV: en,fa,category,note)',
    glossary,
  ].join('\n');
}

function parseJsonReply(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('reply has no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

async function callClaude({ apiKey, model, system, items, feedback, fetchImpl }) {
  const lines = [
    `Namespace: ${items.namespace}`,
    'Translate these entries (key: English text):',
    JSON.stringify(items.entries, null, 2),
  ];
  if (feedback) lines.push('', 'A previous translation of these keys failed checks:', feedback);
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      // The style guide and glossary are identical for every batch, so they are cached.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: lines.join('\n') }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const text = (body.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
  return parseJsonReply(text);
}

async function translateWithApi({ opts, namespace, enMap, todo, glossary, log, fetchImpl, apiKey }) {
  const system = systemPrompt(opts);
  const accepted = {};
  const rejected = {};
  for (let i = 0; i < todo.length; i += opts.batchSize) {
    const keys = todo.slice(i, i + opts.batchSize);
    const entries = Object.fromEntries(keys.map((k) => [k, enMap[k]]));
    log(`batch ${i / opts.batchSize + 1}: ${keys.length} key(s)`);
    let reply = await callClaude({ apiKey, model: opts.model, system, items: { namespace, entries }, fetchImpl });
    let { good, bad } = validate(enMap, pick(reply, keys), glossary);
    Object.assign(accepted, good);
    const retryKeys = keys.filter((k) => !(k in good));
    if (retryKeys.length) {
      const feedback = retryKeys
        .map((k) => `${JSON.stringify(k)}: ${(bad[k] || ['missing from reply']).join('; ')}`)
        .join('\n');
      reply = await callClaude({
        apiKey,
        model: opts.model,
        system,
        items: { namespace, entries: Object.fromEntries(retryKeys.map((k) => [k, enMap[k]])) },
        feedback,
        fetchImpl,
      });
      ({ good, bad } = validate(enMap, pick(reply, retryKeys), glossary));
      Object.assign(accepted, good);
      for (const k of retryKeys) if (!(k in good)) rejected[k] = bad[k] || ['missing from reply'];
    }
  }
  return { accepted, rejected };
}

const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj && typeof obj[k] === 'string').map((k) => [k, obj[k]]));

async function run(
  argv,
  { log = console.log, error = console.error, env = process.env, fetchImpl = globalThis.fetch } = {},
) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    error(`${err.message}\n${USAGE}`);
    return 2;
  }
  const source = loadSources(opts.nodeModules)[opts.namespace];
  if (!source) {
    error(`پکیج @nocobase/plugin-${opts.namespace} با فایل en-US در ${opts.nodeModules} پیدا نشد.`);
    return 2;
  }
  const enFile = path.join(opts.nodeModules, '@nocobase', `plugin-${opts.namespace}`, 'dist', 'locale', 'en-US.json');
  const enMap = JSON.parse(fs.readFileSync(enFile, 'utf8'));
  const faFile = path.join(opts.locales, `${opts.namespace}.json`);
  const faMap = loadTranslations(opts.locales)[opts.namespace] || {};
  const todo = source.keys.filter((k) => opts.force || !isTranslated(faMap[k])).slice(0, opts.limit);
  const glossary = loadGlossary(opts.glossaryCsv);

  if (opts.exportFile) {
    const entries = Object.fromEntries(todo.map((k) => [k, enMap[k]]));
    fs.writeFileSync(opts.exportFile, JSON.stringify(entries, null, 2) + '\n');
    log(`${todo.length} key(s) of ${opts.namespace} written to ${opts.exportFile}`);
    return 0;
  }

  let accepted;
  let rejected;
  if (opts.importFile) {
    const incoming = JSON.parse(fs.readFileSync(opts.importFile, 'utf8'));
    const allowed = new Set(todo);
    const unknown = Object.keys(incoming).filter((k) => !source.keys.includes(k));
    for (const k of unknown) log(`skipped (not in en-US): ${k}`);
    const candidates = Object.fromEntries(Object.entries(incoming).filter(([k]) => allowed.has(k)));
    const skipped = Object.keys(incoming).length - unknown.length - Object.keys(candidates).length;
    if (skipped) log(`${skipped} key(s) already translated; use --force to replace them`);
    const result = validate(enMap, candidates, glossary);
    accepted = result.good;
    rejected = Object.fromEntries(
      Object.keys(candidates)
        .filter((k) => !(k in result.good))
        .map((k) => [k, result.bad[k] || ['empty translation']]),
    );
  } else {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      error(
        'کلید API پیدا نشد: متغیر محیطی ANTHROPIC_API_KEY را تنظیم کنید. چیزی تغییر نکرد.\n' +
          `بدون کلید: کلیدها را با --export بگیرید، ترجمه کنید و با --import برگردانید.`,
      );
      return 2;
    }
    if (!todo.length) {
      log(`${opts.namespace}: nothing to translate`);
      return 0;
    }
    try {
      ({ accepted, rejected } = await translateWithApi({
        opts,
        namespace: opts.namespace,
        enMap,
        todo,
        glossary,
        log,
        fetchImpl,
        apiKey,
      }));
    } catch (err) {
      error(`ترجمه متوقف شد: ${err.message}. چیزی تغییر نکرد.`);
      return 1;
    }
  }

  for (const [k, msgs] of Object.entries(rejected)) log(`REJECTED [${k}] ${msgs.join('; ')}`);
  const { warnings } = checkPair(enMap, accepted, glossary);
  for (const w of warnings) log(`WARNING [${w.key}] ${w.message}`);
  if (!opts.dryRun && Object.keys(accepted).length) writeLocale(faFile, source.keys, { ...faMap, ...accepted });
  log(
    `${opts.namespace}: ${Object.keys(accepted).length} translated, ${Object.keys(rejected).length} rejected, ` +
      `${warnings.length} warning(s)${opts.dryRun ? ' (dry run, nothing written)' : ''}`,
  );
  return Object.keys(rejected).length ? 1 : 0;
}

module.exports = { orderLike, parseArgs, parseJsonReply, run, validate };

if (require.main === module) run(process.argv.slice(2)).then((code) => (process.exitCode = code));
