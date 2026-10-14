import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from '../helpers';
import { removeImportedModule } from './remove-module';

// Upgrading «انبار» 1.0 with items in it to 1.1 (STORY-085): the records stay, and the documents, the stock and the
// approval workflow arrive and work. The 1.0 file is kept as a fixture; modules/inventory holds the current version.

test.describe.configure({ mode: 'serial' });

const V1 = path.resolve(__dirname, 'fixtures/inventory-1.0.0.erp-module.json');
const CURRENT = path.resolve(__dirname, '../../modules/inventory/inventory.erp-module.json');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const query = (filter: object) => `paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`;

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL as string);
  await removeImportedModule(api, read(CURRENT));
  await api.request.dispose();
});

test('inventory 1.0 with records upgrades to 1.1, and its receipts then move the stock', async ({
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
  for (const title of ['کالاها', 'گروه‌های کالا', 'انبارها', 'رسید و حواله', 'موجودی']) {
    await expect(page.getByRole('menuitem', { name: title })).toBeVisible();
  }
});
