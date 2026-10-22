import { expect, test, type Page } from '@playwright/test'
import { expectH1, stubTiles, WEB } from './helpers/stack'
import { publicGet } from './helpers/ui'

/**
 * Journeys 37-39: the Phase 12G public reads still work against the real backend after the writes
 * (Home, Search, suggestions, categories, every detail kind, News), the URL-as-state search rules, and the
 * Food & Dining rules. Read-only: it creates nothing.
 */
test.beforeEach(async ({ context }) => {
  await stubTiles(context)
})

const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search B-17 Portal' })
const resultCount = (page: Page) => page.getByText(/^\d+ results?( for “.*”)?$/)

/** Collects console errors and failed API responses (a regression guard for every page below). */
function watch(page: Page) {
  const problems: string[] = []
  page.on('console', (m) => {
    // An anonymous visitor's /auth/me answers 401 - the browser logs that as a failed resource; it is expected.
    if (m.type() === 'error' && !/favicon|OpenStreetMap|tile\.openstreetmap|status of 401/i.test(m.text())) problems.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/') && r.status() >= 500) problems.push(`${r.status()} ${r.url()}`)
  })
  return problems
}

async function firstHit(query: string): Promise<{ id: string; item: Record<string, any> }> {
  const { body } = await publicGet(`/search?${query}&limit=1`)
  const hit = body.data[0] as { item: Record<string, any> }
  expect(hit, `no seeded result for ${query}`).toBeTruthy()
  return { id: hit.item.id as string, item: hit.item }
}

