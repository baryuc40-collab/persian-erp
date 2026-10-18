import fs from 'fs';
import path from 'path';
import { expect, Page, test } from '@playwright/test';
import { checkModule } from '../check-module';
import { Api, apiAs, enablePersian, openAs } from '../../e2e/helpers';
import { removeImportedModule } from '../../e2e/modules/remove-module';

// Builds the sample module of the guide, «کارها», step by step on a running install and takes a screenshot of each
// step into docs/modules/images/ (STORY-069). The module is removed at the end, so it can run on any install:
//   APP_PORT=13000 yarn docs:module-guide

const KEY = 'tasks';
const COLLECTION = `${KEY}_items`;
const ROLE = `${KEY}_member`;
const IMAGES = path.resolve(__dirname, '../../docs/modules/images');
const OUTPUT = path.resolve(__dirname, '../../storage/playwright/module-guide-results');

test.describe.configure({ mode: 'serial' });
test.setTimeout(5 * 60 * 1000);

const list = (api: Api, resource: string, filter: object) =>
  api.call(`${resource}:list?paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`);

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(IMAGES, `${name}.png`), animations: 'disabled', caret: 'hide' });

// The fields NocoBase gives a collection made in the collection manager.
const SYSTEM_FIELDS = [
  { name: 'id', type: 'snowflakeId', autoIncrement: false, primaryKey: true, allowNull: false, interface: 'snowflakeId', uiSchema: { type: 'number', title: '{{t("ID")}}', 'x-component': 'InputNumber', 'x-component-props': { stringMode: true, separator: '0.00', step: '1' }, 'x-validator': 'integer' } },
  { name: 'createdAt', interface: 'createdAt', type: 'date', field: 'createdAt', uiSchema: { type: 'datetime', title: '{{t("Created at")}}', 'x-component': 'DatePicker', 'x-component-props': {}, 'x-read-pretty': true } },
  { name: 'createdBy', interface: 'createdBy', type: 'belongsTo', target: 'users', foreignKey: 'createdById', uiSchema: { type: 'object', title: '{{t("Created by")}}', 'x-component': 'AssociationField', 'x-component-props': { fieldNames: { value: 'id', label: 'nickname' } }, 'x-read-pretty': true } },
  { name: 'updatedAt', interface: 'updatedAt', type: 'date', field: 'updatedAt', uiSchema: { type: 'datetime', title: '{{t("Last updated at")}}', 'x-component': 'DatePicker', 'x-component-props': {}, 'x-read-pretty': true } },
  { name: 'updatedBy', interface: 'updatedBy', type: 'belongsTo', target: 'users', foreignKey: 'updatedById', uiSchema: { type: 'object', title: '{{t("Last updated by")}}', 'x-component': 'AssociationField', 'x-component-props': { fieldNames: { value: 'id', label: 'nickname' } }, 'x-read-pretty': true } },
];

const FIELDS = [
  { name: 'title', interface: 'input', type: 'string', uiSchema: { type: 'string', title: 'عنوان', 'x-component': 'Input', required: true } },
  { name: 'dueDate', interface: 'date', type: 'dateOnly', uiSchema: { type: 'string', title: 'تاریخ سررسید', 'x-component': 'DatePicker', 'x-component-props': { dateOnly: true, showTime: false } } },
  {
    name: 'status',
    interface: 'select',
    type: 'string',
    defaultValue: 'open',
    uiSchema: {
      type: 'string',
      title: 'وضعیت',
      'x-component': 'Select',
      enum: [
        { value: 'open', label: 'باز' },
        { value: 'done', label: 'انجام‌شده' },
      ],
    },
  },
  {
    name: 'owner',
    interface: 'm2o',
    type: 'belongsTo',
    target: 'users',
    foreignKey: 'ownerId',
    uiSchema: { title: 'مسئول', 'x-component': 'AssociationField', 'x-component-props': { multiple: false, fieldNames: { value: 'id', label: 'nickname' } } },
  },
];
const FIELD_NAMES = ['title', 'dueDate', 'status', 'owner'];

let api: Api;

