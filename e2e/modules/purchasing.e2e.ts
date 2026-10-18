import fs from 'fs';
import path from 'path';
import { expect, Page, test } from '@playwright/test';
import { Api, apiAs, enablePersian } from '../helpers';
import { removeImportedModule } from './remove-module';

// The «سفارش خرید» reference module (EPIC-020), imported from modules/purchasing after the «اشخاص» and «انبار» modules
// it needs, and used by its two roles: orders with lines and a rial total, and the manager's approval that locks them
// (version 1.0, STORY-088).

test.describe.configure({ mode: 'serial' });

const MODULES = path.resolve(__dirname, '../../modules');
const fileOf = (key: string) => JSON.parse(fs.readFileSync(path.join(MODULES, key, `${key}.erp-module.json`), 'utf8'));
const FILE = fileOf('purchasing');
const PASSWORD = 'Purchasing-pass-123';
const BUYER = { email: 'purchasing.buyer@example.com', nickname: 'کارشناس خرید', roles: ['purchasing_buyer'] };
const MANAGER = { email: 'purchasing.manager@example.com', nickname: 'مدیر خرید', roles: ['purchasing_manager'] };

const query = (filter: object) => `paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`;
// The run id keeps the names of this run apart from earlier runs on a local install.
const run = Date.now().toString(36);
const names = { supplier: `پیچ‌سازان ${run}`, warehouse: `انبار مرکزی ${run}`, item: `پیچ ${run}` };
// The modules this file imported, removed again after it, the last one first.
const imported: string[] = [];
// The order of the buyer's test, for the manager's test after it.
const order = { number: '' };

const installed = async (api: Api, key: string) => (await api.call(`erpModules:list?${query({ key })}`)).length > 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL as string);
  await enablePersian(api);
  for (const key of [...Object.keys(FILE.requires.modules), 'purchasing']) {
    // A fresh install imports the files; a local rerun finds the modules already there.
    if (await installed(api, key)) continue;
    await api.call('erpModules:import', key === 'purchasing' ? FILE : fileOf(key));
    imported.push(key);
  }
  for (const user of [BUYER, MANAGER]) {
    if (!(await api.call(`users:list?${query({ email: user.email })}`)).length) {
      await api.call('users:create', { ...user, password: PASSWORD });
    }
  }
  await api.call('parties_companies:create', { name: names.supplier });
  await api.call('inventory_warehouses:create', { name: names.warehouse });
  await api.call('inventory_items:create', { code: `P-${run}`, name: names.item, price: 50000 });
  await api.request.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL as string);
  for (const user of await api.call(`users:list?${query({ email: { $in: [BUYER.email, MANAGER.email] } })}`)) {
    await api.call(`users:destroy?filterByTk=${user.id}`);
  }
  for (const key of imported.reverse()) {
    await removeImportedModule(api, { module: { key } });
  }
  await api.request.dispose();
});

async function signIn(page: Page, email: string) {
  await page.addInitScript(() => localStorage.setItem('NOCOBASE_LOCALE', 'fa-IR'));
  await page.goto('/signin');
  await page.locator('input[type="password"]').waitFor();
  await page.locator('input:not([type="password"])').first().fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
}

