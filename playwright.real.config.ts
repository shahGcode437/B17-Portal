import { defineConfig, devices } from '@playwright/test'

/**
 * REAL-STACK acceptance lane (Phase 12I): the React app (Vite dev server) -> FastAPI -> PostgreSQL.
 * No mock backend, no route interception of the happy path. It complements `playwright.config.ts`
 * (the deterministic mock-contract suite that runs in CI); it is NOT part of CI — it needs a running
 * local stack and needs the local API and the development verification helper (see docs/development/TESTING.md
 * "Real-stack lane" for the exact commands).
 *
 *  - Topology is the frozen development one: frontend http://127.0.0.1:5173, API http://127.0.0.1:8000.
 *    `127.0.0.1` for BOTH, never `localhost` (same-site cookie, AUTH_RBAC.md §5.1).
 *  - Serial and single-worker: the specs share one database and create / clean up their own `P12I`
 *    records (global teardown removes ONLY those).
 *  - Verification links come from the development helper `python -m app.cli.dev_verify`; no log file is read.
 */
const WEB = 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './e2e-real',
  outputDir: './test-results/real',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [['list']],
  expect: { timeout: 15_000 },
  globalSetup: './e2e-real/global-setup.ts',
  globalTeardown: './e2e-real/global-teardown.ts',
  use: {
    baseURL: WEB,
    actionTimeout: 20_000,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev', // the supported local run method: host, port, strictPort and the /api proxy live in vite.config.ts
    url: WEB,
    timeout: 120_000,
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    { name: 'desktop', testMatch: /e2e-real\/(?!mobile).*\.spec\.ts$/, use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' } },
    { name: 'mobile', testMatch: /e2e-real\/mobile\.spec\.ts$/, use: { ...devices['Pixel 7'], serviceWorkers: 'block' } },
  ],
})
