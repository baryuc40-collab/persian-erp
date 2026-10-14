#!/usr/bin/env node
// Checks an ERP module file (<key>.erp-module.json) against the module standard, docs/modules/standard.md.
// Each finding names its rule (M001...) and where it is in the file. Errors exit 1; warnings (M004, which guesses
// from names) are printed but do not fail the check.
const fs = require('fs');

const MODULE_FORMAT = 'persian-erp-module';
const MODULE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,19}$/;

// Fields NocoBase adds to every collection; their titles are translation templates and they are never edited.
const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'createdById', 'updatedById', 'sort']);
const TEXT_INTERFACES = new Set(['input', 'textarea']);
const RELATION_TYPES = new Set(['belongsTo', 'hasOne', 'hasMany', 'belongsToMany', 'belongsToArray']);

// Iranian field types of plugin-fa and the names or titles that call for them (M004).
const IRANIAN_FIELDS = [
  { interface: 'iranLegalId', name: /legal_?id/i, title: /شناسه(‌?ی)?\s*ملی/ },
  { interface: 'iranNationalId', name: /national_?id|national_?code/i, title: /کد\s*ملی/ },
  { interface: 'iranSheba', name: /sheba|iban/i, title: /شبا/ },
  { interface: 'iranPostalCode', name: /postal_?code|zip_?code/i, title: /کد\s*پستی/ },
  { interface: 'iranMobile', name: /mobile/i, title: /موبایل|تلفن\s*همراه/ },
  { interface: 'currencyIRR', name: /amount|price|cost/i, title: /مبلغ|قیمت|هزینه/ },
];

const isTemplate = (text) => /^\s*\{\{\s*t\(/.test(text);
const hasPersian = (text) => /[؀-ۿ]/.test(text);
const hasArabicLetters = (text) => /[يك]/.test(text);
const fieldTitle = (field) => (field.uiSchema && typeof field.uiSchema.title === 'string' ? field.uiSchema.title : '');

// "ds:name" or "name" (main data source) in workflow configs.
const collectionFromConfig = (value) => {
  if (typeof value !== 'string' || !value) return null;
  const [dataSource, name] = value.includes(':') ? value.split(':', 2) : ['main', value];
  return dataSource === 'main' ? name : null;
};

// Collections a classic schema or a modern model refers to; the same keys plugin-modules follows on export.
function pageCollections(value, into = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => pageCollections(item, into));
    return into;
  }
  if (!value || typeof value !== 'object') return into;
  const dataSource = value.dataSourceKey ?? value.dataSource;
  const isMain = dataSource === undefined || dataSource === null || dataSource === 'main';
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && child) {
      if (key === 'collectionName' && isMain) into.add(child);
      if (key === 'associationName' && isMain) into.add(child.split('.')[0]);
      if (key === 'x-collection-field') into.add(child.split('.')[0]);
      if (key === 'x-acl-action' && child.includes(':')) into.add(child.split(':')[0]);
    }
    if (key === 'x-decorator-props' && child && typeof child === 'object') {
      const main = child.dataSource === undefined || child.dataSource === 'main';
      if (main && typeof child.collection === 'string' && child.collection) into.add(child.collection);
      if (main && typeof child.association === 'string' && child.association) into.add(child.association.split('.')[0]);
    }
    pageCollections(child, into);
  }
  return into;
}

const routesOf = (route, path = 'routes') =>
  route && typeof route === 'object'
    ? [
        { route, path: `${path}[${route.ref}]` },
        ...(route.children || []).flatMap((child) => routesOf(child, `${path}[${route.ref}].children`)),
      ]
    : [];

