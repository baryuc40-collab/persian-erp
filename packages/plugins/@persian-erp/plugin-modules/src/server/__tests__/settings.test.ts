import { createMockServer, MockServer } from '@nocobase/test';
import { buildLabModule, MODULE_PLUGINS } from './lab-module';

// The actions behind Settings > ERP modules (STORY-066).

const createApp = () => createMockServer({ plugins: MODULE_PLUGINS, acl: true });

async function rootAgent(app: MockServer) {
  const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
  return app.agent().login(user, 'root');
}

const errorOf = (res) => res.body.errors?.[0]?.message as string;

describe('erpModules settings actions', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createApp();
    await buildLabModule(app);
  });

  afterEach(async () => {
    await app.destroy();
  });

  it('lists the modules with what each holds', async () => {
    const res = await (await rootAgent(app)).resource('erpModules').overview();
    expect(res.status).toBe(200);
    const [lab] = res.body.data;
    expect(lab).toMatchObject({ key: 'lab', title: 'آزمایشگاه', version: '1.0.0', groupSchemaUid: 'labgroup001' });
    expect(lab.collections.map((c) => c.name)).toEqual(['lab_categories', 'lab_items']);
    expect(lab.pages.map((p) => p.type)).toEqual(['page', 'flowPage']);
    expect(lab.workflows.map((w) => w.key)).toEqual(['labapprove1', 'labstatus01']);
    expect(lab.roles).toHaveLength(1);
    expect(lab.error).toBeUndefined();
  });

  it('still lists a module whose menu group is gone, with the reason', async () => {
    await app.db.getRepository('erpModules').update({ filterByTk: 'lab', values: { groupSchemaUid: 'missing' } });
    const res = await (await rootAgent(app)).resource('erpModules').overview();
    expect(res.body.data).toEqual([
      expect.objectContaining({ key: 'lab', collections: [], error: 'The menu group of the module must be a top-level menu group' }),
    ]);
  });

  it('defines a module over a free top-level menu group', async () => {
    await app.db.getRepository('erpModules').destroy({ filterByTk: 'lab' });
    const agent = await rootAgent(app);
    const define = (values) => agent.resource('erpModules').create({ values });

    expect(errorOf(await define({ key: 'Lab', title: 'x', groupSchemaUid: 'labgroup001' }))).toBe(
      'The module key is not valid',
    );
    expect(errorOf(await define({ key: 'lab', title: ' ', groupSchemaUid: 'labgroup001' }))).toBe(
      'The module needs a title',
    );
    expect(errorOf(await define({ key: 'lab', title: 'x', groupSchemaUid: 'labclspage1' }))).toBe(
      'The menu group of the module must be a top-level menu group',
    );

    const res = await define({ key: 'lab', title: ' آزمایشگاه ', groupSchemaUid: 'labgroup001' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'lab', title: 'آزمایشگاه', version: '1.0.0' });

    expect(errorOf(await define({ key: 'lab', title: 'x', groupSchemaUid: 'labgroup001' }))).toBe(
      'A module with this key already exists',
    );
    expect(errorOf(await define({ key: 'lab2', title: 'x', groupSchemaUid: 'labgroup001' }))).toBe(
      'This menu group already belongs to another module',
    );
  });

  it('previews an import without changing anything', async () => {
    const agent = await rootAgent(app);
    const file = JSON.parse((await agent.resource('erpModules').export({ filterByTk: 'lab' })).text);
    const preview = (values) => agent.resource('erpModules').import({ values, dryRun: true });

    // On the install that has the module, everything conflicts.
    const conflicting = await preview(file);
    expect(conflicting.status).toBe(200);
    expect(conflicting.body.data.summary).toMatchObject({ key: 'lab', title: 'آزمایشگاه' });
    expect(conflicting.body.data.problems).toEqual(['The module conflicts with what this install already has']);
    expect(conflicting.body.data.conflicts).toEqual(expect.arrayContaining(['Module: lab', 'Collection: lab_categories, lab_items', 'Role: lab_clerk']));

    // A file that fails the checks is shown as far as it goes.
    const broken = await preview({ ...file, nocobase: '1.0.0' });
    expect(broken.body.data.problems[0]).toMatch(/cannot be imported/);
    expect(broken.body.data.summary.collections).toHaveLength(2);

    // Nothing was written, and an import without dryRun still reports the conflicts as an error.
    await app.db.getRepository('erpModules').destroy({ filterByTk: 'lab' });
    const free = await preview(file);
    expect(free.body.data.problems).toEqual(['The module conflicts with what this install already has']);
    expect(free.body.data.conflicts).not.toContain('Module: lab');
    expect(await app.db.getRepository('erpModules').count()).toBe(0);
    expect((await agent.resource('erpModules').import({ values: file })).status).toBe(400);
  });

  it('is only for administrators', async () => {
    const member = await app.db.getRepository('users').create({ values: { nickname: 'm', roles: ['member'] } });
    const agent = await app.agent().login(member);
    expect((await agent.resource('erpModules').overview()).status).toBe(403);
    expect((await agent.resource('erpModules').create({ values: { key: 'x' } })).status).toBe(403);
  });
});
