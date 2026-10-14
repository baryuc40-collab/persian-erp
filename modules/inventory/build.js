#!/usr/bin/env node
// Builds the «انبار» reference module (EPIC-019) on a fresh install through the same HTTP actions the NocoBase UI uses
// (collections:create, flowSurfaces:applyBlueprint, roles:create ...), then exports it with erpModules:export.
// The module file is never written by hand; to change the module, change this script and run it again.
//
// usage: node modules/inventory/build.js <base-url> <email> <password> [output file]
const fs = require('fs');
const path = require('path');

const [baseURL, account, password, output = path.join(__dirname, 'inventory.erp-module.json')] = process.argv.slice(2);
if (!baseURL || !account || !password) {
  console.error('usage: build.js <base-url> <email> <password> [output file]');
  process.exit(2);
}

const KEY = 'inventory';
const VERSION = '1.0.0';
let token;

async function call(action, body, { text = false } = {}) {
  const res = await fetch(`${baseURL}/api/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Role': 'root', 'X-Locale': 'fa-IR', ...(token ? { Authorization: `Bearer ${token}` } : { 'X-Authenticator': 'basic' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const content = await res.text();
  if (!res.ok) throw new Error(`${action}: ${res.status} ${content.slice(0, 2000)}`);
  return text ? content : JSON.parse(content).data;
}

const list = (resource, filter) => call(`${resource}:list?paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`);

// The fields every collection made from the "General collection" template starts with.
const SYSTEM_FIELDS = [
  { name: 'id', type: 'snowflakeId', autoIncrement: false, primaryKey: true, allowNull: false, interface: 'snowflakeId', uiSchema: { type: 'number', title: '{{t("ID")}}', 'x-component': 'InputNumber', 'x-component-props': { stringMode: true, separator: '0.00', step: '1' }, 'x-validator': 'integer' } },
  { name: 'createdAt', interface: 'createdAt', type: 'date', field: 'createdAt', uiSchema: { type: 'datetime', title: '{{t("Created at")}}', 'x-component': 'DatePicker', 'x-component-props': {}, 'x-read-pretty': true } },
  { name: 'createdBy', interface: 'createdBy', type: 'belongsTo', target: 'users', foreignKey: 'createdById', uiSchema: { type: 'object', title: '{{t("Created by")}}', 'x-component': 'AssociationField', 'x-component-props': { fieldNames: { value: 'id', label: 'nickname' } }, 'x-read-pretty': true } },
  { name: 'updatedAt', interface: 'updatedAt', type: 'date', field: 'updatedAt', uiSchema: { type: 'datetime', title: '{{t("Last updated at")}}', 'x-component': 'DatePicker', 'x-component-props': {}, 'x-read-pretty': true } },
  { name: 'updatedBy', interface: 'updatedBy', type: 'belongsTo', target: 'users', foreignKey: 'updatedById', uiSchema: { type: 'object', title: '{{t("Last updated by")}}', 'x-component': 'AssociationField', 'x-component-props': { fieldNames: { value: 'id', label: 'nickname' } }, 'x-read-pretty': true } },
];

// Field defaults of each interface, as the field dialog of the UI fills them in.
const text = (name, title, extra = {}) => ({ name, interface: 'input', type: 'string', ...extra, uiSchema: { type: 'string', title, 'x-component': 'Input', ...(extra.required ? { required: true } : {}) } });
const textarea = (name, title) => ({ name, interface: 'textarea', type: 'text', uiSchema: { type: 'string', title, 'x-component': 'Input.TextArea' } });
const quantity = (name, title) => ({ name, interface: 'number', type: 'double', uiSchema: { type: 'number', title, 'x-component': 'InputNumber', 'x-component-props': { step: '1', stringMode: true } } });
const select = (name, title, options, defaultValue) => ({ name, interface: 'select', type: 'string', defaultValue, uiSchema: { type: 'string', title, 'x-component': 'Select', enum: options } });
const belongsTo = (name, title, target, label) => ({ name, interface: 'm2o', type: 'belongsTo', target, foreignKey: `${name}Id`, onDelete: 'SET NULL', uiSchema: { type: 'object', title, 'x-component': 'AssociationField', 'x-component-props': { multiple: false, fieldNames: { label, value: 'id' } } } });
const money = (name, title) => ({ name, interface: 'currencyIRR', type: 'bigInt', uiSchema: { type: 'number', title, 'x-component': 'IranianCurrency', 'x-component-props': { unit: 'rial' } } });
const region = (name, title) => ({ name, interface: 'iranRegion', type: 'string', uiSchema: { type: 'string', title, 'x-component': 'IranRegionSelect', 'x-component-props': { changeOnSelect: false }, 'x-validator': { iranRegion: true } } });

const UNITS = ['عدد', 'کیلوگرم', 'متر', 'لیتر', 'بسته'].map((label) => ({ value: label, label }));

const COLLECTIONS = [
  { name: `${KEY}_categories`, title: 'گروه کالا', titleField: 'name', fields: [text('name', 'نام', { required: true })] },
  {
    name: `${KEY}_items`,
    title: 'کالا',
    titleField: 'name',
    fields: [
      text('code', 'کد کالا', { required: true, unique: true }),
      text('name', 'نام', { required: true }),
      select('unit', 'واحد', UNITS, 'عدد'),
      belongsTo('category', 'گروه کالا', `${KEY}_categories`, 'name'),
      quantity('minStock', 'حداقل موجودی'),
      money('price', 'قیمت خرید'),
      textarea('description', 'توضیح'),
    ],
  },
  {
    name: `${KEY}_warehouses`,
    title: 'انبار',
    titleField: 'name',
    fields: [text('name', 'نام', { required: true }), region('region', 'استان و شهر'), textarea('address', 'نشانی')],
  },
];

const GROUP = { title: 'انبار', icon: 'DatabaseOutlined' };

const page = (title, icon, collection, fields, formFields = fields) => ({
  version: '1',
  mode: 'create',
  navigation: { group: GROUP, item: { title, icon } },
  page: { title },
  tabs: [
    {
      key: 'main',
      title,
      blocks: [
        {
          key: 'table',
          type: 'table',
          collection,
          fields,
          actions: [
            'filter',
            'refresh',
            { type: 'addNew', popup: { blocks: [{ type: 'createForm', resource: { binding: 'currentCollection' }, fields: formFields, actions: ['submit'] }] } },
          ],
          recordActions: [
            { type: 'view', popup: { blocks: [{ type: 'details', resource: { binding: 'currentRecord' }, fields: formFields }] } },
            { type: 'edit', popup: { blocks: [{ type: 'editForm', resource: { binding: 'currentRecord' }, fields: formFields, actions: ['submit'] }] } },
            'delete',
          ],
        },
      ],
    },
  ],
});

// The page builder picks field components on the server, where plugin-fa's components are not registered. These are
// the components the field menu of a page offers for them, so they are set as a person would.
const EDIT_MODELS = { iranRegion: 'IranRegionFieldModel', currencyIRR: 'IranianCurrencyFieldModel' };
const DISPLAY_MODELS = { currencyIRR: 'DisplayIranianCurrencyFieldModel' };
const DISPLAY_CONTAINERS = new Set(['TableColumnModel', 'DetailsItemModel']);

async function setIranianFieldModels(file) {
  const interfaces = new Map(file.collections.flatMap((c) => c.fields.map((f) => [`${c.name}.${f.name}`, f.interface])));
  const changes = [];
  const walk = (model) => {
    const field = model.subModels && model.subModels.field;
    const init = model.stepParams && model.stepParams.fieldSettings && model.stepParams.fieldSettings.init;
    if (field && init) {
      const kind = interfaces.get(`${init.collectionName}.${init.fieldPath}`);
      const use = model.use === 'FormItemModel' ? EDIT_MODELS[kind] : DISPLAY_CONTAINERS.has(model.use) ? DISPLAY_MODELS[kind] : undefined;
      if (use && field.use !== use) changes.push({ parentId: model.uid, field: { ...field, use } });
    }
    for (const value of Object.values(model.subModels || {})) {
      for (const child of Array.isArray(value) ? value : [value]) if (child && typeof child === 'object') walk(child);
    }
  };
  file.flowModels.forEach(walk);
  for (const { parentId, field } of changes) {
    await call('flowModels:save', { ...field, parentId, subKey: 'field', subType: 'object' });
  }
  return changes.length;
}

(async () => {
  token = (await call('auth:signIn', { account, password })).token;

  for (const { fields, ...collection } of COLLECTIONS) {
    await call('collections:create', { ...collection, template: 'general', autoGenId: false, logging: true, fields: [...SYSTEM_FIELDS, ...fields] });
  }

  await call('flowSurfaces:applyBlueprint', page('کالاها', 'AppstoreOutlined', `${KEY}_items`, ['code', 'name', 'unit', 'category', 'minStock', 'price'], ['code', 'name', 'unit', 'category', 'minStock', 'price', 'description']));
  await call('flowSurfaces:applyBlueprint', page('گروه‌های کالا', 'TagsOutlined', `${KEY}_categories`, ['name']));
  await call('flowSurfaces:applyBlueprint', page('انبارها', 'HomeOutlined', `${KEY}_warehouses`, ['name', 'region'], ['name', 'region', 'address']));
  const [group] = await list('desktopRoutes', { title: GROUP.title, parentId: { $empty: true } });
  if (!group) throw new Error('the menu group was not created');

  const routes = [group];
  for (let parents = [group.id]; parents.length; ) {
    const children = await list('desktopRoutes', { parentId: { $in: parents } });
    routes.push(...children);
    parents = children.map((r) => r.id);
  }
  // «مدیر انبار» defines items and warehouses; «انباردار» sees them and, from version 1.1, writes the documents.
  const ROLES = [
    { name: `${KEY}_manager`, title: 'مدیر انبار', actions: ['view', 'create', 'update', 'destroy'] },
    { name: `${KEY}_keeper`, title: 'انباردار', actions: ['view'] },
  ];
  for (const { name, title, actions } of ROLES) {
    await call('roles:create', { name, title, snippets: ['!pm', '!pm.*', '!ui.*'], allowNewMenu: false, allowConfigure: false });
    // The role editor lists every field of a collection when an action is ticked; an empty list allows no field.
    for (const collection of COLLECTIONS) {
      const names = [...SYSTEM_FIELDS, ...collection.fields].map((field) => field.name);
      await call(`roles/${name}/dataSourceResources:create?filterByTk=${collection.name}&filter=${encodeURIComponent(JSON.stringify({ dataSourceKey: 'main' }))}`, {
        name: collection.name,
        dataSourceKey: 'main',
        usingActionsConfig: true,
        actions: actions.map((action) => ({ name: action, ...(action === 'destroy' ? {} : { fields: names }) })),
      });
    }
    await call(`roles/${name}/desktopRoutes:set`, routes.map((r) => r.id));
  }

  await call('erpModules:create', {
    key: KEY,
    title: 'انبار',
    version: VERSION,
    description: 'کالا، گروه کالا و انبار برای کسب‌وکار کوچک، با نقش‌های «مدیر انبار» و «انباردار». پایه‌ی رسید، حواله و موجودی در نسخه‌های بعد.',
    groupSchemaUid: group.schemaUid,
  });
  const exported = JSON.parse(await call(`erpModules:export?filterByTk=${KEY}`, undefined, { text: true }));
  console.log(`set ${await setIranianFieldModels(exported)} Iranian field components`);
  const file = await call(`erpModules:export?filterByTk=${KEY}`, undefined, { text: true });
  fs.writeFileSync(output, file);
  console.log(`wrote ${output}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
