import { expect } from '@playwright/test';
import { Api } from '../helpers';

// Fixed data for the visual tests. Every lookup is by title so a second run reuses what the first one made.

export const WORKFLOW_TITLE = 'گردش‌کار نمونه';
export const PAGE_TITLE = 'صفحه‌ی نمونه';
export const LOOP_WORKFLOW_TITLE = 'گردش‌کار حلقه‌ی نمونه';

async function findOne(api: Api, resource: string, title: string) {
  const res = await api.request.get(`/api/${resource}:list`, {
    headers: api.headers,
    params: { filter: JSON.stringify({ title }), paginate: 'false' },
  });
  expect(res.ok()).toBeTruthy();
  const { data } = await res.json();
  return data?.[0];
}

// A collection-event workflow with a condition whose two branches hold different nodes, so the Yes/No labels and
// the branch connector lines are both visible.
export async function seedWorkflow(api: Api): Promise<number> {
  const existing = await findOne(api, 'workflows', WORKFLOW_TITLE);
  if (existing) return existing.id;
  const workflow = await api.call('workflows:create', {
    title: WORKFLOW_TITLE,
    type: 'collection',
    sync: false,
    config: { mode: 1, collection: 'users' },
  });
  const nodes = `workflows/${workflow.id}/nodes:create`;
  const condition = await api.call(nodes, { type: 'condition', title: 'شرط', config: { rejectOnFalse: false } });
  await api.call(nodes, {
    type: 'query',
    title: 'پرس‌وجو',
    upstreamId: condition.id,
    branchIndex: 1,
    config: { collection: 'users', params: {} },
  });
  await api.call(nodes, { type: 'calculation', title: 'محاسبه', upstreamId: condition.id, branchIndex: 0, config: {} });
  await api.call(nodes, { type: 'calculation', title: 'محاسبه‌ی نهایی', upstreamId: condition.id, config: {} });
  return workflow.id;
}

// A loop node with one node inside, so the loop's return line is visible.
export async function seedLoopWorkflow(api: Api): Promise<number> {
  const existing = await findOne(api, 'workflows', LOOP_WORKFLOW_TITLE);
  if (existing) return existing.id;
  const workflow = await api.call('workflows:create', {
    title: LOOP_WORKFLOW_TITLE,
    type: 'collection',
    sync: false,
    config: { mode: 1, collection: 'users' },
  });
  const nodes = `workflows/${workflow.id}/nodes:create`;
  const loop = await api.call(nodes, { type: 'loop', title: 'حلقه', config: { target: 3 } });
  await api.call(nodes, { type: 'calculation', title: 'درون حلقه', upstreamId: loop.id, branchIndex: 0, config: {} });
  return workflow.id;
}

const column = (name: string) => ({
  type: 'void',
  'x-decorator': 'TableV2.Column.Decorator',
  'x-toolbar': 'TableColumnSchemaToolbar',
  'x-settings': 'fieldSettings:TableColumn',
  'x-component': 'TableV2.Column',
  properties: {
    [name]: {
      'x-collection-field': `users.${name}`,
      'x-component': 'CollectionField',
      'x-component-props': { ellipsis: true },
      'x-read-pretty': true,
      'x-decorator': null,
      'x-decorator-props': { labelStyle: { display: 'none' } },
    },
  },
});

const action = (name: string, title: string, props: Record<string, unknown>) => ({
  type: 'void',
  title: `{{ t("${title}") }}`,
  'x-action': name,
  'x-toolbar': 'ActionSchemaToolbar',
  'x-settings': `actionSettings:${name}`,
  'x-align': 'left',
  ...props,
});

// A classic (v1) page with a users table block: the same schema the UI writes when a table block is added, plus a
// few columns and actions.
const tableBlock = {
  type: 'void',
  'x-component': 'Grid.Row',
  properties: {
    col: {
      type: 'void',
      'x-component': 'Grid.Col',
      properties: {
        table: {
          type: 'void',
          'x-decorator': 'TableBlockProvider',
          'x-acl-action': 'users:list',
          'x-use-decorator-props': 'useTableBlockDecoratorProps',
          'x-decorator-props': {
            collection: 'users',
            dataSource: 'main',
            action: 'list',
            params: { pageSize: 20 },
            showIndex: true,
            dragSort: false,
          },
          'x-toolbar': 'BlockSchemaToolbar',
          'x-settings': 'blockSettings:table',
          'x-component': 'CardItem',
          'x-filter-targets': [],
          properties: {
            actions: {
              type: 'void',
              'x-initializer': 'table:configureActions',
              'x-component': 'ActionBar',
              'x-component-props': { style: { marginBottom: 'var(--nb-spacing)' } },
              properties: {
                filter: action('filter', 'Filter', {
                  'x-component': 'Filter.Action',
                  'x-use-component-props': 'useFilterActionProps',
                  'x-component-props': { icon: 'FilterOutlined' },
                }),
                refresh: action('refresh', 'Refresh', {
                  'x-component': 'Action',
                  'x-use-component-props': 'useRefreshActionProps',
                  'x-component-props': { icon: 'ReloadOutlined' },
                }),
              },
            },
            rows: {
              type: 'array',
              'x-initializer': 'table:configureColumns',
              'x-component': 'TableV2',
              'x-use-component-props': 'useTableBlockProps',
              'x-component-props': { rowKey: 'id', rowSelection: { type: 'checkbox' } },
              properties: {
                nickname: column('nickname'),
                username: column('username'),
                email: column('email'),
              },
            },
          },
        },
      },
    },
  },
};

export async function seedPage(api: Api): Promise<string> {
  const existing = await findOne(api, 'desktopRoutes', PAGE_TITLE);
  if (existing) return existing.schemaUid;
  const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}`;
  const pageUid = uid('vp');
  const gridUid = uid('vg');
  const tabName = uid('vt');
  await api.call('desktopRoutes:create', {
    type: 'page',
    title: PAGE_TITLE,
    schemaUid: pageUid,
    menuSchemaUid: uid('vm'),
    enableTabs: false,
    children: [{ type: 'tabs', schemaUid: gridUid, tabSchemaName: tabName, hidden: true }],
  });
  await api.call('uiSchemas:insert', {
    type: 'void',
    'x-component': 'Page',
    'x-uid': pageUid,
    properties: {
      [tabName]: {
        type: 'void',
        'x-component': 'Grid',
        'x-initializer': 'page:addBlock',
        'x-uid': gridUid,
        properties: { row: tableBlock },
      },
    },
  });
  return pageUid;
}
