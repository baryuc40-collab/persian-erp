import { defineConfig } from '@playwright/test';
import base from '../../e2e/playwright.config';

// Takes the screenshots of the module guide (docs/modules/guide.md) on a running install: yarn docs:module-guide.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: /.*\.shots\.ts$/,
  retries: 0,
  outputDir: '../../storage/playwright/module-guide-results',
  reporter: 'list',
  use: { ...base.use, viewport: { width: 1280, height: 760 } },
});
