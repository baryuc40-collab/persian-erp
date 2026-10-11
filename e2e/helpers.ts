import { APIRequestContext, expect, Page, PlaywrightWorkerArgs } from '@playwright/test';

export const EMAIL = process.env.INIT_ROOT_EMAIL || 'admin@nocobase.com';
export const PASSWORD = process.env.INIT_ROOT_PASSWORD || 'admin123';

// The client reads the UI language from localStorage before it talks to the server.
export async function openAs(page: Page, locale: string, path: string) {
  await page.addInitScript((value) => localStorage.setItem('NOCOBASE_LOCALE', value), locale);
  await page.goto('/signin');
  await page.locator('input[type="password"]').waitFor();
  await page.locator('input:not([type="password"])').first().fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
  await page.goto(path);
}

export type Api = {
  request: APIRequestContext;
  headers: Record<string, string>;
  call: (action: string, data?: unknown) => Promise<any>;
};

// A signed-in API client for seeding data. call() posts to /api/<action> and returns `data` from the response.
export async function apiAs(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string): Promise<Api> {
  const request = await playwright.request.newContext({ baseURL });
  const signIn = await request.post('/api/auth:signIn', {
    headers: { 'X-Authenticator': 'basic' },
    data: { account: EMAIL, password: PASSWORD },
  });
  expect(signIn.ok()).toBeTruthy();
  const { token } = (await signIn.json()).data;
  const headers = { Authorization: `Bearer ${token}` };
  const call = async (action: string, data?: unknown) => {
    const res = await request.post(`/api/${action}`, { headers, data });
    expect(res.ok(), `${action}: ${await res.text()}`).toBeTruthy();
    return (await res.json()).data;
  };
  return { request, headers, call };
}

// A fresh install only enables en-US; Persian has to be enabled in system settings before it can be chosen.
export async function enablePersian(api: Api) {
  await api.call('systemSettings:update?filterByTk=1', { enabledLanguages: ['en-US', 'fa-IR'] });
}
