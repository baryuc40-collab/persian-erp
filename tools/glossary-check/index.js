#!/usr/bin/env node
// Checks fa-IR.json translations against their en-US source and glossary/fa-IR.csv.
// Errors (exit 1): missing/changed {{placeholders}} or HTML tags, Arabic ي/ك.
// Warnings: glossary term in the English text without its Persian equivalent, keys not in en-US.
// Files: <dir>/fa-IR.json next to <dir>/en-US.json, and plugin-fa's locale pack
// locales/fa-IR/<namespace>.json, whose source is @nocobase/plugin-<namespace> in node_modules (ADR 0003).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const GLOSSARY = path.join(ROOT, 'glossary', 'fa-IR.csv');
const NODE_MODULES = path.join(ROOT, 'node_modules');

function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      fields.push(field);
      field = '';
    } else field += ch;
  }
  fields.push(field);
  return fields;
}

function loadGlossary(file = GLOSSARY) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  return lines
    .slice(1)
    .map(parseCsvLine)
    .map(([en, fa, , note = '']) => ({
      // "View (action)" → "View"; the parenthesised part only disambiguates rows.
      en: en.replace(/\s*\(.*\)\s*$/, ''),
      fa,
      soft: note.includes('بسته به متن') || /\(.*\)/.test(en),
    }))
    .filter((t) => t.en && t.fa)
    .sort((a, b) => b.en.length - a.en.length);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const placeholders = (s) => (s.match(/\{\{\s*[^}]+?\s*\}\}/g) || []).map((p) => p.replace(/\s+/g, '')).sort();
const tags = (s) => (s.match(/<\/?[a-zA-Z][^>]*>/g) || []).map((t) => t.replace(/\s.*?>/, '>')).sort();
// "بلوک داده" also matches its plural and ezafe forms: "بلوک‌های داده"، "مجموعه‌ی داده".
const termPatterns = new Map();
function hasTerm(fa, term) {
  if (fa.includes(term)) return true;
  if (!termPatterns.has(term)) {
    const words = term.split(' ').map((w) => `${escapeRe(w)}(?:\u200c?ها)?(?:\u200c?ی)?`);
    termPatterns.set(term, new RegExp(words.join(' ')));
  }
  return termPatterns.get(term).test(fa);
}
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function checkPair(enMap, faMap, glossary, { sourceKnown = true } = {}) {
  const errors = [];
  const warnings = [];
  for (const [key, fa] of Object.entries(faMap)) {
    if (typeof fa !== 'string') continue;
    const inSource = Object.prototype.hasOwnProperty.call(enMap, key);
    if (!inSource && sourceKnown) warnings.push({ key, message: 'key is not in en-US.json' });
    // NocoBase keys are usually the English text itself.
    const en = inSource && typeof enMap[key] === 'string' && enMap[key] ? enMap[key] : key;
    // Without the en-US file, a key with no placeholders or tags may be an identifier such as
    // "RunJS deprecated since" whose English text has them, so a mismatch cannot be judged here.
    const guessed = !inSource && !sourceKnown && !placeholders(key).length && !tags(key).length;
    const report = guessed ? warnings : errors;
    const unsure = guessed ? ' (en-US source not installed; check again after yarn install)' : '';

    if (!sameList(placeholders(en), placeholders(fa))) {
      report.push({
        key,
        message: `placeholders differ: en ${placeholders(en).join(' ')} / fa ${placeholders(fa).join(' ')}${unsure}`,
      });
    }
    if (!sameList(tags(en), tags(fa))) {
      report.push({ key, message: `HTML tags differ: en ${tags(en).join(' ')} / fa ${tags(fa).join(' ')}${unsure}` });
    }
    if (/[يك]/.test(fa)) errors.push({ key, message: 'uses Arabic ي or ك instead of Persian ی or ک' });

    // Longest terms first; matched spans are masked so "Data source" does not also count as "Data".
    let text = en.replace(/\{\{[^}]*\}\}/g, ' ').replace(/<[^>]+>/g, ' ');
    for (const term of glossary) {
      const re = new RegExp(`\\b${escapeRe(term.en)}(e?s)?\\b`, 'i');
      if (!re.test(text)) continue;
      text = text.replace(new RegExp(re.source, 'gi'), ' ');
      if (!term.soft && !hasTerm(fa, term.fa)) {
        warnings.push({ key, message: `"${term.en}" should be translated as "${term.fa}"` });
      }
    }
  }
  return { errors, warnings };
}

function findFaFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...findFaFiles(full));
    else if (entry.name === 'fa-IR.json') out.push(full);
    else if (path.basename(target) === 'fa-IR' && entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

// Without node_modules (e.g. CI's lightweight job) a locale pack's source is unknown:
// keys are still checked, using the key itself as the English text.
function sourceFile(file, nodeModules) {
  if (path.basename(file) === 'fa-IR.json') return path.join(path.dirname(file), 'en-US.json');
  const namespace = path.basename(file, '.json');
  return path.join(nodeModules, '@nocobase', `plugin-${namespace}`, 'dist', 'locale', 'en-US.json');
}

function run(argv) {
  const json = argv.includes('--json');
  const nmIndex = argv.indexOf('--node-modules');
  const nodeModules = nmIndex >= 0 ? path.resolve(argv[nmIndex + 1]) : NODE_MODULES;
  const targets = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--node-modules');
  if (!targets.length) {
    console.error('usage: glossary-check <fa-IR.json | directory>... [--json] [--node-modules <dir>]');
    return 2;
  }
  const glossary = loadGlossary();
  const results = [];
  for (const file of targets.flatMap(findFaFiles)) {
    const enFile = sourceFile(file, nodeModules);
    const sourceKnown = fs.existsSync(enFile);
    const enMap = sourceKnown ? JSON.parse(fs.readFileSync(enFile, 'utf8')) : {};
    const faMap = JSON.parse(fs.readFileSync(file, 'utf8'));
    results.push({ file, ...checkPair(enMap, faMap, glossary, { sourceKnown }) });
  }
  const errorCount = results.reduce((n, r) => n + r.errors.length, 0);
  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      for (const e of r.errors) console.log(`ERROR   ${r.file} [${e.key}] ${e.message}`);
      for (const w of r.warnings) console.log(`WARNING ${r.file} [${w.key}] ${w.message}`);
    }
    const warningCount = results.reduce((n, r) => n + r.warnings.length, 0);
    console.log(`${results.length} file(s), ${errorCount} error(s), ${warningCount} warning(s)`);
  }
  return errorCount ? 1 : 0;
}

module.exports = { checkPair, findFaFiles, loadGlossary, placeholders, sourceFile, tags };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
