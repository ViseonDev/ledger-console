import { defineConfig, devices } from '@playwright/test';

const ci = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: ci ? 1 : 0,
  // the tests count requests and measure scroll; keep them off each other's toes
  workers: 1,
  reporter: ci
    ? [['list'], ['junit', { outputFile: 'build/test-results/playwright.xml' }]]
    : [['list']],
  use: {
    baseURL: 'http://localhost:5187',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node fixture/src/server.ts',
      url: 'http://localhost:8022/readyz',
      reuseExistingServer: !ci,
    },
    {
      command: 'npx vite --config console/vite.config.ts console',
      url: 'http://localhost:5187',
      reuseExistingServer: !ci,
      env: { VITE_LEDGER_URL: 'http://localhost:8022' },
    },
  ],
});
