import { expect } from '@playwright/test';
import { Api } from '../helpers';

// A collection with one record and two pages, a classic (v1) and a modern (v2) one, each with a table that shows the
// record and a form that creates new ones.
// The pages are hidden from the menu so they do not show up in the visual tests' screenshots.
// Every lookup is by name or title, so a second run reuses what the first one made.

export const COLLECTION = 'jalali_samples';
export const V1_PAGE_TITLE = 'تاریخ‌های کلاسیک';
export const V2_PAGE_TITLE = 'تاریخ‌های مدرن';

// 2026-10-12 is 1405/07/20. 22:00 UTC is already the next day in Tehran (+03:30): 1405/07/21 01:30.
export const SAMPLE = { title: 'نمونه', day: '2026-10-12', moment: '2026-10-12T22:00:00.000Z' };

const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function list(api: Api, resource: string, filter: object) {
  const res = await api.request.get(`/api/${resource}:list`, {
    headers: api.headers,
    params: { filter: JSON.stringify(filter), paginate: 'false' },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data || [];
}

export async function seedCollection(api: Api) {
  if (!(await list(api, 'collections', { name: COLLECTION })).length) {
    const field = (name: string, type: string, iface: string, title: string, props: object = {}) => ({
      name,
      type,
      interface: iface,
      uiSchema: { type: 'string', title, 'x-component': iface === 'input' ? 'Input' : 'DatePicker', ...props },
    });
    await api.call('collections:create', {
      name: COLLECTION,
      title: 'نمونه‌ی تاریخ',
      template: 'general',
      autoGenId: true,
      fields: [
        field('title', 'string', 'input', 'عنوان'),
        field('day', 'dateOnly', 'date', 'روز', { 'x-component-props': { dateOnly: true } }),
        field('moment', 'date', 'datetime', 'زمان', { 'x-component-props': { showTime: true, timeFormat: 'HH:mm' } }),
      ],
    });
  }
  if (!(await list(api, COLLECTION, {})).length) await api.call(`${COLLECTION}:create`, SAMPLE);
}

async function existingPage(api: Api, title: string): Promise<string | undefined> {
  return (await list(api, 'desktopRoutes', { title }))[0]?.schemaUid;
}

const row = (properties: object) => ({
  type: 'void',
  'x-component': 'Grid.Row',
  properties: { col: { type: 'void', 'x-component': 'Grid.Col', properties } },
});

const v1Column = (name: string) => ({
  type: 'void',
  'x-decorator': 'TableV2.Column.Decorator',
  'x-component': 'TableV2.Column',
  properties: {
    [name]: {
      'x-collection-field': `${COLLECTION}.${name}`,
      'x-component': 'CollectionField',
      'x-read-pretty': true,
      'x-decorator': null,
    },
  },
});

export async function seedV1Page(api: Api): Promise<string> {
  const existing = await existingPage(api, V1_PAGE_TITLE);
  if (existing) return existing;
  const pageUid = uid('jp');
  const gridUid = uid('jg');
  const tabName = uid('jt');
  await api.call('desktopRoutes:create', {
    type: 'page',
    title: V1_PAGE_TITLE,
    schemaUid: pageUid,
    menuSchemaUid: uid('jm'),
    enableTabs: false,
    hideInMenu: true,
    children: [{ type: 'tabs', schemaUid: gridUid, tabSchemaName: tabName, hidden: true }],
  });
  const table = {
    type: 'void',
    'x-decorator': 'TableBlockProvider',
    'x-acl-action': `${COLLECTION}:list`,
    'x-use-decorator-props': 'useTableBlockDecoratorProps',
    'x-decorator-props': { collection: COLLECTION, dataSource: 'main', action: 'list', params: { pageSize: 20 } },
    'x-component': 'CardItem',
    properties: {
      rows: {
        type: 'array',
        'x-component': 'TableV2',
        'x-use-component-props': 'useTableBlockProps',
        'x-component-props': { rowKey: 'id' },
        properties: { title: v1Column('title'), day: v1Column('day'), moment: v1Column('moment') },
      },
    },
  };
  const formField = (name: string) => ({
    type: 'string',
    'x-component': 'CollectionField',
    'x-decorator': 'FormItem',
    'x-collection-field': `${COLLECTION}.${name}`,
  });
  // The schema the UI writes for Add block > Form > the collection, with two fields and Submit.
  const form = {
    type: 'void',
    'x-acl-action-props': { skipScopeCheck: true },
    'x-acl-action': `${COLLECTION}:create`,
    'x-decorator': 'FormBlockProvider',
    'x-use-decorator-props': 'useCreateFormBlockDecoratorProps',
    'x-decorator-props': { dataSource: 'main', collection: COLLECTION },
    'x-component': 'CardItem',
    properties: {
      form: {
        type: 'void',
        'x-component': 'FormV2',
        'x-use-component-props': 'useCreateFormBlockProps',
        properties: {
          grid: {
            type: 'void',
            'x-component': 'Grid',
            properties: {
              dayRow: row({ day: formField('day') }),
              momentRow: row({ moment: formField('moment') }),
            },
          },
          actions: {
            type: 'void',
            'x-component': 'ActionBar',
            'x-component-props': { layout: 'one-column' },
            properties: {
              submit: {
                title: '{{ t("Submit") }}',
                'x-action': 'submit',
                'x-component': 'Action',
                'x-use-component-props': 'useCreateActionProps',
                'x-component-props': { type: 'primary', htmlType: 'submit' },
                'x-action-settings': { triggerWorkflows: [] },
                type: 'void',
              },
            },
          },
        },
      },
    },
  };
  await api.call('uiSchemas:insert', {
    type: 'void',
    'x-component': 'Page',
    'x-uid': pageUid,
    properties: {
      [tabName]: {
        type: 'void',
        'x-component': 'Grid',
        'x-uid': gridUid,
        properties: { tableRow: row({ table }), formRow: row({ form }) },
      },
    },
  });
  return pageUid;
}

// The model tree the UI saves for Add block > Table with two date columns.
const v2Column = (name: string, title: string, props: object) => ({
  uid: uid('jc'),
  use: 'TableColumnModel',
  stepParams: {
    fieldSettings: { init: { dataSourceKey: 'main', collectionName: COLLECTION, fieldPath: name } },
    tableColumnSettings: { model: { use: 'DisplayDateTimeFieldModel' } },
  },
  props: { title, dataIndex: name, width: 200, ...props },
  subModels: {
    field: {
      uid: uid('jf'),
      use: 'DisplayDateTimeFieldModel',
      props: { displayStyle: 'text', dateFormat: 'YYYY-MM-DD', picker: 'date', ...props },
    },
  },
});

// The model tree the UI saves for Add block > Form (Add new) with two fields and Submit.
const v2FormItem = (name: string, model: string, props: object) => ({
  uid: uid('ji'),
  use: 'FormItemModel',
  stepParams: { fieldSettings: { init: { dataSourceKey: 'main', collectionName: COLLECTION, fieldPath: name } } },
  subModels: { field: { uid: uid('jf'), use: model, props } },
});

export async function seedV2Page(api: Api): Promise<string> {
  const existing = await existingPage(api, V2_PAGE_TITLE);
  if (existing) return existing;
  const pageUid = uid('jv');
  const tabUid = uid('jt');
  await api.call('desktopRoutes:create', {
    type: 'flowPage',
    title: V2_PAGE_TITLE,
    schemaUid: pageUid,
    menuSchemaUid: uid('jm'),
    enableTabs: false,
    hideInMenu: true,
    children: [{ type: 'tabs', schemaUid: tabUid, tabSchemaName: uid('jn'), hidden: true }],
  });
  await api.call('flowModels:save', {
    uid: uid('jg'),
    parentId: tabUid,
    subKey: 'grid',
    subType: 'object',
    use: 'BlockGridModel',
    subModels: {
      items: [
        {
          uid: uid('jb'),
          use: 'TableBlockModel',
          stepParams: { resourceSettings: { init: { dataSourceKey: 'main', collectionName: COLLECTION } } },
          subModels: {
            columns: [
              v2Column('day', 'روز', { dateOnly: true, showTime: false, format: 'YYYY-MM-DD' }),
              v2Column('moment', 'زمان', { showTime: true, timeFormat: 'HH:mm', format: 'YYYY-MM-DD HH:mm' }),
            ],
          },
        },
        {
          uid: uid('jb'),
          use: 'CreateFormModel',
          stepParams: { resourceSettings: { init: { dataSourceKey: 'main', collectionName: COLLECTION } } },
          subModels: {
            grid: {
              uid: uid('jg'),
              use: 'FormGridModel',
              subModels: {
                items: [
                  v2FormItem('day', 'DateOnlyFieldModel', { dateOnly: true, showTime: false, utc: false }),
                  v2FormItem('moment', 'DateTimeTzFieldModel', { showTime: true, timeFormat: 'HH:mm', utc: true }),
                ],
              },
            },
            actions: [{ uid: uid('ja'), use: 'FormSubmitActionModel' }],
          },
        },
      ],
    },
  });
  return pageUid;
}

// Removes the collection and the pages, so later tests (the collection list in the visual tests) do not see them.
export async function cleanup(api: Api) {
  for (const title of [V1_PAGE_TITLE, V2_PAGE_TITLE]) {
    for (const route of await list(api, 'desktopRoutes', { title })) {
      await api.call(`desktopRoutes:destroy?filterByTk=${route.id}`);
    }
  }
  if ((await list(api, 'collections', { name: COLLECTION })).length) {
    await api.call(`collections:destroy?filterByTk=${COLLECTION}`);
  }
}