async function openPage(page: Page, item: string) {
  await page.goto('/admin');
  await page.locator('.ant-layout-header').getByText('خرید', { exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await expect(page.locator('.ant-menu-item-selected', { hasText: item })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

const addButton = (page: Page) => page.getByRole('button', { name: /افزودن/ }).filter({ visible: true });

const formItem = (page: Page, label: string) =>
  page
    .locator('form')
    .last()
    .locator('.ant-form-item', { has: page.locator('label', { hasText: new RegExp(`^\\s*${label}\\s*:?\\s*$`) }) });

const choose = async (page: Page, label: string, option: string) => {
  await formItem(page, label).locator('.ant-select').click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: option }).click();
};

const rowOf = (page: Page, number: string) =>
  page.locator('.ant-table-tbody tr.ant-table-row').filter({ visible: true }).filter({ hasText: number });

// The order as the API returns it, with its lines.
async function orderOf(api: Api, number: string) {
  const [found] = await api.call(`purchasing_orders:list?${query({ number })}&appends[]=lines`);
  return found;
}

test('the buyer writes an order whose line and total are worked out in rials, and cannot approve it', async ({
  page,
  playwright,
  baseURL,
}) => {
  await signIn(page, BUYER.email);
  const menu = page.locator('.ant-layout-header .ant-menu-item');
  await expect(menu).toHaveCount(1);
  await expect(menu).toHaveText('خرید');

  await openPage(page, 'سفارش‌های خرید');
  // The approvals page is the manager's only.
  await expect(page.getByRole('menuitem', { name: 'تأیید سفارش‌ها' })).toHaveCount(0);
  for (const column of ['شماره', 'تاریخ', 'تأمین‌کننده', 'انبار مقصد', 'وضعیت', 'جمع']) {
    await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  }

  await addButton(page).click();
  await formItem(page, 'تاریخ').locator('.ant-picker input').click();
  await page.locator('.ant-picker-dropdown:visible .ant-picker-cell-today').click();
  await choose(page, 'تأمین‌کننده', names.supplier);
  await choose(page, 'انبار مقصد', names.warehouse);
  // One line of 10, without a unit price: it comes from the purchase price of the item.
  const lines = formItem(page, 'ردیف‌ها');
  await expect(lines.getByText('انتخاب رکورد')).toHaveCount(0);
  await lines.getByRole('button', { name: /افزودن/ }).click();
  await lines.locator('.ant-table-tbody .ant-select').first().click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: names.item }).click();
  await lines.locator('.ant-table-tbody input.ant-input-number-input').first().fill('10');
  const saved = page.waitForResponse(
    (res) => res.url().includes('purchasing_orders:create') && res.request().method() === 'POST',
  );
  await page.locator('form').last().getByRole('button', { name: 'ثبت' }).click();
  const res = await saved;
  expect(res.ok(), await res.text()).toBeTruthy();
  order.number = (await res.json()).data.number;

  const row = rowOf(page, order.number);
  await expect(row).toContainText('پیش‌نویس');
  await expect(row).toContainText(names.supplier);
  // The total in rials with a thousands separator; the Persian font draws its digits in Persian.
  await expect(row).toContainText('500,000 ریال');

  const api = await apiAs(playwright, baseURL as string);
  const savedOrder = await orderOf(api, order.number);
  expect(Number(savedOrder.total)).toBe(500000);
  expect(savedOrder.lines.map((l) => [l.quantity, Number(l.unitPrice), Number(l.amount)])).toEqual([
    [10, 50000, 500000],
  ]);

  // The buyer has no approval button, and the API refuses the approval too.
  await expect(row.getByText('تأیید سفارش', { exact: true })).toHaveCount(0);
  const token = await page.evaluate(() => localStorage.getItem('NOCOBASE_TOKEN'));
  const approve = await api.request.post(`/api/purchasing_orders:update?filterByTk=${savedOrder.id}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Locale': 'fa-IR' },
    data: { status: 'approved' },
  });
  expect(approve.status()).toBe(400);
  expect((await approve.json()).errors[0].message).toBe('فقط مدیر خرید سفارش را تأیید می‌کند');
  expect((await orderOf(api, order.number)).status).toBe('draft');
  await api.request.dispose();
});

test('the manager approves the order, which then neither role can change, and an empty order is refused', async ({
  page,
  playwright,
  baseURL,
}) => {
  expect(order.number).not.toBe('');
  const api = await apiAs(playwright, baseURL as string);
  const [supplier] = await api.call(`parties_companies:list?${query({ name: names.supplier })}`);
  const [warehouse] = await api.call(`inventory_warehouses:list?${query({ name: names.warehouse })}`);
  const empty = await api.call('purchasing_orders:create', {
    date: new Date().toISOString().slice(0, 10),
    supplier: supplier.id,
    warehouse: warehouse.id,
  });

  await signIn(page, MANAGER.email);
  await openPage(page, 'تأیید سفارش‌ها');
  const approve = async (number: string) => {
    const done = page.waitForResponse((res) => res.url().includes('purchasing_orders:update'));
    await rowOf(page, number).getByText('تأیید سفارش', { exact: true }).click();
    const confirm = page.locator(
      '.ant-modal-confirm:visible .ant-btn-primary, .ant-popconfirm:visible .ant-btn-primary',
    );
    if (await confirm.count()) await confirm.first().click();
    return done;
  };

  // An order without lines is refused in Persian and stays a draft.
  expect((await approve(empty.number)).status()).toBe(400);
  await expect(page.getByText('سفارش ردیفی ندارد')).toBeVisible();
  expect((await orderOf(api, empty.number)).status).toBe('draft');

  expect((await approve(order.number)).ok()).toBeTruthy();
  // The approvals page lists drafts only.
  await expect(rowOf(page, order.number)).toHaveCount(0);
  expect((await orderOf(api, order.number)).status).toBe('approved');

  // On the orders page the approved order has no edit or delete for the manager.
  await page.getByRole('menuitem', { name: 'سفارش‌های خرید' }).click();
  const row = rowOf(page, order.number);
  await expect(row).toContainText('تأییدشده');
  await expect(row.getByText('مشاهده', { exact: true })).toBeVisible();
  for (const action of ['ویرایش', 'حذف']) {
    await expect(row.getByText(action, { exact: true })).toHaveCount(0);
  }
  // Nor through the API, for either role.
  const approved = await orderOf(api, order.number);
  const token = await page.evaluate(() => localStorage.getItem('NOCOBASE_TOKEN'));
  const headers = { Authorization: `Bearer ${token}` };
  await api.request.post(`/api/purchasing_orders:update?filterByTk=${approved.id}`, {
    headers,
    data: { description: 'تغییر پس از تأیید' },
  });
  await api.request.post(`/api/purchasing_order_lines:update?filterByTk=${approved.lines[0].id}`, {
    headers,
    data: { quantity: 99 },
  });
  await api.request.post(`/api/purchasing_orders:destroy?filterByTk=${approved.id}`, { headers });
  const after = await orderOf(api, order.number);
  expect([after.status, after.description, after.lines[0].quantity]).toEqual(['approved', null, 10]);
  await api.request.dispose();
});
