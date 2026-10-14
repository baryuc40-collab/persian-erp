import { createMockServer, MockServer } from '@nocobase/test';
import { ModuleRow } from '../exporter';
import { upgradeModule } from '../upgrader';
import { buildLabModule, MODULE_PLUGINS } from './lab-module';

const createApp = () => createMockServer({ plugins: MODULE_PLUGINS, acl: true });

async function rootAgent(app: MockServer) {
  const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
  return app.agent().login(user, 'root');
}

const errorOf = (res) => res.body.errors?.[0]?.message as string;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// NocoBase writes the default sourceKey ("id") on a reverse field created from full values (see import.test.ts).
const withoutDefaultSourceKey = (file: object) =>
  JSON.parse(JSON.stringify(file), (key, value) => (key === 'sourceKey' && value === 'id' ? undefined : value));

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : 1);

// Version 1.1.0 of the lab module: a new field, a renamed collection and page, a changed workflow and role.
function nextVersion(v1: any) {
  const v2 = copy(v1);
  v2.module.version = '1.1.0';
  const items = v2.collections.find((c) => c.name === 'lab_items');
  items.title = 'قلم کالا';
  // Written as an export writes it, so that exporting the upgraded module gives this file back.
  const note = { description: null, interface: 'input', name: 'note', type: 'string' };
  items.fields = [...items.fields, { ...note, uiSchema: { title: 'یادداشت', 'x-component': 'Input' } }].sort(byName);
  v2.routes.children.find((r) => r.schemaUid === 'labflowpage').title = 'اقلام';
  const status = v2.workflows.find((w) => w.key === 'labstatus01');
  status.title = 'وضعیت تازه';
  status.nodes.find((n) => n.key === 'labnodecond').config = { rejectOnFalse: true };
  const clerk = v2.roles.find((r) => r.name === 'lab_clerk');
  const resource = clerk.resources.find((r) => r.name === 'lab_items');
  resource.actions = [...resource.actions, { fields: ['title'], name: 'create', scope: null }].sort(byName);
  return v2;
}

