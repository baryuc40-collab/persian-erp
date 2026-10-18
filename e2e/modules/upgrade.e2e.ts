import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from '../helpers';
import { removeImportedModule } from './remove-module';

// Upgrading an installed module from the settings page (STORY-077): «اشخاص» 1.0.0 with a person in it, then a
// file of version 1.1.0 with one more field in the people form.

test.describe.configure({ mode: 'serial' });

const FILE = path.resolve(__dirname, '../../modules/parties/parties.erp-module.json');
const v1 = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));

type Model = { uid: string; use: string; stepParams?: any; subModels?: Record<string, Model | Model[]> };

const findModel = (models: Model[], uid: string): Model | undefined => {
  for (const model of models) {
    if (model.uid === uid) return model;
    for (const sub of Object.values(model.subModels || {})) {
      const found = findModel(Array.isArray(sub) ? sub : [sub], uid);
      if (found) return found;
    }
  }
};

// The people form of «افزودن» gets an email field next to the postal code.
function nextVersion() {
  const file = v1();
  file.module.version = '1.1.0';
  const people = file.collections.find((c) => c.name === 'parties_people');
  people.fields.push({
    description: null,
    interface: 'email',
    name: 'email',
    type: 'string',
    uiSchema: { title: 'رایانامه', type: 'string', 'x-component': 'Input', 'x-validator': 'email' },
  });
  const form = file.flowModels.map((m: Model) => findModel([m], 'yk5dm7oigda')).find(Boolean) as Model;
  const items = form.subModels!.items as Model[];
  const postal = items.find((item) => item.uid === 't737p0x4fe0')!;
  const init = { collectionName: 'parties_people', dataSourceKey: 'main', fieldPath: 'email' };
  items.push({
    ...postal,
    uid: 'e2eemailitm',
    sortIndex: items.length + 1,
    stepParams: { fieldSettings: { init } },
    subModels: {
      field: {
        ...(postal.subModels!.field as Model),
        uid: 'e2eemailfld',
        parentId: 'e2eemailitm',
        stepParams: { fieldSettings: { init } },
      },
    },
  } as Model);
  const grid = form.stepParams.gridSettings.grid;
  grid.rows.row4 = [['t737p0x4fe0'], ['e2eemailitm']];
  grid.sizes.row4 = [12, 12];
  return file;
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await enablePersian(api);
  await removeImportedModule(api, v1());
  await api.call('erpModules:import', v1());
  await api.call('parties_people:create', { firstName: 'سارا', lastName: 'کاظمی', nationalId: '0013542419' });
  await api.request.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await removeImportedModule(api, v1());
  await api.request.dispose();
});

test('a newer file of an installed module upgrades it after a preview, and its records stay', async ({
  page,
  playwright,
  baseURL,
}, testInfo) => {
  const file = testInfo.outputPath('parties.erp-module.json');
  fs.writeFileSync(file, JSON.stringify(nextVersion()));

  await openAs(page, 'fa-IR', '/admin/settings/erp-modules');
  await expect(page.getByRole('row', { name: /parties/ })).toContainText('1.0.0');
  await page.locator('input[type=file]').setInputFiles(file);

  const preview = page.getByRole('dialog');
  await expect(preview).toContainText('ارتقای ماژول');
  await expect(preview).toContainText('پیش از ارتقا از پایگاه داده پشتیبان بگیرید.');
  await expect(preview).toContainText('از 1.0.0 به 1.1.0');
  await expect(preview.getByRole('row', { name: /فیلدهای تازه/ })).toContainText('parties_people.email');
  await preview.getByRole('button', { name: 'ارتقا', exact: true }).click();
  await expect(page.getByText('ماژول ارتقا یافت')).toBeVisible();
  await page.getByRole('button', { name: 'بارگذاری دوباره' }).click();
  await expect(page.getByRole('row', { name: /parties/ })).toContainText('1.1.0');

  // The person is still there, and the people form has the new field.
  await page.locator('.ant-layout-header').getByText('اشخاص', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'اشخاص حقیقی' }).click();
  await expect(page.locator('.ant-table-tbody tr.ant-table-row', { hasText: 'کاظمی' })).toContainText('0013542419');
  await page.getByRole('button', { name: /افزودن/ }).click();
  await expect(page.locator('form').last().locator('label', { hasText: 'رایانامه' })).toBeVisible();

  // The same file again is not a newer version.
  await openAs(page, 'fa-IR', '/admin/settings/erp-modules');
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByRole('dialog')).toContainText('این ماژول ارتقا نمی‌یابد');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'ارتقا', exact: true })).toBeDisabled();

  const api = await apiAs(playwright, baseURL!);
  const people = await api.call('parties_people:list');
  expect(people.map((p) => p.lastName)).toEqual(['کاظمی']);
  await api.request.dispose();
});
