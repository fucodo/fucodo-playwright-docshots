// Stand-in for your existing E2E config. The docs suite reuses baseURL, webServer, timeouts …
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:4317',
    // only needed in environments without downloaded Playwright browsers
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  webServer: process.env.BASE_URL ? undefined : {
    command: 'node app/server.cjs',
    url: 'http://127.0.0.1:4317/login',
    reuseExistingServer: true,
  },
});
