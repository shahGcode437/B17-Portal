import { expect, mockFor, test } from '../helpers/test'
import { expectPage, openApp, signIn, signInFromLoginPage } from '../helpers/app'
import { IDS } from '../../src/test/fixtures/apiFixtures'
import type { Page } from '@playwright/test'

/**
 * Phase 12S, S3 on a phone (Pixel 7 profile, touch): the three confirmed bugs where they are most visible - the
 * footer is the only place a phone offers "List Your Business", the bottom tab bar covers the page end, and a slow
 * network is the norm.
 */
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))

async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => scrollY(page)).toBeGreaterThan(100)
}

test('phone: a footer link opens its page at the top, and so does the logo', async ({ page }) => {
  await openApp(page, '/', 'B-17 Portal')
  await scrollToBottom(page)
  await page.locator('footer').getByRole('link', { name: 'Education', exact: true }).click()
  await expect(page).toHaveURL(/\/education$/)
  await expect.poll(() => scrollY(page)).toBe(0)

  await scrollToBottom(page)
  await page.locator('footer').getByRole('link', { name: 'B-17 Portal home' }).click()
  await expectPage(page, 'B-17 Portal')
  await expect.poll(() => scrollY(page)).toBe(0)
})

test('phone: the footer "List Your Business" asks an anonymous visitor to log in, and a resident for a professional profile', async ({ page }) => {
  await openApp(page, '/', 'B-17 Portal')
  await page.locator('footer').getByRole('link', { name: 'List Your Business / Service' }).click()
  await expectPage(page, 'Log In')

  await signIn(page, 'Rana Resident', 'resident')
  await expectPage(page, 'Professional profile needed') // returnTo: back to the Professional area, which now asks for the profile
  await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toHaveCount(0)
  const box = (await page.getByRole('button', { name: 'Create a professional profile' }).boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(36)
})

test('phone: Request Service tapped while the session check is still running does not bounce to Log In', async ({ page }) => {
  await signInFromLoginPage(page, 'Rana Resident')
  const visited: string[] = []
  page.on('framenavigated', (frame) => frame === page.mainFrame() && visited.push(new URL(frame.url()).pathname))
  mockFor(page).meDelayMs = 1500
  await page.goto(`/providers/${IDS.provider}`, { waitUntil: 'commit' })
  await page.getByRole('button', { name: 'Request Service' }).tap()
  await expect(page.getByRole('dialog', { name: /^Request / })).toBeVisible({ timeout: 10_000 })
  expect(visited).not.toContain('/login')
})

test('phone: tapping the exact map pin opens Google Maps in a new tab (same destination as Get Directions)', async ({ page }) => {
  await page.context().route('https://www.google.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Google Maps (stub)</title>' })
  )
  await openApp(page, `/businesses/${IDS.foodExact}`, 'Capital Bakers')
  const map = page.getByTestId('location-map')
  await expect(map).toHaveAttribute('data-map-status', 'ready')
  await map.scrollIntoViewIfNeeded()
  const pin = map.getByRole('link', { name: 'Open this location in Google Maps' })
  const href = (await page.getByRole('link', { name: /get directions/i }).getAttribute('href'))!
  await expect(pin).toHaveAttribute('href', href)
  const [opened] = await Promise.all([page.context().waitForEvent('page'), pin.tap()])
  await opened.waitForLoadState()
  expect(opened.url()).toBe(href)
  await opened.close()
  await expect(page).toHaveURL(new RegExp(`/businesses/${IDS.foodExact}$`))
})
