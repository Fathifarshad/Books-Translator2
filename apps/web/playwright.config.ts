import { defineConfig, devices } from '@playwright/test';

// Set PW_CHROMIUM_PATH to use a pre-installed Chromium instead of `playwright install chromium`.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const PORT = 4173;
const API_PORT = 8797;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'fa-IR',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /(screens|mobile)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'screens',
      testMatch: /screens\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // The API with a throw-away data folder (sample book auto-seeded).
      command: 'pnpm --filter @dozabaneh/api start',
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      env: {
        PORT: String(API_PORT),
        DATA_DIR: './data/e2e',
        E2E_RESET: '1',
        LOG_LEVEL: 'warn',
        WEB_ORIGIN: `http://localhost:${PORT}`,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm build && pnpm preview --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
