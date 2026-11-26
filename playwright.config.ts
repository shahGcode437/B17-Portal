import { defineConfig, devices } from '@playwright/test'
import { ESCAPES_PATH, TRIPWIRE_ORIGIN, TRIPWIRE_PORT } from './e2e/helpers/apiIsolation'

/**
 * Browser E2E (Phase 9M). Production-oriented and deterministic:
 *  - the app is BUILT and served by `vite preview` bound explicitly to 127.0.0.1 — `localhost` is
 *    deliberately avoided because it can resolve to IPv6 (::1) in one process and IPv4 in another
 *    (the Vite dev server vs. the Playwright browser on Windows), which refuses the connection;
 *  - `baseURL` uses the same explicit IPv4 address, so Windows, macOS and CI behave identically.
 * Projects: desktop Chromium + one mobile Chromium profile for functional specs (service worker
 * BLOCKED, so caching cannot make them flaky), and a dedicated PWA project with the worker ALLOWED.
 *
 * API ISOLATION: this lane has no backend and must never reach one, not even a developer's local API on
 * :8000 (which `vite preview` would proxy to by default). The preview server's `/api` proxy is forced to a
 * dedicated tripwire that refuses and records everything; neither server is ever reused (a reused preview
 * keeps its own proxy target, so a busy port fails the run instead); `global-setup.ts` verifies the wiring
 * before any test and `global-teardown.ts` fails the run on any request that got past the browser mock.
 * See docs/development/TESTING.md.
 */
const PORT = 4173
const BASE_URL = `http://127.0.0.1:${PORT}`
const PREVIEW = `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`
// CI builds in its own gate step first and sets PW_SKIP_BUILD=1 so the app is not built twice.
const SERVER_COMMAND = process.env.PW_SKIP_BUILD ? PREVIEW : `npm run build && ${PREVIEW}`

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  expect: { timeout: 10_000 },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: [
    {
      command: `node e2e/helpers/apiTripwire.mjs ${TRIPWIRE_PORT}`,
      url: `${TRIPWIRE_ORIGIN}${ESCAPES_PATH}`,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: SERVER_COMMAND,
      url: BASE_URL,
      timeout: 180_000,
      reuseExistingServer: false,
      // Both win over the shell and `.env` files: the proxy goes to the tripwire, and a build made here
      // calls the relative `/api/v1` (an absolute VITE_API_BASE_URL would bypass the proxy).
      env: { B17_API_PROXY_TARGET: TRIPWIRE_ORIGIN, VITE_API_BASE_URL: '' },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      name: 'desktop',
      testMatch: /e2e\/(?!mobile\/|pwa\/).*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
    },
    {
      name: 'mobile',
      testMatch: /e2e\/mobile\/.*\.spec\.ts$/,
      use: { ...devices['Pixel 7'], serviceWorkers: 'block' },
    },
    {
      name: 'pwa',
      testMatch: /e2e\/pwa\/.*\.spec\.ts$/,
      // Serial and with the service worker allowed: this project is where caching / offline behavior is tested.
      fullyParallel: false,
      workers: 1,
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow' },
    },
  ],
})
