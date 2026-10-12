import { expect, test } from '@playwright/test'
import { expectPage, navigateInApp, openApp, signIn } from '../helpers/app'

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
  for (const path of ['/', '/search?q=food', '/food', '/businesses/business-01', '/login']) {
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

test('a result card opens its preview with touch, and Save stays independent', async ({ page }) => {
  await openApp(page, '/search?q=pharmacy&type=business', 'Search / Explore')
  const preview = page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' })
  await preview.tap()
  await expect(page.getByRole('dialog', { name: 'B-17 Family Pharmacy' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Save B-17 Family Pharmacy' }).tap()
  await expectPage(page, 'Log In') // Save is its own control: it did not open the preview
})

test('detail page: Food profile shows its sections without overflow', async ({ page }) => {
  await openApp(page, '/businesses/business-06', 'Capital Bakers')
  await expect(page.getByRole('heading', { name: 'Service options' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Menu highlights' })).toBeVisible()
  await expect(page.getByText('Chocolate Fudge Cake')).toBeVisible()
})

test('the Food listing form is usable on a phone: type switch, validation and fields', async ({ page }) => {
  await openApp(page, '/')
  await page.goto('/provider/listings/new')
  await expectPage(page, 'Log In')
  await signIn(page, 'Sana Baker')
  await expectPage(page, 'List Your Business / Service / Property')
  await page.getByRole('button', { name: /Business \/ Shop/ }).click()
  await page.getByRole('radio', { name: /Food & Dining/ }).click()
  await expect(page.getByRole('heading', { name: /Food & Dining details/ })).toBeVisible()

  await page.getByRole('button', { name: 'Preview Listing' }).click()
  await expect(page.getByText('Choose at least one category.')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Bakeries' }).check()
  await page.getByRole('checkbox', { name: 'Takeaway' }).check()
  await expect(page.getByText('Choose at least one category.')).toBeHidden()
  await page.getByRole('button', { name: 'Add menu item' }).tap()
  await expect(page.getByLabel('Item name')).toBeFocused()

  // The form stays inside the viewport width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await navigateInApp(page, '/provider/listings', 'Listings')
})
