import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from '../helpers';
import { removeImportedModule } from './remove-module';

// The catalog of modules that come with the image (STORY-070): «اشخاص» is installed from the settings page.

test.describe.configure({ mode: 'serial' });

const FILE = path.resolve(__dirname, '../../modules/parties/parties.erp-module.json');

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await enablePersian(api);
  await api.request.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await removeImportedModule(api, JSON.parse(fs.readFileSync(FILE, 'utf8')));
  await api.request.dispose();
});

test('a module of the catalog is installed with one button after a preview', async ({ page }) => {
  await openAs(page, 'fa-IR', '/admin/settings/erp-modules');
  const catalog = page.locator('.ant-card', { has: page.getByText('کاتالوگ', { exact: true }) });
  const item = catalog.locator('.ant-list-item', { hasText: 'اشخاص' });
  await expect(item).toContainText('اشخاص حقیقی و حقوقی');
  await item.getByRole('button', { name: 'نصب' }).click();

  const preview = page.getByRole('dialog');
  await expect(preview).toContainText('شخص حقیقی (parties_people)');
  await expect(preview).toContainText('کارشناس اشخاص');
  await preview.getByRole('button', { name: 'ورود ماژول' }).click();
  await expect(page.getByText('ماژول وارد شد')).toBeVisible();
  await page.getByRole('button', { name: 'بارگذاری دوباره' }).click();

  await expect(item.getByText('نصب‌شده')).toBeVisible();
  await expect(page.getByRole('row', { name: /parties/ })).toBeVisible();
  await expect(page.locator('.ant-layout-header').getByText('اشخاص', { exact: true })).toBeVisible();
});

test('the module is deleted from the settings page after a preview and its key, and installs again', async ({
  page,
  playwright,
  baseURL,
}) => {
  await openAs(page, 'fa-IR', '/admin/settings/erp-modules');
  const row = page.getByRole('row', { name: /parties/ });
  await row.getByRole('button', { name: 'حذف' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('پیش از حذف از پایگاه داده پشتیبان بگیرید');
  await expect(dialog).toContainText('شخص حقیقی: 0 رکورد');
  const remove = dialog.getByRole('button', { name: 'حذف' });
  await expect(remove).toBeDisabled();
  await dialog.getByLabel('برای تأیید، parties را بنویسید').fill('parties');
  await remove.click();
  await expect(page.getByText('ماژول حذف شد')).toBeVisible();
  await page.getByRole('button', { name: 'بارگذاری دوباره' }).click();

  await expect(page.getByRole('row', { name: /parties/ })).toHaveCount(0);
  const catalog = page.locator('.ant-card', { has: page.getByText('کاتالوگ', { exact: true }) });
  await expect(catalog.locator('.ant-list-item', { hasText: 'اشخاص' }).getByRole('button', { name: 'نصب' })).toBeEnabled();
  await expect(page.locator('.ant-layout-header').getByText('اشخاص', { exact: true })).toHaveCount(0);

  // Nothing is left that would stop the same module from installing again.
  const api = await apiAs(playwright, baseURL!);
  await api.call('erpModules:install?filterByTk=parties');
  await api.request.dispose();
});
