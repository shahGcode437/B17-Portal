import type { Page } from '@playwright/test'
import { expect, test } from './helpers/test'
import { openApp } from './helpers/app'
import { PROBE_PREFIX, TRIPWIRE_HEADER } from './helpers/apiIsolation'

/**
 * Regression tests for the API isolation of the mocked lane (docs/development/TESTING.md): no request
 * can reach a real API, and a request that leaves the mock fails its test.
 *
 * The tests that make a request escape ON PURPOSE take the record away (`takeEscapes`, `unmocked.splice`)
 * so they can assert on it. The two `test.fail` cases do NOT: they pass only while the fixtures fail them.
 */

/** What a `fetch` made by the page itself gets back. */
function fetchFromPage(page: Page, path: string) {
  return page.evaluate(async (url) => {
    try {
      const response = await fetch(url, { credentials: 'include' })
      return { status: response.status, headers: Object.fromEntries(response.headers) }
    } catch {
      return 'network-error' as const
    }
  }, path)
}

test('the preview server forwards /api to the tripwire, never to a real API', async ({ request }) => {
  // An APIRequestContext call skips every browser route, so this is the proxy itself.
  const response = await request.get(`${PROBE_PREFIX}/proxy`)

  expect(response.headers()[TRIPWIRE_HEADER]).toBe('1')
  expect(response.status()).toBe(502) // never a success
  expect(await response.json()).toMatchObject({ error: { code: 'e2e_unmocked_api' } })
})

test('with the page mock removed, an API request is blocked in the browser and recorded', async ({ page, apiGuard }) => {
  await openApp(page, '/')
  await page.unroute('**/api/v1/**')

  expect(await fetchFromPage(page, '/api/v1/auth/me')).toBe('network-error')

  expect(apiGuard.takeEscapes()).toContain('GET /api/v1/auth/me')
})

test('the reconnect session re-check is covered: it cannot leave the browser', async ({ page, context, authMock, apiGuard }) => {
  // The request that escaped on 2026-11-27: offline, then back online with the mock gone.
  authMock.meUnreachable = true
  await openApp(page, '/')
  await expect.poll(() => authMock.calls.filter((call) => call.path === '/auth/me').length).toBeGreaterThan(0)
  await page.unroute('**/api/v1/**')
  await context.setOffline(true)

  await context.setOffline(false) // the app re-checks the session by itself

  await expect.poll(() => apiGuard.escapes).toContain('GET /api/v1/auth/me')
  apiGuard.takeEscapes()
})

test('a second page of the context and a path outside /api/v1 are covered too', async ({ page, context, apiGuard }) => {
  await openApp(page, '/')
  const other = await context.newPage() // no page mock is installed on it
  await other.goto('/robots.txt')

  expect(await fetchFromPage(other, '/api/v1/categories')).toBe('network-error')
  expect(await fetchFromPage(page, '/api/internal')).toBe('network-error')

  expect(apiGuard.takeEscapes()).toEqual(['GET /api/v1/categories', 'GET /api/internal'])
})

test('route.continue() skips the browser guard but still cannot get past the tripwire', async ({ page }) => {
  await openApp(page, '/')
  await page.route(`**${PROBE_PREFIX}/continue`, (route) => route.continue())

  const answer = await fetchFromPage(page, `${PROBE_PREFIX}/continue`)

  expect(answer).toMatchObject({ status: 502, headers: { [TRIPWIRE_HEADER]: '1' } })
})

test('a call the mock does not know is refused and recorded, never answered quietly', async ({ page, authMock }) => {
  await openApp(page, '/') // signed out: the routers alone would answer 401, like a real refusal

  expect(await fetchFromPage(page, '/api/v1/no-such-endpoint')).toMatchObject({ status: 501 })
  const written = await page.evaluate(async () => (await fetch('/api/v1/no-such-endpoint', { method: 'POST' })).status)

  expect(written).toBe(501)
  expect(authMock.unmocked.splice(0)).toEqual(['GET /no-such-endpoint', 'POST /no-such-endpoint'])
})

test.fail('MUST FAIL: a test whose request escapes the page mock', async ({ page }) => {
  await openApp(page, '/')
  await page.unroute('**/api/v1/**')
  await fetchFromPage(page, '/api/v1/auth/me')
})

test.fail('MUST FAIL: a test that makes a call the mock does not know', async ({ page }) => {
  await openApp(page, '/')
  await fetchFromPage(page, '/api/v1/no-such-endpoint')
})
