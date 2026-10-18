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
const VERSION = '1.2.0';
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
const quantity = (name, title, extra = {}) => ({ name, interface: 'number', type: 'double', ...extra, uiSchema: { type: 'number', title, 'x-component': 'InputNumber', 'x-component-props': { step: '1', stringMode: true }, ...(extra.required ? { required: true } : {}) } });
const select = (name, title, options, defaultValue, extra = {}) => ({ name, interface: 'select', type: 'string', defaultValue, ...extra, uiSchema: { type: 'string', title, 'x-component': 'Select', enum: options, ...(extra.required ? { required: true } : {}) } });
const belongsTo = (name, title, target, label, extra = {}) => ({ name, interface: 'm2o', type: 'belongsTo', target, foreignKey: `${name}Id`, onDelete: 'SET NULL', ...extra, uiSchema: { type: 'object', title, 'x-component': 'AssociationField', 'x-component-props': { multiple: false, fieldNames: { label, value: 'id' } }, ...(extra.required ? { required: true } : {}) } });
const hasMany = (name, title, target, foreignKey) => ({ name, interface: 'o2m', type: 'hasMany', target, foreignKey, sourceKey: 'id', targetKey: 'id', onDelete: 'CASCADE', uiSchema: { type: 'array', title, 'x-component': 'AssociationField', 'x-component-props': { multiple: true, fieldNames: { label: 'quantity', value: 'id' } } } });
const dateOnly = (name, title) => ({ name, interface: 'date', type: 'dateOnly', uiSchema: { type: 'string', title, required: true, 'x-component': 'DatePicker', 'x-component-props': { dateOnly: true, dateFormat: 'YYYY-MM-DD', showTime: false } } });
// The document number counts up by itself; the sequence plugin keeps its last value under the pattern key.
const sequence = (name, title) => ({ name, interface: 'sequence', type: 'sequence', inputable: false, patterns: [{ type: 'integer', options: { digits: 5, start: 1, key: 1 } }], uiSchema: { type: 'string', title, 'x-component': 'Input', 'x-component-props': {}, 'x-read-pretty': true } });
const money = (name, title) => ({ name, interface: 'currencyIRR', type: 'bigInt', uiSchema: { type: 'number', title, 'x-component': 'IranianCurrency', 'x-component-props': { unit: 'rial' } } });
const region = (name, title) => ({ name, interface: 'iranRegion', type: 'string', uiSchema: { type: 'string', title, 'x-component': 'IranRegionSelect', 'x-component-props': { changeOnSelect: false }, 'x-validator': { iranRegion: true } } });

const UNITS = ['عدد', 'کیلوگرم', 'متر', 'لیتر', 'بسته'].map((label) => ({ value: label, label }));

const KINDS = [
  { value: 'receipt', label: 'رسید' },
  { value: 'issue', label: 'حواله' },
];
const STATUSES = [
  { value: 'draft', label: 'پیش‌نویس', color: 'default' },
  { value: 'approved', label: 'تأییدشده', color: 'green' },
];

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
  // Version 1.1: receipts and issues with their lines, and the stock they move.
  {
    name: `${KEY}_documents`,
    title: 'سند انبار',
    titleField: 'number',
    fields: [
      sequence('number', 'شماره'),
      select('kind', 'نوع سند', KINDS, 'receipt', { required: true }),
      dateOnly('date', 'تاریخ'),
      belongsTo('warehouse', 'انبار', `${KEY}_warehouses`, 'name', { required: true }),
      select('status', 'وضعیت', STATUSES, 'draft'),
      hasMany('lines', 'ردیف‌ها', `${KEY}_document_lines`, 'documentId'),
      textarea('description', 'توضیح'),
    ],
  },
  {
    name: `${KEY}_document_lines`,
    title: 'ردیف سند انبار',
    titleField: 'quantity',
    fields: [
      belongsTo('document', 'سند', `${KEY}_documents`, 'number', { onDelete: 'CASCADE' }),
      belongsTo('item', 'کالا', `${KEY}_items`, 'name', { required: true }),
      quantity('quantity', 'مقدار', { required: true }),
    ],
  },
  // One row for each item in each warehouse, keyed «item:warehouse» so that two approvals never make two rows. Only
  // the approval workflow writes here.
  {
    name: `${KEY}_stock`,
    title: 'موجودی',
    titleField: 'key',
    filterTargetKey: 'key',
    systemFields: false,
    fields: [
      { name: 'key', interface: 'input', type: 'string', primaryKey: true, allowNull: false, uiSchema: { type: 'string', title: 'کلید', 'x-component': 'Input' } },
      belongsTo('item', 'کالا', `${KEY}_items`, 'name'),
      belongsTo('warehouse', 'انبار', `${KEY}_warehouses`, 'name'),
      quantity('quantity', 'موجودی'),
    ],
  },
  // Version 1.2: the kardex. The approval writes one movement for each item of a document, with the balance after it.
  {
    name: `${KEY}_movements`,
    title: 'گردش کالا',
    titleField: 'key',
    filterTargetKey: 'key',
    systemFields: false,
    fields: [
      { name: 'key', interface: 'input', type: 'string', primaryKey: true, allowNull: false, uiSchema: { type: 'string', title: 'کلید', 'x-component': 'Input' } },
      dateOnly('date', 'تاریخ'),
      belongsTo('document', 'سند', `${KEY}_documents`, 'number'),
      belongsTo('item', 'کالا', `${KEY}_items`, 'name'),
      belongsTo('warehouse', 'انبار', `${KEY}_warehouses`, 'name'),
      quantity('quantityIn', 'ورود'),
      quantity('quantityOut', 'خروج'),
      quantity('balance', 'مانده'),
    ],
  },
];

