import { test as base, expect, type Page } from '@playwright/test'
import { isApiUrl } from './apiIsolation'
import { AuthMock } from './authMock'

/**
 * The project's Playwright `test`: identical to the stock one, plus an automatic `authMock` that
 * answers `/api/v1/**` for every test (the E2E suite runs the production build without a backend), and an
 * automatic `apiGuard` that blocks any API request the page mock did not handle. EITHER an escaped or an
 * unmocked request fails the test. Specs import `test` / `expect` from here instead of `@playwright/test`
 * (without the guard an escape still stops at the tripwire and fails the run: `apiIsolation.ts`).
 */
const mocks = new WeakMap<Page, AuthMock>()

/**
 * API requests that got past the page mock: `page.unroute`, `route.fallback()` past the last handler,
 * another page of the context, or a path outside `/api/v1`. They are aborted in the browser. Context
 * routes run only after every page route, so a mocked request never gets here.
 */
export class ApiGuard {
  readonly escapes: string[] = []

  /** For the isolation spec only: what was caught on purpose, removed so it does not fail the test. */
  takeEscapes(): string[] {
    return this.escapes.splice(0)
  }
}

export const test = base.extend<{ apiGuard: ApiGuard; authMock: AuthMock }>({
  apiGuard: [
    async ({ context }, use) => {
      const guard = new ApiGuard()
      await context.route(isApiUrl, async (route) => {
        const request = route.request()
        guard.escapes.push(`${request.method()} ${new URL(request.url()).pathname}`)
        await route.abort('blockedbyclient')
      })
      await use(guard)
      expect(guard.escapes, 'API requests escaped the page mock (blocked by the guard)').toEqual([])
    },
    { auto: true },
  ],
  authMock: [
    // `apiGuard` is listed so that it is installed first and checked last.
    async ({ page, baseURL, apiGuard }, use) => {
      void apiGuard
      const mock = new AuthMock(baseURL ?? 'http://127.0.0.1:4173')
      await mock.install(page)
      mocks.set(page, mock)
      await use(mock)
      expect(mock.unmocked, 'API calls with no mock (add one to the shared mock; never ignore them)').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/** The mock backend installed for this page (throws if a spec forgot to use the project's `test`). */
export function mockFor(page: Page): AuthMock {
  const mock = mocks.get(page)
  if (!mock) throw new Error('No AuthMock for this page: import { test } from e2e/helpers/test')
  return mock
}
