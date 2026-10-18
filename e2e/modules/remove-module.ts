import { expect } from '@playwright/test';
import { Api } from '../helpers';

/**
 * Deletes a module with everything it made (erpModules:remove, STORY-075), so the tests after it (reference
 * screenshots among them) see the install as it was. A module that is not installed is left alone.
 */
export async function removeImportedModule(api: Api, file: { module: { key: string } }) {
  const key = encodeURIComponent(file.module.key);
  const res = await api.request.post(`/api/erpModules:remove?filterByTk=${key}&confirm=${key}`, { headers: api.headers });
  if (res.status() === 404) return;
  expect(res.ok(), await res.text()).toBeTruthy();
}
