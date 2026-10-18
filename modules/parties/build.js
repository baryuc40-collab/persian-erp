#!/usr/bin/env node
// Builds the «اشخاص» reference module on a fresh install through the same HTTP actions the NocoBase UI uses
// (collections:create, flowSurfaces:applyBlueprint, roles:create ...), then exports it with erpModules:export.
// The module file is never written by hand; to change the module, change this script and run it again.
//
// usage: node modules/parties/build.js <base-url> <email> <password> [output file]
const fs = require('fs');
const path = require('path');

const [baseURL, account, password, output = path.join(__dirname, 'parties.erp-module.json')] = process.argv.slice(2);
if (!baseURL || !account || !password) {
  console.error('usage: build.js <base-url> <email> <password> [output file]');
  process.exit(2);
}

const KEY = 'parties';
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

// The fields every collection made from the "General collection" template starts with.
const SYSTEM_FIELDS = [
  { name: 'id', type: 'snowflakeId', autoIncrement: false, primaryKey: true, allowNull: false, interface: 'snowflakeId', uiSchema: { type: 'number', title: '{{t("ID")}}', 'x-component': 'InputNumber', 'x-component-props': { stringMode: true, separator: '0.00', step: '1' }, 'x-validator': 'integer' } },
  { name: 'createdAt', interface: 'createdAt', type: 'date', field: 'createdAt', uiSchema: { type: 'datetime', title: '{{t("Created at")}}', 'x-component': 'DatePicker', 'x-component-props': {}, 'x-read-pretty': true } },
  { name: 'createdBy', interface: 'createdBy', type: 'belongsTo', target: 'users', foreignKey: 'createdById', uiSchema: { type: 'object', title: '{{t("Created by")}}', 'x-component': 'AssociationField', 'x-component-props': { fieldNames: { value: 'id', label: 'nickname' } }, 'x-read-pretty': true } },
  { name: 'updatedAt', interface: 'updatedAt', type: 'date', field: 'updatedAt', uiSchema: { type: 'datetime', title: '{{t("Last updated at")}}', 'x-component': 'DatePicker', 'x-component-props': {}, 'x-read-pretty': true } },
  { name: 'updatedBy', interface: 'updatedBy', type: 'belongsTo', target: 'users', foreignKey: 'updatedById', uiSchema: { type: 'object', title: '{{t("Last updated by")}}', 'x-component': 'AssociationField', 'x-component-props': { fieldNames: { value: 'id', label: 'nickname' } }, 'x-read-pretty': true } },
];

// Field defaults of each interface, as the field dialog of the UI fills them in.
const text = (name, title, required = false) => ({ name, interface: 'input', type: 'string', uiSchema: { type: 'string', title, 'x-component': 'Input', ...(required ? { required: true } : {}) } });
const iranian = (name, title, kind, maxLength, component = 'Input') => ({
  name,
  interface: kind,
  type: 'string',
  uiSchema: { type: 'string', title, 'x-component': component, 'x-component-props': { maxLength, kind }, 'x-validator': { [kind]: true } },
});
const region = (name, title) => ({ name, interface: 'iranRegion', type: 'string', uiSchema: { type: 'string', title, 'x-component': 'IranRegionSelect', 'x-component-props': { changeOnSelect: false }, 'x-validator': { iranRegion: true } } });
const dateOnly = (name, title) => ({ name, interface: 'date', type: 'dateOnly', uiSchema: { type: 'string', title, 'x-component': 'DatePicker', 'x-component-props': { dateOnly: true, showTime: false } } });

const COLLECTIONS = [
  {
    name: `${KEY}_people`,
    title: 'شخص حقیقی',
    titleField: 'lastName',
    fields: [
      text('firstName', 'نام', true),
      text('lastName', 'نام خانوادگی', true),
      iranian('nationalId', 'کد ملی', 'iranNationalId', 12),
      iranian('mobile', 'تلفن همراه', 'iranMobile', 17),
      dateOnly('birthDate', 'تاریخ تولد'),
      region('region', 'استان و شهر'),
      iranian('postalCode', 'کد پستی', 'iranPostalCode', 12, 'IranianFieldInput'),
    ],
  },
  {
    name: `${KEY}_companies`,
    title: 'شخص حقوقی',
    titleField: 'name',
    fields: [
      text('name', 'نام', true),
      iranian('legalId', 'شناسه‌ی ملی', 'iranLegalId', 13),
      iranian('sheba', 'شبا', 'iranSheba', 34, 'IranianFieldInput'),
      region('region', 'استان و شهر'),
    ],
  },
];

