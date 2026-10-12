import { expect, Locator, Page, test } from '@playwright/test';
import path from 'path';
import { apiAs, enablePersian, openAs } from '../helpers';
import { PAGE_TITLE, seedLoopWorkflow, seedPage, seedWorkflow } from './seed';

// Visual regression tests for the key screens from docs/research/rtl-audit.md, in Persian (RTL) and English (LTR).
// Reference images live in e2e/__screenshots__ and are generated in CI (see docs/dev/getting-started.md).

const LOCALES = ['fa-IR', 'en-US'] as const;
type Locale = (typeof LOCALES)[number];
const text = (locale: Locale, fa: string, en: string) => (locale === 'fa-IR' ? fa : en);

let workflowId: number;
let loopWorkflowId: number;
let pageUid: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await enablePersian(api);
  workflowId = await seedWorkflow(api);
  loopWorkflowId = await seedLoopWorkflow(api);
  pageUid = await seedPage(api);
  await api.request.dispose();
});

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

type Case = {
  name: string;
  path: (locale: Locale) => string;
  // Opens a menu, drawer or modal before the screenshot.
  act?: (page: Page, locale: Locale) => Promise<void>;
  // Parts that change from run to run (generated ids, random names).
  mask?: (page: Page) => Locator[];
  // Taller viewport for long menus, so they open in the same place every time.
  height?: number;
};

const openEditor = async (page: Page) => {
  await page.locator('.anticon-highlight').first().click();
  await expect(page.getByText(/^(افزودن بلوک|Add block)$/).first()).toBeVisible();
};

const cases: Case[] = [
  { name: 'users', path: () => '/admin/settings/users-permissions/users' },
  {
    name: 'users-filter',
    path: () => '/admin/settings/users-permissions/users',
    act: async (page, l) => {
      await page.getByRole('button', { name: text(l, 'فیلتر', 'Filter') }).first().click();
      await expect(page.locator('.ant-popover').first()).toBeVisible();
    },
  },
  {
    name: 'collection-create',
    path: () => '/admin/settings/data-source-manager/main/collections',
    act: async (page, l) => {
      await page.getByRole('button', { name: text(l, 'ایجاد مجموعه', 'Create collection') }).first().hover();
      await page
        .locator('.ant-dropdown-menu-item')
        .filter({ hasText: new RegExp(`^${text(l, 'مجموعه‌ی عمومی', 'General collection')}$`) })
        .click();
      await expect(page.locator('.ant-drawer-open')).toBeVisible();
    },
    // The collection name is generated randomly.
    mask: (page) => [page.locator('.ant-drawer-open input[type="text"]').nth(1)],
  },
  {
    name: 'collection-delete',
    path: () => '/admin/settings/data-source-manager/main/collections',
    act: async (page, l) => {
      await page.getByText(text(l, 'حذف', 'Delete'), { exact: true }).last().click();
      await expect(page.locator('.ant-modal').last()).toBeVisible();
    },
  },
  {
    name: 'collection-fields',
    path: () => '/admin/settings/data-source-manager/main/collections',
    act: async (page, l) => {
      const row = page.locator('tr', { hasText: 'users' }).first();
      await row.getByText(text(l, 'پیکربندی فیلدها', 'Configure fields')).click();
      await expect(page.locator('.ant-drawer-open')).toBeVisible();
    },
  },
  { name: 'system-settings', path: () => '/admin/settings/system-settings' },
  { name: 'page-table', path: () => `/admin/${pageUid}` },
  {
    name: 'page-block-settings',
    path: () => `/admin/${pageUid}`,
    act: async (page) => {
      await openEditor(page);
      await page.locator('.ant-table').first().hover();
      await page.locator('[aria-label^="designer-schema-settings-CardItem"]').first().hover();
      await expect(page.locator('.ant-dropdown:visible').first()).toBeVisible();
    },
  },
  {
    name: 'page-add-block',
    path: () => `/admin/${pageUid}`,
    height: 1000,
    act: async (page, l) => {
      await openEditor(page);
      await page.getByText(text(l, 'افزودن بلوک', 'Add block'), { exact: true }).first().hover();
      await page.getByText(text(l, 'جدول', 'Table'), { exact: true }).first().hover();
      await expect(page.locator('.ant-dropdown-menu-submenu-popup:visible, .ant-popover:visible').first()).toBeVisible();
    },
  },
  {
    name: 'workflow-canvas',
    path: () => `/admin/settings/workflow/workflows/${workflowId}`,
    // The version number is the workflow's generated id.
    mask: (page) => [page.getByText(/#\d{6,}/)],
  },
  {
    name: 'workflow-node',
    path: () => `/admin/settings/workflow/workflows/${workflowId}`,
    act: async (page, l) => {
      // Clicking the node title edits it; the node type tag opens the configuration drawer.
      await page.getByText(text(l, 'پرس‌وجوی رکورد', 'Query record'), { exact: true }).first().click();
      await expect(page.locator('.ant-drawer-open')).toBeVisible();
    },
    // The node key and the version number are generated.
    mask: (page) => [page.getByText(/#\d{6,}/), page.locator('.ant-drawer-open .ant-drawer-header code, .ant-drawer-open .ant-drawer-extra')],
  },
  {
    name: 'workflow-loop',
    path: () => `/admin/settings/workflow/workflows/${loopWorkflowId}`,
    mask: (page) => [page.getByText(/#\d{6,}/)],
  },
  { name: 'mobile', path: () => '/m' },
];

for (const locale of LOCALES) {
  test.describe(locale, () => {
    for (const c of cases) {
      test(c.name, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: c.height || 800 });
        await openAs(page, locale, c.path(locale));
        await settle(page);
        if (c.name.startsWith('page-')) await expect(page.getByText(PAGE_TITLE).first()).toBeVisible();
        if (c.act) {
          await c.act(page, locale);
          await settle(page);
        }
        await expect(page).toHaveScreenshot(`${locale}-${c.name}.png`, {
          mask: c.mask?.(page),
          stylePath: path.join(__dirname, 'screenshot.css'),
        });
      });
    }
  });
}
