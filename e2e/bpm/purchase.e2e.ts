import { expect, Locator, Page, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { Api, apiAs, enablePersian } from '../helpers';
import { removeImportedModule } from '../modules/remove-module';

// The purchase request of the BPMN proof of concept (STORY-083), end to end against a real engine: the «درخواست
// خرید» module and the model bpmn/purchase-request.bpmn with its form on Camunda 8 (STORY-092), or
// bpmn/operaton/purchase-request.bpmn on Operaton. A requester writes a request, sees no task and cannot decide
// it; the purchase manager approves one request and rejects another in the Persian task inbox (STORY-082); the
// service tasks of the process write «سفارش داده شد» and «ردشده» back on the requests (STORY-081).
// Runs only where plugin-bpm and the engine are up (the "E2E (BPMN)" CI job sets BPM_E2E=1).

test.describe.configure({ mode: 'serial' });
test.skip(!process.env.BPM_E2E, 'Needs plugin-bpm and a BPMN engine (BPM_E2E=1)');

const FILE = path.resolve(__dirname, '../../modules/purchase/purchase.erp-module.json');
const BPMN = path.resolve(__dirname, '../../bpmn');
// The files of each engine, in the order they are deployed: a Camunda form before the model that links it.
const MODELS: Record<string, string[]> = {
  camunda8: ['purchase-approve.form', 'purchase-request.bpmn'],
  operaton: ['operaton/purchase-request.bpmn'],
};
const COLLECTION = 'purchase_requests';
const PASSWORD = 'Purchase-e2e-123';
const REQUESTER = { email: 'requester@purchase.e2e', nickname: 'کارمند خرید', roles: ['purchase_requester'] };
const MANAGER = { email: 'manager@purchase.e2e', nickname: 'مدیر خرید', roles: ['purchase_manager'] };

const query = (filter: object) => `paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`;
const run = Date.now().toString(36);

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL as string);
  await enablePersian(api);
  const { engine } = await api.call('bpm:getSettings');
  for (const file of MODELS[engine]) {
    await api.call('bpm:deploy', {
      name: path.basename(file),
      content: fs.readFileSync(path.join(BPMN, file), 'utf8'),
    });
  }
  // A fresh install imports the file; a local rerun finds the module already there.
  if (!(await api.call(`erpModules:list?${query({ key: 'purchase' })}`)).length) {
    const result = await api.call('erpModules:import', JSON.parse(fs.readFileSync(FILE, 'utf8')));
    expect(result).toMatchObject({ key: 'purchase', roles: ['purchase_manager', 'purchase_requester'] });
  }
  for (const user of [REQUESTER, MANAGER]) {
    if (!(await api.call(`users:list?${query({ email: user.email })}`)).length) {
      await api.call('users:create', { ...user, password: PASSWORD });
    }
  }
  await api.request.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await apiAs(playwright, baseURL as string);
  for (const user of await api.call(`users:list?${query({ email: { $in: [REQUESTER.email, MANAGER.email] } })}`)) {
    await api.call(`users:destroy?filterByTk=${user.id}`);
  }
  await removeImportedModule(api, JSON.parse(fs.readFileSync(FILE, 'utf8')));
  await api.request.dispose();
});

async function signIn(page: Page, email: string) {
  await page.addInitScript(() => localStorage.setItem('NOCOBASE_LOCALE', 'fa-IR'));
  await page.goto('/signin');
  await page.locator('input[type="password"]').waitFor();
  await page.locator('input:not([type="password"])').first().fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
}

