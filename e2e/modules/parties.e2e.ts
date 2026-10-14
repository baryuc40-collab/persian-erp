import fs from 'fs';
import path from 'path';
import { expect, Page, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from '../helpers';
import { removeImportedModule } from './remove-module';

// The «اشخاص» reference module (STORY-068): imported from modules/parties, used by its own limited role.

test.describe.configure({ mode: 'serial' });

const FILE = path.resolve(__dirname, '../../modules/parties/parties.erp-module.json');
const EXPERT = { email: 'parties.expert@example.com', password: 'Expert-pass-123' };

const query = (filter: object) => `paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`;

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await enablePersian(api);
  // A fresh install imports the file; a local rerun finds the module already there.
  if (!(await api.call(`erpModules:list?${query({ key: 'parties' })}`)).length) {
    const result = await api.call('erpModules:import', JSON.parse(fs.readFileSync(FILE, 'utf8')));
    expect(result).toMatchObject({ key: 'parties', roles: ['parties_expert'] });
  }
  if (!(await api.call(`users:list?${query({ email: EXPERT.email })}`)).length) {
    await api.call('users:create', { nickname: 'کارشناس', ...EXPERT, roles: ['parties_expert'] });
  }
  await api.request.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  for (const user of await api.call(`users:list?${query({ email: EXPERT.email })}`)) {
    await api.call(`users:destroy?filterByTk=${user.id}`);
  }
  await removeImportedModule(api, JSON.parse(fs.readFileSync(FILE, 'utf8')));
  await api.request.dispose();
});

async function signInAsExpert(page: Page) {
  await page.addInitScript(() => localStorage.setItem('NOCOBASE_LOCALE', 'fa-IR'));
  await page.goto('/signin');
  await page.locator('input[type="password"]').waitFor();
  await page.locator('input:not([type="password"])').first().fill(EXPERT.email);
  await page.locator('input[type="password"]').fill(EXPERT.password);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
}

const openPeople = async (page: Page) => {
  await page.locator('.ant-layout-header').getByText('اشخاص', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'اشخاص حقیقی' }).click();
  await expect(page.getByRole('columnheader', { name: 'کد ملی' })).toBeVisible();
};

test('the module makes the «اشخاص» menu with its two pages', async ({ page }) => {
  await openAs(page, 'fa-IR', '/admin');
  await openPeople(page);
  for (const column of ['نام', 'نام خانوادگی', 'تلفن همراه', 'تاریخ تولد', 'استان و شهر', 'کد پستی']) {
    await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  }
  await page.getByRole('menuitem', { name: 'اشخاص حقوقی' }).click();
  for (const column of ['نام', 'شناسه‌ی ملی', 'شبا', 'استان و شهر']) {
    await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  }
});

test('the expert sees only this menu, adds a person and cannot delete', async ({ page }) => {
  await signInAsExpert(page);
  await page.goto('/admin');
  const menu = page.locator('.ant-layout-header .ant-menu-item');
  await expect(menu).toHaveCount(1);
  await expect(menu).toHaveText('اشخاص');
  await openPeople(page);

  await page.getByRole('button', { name: /افزودن/ }).click();
  const form = page.locator('form').last();
  // The labels of a modern form are not tied to their inputs, so an input is found by its form item's label.
  const input = (label: string) =>
    form
      .locator('.ant-form-item', { has: page.locator('label', { hasText: new RegExp(`^\\s*${label}\\s*:?\\s*$`) }) })
      .locator('input')
      .first();
  await input('نام').fill('مریم');
  await input('نام خانوادگی').fill('احمدی');
  // An invalid national ID is refused with plugin-fa's Persian message (EPIC-013).
  await input('کد ملی').fill('1234567890');
  await form.getByRole('button', { name: 'ثبت' }).click();
  await expect(page.getByText('«کد ملی» معتبر نیست؛ کد ملی ۱۰ رقم با رقم کنترل درست است.').first()).toBeVisible();

  await input('کد ملی').fill('0013542419');
  const created = page.waitForResponse((res) => res.url().includes('parties_people:create'));
  await form.getByRole('button', { name: 'ثبت' }).click();
  expect((await created).ok()).toBeTruthy();
  const row = page.locator('.ant-table-tbody tr.ant-table-row', { hasText: 'احمدی' }).first();
  await expect(row).toContainText('0013542419');
  await expect(row.getByText('ویرایش')).toBeVisible();
  await expect(row.getByText('حذف')).toHaveCount(0);
});
