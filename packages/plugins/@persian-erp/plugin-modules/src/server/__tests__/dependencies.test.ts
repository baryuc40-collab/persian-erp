import { createMockServer, MockServer } from '@nocobase/test';
import { buildLabModule, MODULE_PLUGINS } from './lab-module';

const createApp = () => createMockServer({ plugins: MODULE_PLUGINS, acl: true });

async function rootAgent(app: MockServer) {
  const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
  return app.agent().login(user, 'root');
}

const errorOf = (res) => res.body.errors?.[0]?.message as string;

// A second module whose collection points at a collection of the lab module.
async function buildShopModule(app: MockServer) {
  const db = app.db;
  await db.getRepository('collections').create({
    values: { name: 'shop_orders', title: 'سفارش', fields: [{ name: 'note', type: 'string', interface: 'input' }] },
    context: {},
  });
  await db.getRepository('fields').create({
    values: {
      collectionName: 'shop_orders',
      name: 'item',
      type: 'belongsTo',
      interface: 'm2o',
      target: 'lab_items',
      foreignKey: 'itemId',
    },
    context: {},
  });
  await db.getRepository('desktopRoutes').create({
    values: { type: 'group', title: 'فروشگاه', schemaUid: 'shopgroup01' },
  });
  await db.getRepository('erpModules').create({
    values: { key: 'shop', title: 'فروشگاه', version: '1.0.0', groupSchemaUid: 'shopgroup01' },
  });
}

// One module that needs another (STORY-087).
describe('module dependencies', () => {
  let app: MockServer;
  let labFile: Record<string, any>;
  let shopFile: Record<string, any>;

  beforeAll(async () => {
    const source = await createApp();
    await buildLabModule(source);
    await source.db.getRepository('erpModules').update({ filterByTk: 'lab', values: { version: '1.2.0' } });
    await buildShopModule(source);
    const agent = await rootAgent(source);
    labFile = JSON.parse((await agent.resource('erpModules').export({ filterByTk: 'lab' })).text);
    shopFile = JSON.parse((await agent.resource('erpModules').export({ filterByTk: 'shop' })).text);
    await source.destroy();
  });

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.destroy();
  });

  const importFile = async (file: object) => (await rootAgent(app)).resource('erpModules').import({ values: file });

  it('lists the module that owns a referenced collection, with its installed version, instead of the collection', () => {
    expect(shopFile.requires.modules).toEqual({ lab: '1.2.0' });
    expect(shopFile.requires.collections).not.toContain('lab_items');
    // A collection of NocoBase itself is still listed by name, and a module without dependencies has no entry.
    expect(labFile.requires.collections).toContain('users');
    expect(labFile.requires.modules).toBeUndefined();
  });

  it('refuses the import while the needed module is missing or older, and writes nothing', async () => {
    let res = await importFile(shopFile);
    expect(res.status).toBe(400);
    expect(errorOf(res)).toContain('This module needs the module lab version 1.2.0 or later; install it first');
    expect(app.db.hasCollection('shop_orders')).toBe(false);

    expect((await importFile({ ...labFile, module: { ...labFile.module, version: '1.1.0' } })).status).toBe(200);
    res = await importFile(shopFile);
    expect(res.status).toBe(400);
    expect(errorOf(res)).toContain('this install has version 1.1.0');
    expect(await app.db.getRepository('erpModules').count({ filter: { key: 'shop' } })).toBe(0);
  });

  it('imports once the needed module is there, and shows the need in the preview', async () => {
    expect((await importFile(labFile)).status).toBe(200);
    const preview = await (await rootAgent(app)).resource('erpModules').import({ values: shopFile, dryRun: true });
    expect(preview.body.data.summary.requiredModules).toEqual([{ key: 'lab', version: '1.2.0' }]);
    expect(preview.body.data.problems).toEqual([]);
    expect((await importFile(shopFile)).status).toBe(200);
    expect(app.db.hasCollection('shop_orders')).toBe(true);
  });

  it('refuses to remove a module another one needs, until that one is removed', async () => {
    await importFile(labFile);
    await importFile(shopFile);
    const agent = await rootAgent(app);
    const preview = await agent.resource('erpModules').remove({ filterByTk: 'lab', dryRun: true });
    expect(preview.body.data.dependents).toEqual([{ key: 'shop', title: 'فروشگاه' }]);

    const res = await agent.resource('erpModules').remove({ filterByTk: 'lab', confirm: 'lab' });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe('The module shop depends on this module; remove it first');
    expect(app.db.hasCollection('lab_items')).toBe(true);

    expect((await agent.resource('erpModules').remove({ filterByTk: 'shop', confirm: 'shop' })).status).toBe(200);
    expect((await agent.resource('erpModules').remove({ filterByTk: 'lab', confirm: 'lab' })).status).toBe(200);
  });
});
