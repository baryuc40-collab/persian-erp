import { expect, Page, test } from '@playwright/test';

const EMAIL = process.env.INIT_ROOT_EMAIL || 'admin@nocobase.com';
const PASSWORD = process.env.INIT_ROOT_PASSWORD || 'admin123';

// The client reads the UI language from localStorage before it talks to the server.
async function openAs(page: Page, locale: string, path: string) {
  await page.addInitScript((value) => localStorage.setItem('NOCOBASE_LOCALE', value), locale);
  await page.goto('/signin');
  await page.locator('input[type="password"]').waitFor();
  await page.locator('input:not([type="password"])').first().fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
  await page.goto(path);
}

const loadedFonts = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, ''));
  });

test('Persian: right-to-left layout, Vazirmatn and Persian text', async ({ page }) => {
  await openAs(page, 'fa-IR', '/admin/settings/users-permissions/users');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.getByText('کاربران و دسترسی‌ها').first()).toBeVisible();
  await expect(page.getByText('مدیریت پلاگین‌ها').first()).toBeVisible();
  await expect(page.locator('.ant-table').first()).toHaveClass(/ant-table-rtl/);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^Vazirmatn/);
  expect(await loadedFonts(page)).toContain('Vazirmatn');
});

test('English: layout and font unchanged', async ({ page }) => {
  await openAs(page, 'en-US', '/admin/settings/users-permissions/users');
  await expect(page.getByText('Users & Permissions').first()).toBeVisible();
  expect(await page.locator('html').getAttribute('dir')).not.toBe('rtl');
  await expect(page.locator('.ant-table').first()).not.toHaveClass(/ant-table-rtl/);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).not.toContain('Vazirmatn');
});
