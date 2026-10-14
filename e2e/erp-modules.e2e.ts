import { expect, test } from '@playwright/test';
import { Api, apiAs, enablePersian, openAs } from './helpers';

// Settings > ERP modules (STORY-066): define a module, export it, delete it and import it back.

test.describe.configure({ mode: 'serial' });

const KEY = 'e2enotes';
const GROUP = 'یادداشت‌های آزمون';

// list takes its filter from the query string; a filter in the body is ignored.
const list = (api: Api, resource: string, filter: object) =>
  api.call(`${resource}:list?paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`);

async function removeModule(api: Api) {
  await api.call(`erpModules:destroy?filterByTk=${KEY}`);
  const groups = await list(api, 'desktopRoutes', { title: GROUP, parentId: { $empty: true } });
  for (const group of groups) {
    for (const child of await list(api, 'desktopRoutes', { parentId: group.id })) {
      await api.call(`desktopRoutes:destroy?filterByTk=${child.id}`);
    }
    await api.call(`desktopRoutes:destroy?filterByTk=${group.id}`);
  }
  if ((await list(api, 'collections', { name: `${KEY}_notes` })).length) {
    await api.call(`collections:destroy?filterByTk=${KEY}_notes`);
  }
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await enablePersian(api);
  await removeModule(api);
  // A small module made the way an administrator makes one: a menu group with a link and a collection.
  const group = await api.call('desktopRoutes:create', { type: 'group', title: GROUP, schemaUid: 'e2enotesgrp' });
  await api.call('desktopRoutes:create', {
    type: 'link',
    title: 'راهنما',
    parentId: group.id,
    schemaUid: 'e2enoteslnk',
    options: { href: 'https://www.nocobase.com' },
  });
  await api.call('collections:create', {
    name: `${KEY}_notes`,
    title: 'یادداشت',
    fields: [{ name: 'text', type: 'string', interface: 'input', uiSchema: { title: 'متن', 'x-component': 'Input' } }],
  });
  await api.request.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await removeModule(api);
  await api.request.dispose();
});

test('a module is exported from the settings page and imported back after it is deleted', async ({
  page,
  playwright,
  baseURL,
}, testInfo) => {
  await openAs(page, 'fa-IR', '/admin/settings/erp-modules');

  // Define the module over its menu group.
  await page.getByRole('button', { name: 'تعریف ماژول' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('گروه منو').click();
  await page.getByTitle(GROUP).click();
  await dialog.getByLabel('کلید').fill(KEY);
  await dialog.getByLabel('عنوان').fill('یادداشت‌ها');
  await dialog.getByRole('button', { name: 'ذخیره' }).click();
  const row = page.getByRole('row', { name: new RegExp(KEY) });
  await expect(row).toContainText('یادداشت‌ها');

  // Export it.
  const downloading = page.waitForEvent('download');
  await row.getByRole('button', { name: 'خروجی گرفتن' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${KEY}.erp-module.json`);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);

  // Delete it, as if this were another install.
  const api = await apiAs(playwright, baseURL!);
  await removeModule(api);
  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(KEY) })).toHaveCount(0);

  // Import it: the preview lists what will be made, then the module and its menu are back.
  await page.locator('input[type=file]').setInputFiles(file);
  const preview = page.getByRole('dialog');
  await expect(preview).toContainText(`یادداشت (${KEY}_notes)`);
  await expect(preview).not.toContainText('این ماژول وارد نمی‌شود');
  await preview.getByRole('button', { name: 'ورود ماژول' }).click();
  await expect(page.getByText('ماژول وارد شد')).toBeVisible();
  await page.getByRole('button', { name: 'بارگذاری دوباره' }).click();
  await expect(page.getByRole('row', { name: new RegExp(KEY) })).toBeVisible();
  await expect(page.getByText(GROUP).first()).toBeVisible();
  expect((await list(api, 'collections', { name: `${KEY}_notes` })).length).toBe(1);

  // Importing the same file again is stopped before anything changes.
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByRole('dialog')).toContainText('این ماژول وارد نمی‌شود');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'ورود ماژول' })).toBeDisabled();
  await api.request.dispose();
});
