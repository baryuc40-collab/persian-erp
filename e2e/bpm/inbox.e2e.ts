import { expect, Page, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { Api, apiAs, enablePersian } from '../helpers';

// The task inbox of plugin-bpm (STORY-082) against a real Operaton: a purchase request starts the process, a clerk
// sees no task and gets a 403, the purchase manager approves it in Persian, and the service task marks the record.
// Runs only where plugin-bpm and the engine are up (the "E2E (BPMN)" CI job sets BPM_E2E=1).

const COLLECTION = 'bpm_e2e_requests';
const PAGE_TITLE = 'کارتابل خرید';
const USER_PASSWORD = 'Inbox-e2e-123';
const MODEL = path.resolve(__dirname, '../../bpmn/purchase-request.bpmn');

const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function first(api: Api, resource: string, filter: object) {
  const res = await api.request.get(`/api/${resource}:list`, {
    headers: api.headers,
    params: { filter: JSON.stringify(filter) },
  });
  return (await res.json()).data?.[0];
}

// What a rerun finds already there is kept.
async function seed(api: Api) {
  await enablePersian(api);
  await api.call('bpm:deploy', { name: 'purchase-request.bpmn', content: fs.readFileSync(MODEL, 'utf8') });
  if (!(await first(api, 'collections', { name: COLLECTION }))) {
    await api.call('collections:create', {
      name: COLLECTION,
      title: 'درخواست خرید',
      titleField: 'title',
      fields: [
        { name: 'title', type: 'string', interface: 'input', uiSchema: { title: 'عنوان', 'x-component': 'Input' } },
        { name: 'status', type: 'string', interface: 'input', uiSchema: { title: 'وضعیت', 'x-component': 'Input' } },
      ],
    });
  }
  if (!(await first(api, 'workflows', { title: 'شروع درخواست خرید (e2e)' }))) {
    const start = await api.call('workflows:create', {
      title: 'شروع درخواست خرید (e2e)',
      type: 'collection',
      enabled: true,
      config: { mode: 1, collection: COLLECTION },
    });
    await api.call(`workflows/${start.id}/nodes:create`, {
      type: 'bpm-start',
      title: 'شروع فرایند',
      config: {
        processKey: 'purchase_request',
        businessKey: `${COLLECTION}:{{$context.data.id}}`,
        variables: [{ name: 'recordId', value: '{{$context.data.id}}' }],
      },
    });
  }
  if (!(await first(api, 'workflows', { title: 'ثبت سفارش (e2e)' }))) {
    const order = await api.call('workflows:create', {
      title: 'ثبت سفارش (e2e)',
      type: 'bpm-service-task',
      enabled: true,
      config: { topic: 'place-order' },
    });
    await api.call(`workflows/${order.id}/nodes:create`, {
      type: 'update',
      title: 'وضعیت سفارش',
      config: {
        collection: COLLECTION,
        params: { filter: { id: '{{$context.recordId}}' }, values: { status: 'ordered' } },
      },
    });
  }
  if (!(await first(api, 'roles', { name: 'purchase_manager' }))) {
    await api.call('roles:create', { name: 'purchase_manager', title: 'مدیر خرید', allowNewMenu: true });
  }
  await api.call('roles:update?filterByTk=member', { allowNewMenu: true });
  for (const [email, nickname, role] of [
    ['manager@bpm.e2e', 'مدیر خرید', 'purchase_manager'],
    ['clerk@bpm.e2e', 'کارمند', 'member'],
  ]) {
    if (!(await first(api, 'users', { email }))) {
      await api.call('users:create', { email, nickname, password: USER_PASSWORD, roles: [role] });
    }
  }
  let pageUid = (await first(api, 'desktopRoutes', { title: PAGE_TITLE }))?.schemaUid;
  if (!pageUid) {
    pageUid = uid('bp');
    const tabUid = uid('bt');
    await api.call('desktopRoutes:create', {
      type: 'flowPage',
      title: PAGE_TITLE,
      schemaUid: pageUid,
      menuSchemaUid: uid('bm'),
      enableTabs: false,
      children: [{ type: 'tabs', schemaUid: tabUid, tabSchemaName: uid('bn'), hidden: true }],
    });
    await api.call('flowModels:save', {
      uid: uid('bg'),
      parentId: tabUid,
      subKey: 'grid',
      subType: 'object',
      use: 'BlockGridModel',
      subModels: {
        items: [
          {
            uid: uid('bb'),
            use: 'BpmTaskInboxBlockModel',
            stepParams: { cardSettings: { titleDescription: { title: 'صندوق کار' } } },
          },
        ],
      },
    });
  }
  return pageUid as string;
}

async function signIn(page: Page, email: string) {
  await page.addInitScript(() => localStorage.setItem('NOCOBASE_LOCALE', 'fa-IR'));
  await page.goto('/signin');
  await page.locator('input[type="password"]').waitFor();
  await page.locator('input:not([type="password"])').first().fill(email);
  await page.locator('input[type="password"]').fill(USER_PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
}

test.skip(!process.env.BPM_E2E, 'Needs plugin-bpm and a BPMN engine (BPM_E2E=1)');

test('a purchase manager approves a purchase request in the Persian task inbox', async ({
  browser,
  playwright,
  baseURL,
}) => {
  test.setTimeout(240 * 1000);
  const api = await apiAs(playwright, baseURL as string);
  const pageUid = await seed(api);
  const title = `میز اداری ${Date.now().toString(36)}`;
  const request = await api.call(`${COLLECTION}:create`, { title, status: 'pending' });
  const recordLabel = `درخواست خرید: ${title}`;

  // The clerk has no role of the task: the inbox is empty and completing it through the API is refused.
  const clerk = await browser.newPage();
  await signIn(clerk, 'clerk@bpm.e2e');
  await clerk.goto(`/admin/${pageUid}`);
  await expect(clerk.getByText('صندوق کار', { exact: true })).toBeVisible();
  await expect(clerk.getByText(recordLabel)).toHaveCount(0);

  const manager = await browser.newPage();
  await signIn(manager, 'manager@bpm.e2e');
  await manager.goto(`/admin/${pageUid}`);
  const row = manager.locator('tr', { hasText: recordLabel });
  // The process starts after the record is saved, so the task can come a moment later.
  await expect(async () => {
    await manager.getByRole('button', { name: 'تازه‌سازی' }).click();
    await expect(row).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30 * 1000 });
  await expect(row.getByText('درخواست خرید', { exact: true })).toBeVisible();
  // Created today, written on the Jalali calendar.
  await expect(row).toContainText('۱۴۰');

  const token = await clerk.evaluate(() => localStorage.getItem('NOCOBASE_TOKEN'));
  const managerToken = await manager.evaluate(() => localStorage.getItem('NOCOBASE_TOKEN'));
  const tasks = await (
    await api.request.get('/api/bpmTasks:list', { headers: { Authorization: `Bearer ${managerToken}` } })
  ).json();
  const taskId = tasks.data.find((t: { record: { title: string } | null }) => t.record?.title === title).id;
  const refused = await api.request.post(`/api/bpmTasks:complete?filterByTk=${taskId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { approved: true },
  });
  expect(refused.status()).toBe(403);

  await row.getByRole('button', { name: 'تأیید مدیر' }).click();
  const drawer = manager.getByRole('dialog');
  await expect(drawer.getByText(title)).toBeVisible();
  await expect(drawer.getByText('عنوان')).toBeVisible();
  // The decision is required.
  await drawer.getByRole('button', { name: 'ثبت', exact: true }).click();
  await expect(drawer.getByText('«درخواست تأیید می‌شود؟» را پر کنید')).toBeVisible();
  await drawer.getByText('بله', { exact: true }).click();
  await drawer.locator('textarea').fill('از تأمین‌کننده‌ی همیشگی بخرید');
  await drawer.getByRole('button', { name: 'ثبت', exact: true }).click();
  await expect(manager.getByText('کار انجام شد')).toBeVisible();
  await expect(row).toHaveCount(0);

  // The service task of the process marks the record through the NocoBase workflow (STORY-081).
  await expect(async () => {
    const res = await api.request.get(`/api/${COLLECTION}:get?filterByTk=${request.id}`, {
      headers: { ...api.headers, 'X-Role': 'root' },
    });
    expect((await res.json()).data.status).toBe('ordered');
  }).toPass({ timeout: 30 * 1000 });
});
