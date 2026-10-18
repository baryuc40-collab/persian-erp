#!/usr/bin/env node
// Builds the «سفارش خرید» reference module (EPIC-020) on an install that already has the «اشخاص» and «انبار» modules,
// through the same HTTP actions the NocoBase UI uses, then exports it with erpModules:export. The export lists both
// modules in requires.modules (STORY-087), so the file is refused on an install without them.
// The module file is never written by hand; to change the module, change this script and run it again.
//
// usage: node modules/purchasing/build.js <base-url> <email> <password> [output file]
const fs = require('fs');
const path = require('path');

const [baseURL, account, password, output = path.join(__dirname, 'purchasing.erp-module.json')] = process.argv.slice(2);
if (!baseURL || !account || !password) {
  console.error('usage: build.js <base-url> <email> <password> [output file]');
  process.exit(2);
}

const KEY = 'purchasing';
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
const textarea = (name, title) => ({ name, interface: 'textarea', type: 'text', uiSchema: { type: 'string', title, 'x-component': 'Input.TextArea' } });
const quantity = (name, title, extra = {}) => ({ name, interface: 'number', type: 'double', ...extra, uiSchema: { type: 'number', title, 'x-component': 'InputNumber', 'x-component-props': { step: '1', stringMode: true }, ...(extra.required ? { required: true } : {}) } });
const select = (name, title, options, defaultValue, extra = {}) => ({ name, interface: 'select', type: 'string', defaultValue, ...extra, uiSchema: { type: 'string', title, 'x-component': 'Select', enum: options, ...(extra.required ? { required: true } : {}) } });
const belongsTo = (name, title, target, label, extra = {}) => ({ name, interface: 'm2o', type: 'belongsTo', target, foreignKey: `${name}Id`, onDelete: 'SET NULL', ...extra, uiSchema: { type: 'object', title, 'x-component': 'AssociationField', 'x-component-props': { multiple: false, fieldNames: { label, value: 'id' } }, ...(extra.required ? { required: true } : {}) } });
const hasMany = (name, title, target, foreignKey) => ({ name, interface: 'o2m', type: 'hasMany', target, foreignKey, sourceKey: 'id', targetKey: 'id', onDelete: 'CASCADE', uiSchema: { type: 'array', title, 'x-component': 'AssociationField', 'x-component-props': { multiple: true, fieldNames: { label: 'quantity', value: 'id' } } } });
const dateOnly = (name, title) => ({ name, interface: 'date', type: 'dateOnly', uiSchema: { type: 'string', title, required: true, 'x-component': 'DatePicker', 'x-component-props': { dateOnly: true, dateFormat: 'YYYY-MM-DD', showTime: false } } });
// The document number counts up by itself; the sequence plugin keeps its last value under the pattern key.
const sequence = (name, title) => ({ name, interface: 'sequence', type: 'sequence', inputable: false, patterns: [{ type: 'integer', options: { digits: 5, start: 1, key: 1 } }], uiSchema: { type: 'string', title, 'x-component': 'Input', 'x-component-props': {}, 'x-read-pretty': true } });
const money = (name, title) => ({ name, interface: 'currencyIRR', type: 'bigInt', uiSchema: { type: 'number', title, 'x-component': 'IranianCurrency', 'x-component-props': { unit: 'rial' } } });

const STATUSES = [
  { value: 'draft', label: 'پیش‌نویس', color: 'default' },
  { value: 'approved', label: 'تأییدشده', color: 'green' },
];

