import { expect, test } from './helpers/test'
import { expectPage, expectRobots, metaContent, openApp, pushInApp, signIn } from './helpers/app'
import { enterAdmin } from './helpers/workspace'

test.describe('indexable public pages', () => {
  test('Home: real title and description, indexable, canonical to "/"', async ({ page, baseURL }) => {
    await openApp(page, '/')
    await expect(page).toHaveTitle('B-17 Portal | Local Services, Property, Food & More')
    expect(await metaContent(page, 'description')).toMatch(/hyperlocal platform .* B-17, Islamabad/)
    await expectRobots(page, null) // indexable = no robots restriction
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${baseURL}/`)
    expect(await metaContent(page, 'og:title')).toBe('B-17 Portal | Local Services, Property, Food & More')
  })

  test('a business detail page uses the business name in title and social tags', async ({ page }) => {
    await openApp(page, '/businesses/business-01', 'B-17 Family Pharmacy')
    await expect(page).toHaveTitle('B-17 Family Pharmacy | B-17 Portal')
    await expectRobots(page, null)
    expect(await metaContent(page, 'og:title')).toBe('B-17 Family Pharmacy | B-17 Portal')
    expect(await metaContent(page, 'description')).not.toBe('')
  })

  test('a provider detail page uses the provider name', async ({ page }) => {
    await openApp(page, '/providers/provider-solar-01', 'Sunrise Solar Solutions')
    await expect(page).toHaveTitle('Sunrise Solar Solutions | B-17 Portal')
    await expectRobots(page, null)
  })

  test('section pages carry their own titles', async ({ page }) => {
    await openApp(page, '/food')
    await expect(page).toHaveTitle(/Food/)
    await expectRobots(page, null)
  })
})

test.describe('non-indexable pages', () => {
  test('Search is "noindex, follow" with a stable canonical, whatever the query', async ({ page, baseURL }) => {
    await openApp(page, '/search?q=pharmacy&type=business', 'Search / Explore')
    await expect(page).toHaveTitle('Search B-17 | B-17 Portal')
    await expectRobots(page, 'noindex, follow')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${baseURL}/search`)
  })

  test('Log In, and the Professional and Admin areas are "noindex, nofollow" yet still titled', async ({ page }) => {
    await openApp(page, '/login', 'Log In')
    await expect(page).toHaveTitle('Log In | B-17 Portal')
    await expectRobots(page, 'noindex, nofollow')

    await signIn(page, 'Sara Pro')
    await expectPage(page)
    await pushInApp(page, '/provider')
    await expectPage(page, 'Overview')
    await expect(page).toHaveTitle('Professional Overview | B-17 Portal')
    await expectRobots(page, 'noindex, nofollow')

    await enterAdmin(page)
    await expect(page).toHaveTitle('Admin Dashboard | B-17 Portal')
    await expectRobots(page, 'noindex, nofollow')
  })

  test('metadata follows client-side navigation (indexable → noindex → indexable)', async ({ page }) => {
    await openApp(page, '/')
    await expectRobots(page, null)
    await page.getByRole('banner').getByRole('link', { name: 'Search' }).click()
    await expectPage(page, 'Search / Explore')
    await expectRobots(page, 'noindex, follow')
    await page.getByRole('banner').getByRole('link', { name: 'B-17 Portal home' }).click()
    await expectPage(page)
    await expect(page).toHaveTitle('B-17 Portal | Local Services, Property, Food & More')
    await expectRobots(page, null)
  })

  test('an unknown URL is a real 404 page: one h1, titled, never indexed', async ({ page }) => {
    await openApp(page, '/no/such/page', 'Page Not Found')
    await expect(page).toHaveTitle('Page Not Found | B-17 Portal')
    await expectRobots(page, 'noindex, nofollow')
    await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible()
  })
})

test('robots.txt and the web manifest are served', async ({ request }) => {
  const robotsTxt = await request.get('/robots.txt')
  expect(robotsTxt.ok()).toBe(true)
  expect(await robotsTxt.text()).toMatch(/User-agent:/i)
  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBe(true)
  expect(await manifest.json()).toMatchObject({ name: 'B-17 Portal', display: 'standalone', start_url: '/' })
})
