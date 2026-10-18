import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMockServer, MockServer } from '@nocobase/test';
import { catalogDir, readCatalog } from '../catalog';
import { buildLabModule, MODULE_PLUGINS } from './lab-module';

// The catalog of module files that come with the plugin (STORY-070).

const createApp = () => createMockServer({ plugins: MODULE_PLUGINS, acl: true });

async function rootAgent(app: MockServer) {
  const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
  return app.agent().login(user, 'root');
}

describe('erpModules catalog', () => {
  let app: MockServer;
  let dir: string;

  beforeAll(async () => {
    const source = await createApp();
    await buildLabModule(source);
    const file = (await (await rootAgent(source)).resource('erpModules').export({ filterByTk: 'lab' })).text;
    await source.destroy();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-catalog-'));
    fs.mkdirSync(path.join(dir, 'lab'));
    fs.writeFileSync(path.join(dir, 'lab', 'lab.erp-module.json'), file);
    const old = JSON.parse(file);
    old.module.key = 'oldlab';
    old.nocobase = '1.0.0';
    fs.writeFileSync(path.join(dir, 'oldlab.erp-module.json'), JSON.stringify(old));
    fs.writeFileSync(path.join(dir, 'broken.erp-module.json'), '{');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a module');
    process.env.ERP_MODULES_CATALOG = dir;
  });

  afterAll(() => {
    delete process.env.ERP_MODULES_CATALOG;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.destroy();
  });

  it('reads the module files of the folder and the folders below it', () => {
    expect(catalogDir()).toBe(dir);
    expect(readCatalog().map((e) => [e.file, e.module?.module.key ?? null])).toEqual([
      ['broken.erp-module.json', null],
      ['lab.erp-module.json', 'lab'],
      ['oldlab.erp-module.json', 'oldlab'],
    ]);
  });

  it('lists each module with what an import would say, and installs one by its key', async () => {
    const agent = await rootAgent(app);
    const catalog = async () => (await agent.resource('erpModules').catalog()).body.data;
    const [broken, lab, old] = await catalog();
    expect(broken).toMatchObject({ file: 'broken.erp-module.json', installed: false, problems: ['This is not an ERP module file'] });
    expect(lab).toMatchObject({ installed: false, problems: [], conflicts: [], summary: { key: 'lab', title: 'آزمایشگاه' } });
    expect(lab.summary.collections).toHaveLength(2);
    expect(old.problems[0]).toMatch(/cannot be imported into NocoBase/);

    const res = await agent.resource('erpModules').install({ filterByTk: 'lab' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'lab', collections: ['lab_categories', 'lab_items'] });
    expect(app.db.getCollection('lab_items')).toBeTruthy();
    expect((await catalog())[1]).toMatchObject({ installed: true, installedVersion: '1.0.0', upgrade: false, problems: [] });

    // A second install is stopped by the conflicts, like an import.
    expect((await agent.resource('erpModules').install({ filterByTk: 'lab' })).status).toBe(400);
    expect((await agent.resource('erpModules').install({ filterByTk: 'none' })).status).toBe(404);
  });

  it('offers a newer version of an installed module and upgrades to it by its key', async () => {
    const agent = await rootAgent(app);
    expect((await agent.resource('erpModules').install({ filterByTk: 'lab' })).status).toBe(200);
    // As if the catalog came with a newer version than the installed one.
    await app.db.getRepository('erpModules').update({ filterByTk: 'lab', values: { version: '0.9.0' } });
    const lab = () => agent.resource('erpModules').catalog().then((res) => res.body.data[1]);
    expect(await lab()).toMatchObject({ installed: true, installedVersion: '0.9.0', upgrade: true });

    const preview = await agent.resource('erpModules').upgrade({ filterByTk: 'lab', dryRun: true });
    expect(preview.body.data).toMatchObject({ problems: [], plan: { from: '0.9.0', to: '1.0.0' } });
    expect((await agent.resource('erpModules').upgrade({ filterByTk: 'lab' })).status).toBe(200);
    expect(await lab()).toMatchObject({ installedVersion: '1.0.0', upgrade: false });
    expect((await agent.resource('erpModules').upgrade({ filterByTk: 'none' })).status).toBe(404);
  });

  it('is only for administrators', async () => {
    const member = await app.db.getRepository('users').create({ values: { nickname: 'm', roles: ['member'] } });
    const agent = await app.agent().login(member);
    expect((await agent.resource('erpModules').catalog()).status).toBe(403);
    expect((await agent.resource('erpModules').install({ filterByTk: 'lab' })).status).toBe(403);
  });
});
