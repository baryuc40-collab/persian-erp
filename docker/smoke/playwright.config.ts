import { defineConfig } from '@playwright/test';
import base from '../../e2e/playwright.config';

// Smoke test of a running Docker image (docker/docker-compose.yml): same browser settings as e2e/, no screenshots.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: /.*\.smoke\.ts$/,
  retries: 0,
  outputDir: '../../storage/playwright/docker-smoke-results',
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
});
