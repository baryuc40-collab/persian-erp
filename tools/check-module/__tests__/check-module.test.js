const test = require('node:test');
const assert = require('node:assert');
const { checkModule } = require('..');

// A small module that follows every rule; each test breaks one rule in a copy of it.
const good = () => ({
  format: 'persian-erp-module',
  formatVersion: 1,
  module: { key: 'crm', title: 'مشتریان', version: '1.0.0', description: '' },
  nocobase: '2.2.24',
  requires: {
    collections: ['users'],
    fieldInterfaces: ['input', 'datetime', 'iranNationalId', 'm2o', 'currencyIRR'],
    fieldTypes: ['string', 'date', 'belongsTo', 'bigInt'],
    workflowTriggers: ['collection'],
    workflowInstructions: ['update'],
    models: [],
  },
  collections: [
    {
      name: 'crm_people',
      title: 'شخص',
      fields: [
        { name: 'id', type: 'bigInt', interface: 'integer', uiSchema: { title: '{{t("ID")}}' } },
        { name: 'name', type: 'string', interface: 'input', uiSchema: { title: 'نام' } },
        { name: 'nationalId', type: 'string', interface: 'iranNationalId', uiSchema: { title: 'کد ملی' } },
        { name: 'birthDate', type: 'date', interface: 'datetime', uiSchema: { title: 'تاریخ تولد' } },
        { name: 'credit', type: 'bigInt', interface: 'currencyIRR', uiSchema: { title: 'مبلغ اعتبار' } },
        { name: 'owner', type: 'belongsTo', interface: 'm2o', target: 'users', uiSchema: { title: 'مسئول' } },
        { name: 'ownerId', type: 'bigInt', interface: 'integer', isForeignKey: true, uiSchema: { title: 'ownerId' } },
      ],
    },
  ],
  routes: {
    ref: 'crmgroup',
    type: 'group',
    title: 'مشتریان',
    children: [
      { ref: 'crmpage', type: 'flowPage', title: 'اشخاص', children: [{ ref: 'crmtab', type: 'tabs', hidden: true }] },
    ],
  },
  uiSchemas: [],
  flowModels: [
    { uid: 'crmtable', use: 'TableBlockModel', stepParams: { resourceSettings: { init: { collectionName: 'crm_people', dataSourceKey: 'main' } } } },
  ],
  flowModelTemplates: [],
  flowModelTemplateUsages: [],
  workflows: [
    {
      key: 'crmwelcome',
      type: 'collection',
      title: 'خوش‌آمد',
      description: 'وقتی شخص تازه ثبت شود، مسئولش را خود ثبت‌کننده می‌گذارد.',
      config: { collection: 'crm_people', mode: 1 },
      nodes: [{ key: 'crmnode1', type: 'update', config: { collection: 'crm_people' } }],
    },
  ],
  roles: [
    { name: 'crm_clerk', title: 'کارمند فروش', snippets: ['!pm', '!pm.*', '!ui.*'], strategy: { actions: ['view'] }, resources: [], scopes: [], routes: [] },
  ],
});

const rules = (file, severity = 'error') =>
  checkModule(file)
    .filter((f) => f.severity === severity)
    .map((f) => `${f.rule} ${f.path}`);

test('a module that follows the standard passes', () => {
  assert.deepStrictEqual(checkModule(good()), []);
});

test('M000: a file that is not a module', () => {
  assert.deepStrictEqual(rules({ format: 'something' }), ['M000 ']);
});

test('M001: the key and the prefix of collections and roles', () => {
  const bad = good();
  bad.collections.push({ name: 'people', title: 'افراد', fields: [] });
  bad.roles[0].name = 'clerk';
  assert.deepStrictEqual(rules(bad), ['M001 collections[people]', 'M001 roles[clerk]']);
  const badKey = good();
  badKey.module.key = 'CRM';
  assert.deepStrictEqual(rules(badKey), ['M001 module.key']);
});

test('M002: Persian titles, without Arabic letters', () => {
  const bad = good();
  bad.collections[0].title = 'People';
  bad.collections[0].fields[1].uiSchema.title = '';
  bad.routes.children[0].title = 'كارها';
  bad.roles[0].title = undefined;
  assert.deepStrictEqual(rules(bad), [
    'M002 collections[crm_people].title',
    'M002 collections[crm_people].fields[name].uiSchema.title',
    'M002 routes[crmgroup].children[crmpage].title',
    'M002 roles[crm_clerk].title',
  ]);
});

test('M003: a date kept in a text field', () => {
  const bad = good();
  bad.collections[0].fields[3].interface = 'input';
  bad.requires.fieldInterfaces.push('input');
  assert.deepStrictEqual(rules(bad), ['M003 collections[crm_people].fields[birthDate]']);
});

test('M004: an Iranian identifier in a plain field is a warning', () => {
  const bad = good();
  bad.collections[0].fields[2].interface = 'input';
  bad.collections[0].fields[4].interface = 'number';
  bad.requires.fieldInterfaces.push('number');
  assert.deepStrictEqual(rules(bad), []);
  assert.deepStrictEqual(rules(bad, 'warning'), [
    'M004 collections[crm_people].fields[nationalId]',
    'M004 collections[crm_people].fields[credit]',
  ]);
});

test('M005: a role with limited access', () => {
  const none = good();
  none.roles = [];
  assert.deepStrictEqual(rules(none), ['M005 roles']);
  const broad = good();
  broad.roles[0].snippets = ['ui.*'];
  assert.deepStrictEqual(rules(broad), ['M005 roles']);
  const writesAll = good();
  writesAll.roles[0].strategy = { actions: ['view', 'update'] };
  assert.deepStrictEqual(rules(writesAll), ['M005 roles']);
});

test('M006: workflows have a Persian title and a description', () => {
  const bad = good();
  bad.workflows[0].title = 'Welcome';
  bad.workflows[0].description = ' ';
  assert.deepStrictEqual(rules(bad), ['M002 workflows[crmwelcome].title', 'M006 workflows[crmwelcome].description']);
});

test('M007: what the module uses from outside is in requires', () => {
  const bad = good();
  bad.requires.collections = [];
  bad.requires.workflowInstructions = [];
  bad.flowModels[0].stepParams.resourceSettings.init.collectionName = 'departments';
  assert.deepStrictEqual(rules(bad), [
    'M007 collections[crm_people].fields[owner].target',
    'M007 flowModels[crmtable]',
    'M007 workflows[crmwelcome].nodes[crmnode1].type',
  ]);
});

test('M007: a classic page that shows a collection the module does not have', () => {
  const bad = good();
  bad.uiSchemas = [
    { 'x-uid': 'crmlist', 'x-decorator': 'TableBlockProvider', 'x-decorator-props': { collection: 'crm_peple', action: 'list' } },
  ];
  assert.deepStrictEqual(rules(bad), ['M007 uiSchemas[crmlist]']);
});
