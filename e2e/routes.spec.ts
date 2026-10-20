import { expect, test } from './helpers/test'
import { expectPage, openApp } from './helpers/app'
import { IDS } from '../src/test/fixtures/apiFixtures'

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
  [`/news/${IDS.news}`, 'B-17 Community Park Cleanup Drive This Weekend'],
  [`/businesses/${IDS.generalAreaOnly}`, 'B-17 Family Pharmacy'],
  [`/businesses/${IDS.foodExact}`, 'Capital Bakers'],
  [`/providers/${IDS.provider}`, 'Sunrise Solar Solutions'],
  [`/tutors/${IDS.tutorApproximate}`, 'Sara M.'],
  [`/properties/${IDS.propertyExact}`, '5 Marla House - B-17 Block C'],
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
    ['/providers/does-not-exist', /not found/i],
    ['/tutors/does-not-exist', /not found/i],
    ['/news/does-not-exist', 'Content not found'],
    // A real id on the wrong route is the same "not found": each kind has one canonical route.
    [`/businesses/${IDS.tutorApproximate}`, 'Business not found'],
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