// Upgrading an installed module (STORY-076, decision 0006).
describe('erpModules:upgrade', () => {
  let app: MockServer;
  let v1: any;

  beforeAll(async () => {
    const source = await createApp();
    await buildLabModule(source);
    v1 = JSON.parse((await (await rootAgent(source)).resource('erpModules').export({ filterByTk: 'lab' })).text);
    await source.destroy();
  });

  beforeEach(async () => {
    app = await createApp();
    expect((await (await rootAgent(app)).resource('erpModules').import({ values: v1 })).status).toBe(200);
    await app.db.getRepository('lab_items').create({
      values: [
        { title: 'الف', amount: 2 },
        { title: 'ب', amount: 3 },
      ],
    });
  });

  afterEach(async () => {
    await app.destroy();
  });

  const upgrade = async (file: object, dryRun = false) =>
    (await rootAgent(app)).resource('erpModules').upgrade({ values: file, ...(dryRun ? { dryRun: true } : {}) });
  const exportLab = async () =>
    JSON.parse((await (await rootAgent(app)).resource('erpModules').export({ filterByTk: 'lab' })).text);

  it('previews every change without making one', async () => {
    const res = await upgrade(nextVersion(v1), true);
    expect(res.status).toBe(200);
    const { plan, problems, conflicts } = res.body.data;
    expect(problems).toEqual([]);
    expect(conflicts).toEqual([]);
    expect(plan).toMatchObject({
      key: 'lab',
      from: '1.0.0',
      to: '1.1.0',
      localChanges: false,
      collections: { added: [], updated: ['lab_items'], kept: [] },
      fields: { added: ['lab_items.note'], updated: [], kept: [] },
      workflows: { added: [], revised: ['labstatus01'], disabled: [] },
      roles: { added: [], updated: ['lab_clerk'], kept: [] },
    });
    expect(plan.routes.updated).toEqual(['اقلام']);
    expect(app.db.getCollection('lab_items').getField('note')).toBeFalsy();
    expect((await app.db.getRepository('erpModules').findOne({ filterByTk: 'lab' })).get('version')).toBe('1.0.0');
  });

  it('applies the new version and keeps the records', async () => {
    const v2 = nextVersion(v1);
    const res = await upgrade(v2);
    expect(res.status).toBe(200);
    const db = app.db;
    expect(await db.getRepository('lab_items').count()).toBe(2);
    expect(db.getCollection('lab_items').getField('note')).toBeTruthy();
    await db.getRepository('lab_items').create({ values: { title: 'ج', note: 'تازه' } });
    expect((await db.getRepository('erpModules').findOne({ filterByTk: 'lab' })).get('version')).toBe('1.1.0');

    // The workflow got a new current version; the old one stays, turned off.
    const versions = await db.getRepository('workflows').find({ filter: { key: 'labstatus01' }, sort: ['id'] });
    expect(versions.map((w) => [w.get('title'), !!w.get('current')])).toEqual([
      ['وضعیت', false],
      ['وضعیت تازه', true],
    ]);

    // Exporting the upgraded module gives the new file back.
    expect(withoutDefaultSourceKey(await exportLab())).toEqual(withoutDefaultSourceKey(v2));
  });

  it('keeps the menu of roles outside the module', async () => {
    const group = await app.db.getRepository('desktopRoutes').findOne({ filter: { schemaUid: 'labgroup001' } });
    await app.db.getRepository<any>('roles.desktopRoutes', 'member').add([group.get('id')]);
    expect((await upgrade(nextVersion(v1))).status).toBe(200);
    const linked = await app.db.getRepository('rolesDesktopRoutes').count({
      filter: { roleName: 'member', desktopRouteId: group.get('id') },
    });
    expect(linked).toBe(1);
  });

  it('refuses a version that is not higher, a field whose type changes, and another module', async () => {
    const same = await upgrade(v1);
    expect(same.status).toBe(400);
    expect(errorOf(same)).toContain('Version 1.0.0 of the module is installed; the file has version 1.0.0');

    const retyped = nextVersion(v1);
    retyped.collections.find((c) => c.name === 'lab_items').fields.find((f) => f.name === 'amount').type = 'string';
    const res = await upgrade(retyped);
    expect(res.status).toBe(400);
    expect(errorOf(res)).toContain('The field lab_items.amount changes its type from double to string');

    const other = nextVersion(v1);
    other.module.key = 'other';
    expect((await upgrade(other)).status).toBe(404);
    expect((await app.db.getRepository('erpModules').findOne({ filterByTk: 'lab' })).get('version')).toBe('1.0.0');
  });

  it('warns when the module changed after it was installed', async () => {
    await app.db
      .getRepository('desktopRoutes')
      .update({ filter: { schemaUid: 'labflowpage' }, values: { title: 'دستی' } });
    const res = await upgrade(nextVersion(v1), true);
    expect(res.body.data.plan.localChanges).toBe(true);
  });

  it('rolls everything back, in memory too, when a step fails', async () => {
    const row = (await app.db.getRepository('erpModules').findOne({ filterByTk: 'lab' })).toJSON() as ModuleRow;
    const failing = upgradeModule(app, row, nextVersion(v1), {
      beforeCommit: async () => {
        throw new Error('simulated failure');
      },
    });
    await expect(failing).rejects.toThrow('simulated failure');
    expect(app.db.getCollection('lab_items').getField('note')).toBeFalsy();
    expect(await app.db.getRepository('workflows').count({ filter: { key: 'labstatus01' } })).toBe(1);
    expect(withoutDefaultSourceKey(await exportLab())).toEqual(withoutDefaultSourceKey(v1));
    // The same upgrade goes through afterwards.
    expect((await upgrade(nextVersion(v1))).status).toBe(200);
  });

  it('is only for administrators', async () => {
    expect(
      (
        await app
          .agent()
          .resource('erpModules')
          .upgrade({ values: nextVersion(v1) })
      ).status,
    ).toBe(401);
    const member = await app.db.getRepository('users').create({ values: { nickname: 'm', roles: ['member'] } });
    const res = await (await app.agent().login(member)).resource('erpModules').upgrade({ values: nextVersion(v1) });
    expect(res.status).toBe(403);
  });
});