/** Checks a parsed module file; returns findings as { rule, severity, path, message }. */
function checkModule(file) {
  const findings = [];
  const error = (rule, path, message) => findings.push({ rule, severity: 'error', path, message });
  const warning = (rule, path, message) => findings.push({ rule, severity: 'warning', path, message });

  if (!file || typeof file !== 'object' || file.format !== MODULE_FORMAT) {
    error('M000', '', 'not an ERP module file');
    return findings;
  }
  const list = (value) => (Array.isArray(value) ? value : []);
  const collections = list(file.collections);
  const workflows = list(file.workflows);
  const roles = list(file.roles);
  const routes = routesOf(file.routes);
  const key = file.module && file.module.key;

  // M001: the key, and the prefix on the names of collections and roles.
  if (typeof key !== 'string' || !MODULE_KEY_PATTERN.test(key)) {
    error('M001', 'module.key', 'the key must be 2 to 20 lower-case Latin letters, digits or _, starting with a letter');
  } else {
    for (const collection of collections) {
      if (!String(collection.name).startsWith(`${key}_`)) {
        error('M001', `collections[${collection.name}]`, `the collection name must start with "${key}_"`);
      }
    }
    for (const role of roles) {
      if (!String(role.name).startsWith(`${key}_`)) {
        error('M001', `roles[${role.name}]`, `the role name must start with "${key}_"`);
      }
    }
  }

  // M002: Persian titles for the module, collections, fields, menus and roles.
  const persianTitle = (path, title, what) => {
    const text = typeof title === 'string' ? title.trim() : '';
    if (!text) error('M002', path, `the ${what} has no title`);
    else if (isTemplate(text)) return;
    else if (!hasPersian(text)) error('M002', path, `the ${what} title "${text}" is not Persian`);
    else if (hasArabicLetters(text)) error('M002', path, `the ${what} title "${text}" uses Arabic ي or ك instead of ی or ک`);
  };
  persianTitle('module.title', file.module && file.module.title, 'module');
  const ownFields = [];
  for (const collection of collections) {
    persianTitle(`collections[${collection.name}].title`, collection.title, 'collection');
    for (const field of list(collection.fields)) {
      if (SYSTEM_FIELDS.has(field.name) || field.isForeignKey || !field.interface) continue;
      const path = `collections[${collection.name}].fields[${field.name}]`;
      ownFields.push({ field, path });
      persianTitle(`${path}.uiSchema.title`, fieldTitle(field), 'field');
    }
  }
  for (const { route, path } of routes) {
    // Tabs of a modern page are named by the page unless there are several.
    if (route.type === 'tabs' || route.hidden) continue;
    persianTitle(`${path}.title`, route.title, 'menu item');
  }
  for (const role of roles) persianTitle(`roles[${role.name}].title`, role.title, 'role');

  // M003: dates are date fields, which plugin-fa shows and picks in the Jalali calendar; a date in a text field is not.
  for (const { field, path } of ownFields) {
    const looksLikeDate = /تاریخ/.test(fieldTitle(field)) || /(^|_)(date|time)$|Date$|At$/.test(field.name);
    if (looksLikeDate && TEXT_INTERFACES.has(field.interface)) {
      error('M003', path, `"${field.name}" holds a date in a ${field.interface} field; use a date field`);
    }
  }

  // M004: Iranian field types where the meaning fits (a guess from names, so only a warning).
  for (const { field, path } of ownFields) {
    const kind = IRANIAN_FIELDS.find((k) => k.name.test(field.name) || k.title.test(fieldTitle(field)));
    if (kind && field.interface !== kind.interface) {
      warning('M004', path, `"${field.name}" looks like a ${kind.interface} field but is ${field.interface}`);
    }
  }

  // M005: at least one role with limited access, for the people who use the module day to day.
  const limited = (role) => {
    const snippets = list(role.snippets);
    const broad = ['pm', 'pm.*', 'ui.*'].some((snippet) => snippets.includes(snippet));
    const actions = list(role.strategy && role.strategy.actions);
    const writesAll = ['create', 'update', 'destroy'].some((action) => actions.includes(action));
    return !broad && !writesAll && role.allowConfigure !== true;
  };
  if (!roles.length) error('M005', 'roles', 'the module has no role');
  else if (!roles.some(limited)) {
    error('M005', 'roles', 'every role can configure the system or change every collection; add a role with limited access');
  }

  // M006: workflows have a Persian title and a description of what they do.
  for (const workflow of workflows) {
    const path = `workflows[${workflow.key}]`;
    persianTitle(`${path}.title`, workflow.title, 'workflow');
    if (typeof workflow.description !== 'string' || !workflow.description.trim()) {
      error('M006', `${path}.description`, 'the workflow has no description');
    }
  }

  // M007: everything outside the module that it uses is declared in requires.
  const requires = file.requires || {};
  const own = new Set(collections.map((c) => c.name));
  const declared = (name) => list(requires[name]);
  const outside = new Map();
  const use = (name, path) => {
    if (name && !own.has(name) && !outside.has(name)) outside.set(name, path);
  };
  for (const collection of collections) {
    for (const parent of [].concat(collection.inherits || [])) use(parent, `collections[${collection.name}].inherits`);
    for (const field of list(collection.fields)) {
      if (RELATION_TYPES.has(field.type)) {
        use(field.target, `collections[${collection.name}].fields[${field.name}].target`);
        use(field.through, `collections[${collection.name}].fields[${field.name}].through`);
      }
    }
  }
  for (const workflow of workflows) {
    use(collectionFromConfig(workflow.config && workflow.config.collection), `workflows[${workflow.key}].config.collection`);
    for (const node of list(workflow.nodes)) {
      use(collectionFromConfig(node.config && node.config.collection), `workflows[${workflow.key}].nodes[${node.key}].config.collection`);
    }
  }
  for (const [section, id] of [['uiSchemas', 'x-uid'], ['flowModels', 'uid']]) {
    for (const page of list(file[section])) {
      for (const name of pageCollections(page)) use(name, `${section}[${page[id]}]`);
    }
  }
  for (const [name, path] of outside) {
    if (!declared('collections').includes(name)) {
      error('M007', path, `uses the collection "${name}" from outside the module without listing it in requires.collections`);
    }
  }
  const declaredOnce = (section, value, path, what) => {
    if (value && !declared(section).includes(value)) {
      error('M007', path, `uses the ${what} "${value}" without listing it in requires.${section}`);
    }
  };
  for (const { field, path } of ownFields) declaredOnce('fieldInterfaces', field.interface, path, 'field interface');
  for (const workflow of workflows) {
    declaredOnce('workflowTriggers', workflow.type, `workflows[${workflow.key}].type`, 'workflow trigger');
    for (const node of list(workflow.nodes)) {
      declaredOnce('workflowInstructions', node.type, `workflows[${workflow.key}].nodes[${node.key}].type`, 'workflow node type');
      if (node.type === 'notification' && node.config && typeof node.config.channelName === 'string') {
        declaredOnce('notificationChannels', node.config.channelName, `workflows[${workflow.key}].nodes[${node.key}].config.channelName`, 'notification channel');
      }
    }
  }
  return findings;
}

function run(argv) {
  const json = argv.includes('--json');
  const files = argv.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: check-module <file.erp-module.json>... [--json]');
    return 2;
  }
  let errors = 0;
  const results = [];
  for (const name of files) {
    let findings;
    try {
      findings = checkModule(JSON.parse(fs.readFileSync(name, 'utf8')));
    } catch (e) {
      findings = [{ rule: 'M000', severity: 'error', path: '', message: `cannot read the file: ${e.message}` }];
    }
    errors += findings.filter((f) => f.severity === 'error').length;
    results.push({ file: name, findings });
  }
  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const { file, findings } of results) {
      for (const f of findings) {
        console.log(`${f.severity === 'error' ? 'ERROR  ' : 'WARNING'} ${f.rule} ${file}${f.path ? ` ${f.path}` : ''}: ${f.message}`);
      }
      const count = (severity) => findings.filter((f) => f.severity === severity).length;
      console.log(`${file}: ${count('error')} error(s), ${count('warning')} warning(s)`);
    }
  }
  return errors ? 1 : 0;
}

module.exports = { checkModule, run };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
