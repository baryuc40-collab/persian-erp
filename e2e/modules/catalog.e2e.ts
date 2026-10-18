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
