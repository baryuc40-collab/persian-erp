import { createMockServer, MockServer } from '@nocobase/test';
import PluginModulesServer from '../plugin';

// A small module built the way the UI stores it; see section 9 of docs/research/erp-modules.md.
async function buildLabModule(app: MockServer) {
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
        {
          name: 'category',
          type: 'belongsTo',
          interface: 'm2o',
          target: 'lab_categories',
          foreignKey: 'categoryId',
          reverseField: { name: 'items', type: 'hasMany', interface: 'o2m' },
        },
        { name: 'owner', type: 'belongsTo', interface: 'm2o', target: 'users', foreignKey: 'ownerId' },
      ],
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
    values: { key: 'labapprove1', title: 'تأیید', type: 'action', config: { collection: 'users' } },
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

describe('erpModules:export', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({
      plugins: [
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
      ],
      acl: true,
    });
  });

  afterEach(async () => {
    await app.destroy();
  });

  const login = async (role: string) => {
    const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': role } });
    return app.agent().login(user, role);
  };
  const exportLab = async () => (await login('root')).resource('erpModules').export({ filterByTk: 'lab' });

  it('returns the module as one file with every part of it', async () => {
    const ids = await buildLabModule(app);
    const res = await exportLab();
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="lab.erp-module.json"');
    const file = JSON.parse(res.text);

    expect(file.format).toBe('persian-erp-module');
    expect(file.formatVersion).toBe(1);
    expect(file.nocobase).toBe(app.getVersion());
    expect(file.module).toEqual({ key: 'lab', title: 'آزمایشگاه', version: '1.0.0', description: '' });

    expect(file.collections.map((c) => c.name)).toEqual(['lab_categories', 'lab_items']);
    const category = file.collections[1].fields.find((f) => f.name === 'category');
    expect(category).toMatchObject({ target: 'lab_categories', reverseFieldName: 'items' });
    expect(category.key).toBeUndefined();

    expect(file.routes.ref).toBe('labgroup001');
    expect(file.routes.children.map((r) => r.ref)).toEqual(['labclspage1', 'labflowpage', 'labgroup001/3']);
    expect(file.routes.children[1].children[0]).toMatchObject({ ref: 'labflowtab1', tabSchemaName: 'tab1' });
    expect(file.routes.uiLayouts).toEqual(['admin-layout-model']);

    expect(file.uiSchemas.map((s) => s['x-uid'])).toEqual(['labclspage1']);
    expect(file.flowModels.map((m) => m.uid)).toEqual(['labgrid0001', 'labpopup001', 'labroot0001']);
    expect(file.flowModels[2].props).toEqual({ title: 'مدرن' });
    expect(file.flowModelTemplates.map((t) => t.uid)).toEqual(['labtmpl0001']);
    expect(file.flowModelTemplateUsages).toEqual([{ templateUid: 'labtmpl0001', modelUid: 'labview0001' }]);

    expect(file.workflows.map((w) => w.key)).toEqual(['labapprove1', 'labstatus01']);
    const status = file.workflows[1];
    expect(status.nodes.map((n) => [n.key, n.upstream, n.downstream, n.branchIndex])).toEqual([
      ['labnodecond', null, 'labnodeqry1', null],
      ['labnodeyes1', 'labnodecond', null, 1],
      ['labnodeqry1', 'labnodecond', null, null],
    ]);

    expect(file.roles).toHaveLength(1);
    const role = file.roles[0];
    expect(role.resources).toEqual([
      {
        name: 'lab_items',
        usingActionsConfig: true,
        actions: [
          { name: 'update', fields: ['title'], scope: null },
          { name: 'view', fields: ['amount', 'title'], scope: 'labopenscop' },
        ],
      },
    ]);
    expect(role.scopes).toEqual([
      { key: 'labopenscop', name: 'باز', resourceName: 'lab_items', scope: { amount: 1 } },
    ]);
    expect(role.routes).toEqual([
      'labclsgrid1',
      'labclspage1',
      'labflowpage',
      'labflowtab1',
      'labgroup001',
      'labgroup001/3',
    ]);

    expect(file.requires.collections).toEqual(['users']);
    expect(file.requires.fieldInterfaces).toEqual(expect.arrayContaining(['input', 'm2o', 'number', 'o2m']));
    expect(file.requires.workflowTriggers).toEqual(['action', 'collection']);
    expect(file.requires.workflowInstructions).toEqual(['condition', 'query', 'update']);
    expect(file.requires.models).toEqual(
      expect.arrayContaining(['BlockGridModel', 'RootPageModel', 'TableBlockModel', 'ViewActionModel']),
    );

    // No database id or time is written.
    for (const id of [ids.groupId, ids.statusId, ids.flowPageId]) {
      expect(res.text).not.toContain(String(id));
    }
    expect(res.text).not.toMatch(/"(createdAt|updatedAt|workflowId|upstreamId|rolesResourceId|scopeId)"/);
    expect(res.text).not.toContain('othermodel1');
    expect(res.text).not.toContain('otherwflow1');
  });

  it('gives the same file every time', async () => {
    await buildLabModule(app);
    const first = await exportLab();
    const second = await exportLab();
    expect(second.text).toBe(first.text);
    await expect(first.text.replace(app.getVersion(), '<nocobase>')).toMatchFileSnapshot(
      './__snapshots__/lab.erp-module.json',
    );
  });

  it('is only for administrators', async () => {
    await buildLabModule(app);
    expect((await app.agent().resource('erpModules').export({ filterByTk: 'lab' })).status).toBe(401);
    const member = await app.db.getRepository('users').create({ values: { nickname: 'm', roles: ['member'] } });
    const res = await (await app.agent().login(member)).resource('erpModules').export({ filterByTk: 'lab' });
    expect(res.status).toBe(403);
    expect((await (await login('root')).resource('erpModules').export({ filterByTk: 'none' })).status).toBe(404);
  });
});