// The stock table has only its key and timestamps; it has no id, and nobody creates or updates its rows by hand.
const systemFields = (collection) => (collection.systemFields === false ? SYSTEM_FIELDS.filter((f) => f.name === 'createdAt' || f.name === 'updatedAt') : SYSTEM_FIELDS);
const fieldNames = (collection) => [...systemFields(collection), ...collection.fields].map((field) => field.name);

const GROUP = { title: 'انبار', icon: 'DatabaseOutlined' };
// The lines of a document are written and shown as a table inside its form.
// Notification nodes of ERP modules send through this channel; plugin-modules makes it on every install.
const CHANNEL = 'erp_in_app';
const LINES = { key: 'lines', field: 'lines', fieldType: 'subTable', titleField: 'quantity', fields: ['item', 'quantity'] };

const page = (title, icon, collection, fields, formFields = fields, { detailFields = formFields, extraRecordActions = [], readOnly = false, formLayout, detailLayout, sorting } = {}) => ({
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
          ...(sorting ? { settings: { sorting } } : {}),
          actions: [
            'filter',
            'refresh',
            ...(readOnly ? [] : [{ type: 'addNew', popup: { blocks: [{ type: 'createForm', resource: { binding: 'currentCollection' }, fields: formFields, ...(formLayout ? { fieldsLayout: formLayout } : {}), actions: ['submit'] }] } }]),
          ],
          recordActions: [
            { type: 'view', popup: { blocks: [{ type: 'details', resource: { binding: 'currentRecord' }, fields: detailFields, ...(detailLayout ? { fieldsLayout: detailLayout } : {}) }] } },
            ...(readOnly
              ? []
              : [{ type: 'edit', popup: { blocks: [{ type: 'editForm', resource: { binding: 'currentRecord' }, fields: formFields, ...(formLayout ? { fieldsLayout: formLayout } : {}), actions: ['submit'] }] } }, 'delete', ...extraRecordActions]),
          ],
        },
      ],
    },
  ],
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
    const { systemFields: _, ...values } = collection;
    await call('collections:create', { ...values, template: 'general', autoGenId: false, logging: true, fields: [...systemFields(collection), ...fields] });
  }

  await call('flowSurfaces:applyBlueprint', page('کالاها', 'AppstoreOutlined', `${KEY}_items`, ['code', 'name', 'unit', 'category', 'minStock', 'price'], ['code', 'name', 'unit', 'category', 'minStock', 'price', 'description']));
  await call('flowSurfaces:applyBlueprint', page('گروه‌های کالا', 'TagsOutlined', `${KEY}_categories`, ['name']));
  await call('flowSurfaces:applyBlueprint', page('انبارها', 'HomeOutlined', `${KEY}_warehouses`, ['name', 'region'], ['name', 'region', 'address']));
  await call(
    'flowSurfaces:applyBlueprint',
    page('رسید و حواله', 'FileTextOutlined', `${KEY}_documents`, ['number', 'kind', 'date', 'warehouse', 'status'], ['kind', 'date', 'warehouse', LINES, 'description'], {
      detailFields: ['number', 'kind', 'date', 'warehouse', 'status', LINES, 'description'],
      // The lines get the whole width of the form.
      formLayout: { rows: [[{ key: 'kind', span: 12 }, { key: 'date', span: 12 }], ['warehouse'], ['lines'], ['description']] },
      detailLayout: { rows: [[{ key: 'number', span: 8 }, { key: 'kind', span: 8 }, { key: 'date', span: 8 }], [{ key: 'warehouse', span: 12 }, { key: 'status', span: 12 }], ['lines'], ['description']] },
      extraRecordActions: [{ type: 'updateRecord', title: 'تأیید سند', settings: { assignValues: { status: 'approved' } } }],
    }),
  );
  // Explicit keys: the page builder names a relation column and its click-to-open popup alike otherwise.
  await call(
    'flowSurfaces:applyBlueprint',
    page('موجودی', 'BarChartOutlined', `${KEY}_stock`, [{ field: 'item', key: 'stockItem' }, { field: 'warehouse', key: 'stockWarehouse' }, 'quantity'], ['item', 'warehouse', 'quantity'], { readOnly: true }),
  );
  // The kardex: every movement in the order it happened; the filter narrows it to one item or warehouse.
  const MOVEMENT_FIELDS = ['date', 'document', 'item', 'warehouse', 'quantityIn', 'quantityOut', 'balance'];
  await call(
    'flowSurfaces:applyBlueprint',
    page(
      'کاردکس',
      'HistoryOutlined',
      `${KEY}_movements`,
      MOVEMENT_FIELDS.map((field) => ({ field, key: `movement_${field}` })),
      MOVEMENT_FIELDS,
      { readOnly: true, sorting: [{ field: 'createdAt', direction: 'asc' }] },
    ),
  );
  const [group] = await list('desktopRoutes', { title: GROUP.title, parentId: { $empty: true } });
  if (!group) throw new Error('the menu group was not created');

  const routes = [group];
  for (let parents = [group.id]; parents.length; ) {
    const children = await list('desktopRoutes', { parentId: { $in: parents } });
    routes.push(...children);
    parents = children.map((r) => r.id);
  }
  // Approving a document. A pre-action workflow runs inside the update request, before the record is written, so a
  // refusal reaches the person who pressed «تأیید سند» and nothing is saved. Two statements do the work, each atomic on
  // its own: the first makes the missing stock rows and finds what is short; the second marks the document approved
  // and moves every line, or none of them. Its stock update waits for any other approval of the same rows and checks
  // the quantity again, so two approvals at once cannot take an item below zero.
  const docs = `${KEY}_documents`;
  const params = [
    { name: 'id', value: '{{$context.params.filterByTk}}' },
    { name: 'status', value: '{{$context.params.values.status}}' },
  ];
  const need = (doc) => `need AS (
    SELECT l."itemId", ${doc}."warehouseId", SUM(CASE WHEN ${doc}.kind = 'issue' THEN -l.quantity ELSE l.quantity END) AS delta
    FROM ${KEY}_document_lines l JOIN ${doc} ON l."documentId" = ${doc}.id
    GROUP BY l."itemId", ${doc}."warehouseId"
  )`;
  const CHECK = `WITH doc AS (
    SELECT d.id, d.kind, d."warehouseId" FROM ${docs} d WHERE d.id = :id AND d.status = 'draft' AND :status = 'approved'
  ),
  ${need('doc')},
  ensure AS (
    INSERT INTO ${KEY}_stock (key, "itemId", "warehouseId", quantity, "createdAt", "updatedAt")
    SELECT need."itemId" || ':' || need."warehouseId", need."itemId", need."warehouseId", 0, now(), now() FROM need
    ON CONFLICT (key) DO NOTHING
  ),
  short AS (
    SELECT format('موجودی %s در %s کافی نیست', i.name, w.name) AS message
    FROM need
    LEFT JOIN ${KEY}_stock s ON s.key = need."itemId" || ':' || need."warehouseId"
    JOIN ${KEY}_items i ON i.id = need."itemId"
    JOIN ${KEY}_warehouses w ON w.id = need."warehouseId"
    WHERE COALESCE(s.quantity, 0) + need.delta < 0
  ),
  problems AS (
    SELECT 'سند را یکی‌یکی تأیید کنید' AS message WHERE :status = 'approved' AND :id IS NULL
    UNION ALL SELECT 'سند ردیف کالا ندارد' WHERE EXISTS (SELECT 1 FROM doc) AND NOT EXISTS (SELECT 1 FROM need)
    UNION ALL SELECT message FROM short
  )
  SELECT COUNT(*)::int AS problems, string_agg(message, '، ') AS message FROM problems`;
  const APPLY = `WITH doc AS (
    UPDATE ${docs} SET status = 'approved', "updatedAt" = now()
    WHERE id = :id AND status = 'draft' AND :status = 'approved'
    RETURNING id, kind, "warehouseId", "date"
  ),
  ${need('doc')},
  moved AS (
    UPDATE ${KEY}_stock s SET quantity = s.quantity + need.delta, "updatedAt" = now()
    FROM need WHERE s.key = need."itemId" || ':' || need."warehouseId" AND s.quantity + need.delta >= 0
    RETURNING s.key, s."itemId", s."warehouseId", s.quantity
  ),
  logged AS (
    INSERT INTO ${KEY}_movements (key, "date", "documentId", "itemId", "warehouseId", "quantityIn", "quantityOut", balance, "createdAt", "updatedAt")
    SELECT doc.id || ':' || moved."itemId", doc."date", doc.id, moved."itemId", moved."warehouseId",
      GREATEST(need.delta, 0), GREATEST(-need.delta, 0), moved.quantity, now(), now()
    FROM moved JOIN need ON moved.key = need."itemId" || ':' || need."warehouseId" CROSS JOIN doc
  ),
  -- An issue that leaves an item under its minimum stock tells the inventory managers.
  low AS (
    SELECT format('موجودی %s در %s به %s رسید', i.name, w.name, translate(moved.quantity::text, '0123456789.', '۰۱۲۳۴۵۶۷۸۹٫')) AS message
    FROM moved
    JOIN need ON moved.key = need."itemId" || ':' || need."warehouseId"
    JOIN ${KEY}_items i ON i.id = moved."itemId"
    JOIN ${KEY}_warehouses w ON w.id = moved."warehouseId"
    WHERE need.delta < 0 AND moved.quantity < i."minStock"
  )
  -- A line that could not move fails the statement, so that no line of the document moves.
  SELECT CASE WHEN (SELECT COUNT(*) FROM moved) = (SELECT COUNT(*) FROM need) THEN (SELECT COUNT(*) FROM moved)::int
      ELSE 1 / (SELECT COUNT(*) FROM moved WHERE false)::int END AS moved,
    (SELECT COUNT(*)::int FROM low) AS low,
    (SELECT string_agg(message, '، ') FROM low) AS message`;

  const approval = await call('workflows:create', {
    title: 'تأیید سند انبار',
    description: 'وقتی رسید یا حواله تأیید شود، موجودی کالاهای ردیف‌هایش را در انبار سند زیاد یا کم می‌کند. حواله‌ای که موجودی کافی ندارد با پیام فارسی رد می‌شود و هیچ ردیفی اعمال نمی‌شود.',
    type: 'request-interception',
    sync: true,
    enabled: true,
    config: { collection: docs, global: true, actions: ['update'] },
  });
  const node = (values) => call(`workflows/${approval.id}/nodes:create`, values);
  const check = await node({ type: 'sql', title: 'بررسی موجودی', config: { dataSource: 'main', sql: CHECK, variables: params } });
  const condition = await node({
    type: 'condition',
    title: 'کمبود دارد؟',
    upstreamId: check.id,
    config: { rejectOnFalse: false, engine: 'basic', calculation: { group: { type: 'and', calculations: [{ calculator: 'gt', operands: [`{{$jobsMapByNodeKey.${check.key}.0.problems}}`, 0] }] } } },
  });
  const message = await node({ type: 'response-message', title: 'پیام کمبود', upstreamId: condition.id, branchIndex: 1, config: { message: `{{$jobsMapByNodeKey.${check.key}.0.message}}` } });
  await node({ type: 'end', title: 'رد تأیید', upstreamId: message.id, config: { endStatus: -1 } });
  const apply = await node({ type: 'sql', title: 'اعمال ردیف‌ها', upstreamId: condition.id, config: { dataSource: 'main', sql: APPLY, variables: params } });
  const low = await node({
    type: 'condition',
    title: 'زیر حداقل موجودی؟',
    upstreamId: apply.id,
    config: { rejectOnFalse: false, engine: 'basic', calculation: { group: { type: 'and', calculations: [{ calculator: 'gt', operands: [`{{$jobsMapByNodeKey.${apply.key}.0.low}}`, 0] }] } } },
  });
  // A notification that fails to go out does not stop the approval.
  await node({
    type: 'notification',
    title: 'اعلان حداقل موجودی',
    upstreamId: low.id,
    branchIndex: 1,
    config: {
      channelName: CHANNEL,
      receivers: [{ filter: { 'roles.name': `${KEY}_manager` } }],
      title: 'موجودی کم',
      content: `{{$jobsMapByNodeKey.${apply.key}.0.message}}`,
      ignoreFail: true,
    },
  });

  // «مدیر انبار» defines items and warehouses; «انباردار» sees them. Both write receipts and issues, and change or
  // delete them only while they are drafts. The stock is only read.
  const DRAFT_SCOPES = [
    { key: `${KEY}_draft_documents`, name: 'سند پیش‌نویس', resourceName: docs, scope: { status: { $eq: 'draft' } } },
    { key: `${KEY}_draft_lines`, name: 'ردیف سند پیش‌نویس', resourceName: `${KEY}_document_lines`, scope: { document: { status: { $eq: 'draft' } } } },
  ];
  const scopeIds = {};
  for (const scope of DRAFT_SCOPES) {
    scopeIds[scope.resourceName] = (await call('dataSourcesRolesResourcesScopes:create', { ...scope, dataSourceKey: 'main' })).id;
  }
  const MASTER = [`${KEY}_categories`, `${KEY}_items`, `${KEY}_warehouses`];
  const drafts = (collection) => ['view', 'create', 'update', 'destroy'].map((action) => ({ action, scopeId: action === 'update' || action === 'destroy' ? scopeIds[collection] : undefined }));
  const actionsOf = (role, collection) => {
    if (collection === `${KEY}_stock` || collection === `${KEY}_movements`) return [{ action: 'view' }];
    if (!MASTER.includes(collection)) return drafts(collection);
    return (role === 'manager' ? ['view', 'create', 'update', 'destroy'] : ['view']).map((action) => ({ action }));
  };
  const ROLES = [
    { role: 'manager', name: `${KEY}_manager`, title: 'مدیر انبار' },
    { role: 'keeper', name: `${KEY}_keeper`, title: 'انباردار' },
  ];
  for (const { role, name, title } of ROLES) {
    await call('roles:create', { name, title, snippets: ['!pm', '!pm.*', '!ui.*'], allowNewMenu: false, allowConfigure: false });
    // The role editor lists every field of a collection when an action is ticked; an empty list allows no field.
    for (const collection of COLLECTIONS) {
      const names = fieldNames(collection);
      await call(`roles/${name}/dataSourceResources:create?filterByTk=${collection.name}&filter=${encodeURIComponent(JSON.stringify({ dataSourceKey: 'main' }))}`, {
        name: collection.name,
        dataSourceKey: 'main',
        usingActionsConfig: true,
        actions: actionsOf(role, collection.name).map(({ action, scopeId }) => ({ name: action, ...(action === 'destroy' ? {} : { fields: names }), ...(scopeId ? { scopeId } : {}) })),
      });
    }
    await call(`roles/${name}/desktopRoutes:set`, routes.map((r) => r.id));
  }

  await call('erpModules:create', {
    key: KEY,
    title: 'انبار',
    version: VERSION,
    description: 'کالا، گروه کالا و انبار برای کسب‌وکار کوچک، با رسید و حواله‌ای که پس از تأیید موجودی هر کالا را در هر انبار به‌روز می‌کند، کاردکس هر کالا و اعلان به «مدیر انبار» وقتی موجودی از حداقل کمتر شود. نقش‌ها: «مدیر انبار» و «انباردار».',
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
