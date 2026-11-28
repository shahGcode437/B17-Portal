import { expect, test } from '../helpers/test'
import type { Page } from '@playwright/test'
import { expectPage, navigateInApp, openApp, pushInApp } from '../helpers/app'
import { IDS } from '../../src/test/fixtures/apiFixtures'

/**
 * PWA behavior with the service worker ALLOWED (this project only; every other project blocks it so
 * caching cannot influence functional tests). Runs serially in one browser context per test.
 *
 * Not automated: the OS/browser install dialog and the beforeinstallprompt heuristics — those are
 * browser UI. Install affordance logic is covered by the component tests (InstallPrompt.test.tsx).
 */

/** Resolves once the page is controlled by the active service worker (first load is uncontrolled until `clients.claim()`). */
async function waitForControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    }
  })
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}

test('the manifest is installable-shaped and linked from the page', async ({ page, request }) => {
  await openApp(page, '/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ display: 'standalone', start_url: '/', scope: '/' })
  const purposes = manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes}:${icon.purpose}`)
  expect(purposes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']))
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).ok(), icon.src).toBe(true)
  }
})

test('the service worker is served, registers, and takes control', async ({ page, request }) => {
  const sw = await request.get('/sw.js')
  expect(sw.ok()).toBe(true)
  expect(sw.headers()['content-type']).toMatch(/javascript/)
  expect(await sw.text()).not.toContain('__BUILD_ID__') // template placeholders were substituted at build time

  await openApp(page, '/')
  await waitForControl(page)
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)
  expect(scope).toMatch(/\/$/)
})

test('offline: cached pages still open and an offline notice shows', async ({ page, context }) => {
  // Visit pages while online so the worker caches the shell and the lazy chunks they use.
  await openApp(page, '/')
  await waitForControl(page)
  await page.reload()
  await expectPage(page, 'B-17 Portal')
  await page.goto('/search?q=pharmacy&type=business')
  await expectPage(page, 'Search / Explore')
  await expect(page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' })).toBeVisible()

  await context.setOffline(true)
  // Offline notice appears (permanent polite live region).
  await expect(page.getByRole('status').filter({ hasText: "You're offline" })).toBeVisible()

  // A page already visited still loads from the cached shell, and in-app browsing keeps working.
  await page.reload()
  await expectPage(page, 'Search / Explore')
  await expect(page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' })).toBeVisible()

  // Read-only browsing continues for already-loaded data: open the quick look.
  await page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' }).click()
  await expect(page.getByRole('dialog', { name: 'B-17 Family Pharmacy' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Reconnect: the notice goes away and normal navigation works.
  await context.setOffline(false)
  await expect(page.getByRole('status').filter({ hasText: "You're offline" })).toHaveCount(0)
  await page.goto('/food')
  await expectPage(page, /Food/)
})

test('offline: data reads fail visibly (no cached API data) while the shell still opens', async ({ page, context, authMock }) => {
  await openApp(page, '/')
  await waitForControl(page)
  await page.reload()
  await expectPage(page, 'B-17 Portal')
  // Visit the two routes while online so the worker has cached their (lazy) code - only the DATA must be missing offline.
  await navigateInApp(page, '/search?q=pharmacy&type=business', 'Search / Explore')
  await expect(page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' })).toBeVisible()
  await navigateInApp(page, `/businesses/${IDS.generalAreaOnly}`, 'B-17 Family Pharmacy')
  // The mock would answer even offline, so it fails like the network instead; the worker (network-only API) is
  // what is under test: anything it answered itself would never reach the mock. The mock is never removed.
  authMock.offline = true
  await context.setOffline(true)
  await page.goto('/search?q=pharmacy&type=business')
  await expectPage(page, 'Search / Explore') // the cached shell boots the SPA...
  await expect(page.getByRole('alert')).toBeVisible() // ...and the data read is an honest failure
  await expect(page.getByText('Search unavailable')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' })).toHaveCount(0)

  // Move inside the app, not with a second page load: an offline page being left can send its session re-check
  // while it is torn down, where no mock can intercept it (it reached the API tripwire about 1 run in 6).
  await pushInApp(page, `/businesses/${IDS.generalAreaOnly}`)
  await expect(page.getByText('Search unavailable')).toHaveCount(0) // the search page has gone
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Business not found' })).toHaveCount(0) // a failure is not "not found"
  authMock.offline = false // BEFORE reconnecting: the app re-checks the session the moment it is online again
  await context.setOffline(false)
})

test('map tiles are never cached by the worker, and no API response is stored', async ({ page, authMock }) => {
  await openApp(page, '/')
  await waitForControl(page)
  await navigateInApp(page, `/businesses/${IDS.foodExact}`, 'Capital Bakers')
  await expect(page.getByTestId('location-map')).toHaveAttribute('data-map-status', 'ready')
  await expect.poll(() => authMock.tileRequests.length).toBeGreaterThan(0)

  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
    }
    return urls
  })
  expect(cached.length).toBeGreaterThan(0) // the app shell IS cached...
  expect(cached.filter((url) => /openstreetmap|\/tile|\.png$/.test(url) && !url.includes('/icons/'))).toEqual([]) // ...tiles are not
  expect(cached.filter((url) => url.includes('/api/'))).toEqual([]) // ...and neither is any API response
})

test('the API is network-only: with the worker in control and no network, /api requests fail instead of returning the app shell', async ({ page, context, authMock }) => {
  await openApp(page, '/')
  await waitForControl(page)
  await page.reload()
  await waitForControl(page)
  authMock.offline = true // the mock would answer even offline; the worker is what is under test
  await context.setOffline(true)
  const outcome = await page.evaluate(async () => {
    try {
      const response = await fetch('/api/v1/auth/me', { credentials: 'include' })
      return `response ${response.status} ${response.headers.get('content-type')}`
    } catch {
      return 'network-error'
    }
  })
  authMock.offline = false
  await context.setOffline(false)

  expect(outcome).toBe('network-error') // never the cached index.html (200 text/html)
})

test('private grocery orders are never cached: offline they fail visibly instead of showing old data', async ({ page, context, authMock }) => {
  authMock.addAccount({ email: 'ayesha@example.org', displayName: 'Ayesha Khan' })
  const order = authMock.grocery.seed('ayesha@example.org')
  authMock.session = { email: 'ayesha@example.org', csrf: 'csrf-pwa' }
  await openApp(page, '/')
  await waitForControl(page)
  await page.reload() // as in the tests above: the app's files are cached once the worker serves the page
  await expectPage(page, 'B-17 Portal')
  await navigateInApp(page, '/profile/grocery', 'My Grocery Orders')
  await expect(page.getByText(order.reference)).toBeVisible()
  await navigateInApp(page, `/profile/grocery/${order.id}`, `Order ${order.reference}`)

  const cached = await page.evaluate(async () => {
    const found: string[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        const body = await (await cache.match(request))!.clone().text()
        if (request.url.includes('/api/') || body.includes('House 17, Street 4') || body.includes('+923001234567')) {
          found.push(request.url)
        }
      }
    }
    return found
  })
  expect(cached).toEqual([]) // no API response, and no delivery detail anywhere in a cache

  authMock.offline = true
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Refresh status' }).click()
  await expect(page.getByText(/Couldn't refresh/)).toBeVisible()
  await page.reload()
  // The cached app starts (so the next line proves something) and has no stored order to show.
  await expectPage(page, "We can't reach the server")
  await expect(page.getByText(order.reference)).toHaveCount(0)
  await expect(page.getByText('House 17, Street 4')).toHaveCount(0)
  authMock.offline = false
  await context.setOffline(false)
  // The app re-checks the session by itself on reconnect: wait for that to finish, so no request is still
  // on its way while the page closes (one that is can slip past the mock).
  await expectPage(page, `Order ${order.reference}`)
})

test('private staff grocery data is never cached or stored: offline nothing old is shown after a reload', async ({ page, context, authMock }) => {
  authMock.addAccount({ email: 'sana@example.org', displayName: 'Sana Staff', roles: ['moderator'], staffScopes: ['grocery'] })
  authMock.addAccount({ email: 'ayesha@example.org', displayName: 'Ayesha Khan' })
  const order = authMock.grocery.seed('ayesha@example.org')
  authMock.session = { email: 'sana@example.org', csrf: 'csrf-pwa-staff' }
  await openApp(page, '/')
  await waitForControl(page)
  await page.reload()
  await expectPage(page, 'B-17 Portal')
  await navigateInApp(page, '/admin/grocery', 'Grocery orders')
  await expect(page.getByText(order.reference)).toBeVisible()
  await navigateInApp(page, `/admin/grocery/${order.id}`, `Order ${order.reference}`)
  await page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Claim order' }).click()
  await expect(page.getByRole('region', { name: 'Actions' })).toContainText('Assigned to you')

  const kept = await page.evaluate(async () => {
    const found: string[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        const body = await (await cache.match(request))!.clone().text()
        if (request.url.includes('/api/') || body.includes('House 17, Street 4') || body.includes('+923001234567')) {
          found.push(request.url)
        }
      }
    }
    return {
      cached: found,
      storage: JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
      databases: (await indexedDB.databases()).length,
    }
  })
  expect(kept.cached).toEqual([])
  expect(kept.databases).toBe(0)
  for (const value of ['House 17, Street 4', '923001234567', 'Ayesha Khan', order.id]) expect(kept.storage).not.toContain(value)

  authMock.offline = true
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.getByText(/What's shown may be out of date/)).toBeVisible()
  await page.reload()
  await expectPage(page, "We can't reach the server")
  await expect(page.getByText(order.reference)).toHaveCount(0)
  await expect(page.getByText('House 17, Street 4')).toHaveCount(0)
  authMock.offline = false
  await context.setOffline(false)
  // Wait for the app's own re-check on reconnect, so nothing is still on its way when the page closes.
  await expectPage(page, `Order ${order.reference}`)
  await expect(page.getByRole('region', { name: 'Customer and delivery' })).toContainText('House 17, Street 4')
})

test('Super Admin settings and staff records are never cached or stored, and offline a reload shows none', async ({ page, context, authMock }) => {
  authMock.addAccount({ email: 'omar@example.org', displayName: 'Omar Admin', roles: ['admin'] })
  authMock.addAccount({ email: 'sana.grocer@example.org', displayName: 'Sana Grocer', roles: ['moderator'], staffScopes: ['grocery'] })
  authMock.admin.saveElsewhere({ serviceableBlocks: ['Private Test Block'] })
  authMock.session = { email: 'omar@example.org', csrf: 'csrf-pwa-admin' }
  await openApp(page, '/')
  await waitForControl(page)
  await page.reload()
  await expectPage(page, 'B-17 Portal')
  await navigateInApp(page, '/admin/grocery/settings', 'Grocery settings')
  await expect(page.getByRole('list', { name: 'Listed delivery blocks' })).toContainText('Private Test Block')
  await navigateInApp(page, '/admin/staff', 'Staff')
  await expect(page.getByRole('list', { name: 'Staff' })).toContainText('sana.grocer@example.org')

  const kept = await page.evaluate(async () => {
    const found: string[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        const body = await (await cache.match(request))!.clone().text()
        if (request.url.includes('/api/') || body.includes('sana.grocer@example.org') || body.includes('Private Test Block')) {
          found.push(request.url)
        }
      }
    }
    return {
      cached: found,
      storage: JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
      databases: (await indexedDB.databases()).length,
    }
  })
  expect(kept.cached).toEqual([])
  expect(kept.databases).toBe(0)
  for (const value of ['sana.grocer', 'Private Test Block', 'Sana Grocer']) expect(kept.storage).not.toContain(value)

  authMock.offline = true
  await context.setOffline(true)
  await expect(page.getByText(/What's shown may be out of date/)).toBeVisible()
  await page.reload()
  await expectPage(page, "We can't reach the server")
  await expect(page.getByText('sana.grocer@example.org')).toHaveCount(0)
  authMock.offline = false
  await context.setOffline(false)
  // Wait for the app's own re-check on reconnect, so nothing is still on its way when the page closes.
  await expectPage(page, 'Staff')
  await expect(page.getByRole('list', { name: 'Staff' })).toContainText('sana.grocer@example.org')
})
