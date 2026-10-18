import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { apiAs, enablePersian, openAs } from '../helpers';
import { removeImportedModule } from './remove-module';

// Every module file in modules/ (STORY-071): it is imported on the install, after the modules it needs, each page of its menu opens without a
// console error or a failed API request, and everything it made is removed again.

const MODULES = path.resolve(__dirname, '../../modules');
const files = fs
  .readdirSync(MODULES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((dir) =>
    fs
      .readdirSync(path.join(MODULES, dir.name))
      .filter((name) => name.endsWith('.erp-module.json'))
      .map((name) => path.join(MODULES, dir.name, name)),
  );

const PAGE_TYPES = new Set(['page', 'flowPage']);
const pagesOf = (route): { title: string; schemaUid: string }[] => [
  ...(PAGE_TYPES.has(route.type) ? [{ title: route.title, schemaUid: route.schemaUid }] : []),
  ...(route.children || []).flatMap(pagesOf),
];

const modules = files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
const byKey = new Map(modules.map((module) => [module.module.key, module]));

for (const [index, file] of files.entries()) {
  const module = modules[index];
  // The modules it needs (STORY-087) are imported first and removed after it, unless the install already had them.
  const needed: string[] = [];

  test.describe(path.relative(MODULES, file), () => {
    test.describe.configure({ mode: 'serial' });
    // A module built on plugin-bpm (STORY-083) needs the plugin and an engine, which only the "E2E (BPMN)" job has.
    const needsBpm = [
      ...(module.requires?.workflowTriggers || []),
      ...(module.requires?.workflowInstructions || []),
    ].some((type: string) => type.startsWith('bpm-'));
    test.skip(needsBpm && !process.env.BPM_E2E, 'Needs plugin-bpm and a BPMN engine (BPM_E2E=1)');

    test.beforeAll(async ({ playwright, baseURL }) => {
      const api = await apiAs(playwright, baseURL!);
      await enablePersian(api);
      for (const key of Object.keys(module.requires?.modules || {})) {
        const query = encodeURIComponent(JSON.stringify({ key }));
        if ((await api.call(`erpModules:list?filter=${query}`)).length) continue;
        await api.call('erpModules:import', byKey.get(key));
        needed.push(key);
      }
      await api.call('erpModules:import', module);
      await api.request.dispose();
    });

    test.afterAll(async ({ playwright, baseURL }) => {
      const api = await apiAs(playwright, baseURL!);
      await removeImportedModule(api, module);
      for (const key of needed.reverse()) await removeImportedModule(api, byKey.get(key));
      await api.request.dispose();
    });

    for (const { title, schemaUid } of pagesOf(module.routes)) {
      test(`page «${title}» opens without errors`, async ({ page }) => {
        // Sign in first: the sign-in page itself makes requests that fail until there is a token.
        await openAs(page, 'fa-IR', '/admin');
        await page.waitForLoadState('networkidle');
        const errors: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(`console: ${message.text()} ${message.location().url}`);
        });
        page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
        page.on('response', (response) => {
          if (response.url().includes('/api/') && response.status() >= 400) {
            errors.push(`${response.status()} ${response.url()}`);
          }
        });
        await page.goto(`/admin/${schemaUid}`);
        await expect(page.locator('.ant-layout-content, main').first()).toBeVisible();
        // Blocks load their data after the page itself.
        await page.waitForLoadState('networkidle');
        expect(errors).toEqual([]);
      });
    }
  });
}
