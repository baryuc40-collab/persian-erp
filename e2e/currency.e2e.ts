import { expect, Page, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from './helpers';
import { cleanup, COLLECTION, seedCollection, seedV1Page, seedV2Page } from './currency/seed';

// An Iranian currency field shown in tomans: 125000 rials read as 12,500 tomans, and 12,500 typed is saved as
// 125000 rials (STORY-054).

test.describe.configure({ mode: 'serial' });

const pages: Record<string, string> = {};

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await enablePersian(api);
  await seedCollection(api);
  pages.classic = await seedV1Page(api);
  pages.modern = await seedV2Page(api);
  await api.request.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await cleanup(api);
  await api.request.dispose();
});

async function typeAndSubmit(page: Page, amount: string) {
  const input = page.locator('form .ant-input-number-input');
  await input.fill(amount);
  await expect(input).toHaveValue('12,500');
  const request = page.waitForRequest((req) => req.method() === 'POST' && req.url().includes(`${COLLECTION}:create`));
  await page
    .locator('form')
    .getByRole('button')
    .filter({ hasText: /^\s*(ثبت|ارسال)\s*$/ })
    .click();
  const sent = (await request).postDataJSON();
  const response = await (await request).response();
  return { sent, id: (await response!.json()).data.id };
}

for (const kind of ['classic', 'modern']) {
  test(`${kind} page shows and takes tomans`, async ({ page, playwright, baseURL }) => {
    await openAs(page, 'fa-IR', `/admin/${pages[kind]}`);
    await expect(page.locator('.ant-table-tbody tr.ant-table-row').first()).toContainText('12,500 تومان');
    await expect(page.locator('form')).toContainText('تومان');
    const { sent, id } = await typeAndSubmit(page, '12500');
    expect(Number(sent.amount)).toBe(125000);
    const api = await apiAs(playwright, baseURL!);
    await api.call(`${COLLECTION}:destroy?filterByTk=${id}`);
    await api.request.dispose();
  });
}
