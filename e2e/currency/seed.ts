import { expect } from '@playwright/test';
import { Api } from '../helpers';

// A collection with one Iranian currency field shown in tomans, one record of 125000 rials, and a classic (v1) and a
// modern (v2) page, each with a table and a create form. Pages are hidden from the menu, as in jalali/seed.ts.

export const COLLECTION = 'currency_samples';
export const V1_PAGE_TITLE = 'مبلغ‌های کلاسیک';
export const V2_PAGE_TITLE = 'مبلغ‌های مدرن';

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
    await api.call('collections:create', {
      name: COLLECTION,
      title: 'نمونه‌ی مبلغ',
      template: 'general',
      autoGenId: true,
      fields: [
        {
          name: 'amount',
          type: 'bigInt',
          interface: 'currencyIRR',
          uiSchema: {
            type: 'number',
            title: 'مبلغ',
            'x-component': 'IranianCurrency',
            'x-component-props': { unit: 'toman' },
          },
        },
      ],
    });
  }
  if (!(await list(api, COLLECTION, {})).length) await api.call(`${COLLECTION}:create`, { amount: 125000 });
}

const row = (properties: object) => ({
  type: 'void',
  'x-component': 'Grid.Row',
  properties: { col: { type: 'void', 'x-component': 'Grid.Col', properties } },
});

async function route(api: Api, type: string, title: string, pageUid: string, tabUid: string) {
  await api.call('desktopRoutes:create', {
    type,
    title,
    schemaUid: pageUid,
    menuSchemaUid: uid('cm'),
    enableTabs: false,
    hideInMenu: true,
    children: [{ type: 'tabs', schemaUid: tabUid, tabSchemaName: uid('cn'), hidden: true }],
  });
}

export async function seedV1Page(api: Api): Promise<string> {
  const existing = (await list(api, 'desktopRoutes', { title: V1_PAGE_TITLE }))[0]?.schemaUid;
  if (existing) return existing;
  const pageUid = uid('cp');
  const gridUid = uid('cg');
  await route(api, 'page', V1_PAGE_TITLE, pageUid, gridUid);
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
        properties: {
          amount: {
            type: 'void',
            'x-decorator': 'TableV2.Column.Decorator',
            'x-component': 'TableV2.Column',
            properties: {
              amount: {
                'x-collection-field': `${COLLECTION}.amount`,
                'x-component': 'CollectionField',
                'x-read-pretty': true,
                'x-decorator': null,
              },
            },
          },
        },
      },
    },
  };
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
              amountRow: row({
                amount: {
                  type: 'string',
                  'x-component': 'CollectionField',
                  'x-decorator': 'FormItem',
                  'x-collection-field': `${COLLECTION}.amount`,
                },
              }),
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
      [uid('ct')]: {
        type: 'void',
        'x-component': 'Grid',
        'x-uid': gridUid,
        properties: { tableRow: row({ table }), formRow: row({ form }) },
      },
    },
  });
  return pageUid;
}

export async function seedV2Page(api: Api): Promise<string> {
  const existing = (await list(api, 'desktopRoutes', { title: V2_PAGE_TITLE }))[0]?.schemaUid;
  if (existing) return existing;
  const pageUid = uid('cv');
  const tabUid = uid('ct');
  await route(api, 'flowPage', V2_PAGE_TITLE, pageUid, tabUid);
  const init = { dataSourceKey: 'main', collectionName: COLLECTION };
  await api.call('flowModels:save', {
    uid: uid('cg'),
    parentId: tabUid,
    subKey: 'grid',
    subType: 'object',
    use: 'BlockGridModel',
    subModels: {
      items: [
        {
          uid: uid('cb'),
          use: 'TableBlockModel',
          stepParams: { resourceSettings: { init } },
          subModels: {
            columns: [
              {
                uid: uid('cc'),
                use: 'TableColumnModel',
                stepParams: {
                  fieldSettings: { init: { ...init, fieldPath: 'amount' } },
                  tableColumnSettings: { model: { use: 'DisplayIranianCurrencyFieldModel' } },
                },
                props: { title: 'مبلغ', dataIndex: 'amount', width: 200 },
                subModels: { field: { uid: uid('cf'), use: 'DisplayIranianCurrencyFieldModel', props: {} } },
              },
            ],
          },
        },
        {
          uid: uid('cb'),
          use: 'CreateFormModel',
          stepParams: { resourceSettings: { init } },
          subModels: {
            grid: {
              uid: uid('cg'),
              use: 'FormGridModel',
              subModels: {
                items: [
                  {
                    uid: uid('ci'),
                    use: 'FormItemModel',
                    stepParams: { fieldSettings: { init: { ...init, fieldPath: 'amount' } } },
                    subModels: { field: { uid: uid('cf'), use: 'IranianCurrencyFieldModel', props: {} } },
                  },
                ],
              },
            },
            actions: [{ uid: uid('ca'), use: 'FormSubmitActionModel' }],
          },
        },
      ],
    },
  });
  return pageUid;
}

export async function cleanup(api: Api) {
  for (const title of [V1_PAGE_TITLE, V2_PAGE_TITLE]) {
    for (const r of await list(api, 'desktopRoutes', { title })) {
      await api.call(`desktopRoutes:destroy?filterByTk=${r.id}`);
    }
  }
  if ((await list(api, 'collections', { name: COLLECTION })).length) {
    await api.call(`collections:destroy?filterByTk=${COLLECTION}`);
  }
}
