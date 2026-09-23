// End-to-end config.
//
// One test, run against the real production bundle rather than the dev server,
// because the point of it is to check what actually ships. Everything else in
// the suite runs under jsdom with the storage layer mocked; this is the only
// thing that proves the pieces are wired to each other.

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  // Serial and single-worker on purpose: the thing under test is the browser's
  // own localStorage, so parallel workers would be testing each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  // VITE_DEMO_MODE is deliberately NOT set. The app then starts with an empty
  // ledger, so every figure the test asserts can only have come from the
  // transaction the test entered — a seeded demo would hide an app that saved
  // nothing at all behind numbers that were already there.
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