async function openMenu(page: Page, item: string) {
  await page.goto('/admin');
  await page.locator('.ant-layout-header').getByText('خرید', { exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

async function writeRequest(page: Page, title: string, amount: string) {
  await page.getByRole('button', { name: /افزودن/ }).click();
  const form = page.locator('form').last();
  // The labels of a modern form are not tied to their inputs, so an input is found by its form item's label.
  const input = (label: string) =>
    form
      .locator('.ant-form-item', { has: page.locator('label', { hasText: new RegExp(`^\\s*${label}\\s*:?\\s*$`) }) })
      .locator('input, textarea')
      .first();
  await input('شرح کالا').fill(title);
  await input('مبلغ').fill(amount);
  await input('توضیح').fill('برای واحد مالی');
  const created = page.waitForResponse((res) => res.url().includes(`${COLLECTION}:create`));
  await form.getByRole('button', { name: 'ثبت' }).click();
  expect((await created).ok()).toBeTruthy();
}

// The process starts after the record is saved and a service task runs on the next poll, so both can take a moment.
async function eventually(check: () => Promise<void>) {
  await expect(check).toPass({ timeout: 30 * 1000 });
}

async function inboxRow(page: Page, title: string): Promise<Locator> {
  // The requests page opened before stays in the document with its own table and refresh button, so both are looked
  // for inside the inbox block.
  const inbox = page.locator('.ant-card').filter({ has: page.getByText('صندوق کار', { exact: true }) });
  const row = inbox.locator('tr', { hasText: title });
  await eventually(async () => {
    await inbox.getByRole('button', { name: 'تازه‌سازی' }).click();
    await expect(row).toBeVisible({ timeout: 2000 });
  });
  return row;
}

async function statusOf(api: Api, title: string) {
  const res = await api.request.get(`/api/${COLLECTION}:list?${query({ title })}`, {
    headers: { ...api.headers, 'X-Role': 'root' },
  });
  return (await res.json()).data[0]?.status;
}

test('a purchase request is approved or rejected by the purchase manager', async ({ browser, playwright, baseURL }) => {
  test.setTimeout(300 * 1000);
  const api = await apiAs(playwright, baseURL as string);
  const approved = `لپ‌تاپ ${run}`;
  const rejected = `مبل ${run}`;

  const requester = await browser.newPage();
  await signIn(requester, REQUESTER.email);
  await openMenu(requester, 'درخواست‌های خرید');
  await writeRequest(requester, approved, '45000000');
  await writeRequest(requester, rejected, '120000000');
  const requests = requester.locator('.ant-table-tbody tr.ant-table-row');
  await expect(requests.filter({ hasText: approved })).toContainText('در انتظار تأیید');

  // The requester has no role of the task: nothing in the inbox, and deciding through the API is refused.
  await openMenu(requester, 'کارتابل خرید');
  await expect(requester.getByText('صندوق کار', { exact: true })).toBeVisible();
  await expect(requester.getByText('کاری برای شما نیست')).toBeVisible();

  const manager = await browser.newPage();
  await signIn(manager, MANAGER.email);
  await openMenu(manager, 'کارتابل خرید');
  const row = await inboxRow(manager, approved);
  await expect(row).toContainText('درخواست خرید');

  const managerToken = await manager.evaluate(() => localStorage.getItem('NOCOBASE_TOKEN'));
  const tasks = await (
    await api.request.get('/api/bpmTasks:list', { headers: { Authorization: `Bearer ${managerToken}` } })
  ).json();
  const taskId = tasks.data.find((t: { record: { title: string } | null }) => t.record?.title === approved).id;
  const requesterToken = await requester.evaluate(() => localStorage.getItem('NOCOBASE_TOKEN'));
  const refused = await api.request.post(`/api/bpmTasks:complete?filterByTk=${taskId}`, {
    headers: { Authorization: `Bearer ${requesterToken}` },
    data: { approved: true },
  });
  expect(refused.status()).toBe(403);

  // Approve the first request.
  await row.getByRole('button', { name: 'تأیید مدیر' }).click();
  const drawer = manager.getByRole('dialog');
  await expect(drawer.getByText(approved)).toBeVisible();
  await expect(drawer.getByText('شرح کالا')).toBeVisible();
  await drawer.getByText('بله', { exact: true }).click();
  await drawer.locator('textarea').fill('از تأمین‌کننده‌ی همیشگی بخرید');
  await drawer.getByRole('button', { name: 'ثبت', exact: true }).click();
  await expect(manager.getByText('کار انجام شد')).toBeVisible();

  // Reject the second.
  await (await inboxRow(manager, rejected)).getByRole('button', { name: 'تأیید مدیر' }).click();
  await expect(drawer.getByText(rejected)).toBeVisible();
  await drawer.getByText('خیر', { exact: true }).click();
  await drawer.getByRole('button', { name: 'ثبت', exact: true }).click();
  await expect(manager.getByText('کار انجام شد').last()).toBeVisible();

  await eventually(async () => expect(await statusOf(api, approved)).toBe('ordered'));
  await eventually(async () => expect(await statusOf(api, rejected)).toBe('rejected'));

  // The requester sees the decisions on their own requests.
  await openMenu(requester, 'درخواست‌های خرید');
  await expect(requests.filter({ hasText: approved })).toContainText('سفارش داده شد');
  await expect(requests.filter({ hasText: rejected })).toContainText('ردشده');
});
