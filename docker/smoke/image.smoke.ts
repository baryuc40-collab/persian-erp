import { expect, test } from '@playwright/test';
import { apiAs, EMAIL, PASSWORD } from '../../e2e/helpers';

// A fresh install of the image, with nothing set by hand: Persian, right-to-left and the plugin enabled.

test('the sign-in page of a fresh install is Persian and right-to-left', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ورود' })).toBeVisible();
});

test('the Persian plugin is enabled and Persian is the app language', async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL!);
  const res = await api.request.get('/api/pm:listEnabled', { headers: api.headers });
  expect(res.ok()).toBeTruthy();
  const names = ((await res.json()).data as { packageName: string }[]).map((p) => p.packageName);
  expect(names).toContain('@persian-erp/plugin-fa');
  const settings = await api.request.get('/api/systemSettings:get', { headers: api.headers });
  const { appLang, enabledLanguages } = (await settings.json()).data;
  expect(appLang).toBe('fa-IR');
  expect(enabledLanguages).toContain('fa-IR');
  await api.request.dispose();
});

test('signed in, the admin pages are Persian and use the Jalali calendar', async ({ page }) => {
  await page.goto('/signin');
  await page.locator('input:not([type="password"])').first().fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
  // The client tells the server its calendar on every data request (STORY-042); Jalali is the default for Persian.
  const request = page.waitForRequest((r) => r.url().includes('/api/users:list'));
  await page.goto('/admin/settings/users-permissions/users');
  expect((await request).headers()['x-calendar']).toBe('jalali');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('کاربران و دسترسی‌ها').first()).toBeVisible();
});

test('the Vazirmatn font is served by the image', async ({ request }) => {
  // The image's nginx serves only dist/client of a plugin package (STORY-072).
  for (const file of ['Vazirmatn-Regular.woff2', 'Vazirmatn-FD-Bold.woff2']) {
    const res = await request.get(`/static/plugins/@persian-erp/plugin-fa/dist/client/fonts/${file}`);
    expect(res.status(), file).toBe(200);
  }
});
