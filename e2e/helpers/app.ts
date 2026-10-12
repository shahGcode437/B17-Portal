import { expect, type Page } from '@playwright/test'

/**
 * Shared E2E helpers. Rules for this folder (see docs/development/TESTING.md):
 *  - readiness is always a web-first assertion on something the user can see (a heading, a landmark,
 *    a status) — never a fixed wait, because every route is lazy-loaded;
 *  - locators are semantic (role / label / text), not CSS or test ids;
 *  - nothing here reaches into app internals, and nothing test-only exists in the shipped bundle.
 */

/** Opens `path` with a full page load and waits until the lazy route has rendered its page heading. */
export async function openApp(page: Page, path = '/', heading?: string | RegExp) {
  await page.goto(path)
  await expectPage(page, heading)
}

/** Waits for the current route to be rendered: exactly one h1 (optionally with a given name). */
export async function expectPage(page: Page, heading?: string | RegExp) {
  const h1 = page.getByRole('heading', { level: 1, ...(heading !== undefined && { name: heading }) })
  await expect(h1).toHaveCount(1)
  await expect(h1).toBeVisible()
}

/**
 * In-app (client-side) navigation without reloading. The prototype keeps listings and both login
 * sessions in memory, so a flow that crosses roles (Professional → Admin → Professional) must not
 * reload the page — a reload would correctly wipe that state. The Admin area has no link from the
 * public UI, so this drives React Router the way Back/Forward does: pushState + popstate.
 */
export async function navigateInApp(page: Page, path: string, heading?: string | RegExp) {
  await pushInApp(page, path)
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === path)
  await expectPage(page, heading)
}

/** Same client-side navigation, without asserting where it lands (for routes that redirect, e.g. guards). */
export async function pushInApp(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

/** Demo resident / professional sign-in through the real Log In form (the same screen guards redirect to). */
export async function signIn(page: Page, name: string) {
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', { name: 'Log In' }).click()
}

/** Logs in at /login with a full load, and lands on the home page. */
export async function signInFromLoginPage(page: Page, name: string) {
  await openApp(page, '/login', 'Log In')
  await signIn(page, name)
  await expectPage(page)
}

/** Reads a `<meta>` tag's content (name or property), or null when absent. */
export function metaContent(page: Page, key: string) {
  return page
    .locator(`meta[name="${key}"], meta[property="${key}"]`)
    .first()
    .getAttribute('content')
}

/**
 * Asserts the page's robots directive. `null` means "no robots tag at all", which is how this app
 * expresses "indexable" (the default). Web-first, so it retries until the route's SEO has applied.
 */
export async function expectRobots(page: Page, value: string | null) {
  const tag = page.locator('meta[name="robots"]')
  if (value === null) await expect(tag).toHaveCount(0)
  else await expect(tag).toHaveAttribute('content', value)
}
