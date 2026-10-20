'use strict';
// Browser tests run against the dev server (fake sheets, mock transport): no Google account is needed.
// CHROMIUM_PATH (optional) points at an installed Chromium when Playwright's own download is not present.
const { defineConfig } = require('@playwright/test');

const PORT = 4173;

module.exports = defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:' + PORT,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'node tools/dev-server.js',
    url: 'http://127.0.0.1:' + PORT + '/healthz',
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
