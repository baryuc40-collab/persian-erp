import fs from 'fs';
import path from 'path';
import { expect, Page, test } from '@playwright/test';
import { apiAs, enablePersian } from '../helpers';
import { removeImportedModule } from './remove-module';

// The «انبار» reference module, imported from modules/inventory and used by its two roles: items, categories and
// warehouses (version 1.0, STORY-084), receipts and issues that move the stock when approved (1.1, STORY-085), and the
// kardex with the low-stock notification (1.2, STORY-086).

test.describe.configure({ mode: 'serial' });

const FILE = path.resolve(__dirname, '../../modules/inventory/inventory.erp-module.json');
const PASSWORD = 'Inventory-pass-123';
const MANAGER = { email: 'inventory.manager@example.com', nickname: 'مدیر انبار', roles: ['inventory_manager'] };
const KEEPER = { email: 'inventory.keeper@example.com', nickname: 'انباردار', roles: ['inventory_keeper'] };

// The documents of the keeper's test, for the manager's test after it.
const docs = { run: Date.now().toString(36), numbers: [] as string[] };

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
  const saved = page.waitForResponse(
    (res) => res.url().includes(`${collection}:create`) && res.request().method() === 'POST',
  );
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

test('the keeper writes a receipt and issues, and an approved document moves the stock', async ({
  page,
  playwright,
  baseURL,
}) => {
  const { run } = docs;
  const api = await apiAs(playwright, baseURL as string);
  await api.call('inventory_items:create', { code: `S-${run}`, name: `پیچ ${run}`, minStock: 5 });
  await api.call('inventory_warehouses:create', { name: `انبار مرکزی ${run}` });
  await api.request.dispose();

  await signIn(page, KEEPER.email);
  await openPage(page, 'رسید و حواله');

  // Writes a document with one line and returns its number.
  const writeDocument = async (kind: string, quantity: string) => {
    await addButton(page).click();
    await formItem(page, 'نوع سند').locator('.ant-select').click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: kind }).click();
    await formItem(page, 'تاریخ').locator('.ant-picker input').click();
    await page.locator('.ant-picker-dropdown:visible .ant-picker-cell-today').click();
    await formItem(page, 'انبار').locator('.ant-select').click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: `انبار مرکزی ${run}` })
      .click();
    const lines = formItem(page, 'ردیف‌ها');
    await expect(lines.getByText('انتخاب رکورد')).toHaveCount(0);
    await lines.getByRole('button', { name: /افزودن/ }).click();
    await lines.locator('.ant-table-tbody .ant-select').first().click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: `پیچ ${run}` }).click();
    await lines.locator('.ant-table-tbody input.ant-input-number-input').first().fill(quantity);
    const saved = await submit(page, 'inventory_documents');
    expect(saved.ok(), await saved.text()).toBeTruthy();
    return (await saved.json()).data.number as string;
  };
  const rowOf = (number: string) =>
    page.locator('.ant-table-tbody tr.ant-table-row').filter({ visible: true }).filter({ hasText: number });
  const approve = async (number: string) => {
    const done = page.waitForResponse((res) => res.url().includes('inventory_documents:update'));
    await rowOf(number).getByText('تأیید سند').click();
    const confirm = page.locator(
      '.ant-modal-confirm:visible .ant-btn-primary, .ant-popconfirm:visible .ant-btn-primary',
    );
    if (await confirm.count()) await confirm.first().click();
    return done;
  };
  const stockOf = async () => {
    await page.getByRole('menuitem', { name: 'موجودی' }).click();
    const row = page
      .locator('.ant-table-tbody tr.ant-table-row')
      .filter({ visible: true })
      .filter({ hasText: `پیچ ${run}` });
    await expect(row).toHaveCount(1);
    // The quantity, without the names (the run id in them may have digits).
    const text = (await row.innerText()).replace(`پیچ ${run}`, '').replace(`انبار مرکزی ${run}`, '').split(/\s+/);
    await page.getByRole('menuitem', { name: 'رسید و حواله' }).click();
    return text;
  };

  // A receipt of 10 makes the stock 10.
  const receipt = await writeDocument('رسید', '10');
  await expect(rowOf(receipt)).toContainText('پیش‌نویس');
  expect((await approve(receipt)).ok()).toBeTruthy();
  await expect(rowOf(receipt)).toContainText('تأییدشده');
  expect(await stockOf()).toContain('10');

  // An approved document is closed: the keeper cannot change, delete or approve it again.
  for (const action of ['ویرایش', 'حذف', 'تأیید سند']) {
    await expect(rowOf(receipt).getByText(action, { exact: true })).toHaveCount(0);
  }

  // An issue of 4 leaves 6.
  const issue = await writeDocument('حواله', '4');
  expect((await approve(issue)).ok()).toBeTruthy();
  expect(await stockOf()).toContain('6');

  // An issue of 8 is more than there is: refused in Persian, and nothing moves.
  const tooMuch = await writeDocument('حواله', '8');
  expect((await approve(tooMuch)).status()).toBe(400);
  await expect(page.getByText(`موجودی پیچ ${run} در انبار مرکزی ${run} کافی نیست`)).toBeVisible();
  await expect(rowOf(tooMuch)).toContainText('پیش‌نویس');
  expect(await stockOf()).toContain('6');

  // An issue of 3 leaves 3, under the minimum of 5.
  const last = await writeDocument('حواله', '3');
  expect((await approve(last)).ok()).toBeTruthy();
  expect(await stockOf()).toContain('3');
  docs.numbers.push(receipt, issue, last);
});

// Today in the Persian calendar as the tables show dates: 1405-07-22.
function persianToday() {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

test('the manager sees the kardex of the item and was told when it went under its minimum', async ({
  page,
  playwright,
  baseURL,
}) => {
  const { run, numbers } = docs;
  expect(numbers).toHaveLength(3);
  await signIn(page, MANAGER.email);
  await openPage(page, 'کاردکس');
  for (const column of ['تاریخ', 'سند', 'کالا', 'انبار', 'ورود', 'خروج', 'مانده']) {
    await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  }
  // One movement for each approved document, in order, with the balance after it; the refused issue has none.
  const rows = page
    .locator('.ant-table-tbody tr.ant-table-row')
    .filter({ visible: true })
    .filter({ hasText: `پیچ ${run}` });
  await expect(rows).toHaveCount(3);
  const cells = async (index: number) =>
    (await rows.nth(index).innerText()).replace(`پیچ ${run}`, '').replace(`انبار مرکزی ${run}`, '').split(/\s+/);
  const today = persianToday();
  for (const [index, [number, quantityIn, quantityOut, balance]] of [
    [numbers[0], '10', '0', '10'],
    [numbers[1], '0', '4', '6'],
    [numbers[2], '0', '3', '3'],
  ].entries()) {
    expect(await cells(index)).toEqual(expect.arrayContaining([today, number, quantityIn, quantityOut, balance]));
  }

  // Only the last issue went under the minimum, and the managers got one in-app message for it.
  const token = await page.evaluate(() => localStorage.getItem('NOCOBASE_TOKEN'));
  const api = await apiAs(playwright, baseURL as string);
  const res = await api.request.post('/api/myInAppMessages:list', { headers: { Authorization: `Bearer ${token}` } });
  const messages = (await res.json()).data.messages.filter((m: { content: string }) => m.content.includes(run));
  expect(messages.map((m: { title: string; content: string }) => [m.title, m.content])).toEqual([
    ['موجودی کم', `موجودی پیچ ${run} در انبار مرکزی ${run} به ۳ رسید`],
  ]);
  await api.request.dispose();
});
