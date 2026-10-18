import { createMockServer, MockServer } from '@nocobase/test';
import { ModuleRow } from '../exporter';
import { removeModule } from '../remover';
import { buildLabModule, MODULE_PLUGINS } from './lab-module';

const createApp = () => createMockServer({ plugins: MODULE_PLUGINS, acl: true });

async function rootAgent(app: MockServer) {
  const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
  return app.agent().login(user, 'root');
}

const errorOf = (res) => res.body.errors?.[0]?.message as string;

// Removing a module (STORY-075, section 5 of docs/decisions/0006-erp-module-upgrade.md).
describe('erpModules:remove', () => {
  let app: MockServer;
  let labFile: object;

  beforeAll(async () => {
    const source = await createApp();
    await buildLabModule(source);
    labFile = JSON.parse((await (await rootAgent(source)).resource('erpModules').export({ filterByTk: 'lab' })).text);
    await source.destroy();
  });

  beforeEach(async () => {
    app = await createApp();
    expect((await (await rootAgent(app)).resource('erpModules').import({ values: labFile })).status).toBe(200);
    await app.db.getRepository('lab_items').create({ values: [{ title: 'الف' }, { title: 'ب' }] });
    await app.db.getRepository('users').create({ values: { nickname: 'clerk', roles: ['lab_clerk'] } });
  });

  afterEach(async () => {
    await app.destroy();
  });

  const remove = async (params: Record<string, unknown>) =>
    (await rootAgent(app)).resource('erpModules').remove({ filterByTk: 'lab', ...params });

  it('previews what goes, with the records of each collection and the users of each role', async () => {
    const res = await remove({ dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'lab', title: 'آزمایشگاه', version: '1.0.0' });
    expect(res.body.data.collections).toEqual(
      expect.arrayContaining([
        { name: 'lab_items', title: 'قلم', records: 2 },
        { name: 'lab_categories', title: 'دسته', records: 0 },
      ]),
    );
    expect(res.body.data.roles).toEqual([{ name: 'lab_clerk', title: 'کارمند آزمایشگاه', users: 1 }]);
    expect(res.body.data.workflows.map((w) => w.key).sort()).toEqual(['labapprove1', 'labstatus01']);
    expect(res.body.data.pages.length).toBeGreaterThan(0);
    // A preview changes nothing.
    expect(await app.db.getRepository('erpModules').count()).toBe(1);
  });

  it('removes nothing without the module key as confirmation', async () => {
    for (const confirm of [undefined, 'LAB', 'other']) {
      const res = await remove({ confirm });
      expect(res.status).toBe(400);
      expect(errorOf(res)).toBe('Type the module key to confirm the deletion');
    }
    expect(app.db.hasCollection('lab_items')).toBe(true);
  });

  it('removes every part of the module, keeps its users, and the same file imports again', async () => {
    const res = await remove({ confirm: 'lab' });
    expect(res.status).toBe(200);
    const db = app.db;
    for (const name of ['lab_items', 'lab_categories']) {
      expect(db.hasCollection(name)).toBe(false);
      expect(await db.sequelize.getQueryInterface().tableExists(name)).toBe(false);
    }
    expect(await db.getRepository('collections').count({ filter: { name: { $like: 'lab_%' } } })).toBe(0);
    expect(await db.getRepository('workflows').count({ filter: { key: { $in: ['labapprove1', 'labstatus01'] } } })).toBe(0);
    expect(await db.getRepository('roles').count({ filter: { name: 'lab_clerk' } })).toBe(0);
    expect(app.acl.getRole('lab_clerk')).toBeFalsy();
    expect(await db.getRepository('desktopRoutes').count()).toBe(0);
    // Pages: a modern page with a popup host outside the route tree, and a classic page.
    for (const uid of ['labroot0001', 'labtable001', 'labpopup001', 'labtmpl0001']) {
      expect(await db.getRepository('flowModels').count({ filter: { uid } })).toBe(0);
    }
    expect(await db.getRepository('uiSchemas').count({ filter: { 'x-uid': 'labclspage1' } })).toBe(0);
    expect(await db.getRepository('flowModelTemplates').count()).toBe(0);
    expect(await db.getRepository('erpModules').count()).toBe(0);
    expect(await db.getRepository('users').count({ filter: { nickname: 'clerk' } })).toBe(1);

    expect((await (await rootAgent(app)).resource('erpModules').import({ values: labFile })).status).toBe(200);
  });

  it('rolls everything back, in memory too, when a step fails', async () => {
    const row = (await app.db.getRepository('erpModules').findOne({ filterByTk: 'lab' })).toJSON() as ModuleRow;
    const failing = removeModule(app, row, 'lab', {
      beforeCommit: async () => {
        throw new Error('simulated failure');
      },
    });
    await expect(failing).rejects.toThrow('simulated failure');
    expect(await app.db.getRepository('erpModules').count()).toBe(1);
    expect(await app.db.getRepository('lab_items').count()).toBe(2);
    expect(app.acl.getRole('lab_clerk')).toBeTruthy();
    expect(await app.db.getRepository('workflows').count({ filter: { key: 'labstatus01' } })).toBe(1);
    // The module still exports as it did.
    const res = await (await rootAgent(app)).resource('erpModules').export({ filterByTk: 'lab' });
    expect(res.status).toBe(200);
  });

  it('is only for administrators', async () => {
    const member = await app.db.getRepository('users').create({ values: { nickname: 'm', roles: ['member'] } });
    const res = await (await app.agent().login(member)).resource('erpModules').remove({ filterByTk: 'lab', confirm: 'lab' });
    expect(res.status).toBe(403);
    expect((await remove({ filterByTk: 'nothing', confirm: 'nothing' })).status).toBe(404);
  });
});
