import { test as base, expect, type Page } from '@playwright/test'
import { AuthMock } from './authMock'

/**
 * The project's Playwright `test`: identical to the stock one, plus an automatic `authMock` that
 * answers `/api/v1/**` for every test (the E2E suite runs the production build without a backend).
 * Specs import `test` / `expect` from here instead of `@playwright/test`.
 */
const mocks = new WeakMap<Page, AuthMock>()

export const test = base.extend<{ authMock: AuthMock }>({
  authMock: [
    async ({ page, baseURL }, use) => {
      const mock = new AuthMock(baseURL ?? 'http://127.0.0.1:4173')
      await mock.install(page)
      mocks.set(page, mock)
      await use(mock)
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
