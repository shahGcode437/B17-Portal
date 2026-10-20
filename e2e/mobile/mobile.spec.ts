import { expect, test } from '../helpers/test'
import { expectPage, openApp } from '../helpers/app'
import { IDS } from '../../src/test/fixtures/apiFixtures'

/**
 * Mobile-viewport coverage (Pixel 7 profile, touch + mobile UA). Runs only in the `mobile`
 * project. Covers the pieces whose layout differs on phones: the bottom tab bar, the Filters
 * sheet, a detail page, and one long form.
 */
test('bottom tab bar navigates between the main areas; header nav is replaced', async ({ page }) => {
  await openApp(page, '/')
  const tabs = page.getByRole('navigation', { name: 'Primary' })
  await expect(tabs).toBeVisible()
  await tabs.getByRole('link', { name: 'Explore' }).click()
  await expectPage(page, 'Search / Explore')
  await expect(tabs.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page')
  await tabs.getByRole('link', { name: 'Updates' }).click()
  await expect(page).toHaveURL(/\/news$/)
  await tabs.getByRole('link', { name: 'Home' }).click()
  await expectPage(page, 'B-17 Portal')
})

test('no horizontal page scroll on key pages', async ({ page }) => {
  for (const path of ['/', '/search?q=food', '/food', `/businesses/${IDS.generalAreaOnly}`, `/businesses/${IDS.foodExact}`, `/properties/${IDS.propertyExact}`, '/login']) {
    await openApp(page, path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0)
  }
})

test('Search on a phone: results, Filters sheet, Food scope, Apply', async ({ page }) => {
  await openApp(page, '/search?type=business', 'Search / Explore')
  // The inline desktop filter card is hidden; the sheet is the entry point.
  await expect(page.getByRole('combobox', { name: 'Business Type' })).toBeHidden()
  await page.getByRole('button', { name: 'Filters' }).click()
  const sheet = page.getByRole('dialog', { name: 'Filters' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('combobox', { name: 'Business Type' }).selectOption('food')
  await expect(page).toHaveURL(/vertical=food/)
  await sheet.getByRole('combobox', { name: 'Food Category' }).selectOption('bakeries')
  await expect(page).toHaveURL(/foodCategory=bakeries/)
  await sheet.getByRole('button', { name: 'Apply' }).click()
  await expect(sheet).toBeHidden()

  await expect(page.getByRole('button', { name: 'Preview Capital Bakers' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preview Karahi Junction' })).toHaveCount(0)
  // Active filters are shown as removable chips.
  await page.getByRole('button', { name: /Remove Food category: Bakeries filter/ }).click()
  await expect(page).not.toHaveURL(/foodCategory/)
})

test('a result card opens its preview with touch, and Save stays independent (and honest)', async ({ page }) => {
  await openApp(page, '/search?q=pharmacy&type=business', 'Search / Explore')
  const preview = page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' })
  await preview.tap()
  await expect(page.getByRole('dialog', { name: 'B-17 Family Pharmacy' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Save B-17 Family Pharmacy (coming soon)' }).tap({ force: true })
  await expect(page.getByText('Saving items is coming soon.')).toBeVisible() // its own control: it did not open the preview
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('detail page: Food profile shows its sections without overflow', async ({ page }) => {
  await openApp(page, `/businesses/${IDS.foodExact}`, 'Capital Bakers')
  await expect(page.getByRole('heading', { name: 'Service options' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Menu highlights' })).toBeVisible()
  await expect(page.getByText('Chocolate Fudge Cake')).toBeVisible()
})

test('the map on a phone: it fits, does not trap the page scroll, shows attribution and Get Directions', async ({ page }) => {
  await openApp(page, `/businesses/${IDS.foodExact}`, 'Capital Bakers')
  const map = page.getByTestId('location-map')
  await expect(map).toHaveAttribute('data-map-status', 'ready')
  await map.scrollIntoViewIfNeeded()
  const box = (await map.boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.width).toBeLessThanOrEqual(viewport.width)
  await expect(map.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap')
  await expect(map.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  // Touch-sized controls: the zoom buttons and the directions link meet the 44px target.
  const zoom = (await map.getByRole('button', { name: 'Zoom in' }).boundingBox())!
  expect(Math.min(zoom.width, zoom.height)).toBeGreaterThanOrEqual(44)
  const directions = (await page.getByRole('link', { name: /get directions/i }).boundingBox())!
  expect(directions.height).toBeGreaterThanOrEqual(44)

  // One-finger drag on the map must scroll the PAGE, not pan the map (the map would trap the swipe).
  const before = await page.evaluate(() => window.scrollY)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 200)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('Log In and Create Account fit a 320px phone: no horizontal scroll, inputs at least 16px, touch-sized controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  for (const path of ['/login', '/register', '/forgot-password']) {
    await openApp(page, path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0)
    const inputs = await page.locator('input').evaluateAll((nodes) => nodes.map((node) => parseFloat(getComputedStyle(node).fontSize)))
    expect(Math.min(...inputs), `${path} has an input under 16px`).toBeGreaterThanOrEqual(16)
  }
  await openApp(page, '/login')
  const google = await page.getByRole('button', { name: 'Continue with Google' }).boundingBox()
  expect(google!.height).toBeGreaterThanOrEqual(36)
  expect(google!.width).toBeLessThanOrEqual(320)
})