const COLLECTIONS = [
  {
    name: `${KEY}_orders`,
    title: 'سفارش خرید',
    titleField: 'number',
    fields: [
      sequence('number', 'شماره'),
      dateOnly('date', 'تاریخ'),
      belongsTo('supplier', 'تأمین‌کننده', 'parties_companies', 'name', { required: true }),
      belongsTo('warehouse', 'انبار مقصد', 'inventory_warehouses', 'name', { required: true }),
      select('status', 'وضعیت', STATUSES, 'draft'),
      money('total', 'جمع'),
      hasMany('lines', 'ردیف‌ها', `${KEY}_order_lines`, 'orderId'),
      textarea('description', 'توضیح'),
    ],
  },
  {
    name: `${KEY}_order_lines`,
    title: 'ردیف سفارش خرید',
    titleField: 'quantity',
    fields: [
      belongsTo('order', 'سفارش', `${KEY}_orders`, 'number', { onDelete: 'CASCADE' }),
      belongsTo('item', 'کالا', 'inventory_items', 'name', { required: true }),
      quantity('quantity', 'مقدار', { required: true }),
      money('unitPrice', 'قیمت واحد'),
      money('amount', 'مبلغ'),
    ],
  },
];

const fieldNames = (collection) => [...SYSTEM_FIELDS, ...collection.fields].map((field) => field.name);
// What a person may write; the status changes only by approval, and the amounts only by the totals workflow.
const COMPUTED = new Set(['status', 'total', 'amount']);
const writable = (collection) => fieldNames(collection).filter((name) => !COMPUTED.has(name));

const GROUP = { title: 'خرید', icon: 'ShoppingCartOutlined' };
const ORDERS = `${KEY}_orders`;
const LINES_COLLECTION = `${KEY}_order_lines`;
// The lines are written as a table inside the order form; the amount shows in the details only.
const LINES = { key: 'lines', field: 'lines', fieldType: 'subTable', titleField: 'quantity', fields: ['item', 'quantity', 'unitPrice'] };
const LINES_DETAIL = { ...LINES, fields: ['item', 'quantity', 'unitPrice', 'amount'] };
const TABLE_FIELDS = ['number', 'date', 'supplier', 'warehouse', 'status', 'total'];
const FORM_FIELDS = ['date', 'supplier', 'warehouse', LINES, 'description'];
const DETAIL_FIELDS = ['number', 'date', 'supplier', 'warehouse', 'status', 'total', LINES_DETAIL, 'description'];
const FORM_LAYOUT = { rows: [[{ key: 'date', span: 8 }, { key: 'supplier', span: 8 }, { key: 'warehouse', span: 8 }], ['lines'], ['description']] };
const DETAIL_LAYOUT = {
  rows: [
    [{ key: 'number', span: 8 }, { key: 'date', span: 8 }, { key: 'status', span: 8 }],
    [{ key: 'supplier', span: 8 }, { key: 'warehouse', span: 8 }, { key: 'total', span: 8 }],
    ['lines'],
    ['description'],
  ],
};

const view = { type: 'view', popup: { blocks: [{ type: 'details', resource: { binding: 'currentRecord' }, fields: DETAIL_FIELDS, fieldsLayout: DETAIL_LAYOUT }] } };
const form = (type, binding) => ({ type, resource: { binding }, fields: FORM_FIELDS, fieldsLayout: FORM_LAYOUT, actions: ['submit'] });

const surface = (title, icon, block) => ({
  version: '1',
  mode: 'create',
  navigation: { group: GROUP, item: { title, icon } },
  page: { title },
  tabs: [{ key: 'main', title, blocks: [{ key: 'table', type: 'table', collection: ORDERS, fields: TABLE_FIELDS, ...block }] }],
});

// Every order, written by both roles while it is a draft.
const ORDERS_PAGE = surface('سفارش‌های خرید', 'FileTextOutlined', {
  settings: { sorting: [{ field: 'createdAt', direction: 'desc' }] },
  actions: ['filter', 'refresh', { type: 'addNew', popup: { blocks: [form('createForm', 'currentCollection')] } }],
  recordActions: [view, { type: 'edit', popup: { blocks: [form('editForm', 'currentRecord')] } }, 'delete'],
});
// The drafts waiting for the purchase manager, with the approval button. Only the manager's menu has this page.
const APPROVAL_PAGE = surface('تأیید سفارش‌ها', 'CheckCircleOutlined', {
  settings: { dataScope: { logic: '$and', items: [{ path: 'status', operator: '$eq', value: 'draft' }] }, sorting: [{ field: 'createdAt', direction: 'asc' }] },
  actions: ['refresh'],
  recordActions: [view, { type: 'updateRecord', title: 'تأیید سفارش', settings: { assignValues: { status: 'approved' } } }],
});