const page = (title, icon, collection, fields) => ({
  version: '1',
  mode: 'create',
  navigation: { group: { title: 'اشخاص', icon: 'TeamOutlined' }, item: { title, icon } },
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
            { type: 'addNew', popup: { blocks: [{ type: 'createForm', resource: { binding: 'currentCollection' }, fields, actions: ['submit'] }] } },
          ],
          recordActions: [
            { type: 'view', popup: { blocks: [{ type: 'details', resource: { binding: 'currentRecord' }, fields }] } },
            { type: 'edit', popup: { blocks: [{ type: 'editForm', resource: { binding: 'currentRecord' }, fields, actions: ['submit'] }] } },
            'delete',
          ],
        },
      ],
    },
  ],
});

// The page builder picks field components on the server, where plugin-fa's components for Iranian fields are not
// registered. These are the components the field menu of a page offers for them, so they are set as a person would.
const EDIT_MODELS = { iranRegion: 'IranRegionFieldModel' };
const DISPLAY_MODELS = { iranSheba: 'DisplayIranianFieldModel', iranPostalCode: 'DisplayIranianFieldModel' };
const DISPLAY_CONTAINERS = new Set(['TableColumnModel', 'DetailsItemModel']);

async function setIranianFieldModels(file) {
  const interfaces = new Map(
    file.collections.flatMap((c) => c.fields.map((f) => [`${c.name}.${f.name}`, f.interface])),
  );
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

  const people = await call(
    'flowSurfaces:applyBlueprint',
    page('اشخاص حقیقی', 'UserOutlined', `${KEY}_people`, ['firstName', 'lastName', 'nationalId', 'mobile', 'birthDate', 'region', 'postalCode']),
  );
  await call(
    'flowSurfaces:applyBlueprint',
    page('اشخاص حقوقی', 'BankOutlined', `${KEY}_companies`, ['name', 'legalId', 'sheba', 'region']),
  );
  const group = (await call(`desktopRoutes:list?paginate=false&filter=${encodeURIComponent(JSON.stringify({ title: 'اشخاص', parentId: { $empty: true } }))}`))[0];
  if (!group) throw new Error(`the menu group was not created: ${JSON.stringify(people).slice(0, 500)}`);

  // «کارشناس اشخاص»: sees and adds and edits people, cannot delete them, and sees only this menu.
  const role = `${KEY}_expert`;
  await call('roles:create', { name: role, title: 'کارشناس اشخاص', snippets: ['!pm', '!pm.*', '!ui.*'], allowNewMenu: false, allowConfigure: false });
  // The role editor lists every field of a collection when an action is ticked; an empty list allows no field.
  for (const { name, fields } of COLLECTIONS) {
    const names = [...SYSTEM_FIELDS, ...fields].map((field) => field.name);
    await call(`roles/${role}/dataSourceResources:create?filterByTk=${name}&filter=${encodeURIComponent(JSON.stringify({ dataSourceKey: 'main' }))}`, {
      name,
      dataSourceKey: 'main',
      usingActionsConfig: true,
      actions: ['view', 'create', 'update'].map((action) => ({ name: action, fields: names })),
    });
  }
  const routes = [group];
  for (let parents = [group.id]; parents.length; ) {
    const children = await call(`desktopRoutes:list?paginate=false&filter=${encodeURIComponent(JSON.stringify({ parentId: { $in: parents } }))}`);
    routes.push(...children);
    parents = children.map((r) => r.id);
  }
  await call(`roles/${role}/desktopRoutes:set`, routes.map((r) => r.id));

  await call('erpModules:create', {
    key: KEY,
    title: 'اشخاص',
    version: '1.0.0',
    description: 'اشخاص حقیقی و حقوقی با کد ملی، شناسه‌ی ملی، شبا و نشانی ایرانی. نمونه‌ی مرجع استاندارد ماژول.',
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
