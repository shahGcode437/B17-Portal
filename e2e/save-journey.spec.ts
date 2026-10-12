import { expect, test } from '@playwright/test'
import { expectPage, openApp, signIn } from './helpers/app'

/**
 * Core resident journey: Home → Search → result → detail → Save → Saved → unsave.
 * Saving is auth-gated, so a logged-out Save sends the visitor to Log In and back.
 */
test('Home → Search → preview → detail → Save → Saved → unsave', async ({ page }) => {
  await openApp(page, '/')

  // Home: search from the hero.
  await page.getByRole('searchbox', { name: 'Search B-17 Portal' }).fill('pharmacy')
  await page.getByRole('button', { name: 'Search', exact: true }).first().click()
  await expect(page).toHaveURL(/\/search\?q=pharmacy/)
  await expectPage(page, 'Search / Explore')

  // The result card has ONE preview control; opening it shows the quick-look dialog.
  const card = page.getByRole('button', { name: 'Preview B-17 Family Pharmacy' })
  await expect(card).toBeVisible()
  await card.click()
  const dialog = page.getByRole('dialog', { name: 'B-17 Family Pharmacy' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'View Profile' }).click()

  // Detail page.
  await expect(page).toHaveURL(/\/businesses\/business-/)
  await expectPage(page, 'B-17 Family Pharmacy')

  // Saving while logged out sends us to Log In (preserving the page), then back.
  await page.getByRole('button', { name: 'Save B-17 Family Pharmacy' }).click()
  await expectPage(page, 'Log In')
  await signIn(page, 'Ayesha Khan')
  await expectPage(page, 'B-17 Family Pharmacy')

  // Logged in: Save toggles (pressed state is exposed, not just colour).
  const save = page.getByRole('button', { name: 'Save B-17 Family Pharmacy' })
  await save.click()
  await expect(page.getByRole('button', { name: 'Remove B-17 Family Pharmacy from saved' })).toHaveAttribute('aria-pressed', 'true')

  // Saved page shows it; removing it empties the page.
  await page.goto('/profile/saved')
  // (full load wipes in-memory auth, so the guard sends us to Log In; sign in again and follow `from`)
  await expectPage(page, 'Log In')
  await signIn(page, 'Ayesha Khan')
  await expectPage(page, 'Saved')
  // Saved items persist in localStorage, so the earlier save survived the reload.
  await expect(page.getByRole('button', { name: 'Remove B-17 Family Pharmacy from saved' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove B-17 Family Pharmacy from saved' }).click()
  await expect(page.getByRole('heading', { name: 'Nothing saved yet' })).toBeVisible()
})
