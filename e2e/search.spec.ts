import { expect, test } from './helpers/test'
import type { Page } from '@playwright/test'
import { expectPage, openApp } from './helpers/app'

const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search B-17 Portal' })
const resultCount = (page: Page) => page.getByText(/^\d+ results?( for “.*”)?$/)

test.describe('Search: URL is the source of truth', () => {
  test('a direct URL renders the matching, filtered state', async ({ page }) => {
    await openApp(page, '/search?q=karahi&type=business', 'Search / Explore')
    await expect(searchBox(page)).toHaveValue('karahi')
    await expect(page.getByRole('radio', { name: 'Directory' })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Preview Karahi Junction' })).toBeVisible()
  })

  test('typing commits to the URL, and Back / Forward / reload restore it', async ({ page }) => {
    await openApp(page, '/search', 'Search / Explore')
    await searchBox(page).fill('solar')
    await expect(page).toHaveURL(/[?&]q=solar/)
    await expect(page.getByRole('button', { name: 'Preview Sunrise Solar Solutions' })).toBeVisible()

    // The open suggestion list overlays the filter row (normal combobox behavior); dismiss it, then change type.
    await searchBox(page).press('Escape')
    await expect(page.getByRole('listbox', { name: 'Search suggestions' })).toBeHidden()
    await page.getByRole('radio', { name: 'Services' }).click()
    await expect(page).toHaveURL(/type=provider/)

    await page.reload()
    await expectPage(page, 'Search / Explore')
    await expect(searchBox(page)).toHaveValue('solar')
    await expect(page.getByRole('radio', { name: 'Services' })).toBeChecked()
  })

  test('"Clear" resets query, type and filters together', async ({ page }) => {
    await openApp(page, '/search?q=cake&type=business&vertical=food&foodCategory=bakeries', 'Search / Explore')
    await expect(page.getByRole('button', { name: /Remove Food category: Bakeries filter/ })).toBeVisible()
    await page.getByRole('button', { name: /clear/i }).first().click()
    await expect(page).toHaveURL(/\/search$/)
    await expect(searchBox(page)).toHaveValue('')
    await expect(page.getByRole('radio', { name: 'All' })).toBeChecked()
  })
})

test.describe('Search: suggestions combobox', () => {
  test('ArrowDown + Enter picks a suggestion; Escape closes without picking', async ({ page }) => {
    await openApp(page, '/search', 'Search / Explore')
    const input = searchBox(page)
    await input.fill('kara')
    const list = page.getByRole('listbox', { name: 'Search suggestions' })
    await expect(list).toBeVisible()
    await expect(input).toHaveAttribute('aria-expanded', 'true')

    await input.press('Escape')
    await expect(list).toBeHidden()
    await expect(input).toHaveValue('kara')

    await input.press('ArrowDown')
    await expect(list).toBeVisible()
    const first = list.getByRole('option').first()
    await expect(first).toHaveAttribute('aria-selected', 'true')
    const label = (await first.innerText()).split('\n')[0]
    await input.press('Enter')
    await expect(list).toBeHidden()
    await expect(input).toHaveValue(label)
    await expect(page).toHaveURL(/[?&]q=/)
  })

  test('clicking a suggestion commits it (and its type) to the URL', async ({ page }) => {
    await openApp(page, '/search', 'Search / Explore')
    await searchBox(page).fill('solar')
    await page.getByRole('listbox', { name: 'Search suggestions' }).getByRole('option').first().click()
    await expect(page).toHaveURL(/[?&]q=/)
    await expect(resultCount(page)).toBeVisible()
  })
})

test.describe('Search: Food & Dining vs General businesses', () => {
  test('the Business Type filter scopes results, and Food adds its own filters', async ({ page }) => {
    await openApp(page, '/search?type=business', 'Search / Explore')
    // Desktop shows the inline controls (the mobile project covers the sheet).
    const type = page.getByRole('combobox', { name: 'Business Type' })

    await type.selectOption('food')
    await expect(page).toHaveURL(/vertical=food/)
    await expect(page.getByRole('button', { name: 'Preview Karahi Junction' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' })).toHaveCount(0)

    await page.getByRole('combobox', { name: 'Food Category' }).selectOption('bakeries')
    await expect(page).toHaveURL(/foodCategory=bakeries/)
    await expect(page.getByRole('button', { name: 'Preview Capital Bakers' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preview Karahi Junction' })).toHaveCount(0)

    await page.getByRole('combobox', { name: 'Service' }).selectOption('delivery')
    await expect(page).toHaveURL(/service=delivery/)

    // Switching back to General drops every Food-only filter in the same step.
    await type.selectOption('general')
    await expect(page).toHaveURL(/vertical=general/)
    await expect(page).not.toHaveURL(/foodCategory=|service=/)
    await expect(page.getByRole('button', { name: 'Preview Capital Bakers' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' })).toBeVisible()
  })

  test('an unknown service in the URL is dropped; an unknown Food category is an honest empty result', async ({ page }) => {
    // `service` is a closed set, so an invalid value is never sent. A Food CATEGORY is open data now
    // (an admin can add one), so the server decides: it finds nothing for an unknown slug - not an error.
    await openApp(page, '/search?type=business&vertical=food&service=teleport', 'Search / Explore')
    await expect(page.getByRole('button', { name: 'Preview Karahi Junction' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Remove Service/ })).toHaveCount(0)
    await openApp(page, '/search?type=business&vertical=food&foodCategory=not-a-category', 'Search / Explore')
    await expect(page.getByText('0 results')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No results found' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})

test.describe('Search: results, empty and quick look', () => {
  test('a search with no matches says what was searched and offers real next steps', async ({ page }) => {
    await openApp(page, '/search?q=zzzxqv&type=property', 'Search / Explore')
    await expect(page.getByText('0 results for “zzzxqv”')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No Property results for “zzzxqv”' })).toBeVisible()
    await page.getByRole('button', { name: 'Search all of B-17' }).click()
    await expect(page).not.toHaveURL(/type=property/)
    await expect(page.getByRole('heading', { name: /No results for/ })).toBeVisible()
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(page).not.toHaveURL(/q=/)
    await expect(resultCount(page)).toBeVisible()
  })

  test('a card exposes one preview control and an independent Save control (no nested interactive)', async ({ page }) => {
    await openApp(page, '/search?q=pharmacy&type=business', 'Search / Explore')
    const preview = page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' })
    await expect(preview).toBeVisible()
    // Regression for the Phase 9M finding: Save must not live INSIDE the preview button.
    await expect(preview.getByRole('button')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save B-17 Family Pharmacy' })).toBeVisible()

    // Mouse: preview opens the dialog, Escape closes it and returns focus to the trigger.
    await preview.click()
    const dialog = page.getByRole('dialog', { name: 'B-17 Family Pharmacy' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(preview).toBeFocused()

    // Keyboard: the preview control is reachable and Enter opens it.
    await preview.press('Enter')
    await expect(dialog).toBeVisible()
  })

  test('Save on a logged-out visitor sends them to Log In (never opens the preview)', async ({ page }) => {
    await openApp(page, '/search?q=pharmacy&type=business', 'Search / Explore')
    await page.getByRole('button', { name: 'Save B-17 Family Pharmacy' }).click()
    await expectPage(page, 'Log In')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('a failing search shows an error with Try again - never an empty list - and recovers', async ({ page }) => {
    let healthy = false
    await page.route('**/api/v1/search?*', (route) => {
      if (healthy || new URL(route.request().url()).searchParams.get('limit') !== '12') return route.fallback()
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal_error', message: 'x', details: [], requestId: 'r' } }),
      })
    })
    await openApp(page, '/search?q=pharmacy&type=business', 'Search / Explore')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByText('Search unavailable')).toBeVisible()
    await expect(page.getByText(/No .*results/)).toHaveCount(0)
    healthy = true
    await page.getByRole('button', { name: /try again/i }).click()
    await expect(page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
