import { expect, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from './helpers';

// The administrator's default calendar (STORY-048).

test.describe.configure({ mode: 'serial' });

const setDefault = async (playwright, baseURL: string, calendar: string | null) => {
  const api = await apiAs(playwright, baseURL);
  await api.call('persianErp:setSettings', { calendar });
  await api.request.dispose();
};

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  await enablePersian(api);
  await api.request.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  await setDefault(playwright, baseURL!, null);
});

test('the settings page saves the default calendar', async ({ page, playwright, baseURL }) => {
  await openAs(page, 'fa-IR', '/admin/settings/persian-erp');
  await expect(page.getByText('تقویم پیش‌فرض')).toBeVisible();
  await expect(page.getByLabel('بر اساس زبان (شمسی در فارسی)')).toBeChecked();
  await page.getByLabel('میلادی').check();
  const saved = page.waitForResponse((res) => res.url().includes('persianErp:setSettings'));
  await page.getByRole('button', { name: 'ذخیره' }).click();
  expect((await saved).ok()).toBeTruthy();
  const api = await apiAs(playwright, baseURL!);
  expect(await api.call('persianErp:getSettings')).toEqual({ calendar: 'gregory' });
  await api.request.dispose();
});

test('Persian users without a choice follow a Gregorian default', async ({ page, playwright, baseURL }) => {
  await setDefault(playwright, baseURL!, 'gregory');
  const request = page.waitForRequest((r) => r.url().includes('/api/') && r.url().includes(':list'));
  await openAs(page, 'fa-IR', '/admin/settings/users-permissions/users');
  expect((await request).headers()['x-calendar']).toBeUndefined();
});
