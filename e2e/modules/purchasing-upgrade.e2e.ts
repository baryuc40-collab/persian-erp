import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { Api, apiAs, enablePersian } from '../helpers';
import { removeImportedModule } from './remove-module';

// Upgrading «سفارش خرید» 1.0 (STORY-088) with an approved order in it to the current version (STORY-089): the order
// stays as it was, and the stock receipt of the new version is issued from it. 1.0 is kept as a fixture;
// modules/purchasing holds the current one.

test.describe.configure({ mode: 'serial' });

const MODULES = path.resolve(__dirname, '../../modules');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fileOf = (key: string) => read(path.join(MODULES, key, `${key}.erp-module.json`));
const V1 = read(path.resolve(__dirname, 'fixtures/purchasing-1.0.0.erp-module.json'));
const CURRENT = fileOf('purchasing');

const query = (filter: object) => `paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`;
const run = Date.now().toString(36);
// The modules this file imported, removed again after it, the last one first.
const imported: string[] = [];

const installed = async (api: Api, key: string) => (await api.call(`erpModules:list?${query({ key })}`)).length > 0;

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL as string);
  for (const key of imported.reverse()) {
    await removeImportedModule(api, { module: { key } });
  }
  await api.request.dispose();
});

test('purchasing 1.0 with an approved order upgrades, and the order then gets its stock receipt', async ({
  playwright,
  baseURL,
}) => {
  const api = await apiAs(playwright, baseURL as string);
  await enablePersian(api);
  expect(V1.module.version).toBe('1.0.0');
  expect(await installed(api, 'purchasing')).toBe(false);
  for (const key of Object.keys(V1.requires.modules)) {
    if (await installed(api, key)) continue;
    await api.call('erpModules:import', fileOf(key));
    imported.push(key);
  }
  await api.call('erpModules:import', V1);
  imported.push('purchasing');

  const supplier = await api.call('parties_companies:create', { name: `تأمین‌کننده ${run}` });
  const warehouse = await api.call('inventory_warehouses:create', { name: `انبار ${run}` });
  const item = await api.call('inventory_items:create', { code: `U-${run}`, name: `مهره ${run}`, price: 20000 });
  const created = await api.call('purchasing_orders:create', {
    date: '2026-10-14',
    supplier: supplier.id,
    warehouse: warehouse.id,
    lines: [{ item: item.id, quantity: 4 }],
  });
  await api.call(`purchasing_orders:update?filterByTk=${created.id}`, { status: 'approved' });

  const preview = await api.call('erpModules:upgrade?dryRun=true', CURRENT);
  expect(preview.problems).toEqual([]);
  const result = await api.call('erpModules:upgrade', CURRENT);
  expect(result.key).toBe('purchasing');
  const [module] = await api.call(`erpModules:list?${query({ key: 'purchasing' })}`);
  expect(module.version).toBe(CURRENT.module.version);

  // The order of 1.0 is where it was, approved and with its total.
  const orderOf = async () =>
    (await api.call(`purchasing_orders:list?${query({ id: created.id })}&appends[]=lines`))[0];
  const kept = await orderOf();
  expect([kept.status, Number(kept.total), kept.lines.map((line) => line.quantity)]).toEqual(['approved', 80000, [4]]);

  // «صدور رسید انبار» of the new version works on it.
  const [workflow] = await api.call(`workflows:list?${query({ title: 'صدور رسید انبار', current: true })}`);
  const issued = await api.request.post(
    `/api/purchasing_orders:trigger?filterByTk=${created.id}&triggerWorkflows=${workflow.key}`,
    { headers: api.headers },
  );
  expect(issued.ok(), await issued.text()).toBeTruthy();
  const after = await orderOf();
  expect(after.status).toBe('received');
  const [receipt] = await api.call(`inventory_documents:list?${query({ id: after.receiptId })}&appends[]=lines`);
  expect([receipt.kind, receipt.status, receipt.warehouseId]).toEqual(['receipt', 'draft', warehouse.id]);
  expect(receipt.lines.map((line) => [line.itemId, line.quantity])).toEqual([[item.id, 4]]);
  await api.request.dispose();
});
