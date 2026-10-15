import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: './work/ui-test-results',
  reporter: [['list'], ['html', { outputFolder: './work/ui-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4183',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node src/preview-server.ts',
    url: 'http://127.0.0.1:4183/api/health',
    reuseExistingServer: false,
    timeout: 15_000,
    env: { PREVIEW_PORT: '4183', PREVIEW_STORAGE: 'memory' },
  },
});
