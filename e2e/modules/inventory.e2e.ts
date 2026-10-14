import fs from 'fs';
import path from 'path';
import { expect, Page, test } from '@playwright/test';
import { apiAs, enablePersian } from '../helpers';
import { removeImportedModule } from './remove-module';

// The «انبار» reference module, version 1.0 (STORY-084): imported from modules/inventory and used by its two roles.

test.describe.configure({ mode: 'serial' });

const FILE = path.resolve(__dirname, '../../modules/inventory/inventory.erp-module.json');
const PASSWORD = 'Inventory-pass-123';
const MANAGER = { email: 'inventory.manager@example.com', nickname: 'مدیر انبار', roles: ['inventory_manager'] };
const KEEPER = { email: 'inventory.keeper@example.com', nickname: 'انباردار', roles: ['inventory_keeper'] };

const query = (filter: object) => `paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`;

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL as string);
  await enablePersian(api);
  // A fresh install imports the file; a local rerun finds the module already there.
  if (!(await api.call(`erpModules:list?${query({ key: 'inventory' })}`)).length) {
    const result = await api.call('erpModules:import', JSON.parse(fs.readFileSync(FILE, 'utf8')));
    expect(result).toMatchObject({ key: 'inventory', roles: ['inventory_keeper', 'inventory_manager'] });
  }
  for (const user of [MANAGER, KEEPER]) {
    if (!(await api.call(`users:list?${query({ email: user.email })}`)).length) {
      await api.call('users:create', { ...user, password: PASSWORD });
    }
  }
  await api.request.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL as string);
  for (const user of await api.call(`users:list?${query({ email: { $in: [MANAGER.email, KEEPER.email] } })}`)) {
    await api.call(`users:destroy?filterByTk=${user.id}`);
  }
  await removeImportedModule(api, JSON.parse(fs.readFileSync(FILE, 'utf8')));
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
  await page.locator('.ant-layout-header').getByText('انبار', { exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
  // /admin first shows the first page of the menu; its buttons go hidden once the chosen page has loaded.
  await expect(page.locator('.ant-menu-item-selected', { hasText: item })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

// The page opened before stays in the document, hidden, with its own buttons.
const addButton = (page: Page) => page.getByRole('button', { name: /افزودن/ }).filter({ visible: true });

// The labels of a modern form are not tied to their inputs, so a field is found by its form item's label.
const formItem = (page: Page, label: string) =>
  page
    .locator('form')
    .last()
    .locator('.ant-form-item', { has: page.locator('label', { hasText: new RegExp(`^\\s*${label}\\s*:?\\s*$`) }) });

async function submit(page: Page, collection: string) {
  const saved = page.waitForResponse((res) => res.url().includes(`${collection}:create`));
  await page.locator('form').last().getByRole('button', { name: 'ثبت' }).click();
  return saved;
}

test('the manager defines a category and an item, and a repeated code is refused', async ({ page }) => {
  const run = Date.now().toString(36);
  await signIn(page, MANAGER.email);
  const menu = page.locator('.ant-layout-header .ant-menu-item');
  await expect(menu).toHaveCount(1);
  await expect(menu).toHaveText('انبار');

  await openPage(page, 'گروه‌های کالا');
  await addButton(page).click();
  await formItem(page, 'نام').locator('input').fill(`ابزار ${run}`);
  expect((await submit(page, 'inventory_categories')).ok()).toBeTruthy();

  await openPage(page, 'کالاها');
  for (const column of ['کد کالا', 'نام', 'واحد', 'گروه کالا', 'حداقل موجودی', 'قیمت خرید']) {
    await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  }
  const addItem = async (code: string) => {
    await addButton(page).click();
    await formItem(page, 'کد کالا').locator('input').fill(code);
    await formItem(page, 'نام').locator('input').fill(`پیچ ${run}`);
    await formItem(page, 'گروه کالا').locator('.ant-select').click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: `ابزار ${run}` }).click();
    await formItem(page, 'حداقل موجودی').locator('input').fill('5');
    await formItem(page, 'قیمت خرید').locator('input').fill('120000');
    return submit(page, 'inventory_items');
  };
  expect((await addItem(`P-${run}`)).ok()).toBeTruthy();
  const row = page.locator('.ant-table-tbody tr.ant-table-row', { hasText: `P-${run}` }).first();
  await expect(row).toContainText(`ابزار ${run}`);
  await expect(row).toContainText('عدد');

  // The code is unique; NocoBase's message comes in Persian.
  expect((await addItem(`P-${run}`)).ok()).toBeFalsy();
  await expect(page.getByText('کد کالا از قبل وجود دارد')).toBeVisible();
});

test('the keeper sees items and warehouses but cannot change them', async ({ page }) => {
  await signIn(page, KEEPER.email);
  await openPage(page, 'کالاها');
  await expect(page.getByRole('columnheader', { name: 'کد کالا', exact: true })).toBeVisible();
  await expect(addButton(page)).toHaveCount(0);
  const row = page.locator('.ant-table-tbody tr.ant-table-row').first();
  await expect(row.getByText('مشاهده')).toBeVisible();
  await expect(row.getByText('ویرایش')).toHaveCount(0);
  await expect(row.getByText('حذف')).toHaveCount(0);

  await page.getByRole('menuitem', { name: 'انبارها' }).click();
  await expect(page.getByRole('columnheader', { name: 'استان و شهر', exact: true })).toBeVisible();
  await expect(addButton(page)).toHaveCount(0);
});
