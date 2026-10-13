import { expect, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from './helpers';
import { cleanup, COLLECTION, seedCollection, seedV1Page } from './jalali/seed';

// Digits typed on a Persian keyboard are sent as Latin digits (STORY-052).

test.use({ timezoneId: 'Asia/Tehran' });

let path: string;

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await enablePersian(api);
  await seedCollection(api);
  path = await seedV1Page(api);
  await api.request.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await cleanup(api);
  await api.request.dispose();
});

test('a date typed with Persian digits is read and saved', async ({ page, playwright, baseURL }) => {
  await openAs(page, 'fa-IR', `/admin/${path}`);
  const day = page.locator('form .ant-picker input').first();
  await day.click();
  // insertText is what a Persian keyboard or input method delivers.
  await page.keyboard.insertText('۱۴۰۵-۰۷-۲۰');
  await expect(day).toHaveValue('1405-07-20');
  // Leave the field so the picker takes the typed date, without Enter, which would also submit the form.
  await page.keyboard.press('Tab');
  await expect(day).toHaveValue('1405-07-20');
  const request = page.waitForRequest((req) => req.method() === 'POST' && req.url().includes(`${COLLECTION}:create`));
  await page
    .locator('form')
    .getByRole('button')
    .filter({ hasText: /^\s*(ثبت|ارسال)\s*$/ })
    .click();
  const req = await request;
  expect(req.postDataJSON().day).toBe('2026-10-12');
  const { data } = await (await req.response())!.json();
  const api = await apiAs(playwright, baseURL!);
  await api.call(`${COLLECTION}:destroy?filterByTk=${data.id}`);
  await api.request.dispose();
});
