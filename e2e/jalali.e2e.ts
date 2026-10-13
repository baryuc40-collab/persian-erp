import { expect, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from './helpers';
import { seedCollection, seedV1Page, seedV2Page } from './jalali/seed';

// Dates in tables are shown in the Jalali calendar in Persian and stay Gregorian in English (EPIC-010).
// The browser runs in Tehran time so the sample moment falls on the next day there.

test.use({ timezoneId: 'Asia/Tehran' });

const pages: Record<string, string> = {};

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await enablePersian(api);
  await seedCollection(api);
  pages.classic = await seedV1Page(api);
  pages.modern = await seedV2Page(api);
  await api.request.dispose();
});

for (const kind of ['classic', 'modern']) {
  test(`${kind} table shows Jalali dates in Persian`, async ({ page }) => {
    await openAs(page, 'fa-IR', `/admin/${pages[kind]}`);
    const row = page.locator('.ant-table-tbody tr.ant-table-row').first();
    await expect(row).toContainText('1405-07-20');
    await expect(row).toContainText('1405-07-21 01:30');
  });

  test(`${kind} table keeps Gregorian dates in English`, async ({ page }) => {
    await openAs(page, 'en-US', `/admin/${pages[kind]}`);
    const row = page.locator('.ant-table-tbody tr.ant-table-row').first();
    await expect(row).toContainText('2026-10-12');
    await expect(row).toContainText('2026-10-13 01:30');
  });
}