test('Home loads with its sections and no errors', async ({ page }) => {
  const problems = watch(page)
  await page.goto('/')
  await expectH1(page, 'B-17 Portal')
  await expect(page.getByRole('link', { name: /Services/ }).first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(problems).toEqual([])
})

test('Search: results and count come from the backend; suggestions work; a category read is real', async ({ page }) => {
  await page.goto('/search?q=solar')
  await expectH1(page, 'Search / Explore')
  await expect(page.getByRole('button', { name: 'Preview Sunrise Solar Solutions' })).toBeVisible()
  const api = await publicGet('/search?q=solar&limit=12')
  await expect(resultCount(page)).toContainText(String(api.body.meta.total)) // the total is the backend's, not counted in the browser

  await page.goto('/search')
  await searchBox(page).fill('kara')
  const list = page.getByRole('listbox', { name: 'Search suggestions' })
  await expect(list).toBeVisible()
  await expect(list.getByRole('option').first()).toBeVisible()
  const categories = await publicGet('/categories?module=services')
  expect(categories.status).toBe(200)
  expect(categories.body.data.length).toBeGreaterThan(5)
})

test('Search state: the URL is the state (filters replace history entries); Back / Forward / reload restore it; a stale slow response cannot overwrite a newer search', async ({ page }) => {
  await page.goto('/')
  await page.goto('/search')
  await expectH1(page, 'Search / Explore')
  await searchBox(page).fill('solar')
  await expect(page).toHaveURL(/[?&]q=solar/)
  // Escape closes the open suggestion list (it would CLEAR the field if the list were not open yet): wait for it first.
  await expect(page.getByRole('listbox', { name: 'Search suggestions' })).toBeVisible()
  await searchBox(page).press('Escape')
  await expect(page.getByRole('listbox', { name: 'Search suggestions' })).toBeHidden()
  await page.getByRole('radio', { name: 'Services' }).click()
  await expect(page).toHaveURL(/type=provider/)
  // Filters update the URL in place (no history spam): Back leaves Search, Forward returns to the SAME state.
  await page.goBack()
  await expectH1(page, 'B-17 Portal')
  await page.goForward()
  await expect(page).toHaveURL(/q=solar.*type=provider|type=provider.*q=solar/)
  await expect(searchBox(page)).toHaveValue('solar')
  await expect(page.getByRole('radio', { name: 'Services' })).toBeChecked()
  await page.reload()
  await expect(searchBox(page)).toHaveValue('solar')
  await expect(page.getByRole('radio', { name: 'Services' })).toBeChecked()

  // Out-of-order responses: the FIRST query's answer is held back for 3 s and must not replace the newer one.
  await page.route(/\/api\/v1\/search\?.*q=karahi/, async (route) => {
    const real = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 3000))
    await route.fulfill({ response: real })
  })
  await page.goto('/search?q=karahi')
  await searchBox(page).fill('solar')
  await expect(page).toHaveURL(/[?&]q=solar/)
  await expect(page.getByRole('button', { name: 'Preview Sunrise Solar Solutions' })).toBeVisible()
  await page.waitForTimeout(4000) // the stale karahi response lands now
  await expect(page.getByRole('button', { name: 'Preview Sunrise Solar Solutions' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preview Karahi Junction' })).toHaveCount(0)
})

test('Area and Grade facets stay hidden (no facets endpoint) while deep-linked area / grade still filter', async ({ page }) => {
  await page.goto('/search?type=tutor')
  await expectH1(page, 'Search / Explore')
  await expect(page.getByRole('combobox', { name: 'Area' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /Grade/ })).toHaveCount(0)
  const tutor = await firstHit('type=tutor')
  const grade = String(tutor.item.grade)
  const total = (await publicGet('/search?type=tutor&limit=1')).body.meta.total as number
  const filtered = (await publicGet(`/search?type=tutor&grade=${encodeURIComponent(grade)}&limit=1`)).body.meta.total as number
  await page.goto(`/search?type=tutor&grade=${encodeURIComponent(grade)}`)
  await expectH1(page, 'Search / Explore')
  await expect(page.getByText(new RegExp(`^${filtered} results?`))).toBeVisible()
  expect(filtered).toBeLessThanOrEqual(total)
  await expect(page.getByRole('button', { name: /Remove .*filter/ }).first()).toBeVisible() // a removable chip
})

test('every detail kind opens from the real backend: Provider, Business, Tutor, Property, Food', async ({ page }) => {
  const problems = watch(page)
  const cases: [string, string, string][] = [
    ['provider', '/providers/', 'type=provider'],
    ['business', '/businesses/', 'type=business&vertical=general'],
    ['tutor', '/tutors/', 'type=tutor'],
    ['property', '/properties/', 'type=property'],
    ['food', '/businesses/', 'type=business&vertical=food'], // Food is a Business: the same canonical route
  ]
  for (const [label, prefix, query] of cases) {
    const hit = await firstHit(query)
    const name = String(hit.item.name ?? hit.item.title)
    await page.goto(`${prefix}${hit.id}`)
    await expectH1(page, name)
    await page.waitForLoadState('networkidle')
    expect(problems, label).toEqual([])
  }
})

test('Food stays a Business (vertical = food, /businesses/:id) with no cart, ordering, payment or review UI', async ({ page }) => {
  const food = await firstHit('type=business&vertical=food')
  expect(food.item.kind).toBe('business')
  expect(food.item.vertical).toBe('food')
  await page.goto(`/businesses/${food.id}`)
  await expectH1(page, String(food.item.name))
  const body = (await page.locator('body').innerText()).toLowerCase()
  for (const banned of ['add to cart', 'checkout', 'order now', 'place order', 'pay now', 'write a review', 'rate this']) expect(body, banned).not.toContain(banned)
  await expect(page.getByRole('button', { name: /cart|checkout|order now/i })).toHaveCount(0)
})

test('News: list and detail come from the backend', async ({ page }) => {
  await page.goto('/news')
  await expectH1(page, /News/)
  const article = (await publicGet('/news?limit=1')).body.data[0] as { id: string; title: string }
  await page.goto(`/news/${article.id}`)
  await expectH1(page, article.title)
  expect((await publicGet(`/news/${article.id}`)).status).toBe(200)
  void WEB
})
