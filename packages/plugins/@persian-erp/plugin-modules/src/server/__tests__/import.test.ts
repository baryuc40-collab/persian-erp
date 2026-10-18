import { createMockServer, MockServer } from '@nocobase/test';
import { importModule } from '../importer';
import { buildLabModule, MODULE_PLUGINS } from './lab-module';

const createApp = () => createMockServer({ plugins: MODULE_PLUGINS, acl: true });

async function rootAgent(app: MockServer) {
  const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
  return app.agent().login(user, 'root');
}

async function exportLab(app: MockServer) {
  const res = await (await rootAgent(app)).resource('erpModules').export({ filterByTk: 'lab' });
  expect(res.status).toBe(200);
  return res.text;
}

const errorOf = (res) => res.body.errors?.[0]?.message as string;

describe('erpModules:import', () => {
  let app: MockServer;
  let labFile: string;

  beforeAll(async () => {
    // The file comes from another install, as it would in use.
    const source = await createApp();
    await buildLabModule(source);
    labFile = await exportLab(source);
    await source.destroy();
  });

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.destroy();
  });

  const importLab = async (file = JSON.parse(labFile)) =>
    (await rootAgent(app)).resource('erpModules').import({ values: file });

  it('builds the whole module on a new install, with new ids', async () => {
    const res = await importLab();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'lab', warnings: [] });

    // Exporting the imported module gives the same file back. The one difference: NocoBase writes the default
    // sourceKey ("id") on a reverse field when it is created from full values, as the import does.
    const withoutDefaultSourceKey = (text: string) =>
      JSON.parse(text, (key, value) => (key === 'sourceKey' && value === 'id' ? undefined : value));
    expect(withoutDefaultSourceKey(await exportLab(app))).toEqual(withoutDefaultSourceKey(labFile));

    // The menu is in the admin layout, so it shows up for the user.
    const accessible = await (await rootAgent(app)).resource('desktopRoutes').listAccessible({ tree: true });
    expect(accessible.body.data.map((route) => route.schemaUid)).toEqual(['labgroup001']);

    // The page points to its route on this install.
    const route = await app.db.getRepository('desktopRoutes').findOne({ filter: { schemaUid: 'labflowpage' } });
    const page = await (app.db.getRepository('flowModels') as any).findModelById('labroot0001');
    expect(page.props.routeId).toBe(route.get('id'));

    // Workflows keep their enabled state, and the node links point to the new node ids.
    const workflows = await app.db.getRepository('workflows').find({ appends: ['nodes'], sort: ['key'] });
    expect(workflows.map((w) => [w.get('key'), w.get('enabled'), w.get('current')])).toEqual([
      ['labapprove1', true, true],
      ['labstatus01', false, true],
    ]);
    const nodes = workflows[1].get('nodes') as any[];
    const byKey = Object.fromEntries(nodes.map((n) => [n.key, n]));
    expect(byKey.labnodecond.downstreamId).toBe(byKey.labnodeqry1.id);
    expect(byKey.labnodeyes1.upstreamId).toBe(byKey.labnodecond.id);

    // The new collections work, and the module role sees only what it was given.
    const agent = await rootAgent(app);
    expect((await agent.resource('lab_items').create({ values: { title: 'آزمون', amount: 1 } })).status).toBe(200);
    const clerk = await app.db.getRepository('users').create({ values: { nickname: 'c', roles: ['lab_clerk'] } });
    const clerkAgent = await app.agent().login(clerk, 'lab_clerk');
    const list = await clerkAgent.resource('lab_items').list();
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect((await clerkAgent.resource('lab_categories').create({ values: { name: 'x' } })).status).toBe(403);
  });

  it('stops before any change when the install already has parts of the module', async () => {
    expect((await importLab()).status).toBe(200);
    const routes = await app.db.getRepository('desktopRoutes').count();
    const res = await importLab();
    expect(res.status).toBe(400);
    const message = errorOf(res);
    expect(message).toContain('The module conflicts with what this install already has');
    expect(message).toContain('Collection: lab_categories, lab_items');
    expect(message).toContain('Role: lab_clerk');
    expect(message).toContain('Menu group: آزمایشگاه');
    expect(message).toContain('Workflow: labapprove1, labstatus01');
    expect(message).toContain('Module: lab');
    expect(message).toMatch(/Page element: (\w+, ){4}\w+ and \d+ more/);
    expect(await app.db.getRepository('desktopRoutes').count()).toBe(routes);
  });

  it('rolls everything back when a step fails', async () => {
    const failing = importModule(app, JSON.parse(labFile), {
      beforeCommit: async () => {
        throw new Error('simulated failure');
      },
    });
    await expect(failing).rejects.toThrow('simulated failure');

    expect(app.db.hasCollection('lab_items')).toBe(false);
    expect(await app.db.sequelize.getQueryInterface().tableExists('lab_items')).toBe(false);
    expect(await app.db.getRepository('collections').count({ filter: { name: { $in: ['lab_items'] } } })).toBe(0);
    expect(await app.db.getRepository('workflows').count()).toBe(0);
    expect(await app.db.getRepository('roles').count({ filter: { name: 'lab_clerk' } })).toBe(0);
    expect(await app.db.getRepository('desktopRoutes').count()).toBe(0);
    expect(await app.db.getRepository('flowModels').count()).toBe(0);
    expect(await app.db.getRepository('erpModules').count()).toBe(0);

    // Nothing is left behind in memory either, so the same file imports cleanly afterwards.
    expect((await importLab()).status).toBe(200);
  });

  // Messages are checked in English: a plugin passed as a class has no package, so its translations do not load
  // here. The Persian text is in src/locale/fa-IR.json and is checked by tools/glossary-check.
  it('refuses files it cannot import, with a clear message', async () => {
    const file = JSON.parse(labFile);
    const [major, minor] = app.getVersion().split('.');
    const otherMinor = `${major}.${Number(minor) + 1}.0`;

    let res = await importLab({ ...file, nocobase: otherMinor });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe(
      `The module was made with NocoBase ${otherMinor} and cannot be imported into NocoBase ${app.getVersion()}`,
    );

    res = await importLab({ ...file, formatVersion: 2 });
    expect(errorOf(res)).toBe('The module file has format version 2, but this plugin reads up to version 1');

    res = await importLab({ ...file, requires: { ...file.requires, collections: ['missing_things'] } });
    expect(errorOf(res)).toBe('This install has no collection named missing_things');

    res = await importLab({ ...file, requires: { ...file.requires, workflowTriggers: ['no-such-trigger'] } });
    expect(errorOf(res)).toBe('This install has no workflow trigger no-such-trigger');

    res = await importLab({ ...file, routes: { ...file.routes, uiLayouts: ['no-such-layout'] } });
    expect(errorOf(res)).toBe('This install has no UI layout no-such-layout');

    res = await importLab({ hello: 'world' });
    expect(errorOf(res)).toBe('This is not an ERP module file');

    expect(await app.db.getRepository('collections').count({ filter: { name: 'lab_items' } })).toBe(0);
  });

  it('imports a file from another patch of the same NocoBase, with a warning', async () => {
    const [major, minor] = app.getVersion().split('.');
    const otherPatch = `${major}.${minor}.0`;
    const res = await importLab({ ...JSON.parse(labFile), nocobase: otherPatch });
    if (otherPatch === app.getVersion()) {
      expect(res.body.data.warnings).toEqual([]);
    } else {
      expect(res.body.data.warnings).toEqual([
        `The module was made with NocoBase ${otherPatch}; this install runs ${app.getVersion()}`,
      ]);
    }
  });

  it('is only for administrators', async () => {
    expect((await app.agent().resource('erpModules').import({ values: JSON.parse(labFile) })).status).toBe(401);
    const member = await app.db.getRepository('users').create({ values: { nickname: 'm', roles: ['member'] } });
    const res = await (await app.agent().login(member)).resource('erpModules').import({ values: JSON.parse(labFile) });
    expect(res.status).toBe(403);
  });
});