// Settings the page builder cannot write. It picks field components on the server, where plugin-fa's components are not
// registered. These are the components the field menu of a page offers for them, so they are set as a person would.
const EDIT_MODELS = { iranRegion: 'IranRegionFieldModel', currencyIRR: 'IranianCurrencyFieldModel' };
const DISPLAY_MODELS = { currencyIRR: 'DisplayIranianCurrencyFieldModel' };
const DISPLAY_CONTAINERS = new Set(['TableColumnModel', 'DetailsItemModel']);

async function setFieldModels(file) {
  const interfaces = new Map(file.collections.flatMap((c) => c.fields.map((f) => [`${c.name}.${f.name}`, f.interface])));
  const changes = [];
  const walk = (model) => {
    const field = model.subModels && model.subModels.field;
    const init = model.stepParams && model.stepParams.fieldSettings && model.stepParams.fieldSettings.init;
    if (field && init) {
      const kind = interfaces.get(`${init.collectionName}.${init.fieldPath}`);
      const use = model.use === 'FormItemModel' ? EDIT_MODELS[kind] : DISPLAY_CONTAINERS.has(model.use) ? DISPLAY_MODELS[kind] : undefined;
      if (use && field.use !== use) changes.push({ parentId: model.uid, field: { ...field, use } });
      // A line belongs to one document, so the lines table offers «افزودن» only, not picking a line of another one.
      const select = field.stepParams && field.stepParams.subTableColumnSettings && field.stepParams.subTableColumnSettings.allowSelectExistingRecord;
      if (field.use === 'SubTableFieldModel' && !(select && select.allowSelectExistingRecord === false)) {
        const stepParams = { ...field.stepParams, subTableColumnSettings: { ...(field.stepParams && field.stepParams.subTableColumnSettings), allowSelectExistingRecord: { allowSelectExistingRecord: false } } };
        changes.push({ parentId: model.uid, field: { ...field, stepParams } });
      }
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

  await call('flowSurfaces:applyBlueprint', ORDERS_PAGE);
  await call('flowSurfaces:applyBlueprint', APPROVAL_PAGE);
  const [group] = await list('desktopRoutes', { title: GROUP.title, parentId: { $empty: true } });
  if (!group) throw new Error('the menu group was not created');
  const routes = [group];
  for (let parents = [group.id]; parents.length; ) {
    const children = await list('desktopRoutes', { parentId: { $in: parents } });
    routes.push(...children);
    parents = children.map((r) => r.id);
  }
  const approvalRoutes = new Set();
  for (const route of routes.filter((r) => r.title === 'تأیید سفارش‌ها')) {
    approvalRoutes.add(route.id);
    for (const child of routes.filter((r) => r.parentId === route.id)) approvalRoutes.add(child.id);
  }

  // The amounts. Saving an order, with the lines of its form, prices every line that has no unit price at the purchase
  // price of its item, works out each amount, and adds them up into the total. It runs in the same transaction as the
  // save, after the lines are written, so the API writes the same numbers as the form. Its own writes are SQL, so they
  // do not start it again. An approved order is left as it is.
  const TOTALS = `WITH priced AS (
    UPDATE ${LINES_COLLECTION} l SET "unitPrice" = COALESCE(l."unitPrice", i.price, 0),
      amount = ROUND(l.quantity * COALESCE(l."unitPrice", i.price, 0)), "updatedAt" = now()
    FROM inventory_items i
    WHERE i.id = l."itemId" AND l."orderId" = :id
    RETURNING l.amount
  )
  UPDATE ${ORDERS} SET total = (SELECT COALESCE(SUM(amount), 0) FROM priced) WHERE id = :id AND status = 'draft'
  RETURNING total`;
  const totals = await call('workflows:create', {
    title: 'جمع سفارش خرید',
    description: 'وقتی سفارش خرید ساخته یا ویرایش شود، قیمت واحد ردیف‌های بی‌قیمت را از قیمت خرید کالا می‌گذارد، مبلغ هر ردیف را حساب می‌کند و جمع ریالی سفارش را می‌نویسد.',
    type: 'collection',
    sync: true,
    enabled: true,
    config: { collection: ORDERS, mode: 3, changed: [], condition: { $and: [{ status: { $eq: 'draft' } }] }, appends: [] },
  });
  await call(`workflows/${totals.id}/nodes:create`, {
    type: 'sql',
    title: 'حساب مبلغ‌ها',
    config: { dataSource: 'main', sql: TOTALS, variables: [{ name: 'id', value: '{{$context.data.id}}' }] },
  });

  // Approving an order. A pre-action workflow runs inside the update request before the record is written, so a
  // refusal reaches the person who pressed the button and nothing is saved. A request that does not set the status
  // passes untouched: the SQL node fails on a variable the request does not have, so the checks come after conditions.
  const CHECK = `WITH problems AS (
    SELECT 'فقط مدیر خرید سفارش را تأیید می‌کند' AS message WHERE :role NOT IN ('${KEY}_manager', 'root', 'admin')
    UNION ALL SELECT 'سفارش ردیفی ندارد' FROM ${ORDERS} o
      WHERE o.id = :id AND NOT EXISTS (SELECT 1 FROM ${LINES_COLLECTION} l WHERE l."orderId" = o.id)
  )
  SELECT COUNT(*)::int AS problems, string_agg(message, '، ') AS message FROM problems`;
  const approval = await call('workflows:create', {
    title: 'تأیید سفارش خرید',
    description: 'وقتی سفارش خرید تأیید شود، بررسی می‌کند که تأییدکننده مدیر خرید باشد و سفارش ردیف داشته باشد؛ وگرنه تأیید را با پیام فارسی رد می‌کند.',
    type: 'request-interception',
    sync: true,
    enabled: true,
    config: { collection: ORDERS, global: true, actions: ['update'] },
  });
  const node = (values) => call(`workflows/${approval.id}/nodes:create`, values);
  const when = (title, upstream, branchIndex, calculator, operands) =>
    node({
      type: 'condition',
      title,
      ...(upstream ? { upstreamId: upstream.id, ...(branchIndex === null ? {} : { branchIndex }) } : {}),
      config: { rejectOnFalse: false, engine: 'basic', calculation: { group: { type: 'and', calculations: [{ calculator, operands }] } } },
    });
  const refuse = async (title, upstream, branchIndex, text) => {
    const message = await node({ type: 'response-message', title, upstreamId: upstream.id, branchIndex, config: { message: text } });
    await node({ type: 'end', title: 'رد تأیید', upstreamId: message.id, config: { endStatus: -1 } });
  };
  const approving = await when('تأیید سفارش است؟', null, null, 'equal', ['{{$context.params.values.status}}', 'approved']);
  // A request for one order names it; a bulk update does not.
  const single = await when('یک سفارش است؟', approving, 1, 'gt', ['{{$context.params.filterByTk}}', 0]);
  await refuse('پیام چند سفارش', single, 0, 'سفارش‌ها را یکی‌یکی تأیید کنید');
  const check = await node({
    type: 'sql',
    title: 'بررسی سفارش',
    upstreamId: single.id,
    branchIndex: 1,
    config: {
      dataSource: 'main',
      sql: CHECK,
      variables: [
        { name: 'id', value: '{{$context.params.filterByTk}}' },
        { name: 'role', value: '{{$context.roleName}}' },
      ],
    },
  });
  const problems = await when('ایراد دارد؟', check, null, 'gt', [`{{$jobsMapByNodeKey.${check.key}.0.problems}}`, 0]);
  await refuse('پیام ایراد', problems, 1, `{{$jobsMapByNodeKey.${check.key}.0.message}}`);

  // «کارشناس خرید» and «مدیر خرید» write orders and change or delete them only while they are drafts; only the manager
  // approves. Both see suppliers, items and warehouses without changing them.
  const DRAFT_SCOPES = [
    { key: `${KEY}_draft_orders`, name: 'سفارش پیش‌نویس', resourceName: ORDERS, scope: { status: { $eq: 'draft' } } },
    { key: `${KEY}_draft_lines`, name: 'ردیف سفارش پیش‌نویس', resourceName: LINES_COLLECTION, scope: { order: { status: { $eq: 'draft' } } } },
  ];
  const scopeIds = {};
  for (const scope of DRAFT_SCOPES) {
    scopeIds[scope.resourceName] = (await call('dataSourcesRolesResourcesScopes:create', { ...scope, dataSourceKey: 'main' })).id;
  }
  // The other modules' collections an order points at, read only.
  const LOOKUPS = { parties_companies: 'name', inventory_items: 'name', inventory_warehouses: 'name' };
  const ROLES = [
    { role: 'manager', name: `${KEY}_manager`, title: 'مدیر خرید' },
    { role: 'buyer', name: `${KEY}_buyer`, title: 'کارشناس خرید' },
  ];
  for (const { role, name, title } of ROLES) {
    await call('roles:create', { name, title, snippets: ['!pm', '!pm.*', '!ui.*'], allowNewMenu: false, allowConfigure: false });
    const resources = COLLECTIONS.map((collection) => {
      const all = fieldNames(collection);
      const own = writable(collection);
      return {
        name: collection.name,
        actions: [
          { name: 'view', fields: all },
          { name: 'create', fields: own },
          // The manager's update may also set the status: that is the approval.
          { name: 'update', fields: role === 'manager' && collection.name === ORDERS ? [...own, 'status'] : own, scopeId: scopeIds[collection.name] },
          { name: 'destroy', scopeId: scopeIds[collection.name] },
        ],
      };
    });
    for (const [collection] of Object.entries(LOOKUPS)) {
      const { data } = await fetch(`${baseURL}/api/collections/${collection}/fields:list?paginate=false`, { headers: { Authorization: `Bearer ${token}`, 'X-Role': 'root' } }).then((r) => r.json());
      resources.push({ name: collection, actions: [{ name: 'view', fields: data.map((f) => f.name) }] });
    }
    for (const resource of resources) {
      await call(`roles/${name}/dataSourceResources:create?filterByTk=${resource.name}&filter=${encodeURIComponent(JSON.stringify({ dataSourceKey: 'main' }))}`, {
        name: resource.name,
        dataSourceKey: 'main',
        usingActionsConfig: true,
        actions: resource.actions,
      });
    }
    await call(`roles/${name}/desktopRoutes:set`, routes.map((r) => r.id));
    // Giving a role a menu group gives it every page of the group, so the approvals page is taken back afterwards.
    if (role !== 'manager') await call(`roles/${name}/desktopRoutes:remove`, [...approvalRoutes]);
  }

  await call('erpModules:create', {
    key: KEY,
    title: 'سفارش خرید',
    version: VERSION,
    description:
      'سفارش خرید از تأمین‌کننده‌های ماژول «اشخاص» برای کالا و انبار ماژول «انبار»، با ردیف‌هایی که قیمت واحدشان از قیمت خرید کالا می‌آید، جمع ریالی خودکار و تأیید «مدیر خرید» که سفارش را قفل می‌کند. نقش‌ها: «کارشناس خرید» و «مدیر خرید». به ماژول‌های «اشخاص» و «انبار» نیاز دارد.',
    groupSchemaUid: group.schemaUid,
  });
  const exported = JSON.parse(await call(`erpModules:export?filterByTk=${KEY}`, undefined, { text: true }));
  console.log(`set ${await setFieldModels(exported)} field components`);
  const file = await call(`erpModules:export?filterByTk=${KEY}`, undefined, { text: true });
  fs.writeFileSync(output, file);
  console.log(`wrote ${output}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
