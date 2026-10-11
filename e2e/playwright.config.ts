import { defineConfig, devices } from '@playwright/test';

// NocoBase's defineConfig (playwright.config.ts) expects its monorepo e2e harness (auth setup files, bundle
// status endpoint), which a project installed from npm does not have, so these smoke tests use plain Playwright.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.e2e\.ts$/,
  timeout: 120 * 1000,
  // One reference image per test, without the platform suffix: the references are generated on the CI runner.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    timeout: 30 * 1000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { outputFolder: '../storage/playwright/e2e-report', open: 'never' }]] : 'list',
  outputDir: '../storage/playwright/e2e-results',
  use: {
    baseURL: process.env.APP_BASE_URL || `http://localhost:${process.env.APP_PORT || 13000}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
});
