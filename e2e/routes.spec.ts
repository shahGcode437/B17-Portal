import { expect, test } from '@playwright/test'
import { expectPage, openApp } from './helpers/app'

/** Every public route must load directly from its URL (deep link / refresh / shared link) with exactly one h1. */
const PUBLIC_ROUTES: [path: string, heading: string | RegExp][] = [
  ['/', 'B-17 Portal'],
  ['/search', 'Search / Explore'],
  ['/services', /Services/],
  ['/directory', /Directory|Business/],
  ['/food', /Food/],
  ['/education', /Education|Tutor/],
  ['/property', /Property/],
  ['/news', /News/],
  ['/news/news-01', /.+/],
  ['/businesses/business-01', 'B-17 Family Pharmacy'],
  ['/providers/provider-solar-01', 'Sunrise Solar Solutions'],
  ['/tutors/tutor-physics-01', /.+/],
  ['/properties/property-01', '5 Marla House — B-17 Block C'],
  ['/coming-soon', /.+/],
  ['/login', 'Log In'],
  ['/register', 'Create Account'],
]

for (const [path, heading] of PUBLIC_ROUTES) {
  test(`direct load of ${path} renders one h1 and no error state`, async ({ page }) => {
    await openApp(page, path, heading)
    await expect(page.getByRole('heading', { name: /Something went wrong|This page couldn't load/ })).toHaveCount(0)
    await expect(page.getByRole('main')).toBeVisible()
  })
}

test.describe('unknown entities are handled, not crashed', () => {
  for (const [path, heading] of [
    ['/businesses/does-not-exist', 'Business not found'],
    ['/properties/does-not-exist', 'Property not found'],
  ] as const) {
    test(`${path} shows "${heading}" with one h1`, async ({ page }) => {
      await openApp(page, path, heading)
    })
  }

  test('an unknown route shows the 404 page', async ({ page }) => {
    await openApp(page, '/definitely/not/a/page', 'Page Not Found')
    await page.getByRole('link', { name: 'Back to Home' }).click()
    await expectPage(page, 'B-17 Portal')
  })
})

test('primary navigation reaches every section and marks the current one', async ({ page }) => {
  await openApp(page, '/')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  for (const [label, url] of [
    ['Services', /\/services$/],
    ['Directory', /\/directory$/],
    ['Food', /\/food$/],
    ['Education', /\/education$/],
    ['Property', /\/property$/],
    ['News & Updates', /\/news$/],
  ] as const) {
    await nav.getByRole('link', { name: label }).click()
    await expect(page).toHaveURL(url)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
  }
})

test('Back and Forward move through in-app history', async ({ page }) => {
  await openApp(page, '/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Food' }).click()
  await expect(page).toHaveURL(/\/food$/)
  await page.goBack()
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/)
  await expectPage(page, 'B-17 Portal')
  await page.goForward()
  await expect(page).toHaveURL(/\/food$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
})
