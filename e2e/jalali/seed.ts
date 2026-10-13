import { expect } from '@playwright/test';
import { Api } from '../helpers';

// A collection with one record and two pages that show it in a table: a classic (v1) page and a modern (v2) page.
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
  await api.call('uiSchemas:insert', {
    type: 'void',
    'x-component': 'Page',
    'x-uid': pageUid,
    properties: {
      [tabName]: {
        type: 'void',
        'x-component': 'Grid',
        'x-uid': gridUid,
        properties: {
          row: {
            type: 'void',
            'x-component': 'Grid.Row',
            properties: { col: { type: 'void', 'x-component': 'Grid.Col', properties: { table } } },
          },
        },
      },
    },
  });
  return pageUid;
}

// The model tree the UI saves for a table block with two date columns (Add block > Table, Fields > ...).
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
      ],
    },
  });
  return pageUid;
}