// Removes the sample module: through its exported file once it is defined, by name before that.
async function removeSample() {
  const exported = await api.request.post(`/api/erpModules:export?filterByTk=${KEY}`, { headers: api.headers });
  if (exported.ok()) await removeImportedModule(api, await exported.json());
  for (const workflow of await list(api, 'workflows', { title: 'باز کردن کار تازه' })) {
    await api.call(`workflows:destroy?filterByTk=${workflow.id}`);
  }
  for (const group of await list(api, 'desktopRoutes', { title: 'کارها', parentId: { $empty: true } })) {
    for (const child of await list(api, 'desktopRoutes', { parentId: group.id })) {
      for (const tab of await list(api, 'desktopRoutes', { parentId: child.id })) {
        await api.call(`desktopRoutes:destroy?filterByTk=${tab.id}`);
      }
      await api.call(`desktopRoutes:destroy?filterByTk=${child.id}`);
    }
    await api.call(`desktopRoutes:destroy?filterByTk=${group.id}`);
  }
  if ((await list(api, 'roles', { name: ROLE })).length) await api.call(`roles:destroy?filterByTk=${ROLE}`);
  if ((await list(api, 'collections', { name: COLLECTION })).length) await api.call(`collections:destroy?filterByTk=${COLLECTION}`);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  fs.mkdirSync(IMAGES, { recursive: true });
  api = await apiAs(playwright, baseURL!);
  await enablePersian(api);
  await removeSample();
});

test.afterAll(async () => {
  await removeSample();
  await api.request.dispose();
});

