import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from '../helpers';
import { removeImportedModule } from './remove-module';

// Upgrading «انبار» with records in it to the current version: from 1.0 (STORY-085), where the documents, the stock
// and the approval workflow arrive and work, and from 1.1 (STORY-086), where approved documents and the stock stay and
// the kardex starts with the documents approved after the upgrade, and from 1.2 (STORY-087), whose approval workflow
// refused an edit that does not set the status (fixed in 1.2.1, STORY-090). Older versions are kept as fixtures;
// modules/inventory holds the current one.

test.describe.configure({ mode: 'serial' });

const V1 = path.resolve(__dirname, 'fixtures/inventory-1.0.0.erp-module.json');
const V1_1 = path.resolve(__dirname, 'fixtures/inventory-1.1.0.erp-module.json');
const V1_2 = path.resolve(__dirname, 'fixtures/inventory-1.2.0.erp-module.json');
const CURRENT = path.resolve(__dirname, '../../modules/inventory/inventory.erp-module.json');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const query = (filter: object) => `paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`;

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL as string);
  await removeImportedModule(api, read(CURRENT));
  await api.request.dispose();
});

test('inventory 1.0 with records upgrades, and its receipts then move the stock', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await apiAs(playwright, baseURL as string);
  await enablePersian(api);
  await removeImportedModule(api, read(CURRENT));
  expect(read(V1).module.version).toBe('1.0.0');
  await api.call('erpModules:import', read(V1));
  const category = await api.call('inventory_categories:create', { name: 'ابزار' });
  const item = await api.call('inventory_items:create', {
    code: 'U-1',
    name: 'پیچ',
    category: category.id,
    minStock: 5,
  });
  const warehouse = await api.call('inventory_warehouses:create', { name: 'انبار مرکزی' });

  const file = read(CURRENT);
  const preview = await api.call('erpModules:upgrade?dryRun=true', file);
  expect(preview.problems).toEqual([]);
  expect(preview.plan.collections.added).toEqual(
    expect.arrayContaining(['inventory_documents', 'inventory_document_lines', 'inventory_stock']),
  );
  const result = await api.call('erpModules:upgrade', file);
  expect(result.key).toBe('inventory');
  const [installed] = await api.call(`erpModules:list?${query({ key: 'inventory' })}`);
  expect(installed.version).toBe(file.module.version);

  // The records of 1.0 are where they were.
  const [kept] = await api.call(`inventory_items:list?${query({ id: item.id })}&appends=category`);
  expect(kept).toMatchObject({ code: 'U-1', name: 'پیچ', minStock: 5, category: { name: 'ابزار' } });

  // A receipt of the new version moves the stock through the approval workflow.
  const receipt = await api.call('inventory_documents:create', {
    kind: 'receipt',
    date: '2026-10-14',
    warehouse: warehouse.id,
    lines: [{ item: item.id, quantity: 10 }],
  });
  await api.call(`inventory_documents:update?filterByTk=${receipt.id}`, { status: 'approved' });
  const [stock] = await api.call(`inventory_stock:list?${query({ itemId: item.id })}`);
  expect(stock).toMatchObject({ warehouseId: warehouse.id, quantity: 10 });
  await api.request.dispose();

  // The menu has the pages of 1.1.
  await openAs(page, 'fa-IR', '/admin');
  await page.locator('.ant-layout-header').getByText('انبار', { exact: true }).click();
  for (const title of ['کالاها', 'گروه‌های کالا', 'انبارها', 'رسید و حواله', 'موجودی', 'کاردکس']) {
    await expect(page.getByRole('menuitem', { name: title })).toBeVisible();
  }
});

test('inventory 1.1 with approved documents upgrades, and the kardex starts after it', async ({
  playwright,
  baseURL,
}) => {
  const api = await apiAs(playwright, baseURL as string);
  await removeImportedModule(api, read(CURRENT));
  expect(read(V1_1).module.version).toBe('1.1.0');
  await api.call('erpModules:import', read(V1_1));
  const item = await api.call('inventory_items:create', { code: 'K-1', name: 'مهره', minStock: 2 });
  const warehouse = await api.call('inventory_warehouses:create', { name: 'انبار شعبه' });
  const document = (kind: string, quantity: number) =>
    api.call('inventory_documents:create', {
      kind,
      date: '2026-10-14',
      warehouse: warehouse.id,
      lines: [{ item: item.id, quantity }],
    });
  const approve = (id: string) => api.call(`inventory_documents:update?filterByTk=${id}`, { status: 'approved' });
  const before = await document('receipt', 10);
  await approve(before.id);

  await api.call('erpModules:upgrade', read(CURRENT));

  // The approved receipt and the stock it made are there; the kardex has nothing from before the upgrade.
  const [kept] = await api.call(`inventory_documents:list?${query({ id: before.id })}`);
  expect(kept.status).toBe('approved');
  const stock = async () => (await api.call(`inventory_stock:list?${query({ itemId: item.id })}`))[0].quantity;
  expect(await stock()).toBe(10);
  expect(await api.call(`inventory_movements:list?${query({ itemId: item.id })}`)).toEqual([]);

  // An issue after the upgrade moves the stock and starts the kardex.
  const after = await document('issue', 4);
  await approve(after.id);
  expect(await stock()).toBe(6);
  const movements = await api.call(`inventory_movements:list?${query({ itemId: item.id })}`);
  expect(movements).toMatchObject([{ documentId: after.id, quantityIn: 0, quantityOut: 4, balance: 6 }]);
  await api.request.dispose();
});

test('inventory 1.2 upgrades, and a draft document then takes an edit without a status', async ({
  playwright,
  baseURL,
}) => {
  const api = await apiAs(playwright, baseURL as string);
  await removeImportedModule(api, read(CURRENT));
  expect(read(V1_2).module.version).toBe('1.2.0');
  await api.call('erpModules:import', read(V1_2));
  const item = await api.call('inventory_items:create', { code: 'E-1', name: 'واشر' });
  const warehouse = await api.call('inventory_warehouses:create', { name: 'انبار جنوب' });
  const draft = await api.call('inventory_documents:create', {
    kind: 'receipt',
    date: '2026-10-14',
    warehouse: warehouse.id,
    lines: [{ item: item.id, quantity: 3 }],
  });
  const edit = (values: object, filter = `filterByTk=${draft.id}`) =>
    api.request.post(`/api/inventory_documents:update?${filter}`, { headers: api.headers, data: values });
  // The bug of 1.2: the approval workflow failed on the missing status, and the edit with it.
  expect((await edit({ description: 'پیش از ارتقا' })).ok()).toBe(false);

  await api.call('erpModules:upgrade', read(CURRENT));

  const changed = await edit({ description: 'پس از ارتقا' });
  expect(changed.ok(), await changed.text()).toBeTruthy();
  const [kept] = await api.call(`inventory_documents:list?${query({ id: draft.id })}`);
  expect([kept.status, kept.description]).toEqual(['draft', 'پس از ارتقا']);

  // Approving many documents in one request is still refused, and one at a time still moves the stock.
  const bulk = await edit({ status: 'approved' }, `filter=${encodeURIComponent(JSON.stringify({ id: draft.id }))}`);
  expect(bulk.status()).toBe(400);
  expect(await bulk.text()).toContain('سند را یکی‌یکی تأیید کنید');
  const approved = await edit({ status: 'approved' });
  expect(approved.ok(), await approved.text()).toBeTruthy();
  const [stock] = await api.call(`inventory_stock:list?${query({ itemId: item.id })}`);
  expect(stock.quantity).toBe(3);
  await api.request.dispose();
});
