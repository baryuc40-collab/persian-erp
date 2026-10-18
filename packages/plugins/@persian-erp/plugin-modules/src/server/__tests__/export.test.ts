import { createMockServer, MockServer } from '@nocobase/test';
import { buildLabModule, MODULE_PLUGINS } from './lab-module';

describe('erpModules:export', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({
      plugins: MODULE_PLUGINS,
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

  it('takes a workflow without a collection when one of its nodes works on a module collection', async () => {
    await buildLabModule(app);
    const workflows = app.db.getRepository('workflows');
    const nodes = app.db.getRepository('flow_nodes');
    for (const [key, collection] of [
      ['labschedul1', 'lab_items'],
      ['otherschedu', 'users'],
    ]) {
      const workflow = await workflows.create({
        values: { key, title: 'زمان‌بندی', type: 'schedule', config: { mode: 0 } },
      });
      await nodes.create({
        values: { key: `${key}n`, workflowId: workflow.get('id'), type: 'update', config: { collection, params: {} } },
      });
    }
    const file = JSON.parse((await exportLab()).text);
    expect(file.workflows.map((w) => w.key)).toEqual(['labapprove1', 'labschedul1', 'labstatus01']);
    expect(file.requires.workflowTriggers).toEqual(['action', 'collection', 'schedule']);
  });

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
    expect(role.scopes).toEqual([{ key: 'labopenscop', name: 'باز', resourceName: 'lab_items', scope: { amount: 1 } }]);
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