test('the sample module «کارها», step by step', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await openAs(page, 'fa-IR', '/admin');

  // Step 3: the collection, with the key as the prefix of its name and Persian titles.
  await api.call('collections:create', {
    name: COLLECTION,
    title: 'کار',
    titleField: 'title',
    template: 'general',
    autoGenId: false,
    logging: true,
    fields: [...SYSTEM_FIELDS, ...FIELDS],
  });
  await page.goto('/admin/settings/data-source-manager/main/collections');
  const row = page.getByRole('row', { name: new RegExp(COLLECTION) });
  await row.getByText('پیکربندی فیلدها').click();
  await expect(page.getByText('تاریخ سررسید').first()).toBeVisible();
  await shot(page, '03-collection');
  await page.keyboard.press('Escape');

  // Steps 2 and 4: the menu group and its page, with a table of the collection.
  const fields = FIELD_NAMES;
  await api.call('flowSurfaces:applyBlueprint', {
    version: '1',
    mode: 'create',
    navigation: { group: { title: 'کارها', icon: 'CheckSquareOutlined' }, item: { title: 'فهرست کارها', icon: 'UnorderedListOutlined' } },
    page: { title: 'فهرست کارها' },
    tabs: [
      {
        key: 'main',
        title: 'فهرست کارها',
        blocks: [
          {
            key: 'table',
            type: 'table',
            collection: COLLECTION,
            fields,
            actions: [
              'filter',
              'refresh',
              { type: 'addNew', popup: { blocks: [{ type: 'createForm', resource: { binding: 'currentCollection' }, fields, actions: ['submit'] }] } },
            ],
            recordActions: [
              { type: 'edit', popup: { blocks: [{ type: 'editForm', resource: { binding: 'currentRecord' }, fields, actions: ['submit'] }] } },
              'delete',
            ],
          },
        ],
      },
    ],
  });
  const [group] = await list(api, 'desktopRoutes', { title: 'کارها', parentId: { $empty: true } });
  const [item] = await list(api, 'desktopRoutes', { parentId: group.id });
  await api.call(`${COLLECTION}:create`, { title: 'تمدید قرارداد اجاره‌ی انبار', dueDate: '2026-11-21', status: 'open', ownerId: 1 });
  await api.call(`${COLLECTION}:create`, { title: 'پرداخت قبض برق', dueDate: '2026-10-22', status: 'done', ownerId: 1 });
  await page.goto(`/admin/${item.schemaUid}`);
  await expect(page.getByText('پرداخت قبض برق')).toBeVisible();
  await shot(page, '04-page');
  await page.getByRole('button', { name: /افزودن/ }).first().click();
  await expect(page.getByRole('dialog').getByText('تاریخ سررسید')).toBeVisible();
  await shot(page, '04-page-form');
  await page.keyboard.press('Escape');

  // Step 5: a role with limited access: no settings, only this menu, view and add and edit on the collection.
  await api.call('roles:create', { name: ROLE, title: 'عضو تیم', snippets: ['!pm', '!pm.*', '!ui.*'], allowNewMenu: false, allowConfigure: false });
  const names = [...SYSTEM_FIELDS.map((f) => f.name), ...FIELD_NAMES];
  await api.call(`roles/${ROLE}/dataSourceResources:create?filterByTk=${COLLECTION}&filter=${encodeURIComponent(JSON.stringify({ dataSourceKey: 'main' }))}`, {
    name: COLLECTION,
    dataSourceKey: 'main',
    usingActionsConfig: true,
    actions: ['view', 'create', 'update'].map((action) => ({ name: action, fields: names })),
  });
  await api.call(`roles/${ROLE}/desktopRoutes:set`, [group.id, item.id, ...(await list(api, 'desktopRoutes', { parentId: item.id })).map((r) => r.id)]);
  await page.goto('/admin/settings/users-permissions/roles');
  await page.getByText('عضو تیم').first().click();
  await page.getByRole('tab', { name: 'منابع داده' }).click();
  await page.getByText('پیکربندی', { exact: true }).first().click();
  await page.getByRole('tab', { name: 'دسترسی‌های اکشن', exact: true }).click();
  const permissions = page.getByRole('row', { name: new RegExp(COLLECTION) });
  await expect(permissions).toBeVisible();
  await shot(page, '05-role');

  // Step 6: a workflow with a description of what it does.
  const workflow = await api.call('workflows:create', {
    title: 'باز کردن کار تازه',
    description: 'وقتی کار تازه‌ای ثبت شود، وضعیتش را «باز» می‌گذارد.',
    type: 'collection',
    sync: false,
    enabled: true,
    config: { mode: 1, collection: COLLECTION },
  });
  await api.call(`workflows/${workflow.id}/nodes:create`, {
    type: 'update',
    title: 'وضعیت باز',
    config: {
      collection: COLLECTION,
      usingAssignFormSchema: true,
      params: { filter: { $and: [{ id: { $eq: '{{$context.data.id}}' } }] }, values: { status: 'open' } },
    },
  });
  await page.goto(`/admin/settings/workflow/workflows/${workflow.id}`);
  await expect(page.getByText('وضعیت باز').first()).toBeVisible();
  await shot(page, '06-workflow');

  // Step 7: the module is defined over its menu group in Settings > ERP modules.
  await page.goto('/admin/settings/erp-modules');
  await page.getByRole('button', { name: 'تعریف ماژول' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('گروه منو').click();
  await page.getByTitle('کارها').click();
  await dialog.getByLabel('کلید').fill(KEY);
  await dialog.getByLabel('عنوان').fill('کارها');
  await shot(page, '07-define');
  await dialog.getByRole('button', { name: 'ذخیره' }).click();
  const moduleRow = page.getByRole('row', { name: new RegExp(KEY) });
  await expect(moduleRow).toContainText('کارها');

  // Step 8: export; the row opens to show what the module holds.
  await expect(page.locator('.ant-message-notice')).toHaveCount(0, { timeout: 10_000 });
  await moduleRow.locator('.ant-table-row-expand-icon').click();
  await expect(page.getByText(`کار (${COLLECTION})`)).toBeVisible();
  await shot(page, '08-export');
  const downloading = page.waitForEvent('download');
  await moduleRow.getByRole('button', { name: 'خروجی گرفتن' }).click();
  const download = await downloading;
  const saved = path.join(OUTPUT, download.suggestedFilename());
  await download.saveAs(saved);
  const file = JSON.parse(fs.readFileSync(saved, 'utf8'));

  // Step 9: the sample module passes the standard.
  expect(checkModule(file).filter((f) => f.severity === 'error')).toEqual([]);
  expect(file.workflows.map((w) => w.title)).toEqual(['باز کردن کار تازه']);
  expect(file.roles.map((r) => r.name)).toEqual([ROLE]);
});
