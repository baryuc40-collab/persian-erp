import { expect, Page, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from './helpers';
import { cleanup, COLLECTION, seedCollection, seedV1Page, seedV2Page } from './iranian/seed';

// A national ID field (STORY-055): an invalid ID is refused with a Persian message, and a valid one typed with
// Persian digits and a dash is stored as ten Latin digits.

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

const submit = (page: Page) =>
  page
    .locator('form')
    .getByRole('button')
    .filter({ hasText: /^\s*(ثبت|ارسال)\s*$/ })
    .click();

for (const kind of ['classic', 'modern']) {
  test(`${kind} table shows a Sheba number in groups with its bank`, async ({ page }) => {
    await openAs(page, 'fa-IR', `/admin/${pages[kind]}`);
    const row = page.locator('.ant-table-tbody tr.ant-table-row').first();
    await expect(row).toContainText('IR11 0170 0000 0012 3456 7890 01');
    await expect(row).toContainText('بانک ملی ایران');
  });

  test(`${kind} form refuses an invalid national ID and stores a valid one`, async ({ page, playwright, baseURL }) => {
    await openAs(page, 'fa-IR', `/admin/${pages[kind]}`);
    const input = page.locator('form input').first();
    await input.fill('0499370898');
    await submit(page);
    // The classic form checks the rule itself; the modern one shows the server's answer.
    await expect(page.getByText('«کد ملی» معتبر نیست').first()).toBeVisible();

    await input.fill('');
    await input.click();
    await page.keyboard.insertText('۰۰۸۴-۵۷۵۹۴۸');
    // Leave the field, as a person would, so the form checks the new value before it is sent.
    await page.keyboard.press('Tab');
    if (kind === 'classic') await expect(page.locator('form').getByText('معتبر نیست')).toHaveCount(0);
    // After a refused submit, the classic form's first click can go unanswered while it re-checks the field, so the
    // click is retried until the request is sent.
    let data: { id: number; nid: string };
    await expect(async () => {
      const response = page.waitForResponse((res) => res.url().includes(`${COLLECTION}:create`), { timeout: 2000 });
      await submit(page);
      data = (await (await response).json()).data;
    }).toPass({ timeout: 20000 });
    expect(data.nid).toBe('0084575948');
    const api = await apiAs(playwright, baseURL!);
    await api.call(`${COLLECTION}:destroy?filterByTk=${data.id}`);
    await api.request.dispose();
  });
}
