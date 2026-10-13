import { expect, Page, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from './helpers';
import { cleanup, COLLECTION, seedCollection, seedV1Page, seedV2Page } from './jalali/seed';

// Dates are shown and picked in the Jalali calendar in Persian and stay Gregorian in English (EPIC-010); what is
// saved is the same either way. The browser runs in Tehran time (+03:30), so the sample moment falls on the next day
// there and midnight picked in Tehran is the evening before in UTC.

test.use({ timezoneId: 'Asia/Tehran' });
test.describe.configure({ mode: 'serial' });

const KINDS = ['classic', 'modern'] as const;
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

const firstRow = (page: Page) => page.locator('.ant-table-tbody tr.ant-table-row').first();

for (const kind of KINDS) {
  test(`${kind} table shows Jalali dates in Persian`, async ({ page }) => {
    await openAs(page, 'fa-IR', `/admin/${pages[kind]}`);
    await expect(firstRow(page)).toContainText('1405-07-20');
    await expect(firstRow(page)).toContainText('1405-07-21 01:30');
  });

  test(`${kind} table keeps Gregorian dates in English`, async ({ page }) => {
    await openAs(page, 'en-US', `/admin/${pages[kind]}`);
    await expect(firstRow(page)).toContainText('2026-10-12');
    await expect(firstRow(page)).toContainText('2026-10-13 01:30');
  });
}

test('the user menu switches Persian users to the Gregorian calendar', async ({ page }) => {
  await openAs(page, 'fa-IR', `/admin/${pages.classic}`);
  await expect(firstRow(page)).toContainText('1405-07-20');
  await page.locator('[data-testid="user-center-button"]').hover();
  const item = page.getByRole('menuitem').filter({ hasText: 'تقویم' });
  await expect(item).toContainText('شمسی');
  await item.click();
  await page.getByRole('option', { name: 'میلادی' }).click();
  await page.waitForLoadState('networkidle');
  await expect(firstRow(page)).toContainText('2026-10-12');
  await expect(firstRow(page)).toContainText('2026-10-13 01:30');
  // The choice is kept for the next visit.
  await page.goto(`/admin/${pages.modern}`);
  await expect(firstRow(page)).toContainText('2026-10-12');
});

// Picks the same day in both form fields and submits; returns what was sent to the server.
async function pickAndSubmit(page: Page, day: string) {
  const pickers = page.locator('form .ant-picker input');
  await expect(pickers).toHaveCount(2);
  const openDropdown = page.locator('.ant-picker-dropdown:visible');
  await pickers.nth(0).click();
  await openDropdown.locator(`td[title="${day}"]`).click();
  // Wait for the first calendar to close, or both match while it fades out.
  await expect(openDropdown).toHaveCount(0);
  await pickers.nth(1).click();
  await openDropdown.locator(`td[title="${day}"]`).click();
  await openDropdown.locator('.ant-picker-ok button').click();
  await expect(pickers.nth(0)).toHaveValue(day);
  const request = page.waitForRequest((req) => req.method() === 'POST' && req.url().includes(`${COLLECTION}:create`));
  await page
    .locator('form')
    .getByRole('button')
    .filter({ hasText: /^\s*(Submit|ثبت|ارسال)\s*$/ })
    .click();
  const sent = (await request).postDataJSON();
  const response = await (await request).response();
  return { sent, id: (await response!.json()).data.id };
}

for (const kind of KINDS) {
  for (const [locale, day] of [
    ['fa-IR', '1405-07-20'],
    ['en-US', '2026-10-12'],
  ]) {
    test(`${kind} form in ${locale} saves the picked date in Gregorian`, async ({ page, playwright, baseURL }) => {
      await openAs(page, locale, `/admin/${pages[kind]}`);
      const { sent, id } = await pickAndSubmit(page, day);
      expect(sent.day).toBe('2026-10-12');
      expect(sent.moment).toBe('2026-10-11T20:30:00.000Z');
      const api = await apiAs(playwright, baseURL!);
      await api.call(`${COLLECTION}:destroy?filterByTk=${id}`);
      await api.request.dispose();
    });
  }
}
