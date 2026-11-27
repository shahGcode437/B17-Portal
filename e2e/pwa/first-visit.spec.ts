import type { Page } from '@playwright/test'
import { expect, test } from '../helpers/test'
import { expectPage, openApp } from '../helpers/app'

/**
 * Offline RIGHT AFTER A FIRST VISIT: the worker has only what it precached while installing. The other offline
 * tests reload once online first, which re-caches the app's files through the worker and hid that a reload here
 * showed a blank page: the files were precached by requests WITHOUT an `Origin` header, the page asks for them
 * WITH one (`crossorigin` scripts), and `vite preview` answers `Vary: Origin`, so every lookup missed.
 */

async function waitForControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    }
  })
}

test('the app starts offline after a first visit, with no online reload in between', async ({ page, context, authMock }) => {
  await openApp(page, '/')
  await waitForControl(page)
  const precached = await page.evaluate(async () => {
    const worker = await (await fetch('/sw.js')).text()
    return JSON.parse(/const PRECACHE_URLS = (\[[^\]]*\])/.exec(worker)![1]) as string[]
  })
  expect(precached.filter((url) => url.endsWith('.js')).length).toBeGreaterThan(1)

  const failed: string[] = []
  page.on('requestfailed', (request) => failed.push(new URL(request.url()).pathname))
  authMock.offline = true // the mock would answer even offline; the worker is what is under test
  await context.setOffline(true)
  await page.reload()

  await expectPage(page, 'B-17 Portal') // not a blank page
  await expect(page.getByRole('status').filter({ hasText: "You're offline" })).toBeVisible()
  expect(failed.filter((path) => precached.includes(path))).toEqual([]) // every precached file was served

  authMock.offline = false
  await context.setOffline(false)
  // The app re-checks the session on reconnect: wait for it, so no request is on its way as the page closes.
  await expect(page.getByRole('banner').getByRole('link', { name: 'Log in' })).toBeVisible()
})
