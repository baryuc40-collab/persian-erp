#!/usr/bin/env node
// Builds the «درخواست خرید» module of the BPMN proof of concept (STORY-083) on a fresh install with plugin-bpm, through
// the same HTTP actions the NocoBase UI uses, then exports it with erpModules:export. The process itself is the model
// bpmn/purchase-request.bpmn with its form bpmn/purchase-approve.form (Camunda 8) or bpmn/operaton/purchase-request.bpmn
// (Operaton), deployed in Settings > BPMN engine; the module holds the data, pages, workflows and roles.
// The module file is never written by hand; to change the module, change this script and run it again.
//
// usage: node modules/purchase/build.js <base-url> <email> <password> [output file]
const fs = require('fs');
const path = require('path');

const [baseURL, account, password, output = path.join(__dirname, 'purchase.erp-module.json')] = process.argv.slice(2);
if (!baseURL || !account || !password) {
  console.error('usage: build.js <base-url> <email> <password> [output file]');
  process.exit(2);
}

const KEY = 'purchase';
const COLLECTION = `${KEY}_requests`;
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

// The status is written by the workflows of the process, never by a person, so its values are fixed here.
const STATUSES = [
  { value: 'pending', label: 'در انتظار تأیید', color: 'orange' },
  { value: 'ordered', label: 'سفارش داده شد', color: 'green' },
  { value: 'rejected', label: 'ردشده', color: 'red' },
];

const FIELDS = [
  { name: 'title', interface: 'input', type: 'string', uiSchema: { type: 'string', title: 'شرح کالا', 'x-component': 'Input', required: true } },
  { name: 'amount', interface: 'currencyIRR', type: 'bigInt', uiSchema: { type: 'number', title: 'مبلغ', 'x-component': 'IranianCurrency', 'x-component-props': { unit: 'toman' } } },
  { name: 'description', interface: 'textarea', type: 'text', uiSchema: { type: 'string', title: 'توضیح', 'x-component': 'Input.TextArea' } },
  { name: 'status', interface: 'select', type: 'string', defaultValue: 'pending', uiSchema: { type: 'string', title: 'وضعیت', 'x-component': 'Select', enum: STATUSES } },
];

const GROUP = { title: 'خرید', icon: 'ShoppingCartOutlined' };

const requestsPage = {
  version: '1',
  mode: 'create',
  navigation: { group: GROUP, item: { title: 'درخواست‌های خرید', icon: 'FileTextOutlined' } },
  page: { title: 'درخواست‌های خرید' },
  tabs: [
    {
      key: 'main',
      title: 'درخواست‌های خرید',
      blocks: [
        {
          key: 'table',
          type: 'table',
          collection: COLLECTION,
          fields: ['title', 'amount', 'status', 'createdBy', 'createdAt'],
          actions: [
            'filter',
            'refresh',
            { type: 'addNew', popup: { blocks: [{ type: 'createForm', resource: { binding: 'currentCollection' }, fields: ['title', 'amount', 'description'], actions: ['submit'] }] } },
          ],
          recordActions: [
            { type: 'view', popup: { blocks: [{ type: 'details', resource: { binding: 'currentRecord' }, fields: ['title', 'amount', 'description', 'status', 'createdBy', 'createdAt'] }] } },
          ],
        },
      ],
    },
  ],
};

const inboxPage = {
  version: '1',
  mode: 'create',
  navigation: { group: GROUP, item: { title: 'کارتابل خرید', icon: 'InboxOutlined' } },
  page: { title: 'کارتابل خرید' },
  tabs: [
    {
      key: 'main',
      title: 'کارتابل خرید',
      blocks: [{ key: 'intro', type: 'markdown', settings: { content: 'کارهای فرایند خرید که منتظر شماست. هر کار را باز کنید، درخواست را ببینید و تصمیم را ثبت کنید.' } }],
    },
  ],
};

// The page builder picks field components on the server, where plugin-fa's components are not registered. These are
// the components the field menu of a page offers for an IRR amount, so they are set as a person would.
const EDIT_MODELS = { currencyIRR: 'IranianCurrencyFieldModel' };
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

// The grid of a page made by the page builder: page route > hidden tab route > tab model > grid model.
async function pageGrid(title) {
  const [route] = await list('desktopRoutes', { title, type: 'flowPage' });
  const [tab] = await list('desktopRoutes', { parentId: route.id, type: 'tabs' });
  const tabModel = await call(`flowModels:findOne?uid=${tab.schemaUid}&includeAsyncNode=true`);
  return tabModel.subModels.grid;
}

async function workflow(values, node) {
  const created = await call('workflows:create', values);
  await call(`workflows/${created.id}/nodes:create`, node);
  return created;
}

