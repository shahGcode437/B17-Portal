import { expect, type Page } from '@playwright/test'
import { expectPage, navigateInApp, openApp, signIn } from './app'

/**
 * Role flows shared by the Professional / Admin specs. The Professional and Admin sessions live in
 * memory, so these helpers only ever move with in-app navigation after the first page load.
 */

/** Public header → "List Your Business" → (guard) Log In → back to the Professional workspace. */
export async function enterProfessionalWorkspace(page: Page, name: string) {
  await openApp(page, '/')
  // The header link is icon-only below `xl` but always named; the footer has a longer, different link.
  await page.getByRole('banner').getByRole('link', { name: 'List Your Business', exact: true }).click()
  await expectPage(page, 'Log In') // the workspace guard sent us here, remembering where we were going
  await signIn(page, name)
  await expectPage(page, 'Overview')
  await expect(page).toHaveURL(/\/provider$/)
}

/** Admin Login (demo) → Admin Dashboard. The Admin area has no public link, so this navigates in-app. */
export async function enterAdmin(page: Page) {
  await navigateInApp(page, '/admin/login', 'Admin Login')
  await page.getByRole('button', { name: 'Continue as Admin (Demo)' }).click()
  await expectPage(page, 'Admin Dashboard')
}

export async function openListingReview(page: Page) {
  await navigateInApp(page, '/admin/moderation', 'Listing Review')
}

export async function openMyListings(page: Page) {
  await navigateInApp(page, '/provider/listings', 'Listings')
}
