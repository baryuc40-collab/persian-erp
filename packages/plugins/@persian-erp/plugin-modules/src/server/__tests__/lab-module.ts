import type { MockServer } from '@nocobase/test';
import PluginModulesServer from '../plugin';

// Plugins a module can use: menus, both page generations, templates, workflows and permissions.
export const MODULE_PLUGINS = [

    'error-handler',
    'field-sort',
    'users',
    'auth',
    'acl',
    'data-source-main',
    'data-source-manager',
    'ui-schema-storage',
    'client',
    'flow-engine',
    'ui-templates',
  'ui-layout',
    'workflow',
    'workflow-action-trigger',
    PluginModulesServer,
];

// A small module built the way the UI stores it; see section 9 of docs/research/erp-modules.md.
export async function buildLabModule(app: MockServer) {
  const db = app.db;
  const collections = db.getRepository('collections');
  await collections.create({
    values: { name: 'lab_categories', title: 'دسته', fields: [{ name: 'name', type: 'string', interface: 'input' }] },
    context: {},
  });
  await collections.create({
    values: {
      name: 'lab_items',
      title: 'قلم',
      fields: [
        { name: 'title', type: 'string', interface: 'input' },
        { name: 'amount', type: 'double', interface: 'number' },
      ],
    },
    context: {},
  });

  // Relation fields are added one by one, as the collection manager does, which also adds their foreign keys.
  const fields = db.getRepository('fields');
  await fields.create({
    values: {
      collectionName: 'lab_items',
      name: 'category',
      type: 'belongsTo',
      interface: 'm2o',
      target: 'lab_categories',
      foreignKey: 'categoryId',
      reverseField: { name: 'items', type: 'hasMany', interface: 'o2m' },
    },
    context: {},
  });
  await fields.create({
    values: {
      collectionName: 'lab_items',
      name: 'owner',
      type: 'belongsTo',
      interface: 'm2o',
      target: 'users',
      foreignKey: 'ownerId',
    },
    context: {},
  });

  const group = await db.getRepository('desktopRoutes').create({
    values: {
      type: 'group',
      title: 'آزمایشگاه',
      schemaUid: 'labgroup001',
      children: [
        {
          type: 'page',
          title: 'کلاسیک',
          schemaUid: 'labclspage1',
          menuSchemaUid: 'labclsmenu1',
          children: [{ type: 'tabs', schemaUid: 'labclsgrid1', tabSchemaName: 'tab1', hidden: true }],
        },
        {
          type: 'flowPage',
          title: 'مدرن',
          schemaUid: 'labflowpage',
          menuSchemaUid: 'labflowmenu',
          children: [{ type: 'tabs', schemaUid: 'labflowtab1', tabSchemaName: 'tab1', hidden: true }],
        },
        { type: 'link', title: 'پیوند', options: { href: 'https://example.com' } },
      ],
    },
  });
  // Routes made in the UI are linked to the layout they were made in (plugin-ui-layout).
  for (const route of await db.getRepository('desktopRoutes').find()) {
    await db.getRepository<any>('desktopRoutes.uiLayouts', route.get('id') as string).set({ tk: ['admin-layout-model'] });
  }
  const routes = await db.getRepository('desktopRoutes').find({ filter: { parentId: group.get('id') } });
  const flowPage = routes.find((route) => route.get('schemaUid') === 'labflowpage');

  await db.getRepository('uiSchemas').insert({
    type: 'void',
    'x-component': 'Page',
    'x-uid': 'labclspage1',
    // Generated when missing; fixed here so the reference file does not change between runs.
    name: 'labclspage',
    properties: {
      tab1: {
        type: 'void',
        'x-component': 'Grid',
        'x-uid': 'labclsgrid1',
        properties: {
          table: {
            type: 'void',
            'x-uid': 'labclstable',
            'x-decorator': 'TableBlockProvider',
            'x-acl-action': 'lab_items:list',
            'x-decorator-props': { collection: 'lab_items', dataSource: 'main' },
            properties: {
              approve: {
                type: 'void',
                'x-uid': 'labclsbtn01',
                'x-component': 'Action',
                'x-action-settings': { triggerWorkflows: [{ workflowKey: 'labapprove1' }] },
              },
            },
          },
        },
      },
    },
  });

  const models = db.getRepository('flowModels') as any;
  await models.upsertModel({
    uid: 'labroot0001',
    parentId: 'labflowpage',
    subKey: 'page',
    subType: 'object',
    use: 'RootPageModel',
    props: { routeId: flowPage.get('id'), title: 'مدرن' },
  });
  await models.upsertModel({
    uid: 'labgrid0001',
    parentId: 'labflowtab1',
    subKey: 'grid',
    subType: 'object',
    use: 'BlockGridModel',
    subModels: {
      items: [
        {
          uid: 'labtable001',
          use: 'TableBlockModel',
          stepParams: { resourceSettings: { init: { dataSourceKey: 'main', collectionName: 'lab_items' } } },
          subModels: {
            actions: [
              {
                uid: 'labview0001',
                use: 'ViewActionModel',
                stepParams: {
                  popupSettings: {
                    openView: {
                      uid: 'labpopup001',
                      dataSourceKey: 'main',
                      collectionName: 'lab_items',
                      popupTemplateUid: 'labtmpl0001',
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  });
  // A popup host is a root of its own, reached only through openView.uid and the popup template.
  await models.insertModel({
    uid: 'labpopup001',
    use: 'ViewActionModel',
    subModels: { page: { uid: 'labpopuppg1', use: 'ChildPageModel' } },
  });
  // Not part of the module.
  await models.insertModel({ uid: 'othermodel1', use: 'TableBlockModel' });
  await db.getRepository('flowModelTemplates').create({
    values: {
      uid: 'labtmpl0001',
      name: 'قلم',
      targetUid: 'labpopup001',
      useModel: 'DetailsBlockModel',
      type: 'popup',
      dataSourceKey: 'main',
      collectionName: 'lab_items',
    },
  });
  // plugin-ui-templates records the usage itself when a model naming the template is saved.
  if (!(await db.getRepository('flowModelTemplateUsages').count({ filter: { modelUid: 'labview0001' } }))) {
    throw new Error('expected plugin-ui-templates to record the template usage');
  }

  const workflows = db.getRepository('workflows');
  const status = await workflows.create({
    values: { key: 'labstatus01', title: 'وضعیت', type: 'collection', config: { mode: 1, collection: 'lab_items' } },
  });
  const nodes = db.getRepository('flow_nodes');
  const condition = await nodes.create({
    values: { key: 'labnodecond', workflowId: status.get('id'), type: 'condition', title: 'شرط', config: {} },
  });
  await nodes.create({
    values: {
      key: 'labnodeyes1',
      workflowId: status.get('id'),
      type: 'update',
      upstreamId: condition.get('id'),
      branchIndex: 1,
      config: { collection: 'lab_items', params: { values: { title: '{{$jobsMapByNodeKey.labnodecond}}' } } },
    },
  });
  const query = await nodes.create({
    values: {
      key: 'labnodeqry1',
      workflowId: status.get('id'),
      type: 'query',
      upstreamId: condition.get('id'),
      config: { collection: 'lab_categories' },
    },
  });
  await nodes.update({ filterByTk: condition.get('id'), values: { downstreamId: query.get('id') } });
  // Runs from a module page on a collection outside the module.
  await workflows.create({
    values: { key: 'labapprove1', title: 'تأیید', type: 'action', enabled: true, config: { collection: 'users' } },
  });
  await workflows.create({
    values: { key: 'otherwflow1', title: 'دیگر', type: 'collection', config: { mode: 1, collection: 'users' } },
  });

  await db.getRepository('roles').create({ values: { name: 'lab_clerk', title: 'کارمند آزمایشگاه' } });
  const scope = await db.getRepository('dataSourcesRolesResourcesScopes').create({
    values: { key: 'labopenscop', name: 'باز', dataSourceKey: 'main', resourceName: 'lab_items', scope: { amount: 1 } },
  });
  await db.getRepository('dataSourcesRolesResources').create({
    values: {
      roleName: 'lab_clerk',
      dataSourceKey: 'main',
      name: 'lab_items',
      usingActionsConfig: true,
      actions: [
        { name: 'view', fields: ['title', 'amount'], scopeId: scope.get('id') },
        { name: 'update', fields: ['title'] },
      ],
    },
  });
  // Permissions outside the module are left out.
  await db.getRepository('dataSourcesRolesResources').create({
    values: { roleName: 'lab_clerk', dataSourceKey: 'main', name: 'users', usingActionsConfig: true, actions: [] },
  });
  const all = await db.getRepository('desktopRoutes').find();
  await db.getRepository('roles.desktopRoutes', 'lab_clerk').add(all.map((route) => route.get('id')));

  await db.getRepository('erpModules').create({
    values: { key: 'lab', title: 'آزمایشگاه', version: '1.0.0', groupSchemaUid: 'labgroup001' },
  });
  return { groupId: group.get('id'), statusId: status.get('id'), flowPageId: flowPage.get('id') };
}