(async () => {
  token = (await call('auth:signIn', { account, password })).token;

  await call('collections:create', { name: COLLECTION, title: 'درخواست خرید', titleField: 'title', template: 'general', autoGenId: false, logging: true, fields: [...SYSTEM_FIELDS, ...FIELDS] });

  await call('flowSurfaces:applyBlueprint', requestsPage);
  await call('flowSurfaces:applyBlueprint', inboxPage);
  // The task inbox of plugin-bpm is not a block the page builder knows, so it is added under the text, as the
  // "Other blocks" menu of the page does.
  const grid = await pageGrid('کارتابل خرید');
  const inbox = { uid: `${KEY}inbox01`, use: 'BpmTaskInboxBlockModel', stepParams: { cardSettings: { titleDescription: { title: 'کارتابل' } } } };
  await call('flowModels:save', { ...inbox, parentId: grid.uid, subKey: 'items', subType: 'array' });
  const rows = { ...(grid.props && grid.props.rows), inbox: [[inbox.uid]] };
  await call('flowModels:save', { uid: grid.uid, use: grid.use, props: { ...grid.props, rows } });

  const [group] = await list('desktopRoutes', { title: GROUP.title, parentId: { $empty: true } });
  if (!group) throw new Error('the menu group was not created');

  // The process: a new request starts it, and its two service tasks write the decision back on the request.
  await workflow(
    {
      title: 'شروع فرایند درخواست خرید',
      description: 'وقتی درخواست خرید تازه ثبت شود، فرایند BPMN «درخواست خرید» را با کلید همان درخواست شروع می‌کند تا کار «تأیید مدیر» به کارتابل مدیر خرید برود.',
      type: 'collection',
      enabled: true,
      config: { mode: 1, collection: COLLECTION },
    },
    {
      type: 'bpm-start',
      title: 'شروع فرایند درخواست خرید',
      config: { processKey: 'purchase_request', businessKey: `${COLLECTION}:{{$context.data.id}}`, variables: [{ name: 'recordId', value: '{{$context.data.id}}' }] },
    },
  );
  for (const [topic, status, title, description] of [
    ['place-order', 'ordered', 'ثبت سفارش خرید', 'وقتی مدیر خرید درخواست را تأیید کند، کار سرویس «ثبت سفارش» فرایند وضعیت درخواست را «سفارش داده شد» می‌کند.'],
    ['reject-request', 'rejected', 'ثبت رد درخواست خرید', 'وقتی مدیر خرید درخواست را رد کند، کار سرویس «ثبت رد» فرایند وضعیت درخواست را «ردشده» می‌کند.'],
  ]) {
    await workflow(
      { title, description, type: 'bpm-service-task', enabled: true, config: { topic } },
      { type: 'update', title: 'وضعیت درخواست', config: { collection: COLLECTION, params: { filter: { id: '{{$context.recordId}}' }, values: { status } } } },
    );
  }

  // Roles. The manager role is the candidate group of the «تأیید مدیر» task, so its name is the one in the model.
  const routes = [group];
  for (let parents = [group.id]; parents.length; ) {
    const children = await list('desktopRoutes', { parentId: { $in: parents } });
    routes.push(...children);
    parents = children.map((r) => r.id);
  }
  const allFields = [...SYSTEM_FIELDS, ...FIELDS].map((field) => field.name);
  const [own] = await list('dataSourcesRolesResourcesScopes', { key: 'own' });
  const ROLES = [
    // Writes requests and sees only their own.
    { name: `${KEY}_requester`, title: 'درخواست‌دهنده‌ی خرید', actions: [{ name: 'view', fields: allFields, scopeId: own.id }, { name: 'create', fields: ['title', 'amount', 'description'] }] },
    // Sees every request and decides on them in the task inbox.
    { name: `${KEY}_manager`, title: 'مدیر خرید', actions: [{ name: 'view', fields: allFields }] },
  ];
  for (const { name, title, actions } of ROLES) {
    await call('roles:create', { name, title, snippets: ['!pm', '!pm.*', '!ui.*'], allowNewMenu: false, allowConfigure: false });
    await call(`roles/${name}/dataSourceResources:create?filterByTk=${COLLECTION}&filter=${encodeURIComponent(JSON.stringify({ dataSourceKey: 'main' }))}`, {
      name: COLLECTION,
      dataSourceKey: 'main',
      usingActionsConfig: true,
      actions,
    });
    await call(`roles/${name}/desktopRoutes:set`, routes.map((r) => r.id));
  }

  await call('erpModules:create', {
    key: KEY,
    title: 'درخواست خرید',
    version: '1.0.0',
    description: 'درخواست خرید با تأیید مدیر در فرایند BPMN (نمونه‌ی اثبات مفهوم اپیک ۰۱۶). به پلاگین موتور BPMN و استقرار مدل bpmn/purchase-request.bpmn و فرم bpmn/purchase-approve.form نیاز دارد (با Operaton، مدل bpmn/operaton/purchase-request.bpmn).',
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
