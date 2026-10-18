import { expect, type Page } from '@playwright/test'
import { expectPage, navigateInApp, openApp, pushInApp, signIn } from './app'

/**
 * Role flows shared by the Professional / Admin specs. Authentication is real (against the mock
 * backend), but listing and moderation DATA are still in-memory prototype state until their Phase 12
 * slices, so a flow that crosses roles (Professional → Admin → Professional) must not reload the
 * page — a reload would correctly wipe that data. After the first load these helpers therefore only
 * move with in-app navigation.
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

/**
 * Admin Login → Admin Dashboard, signing in with an account that has the backend `admin` role. The
 * Admin area has no public link, so this navigates in-app. If another account is signed in, it is
 * logged out first (one identity system: there is no separate admin session).
 */
export async function enterAdmin(page: Page) {
  await navigateInApp(page, '/admin/login', 'Admin Login')
  const switchAccount = page.getByRole('button', { name: 'Log out to switch account' })
  if (await switchAccount.isVisible()) await switchAccount.click()
  await expect(page.getByLabel('Email')).toBeVisible()
  await signIn(page, 'Demo Admin', 'admin')
  await expectPage(page, 'Admin Dashboard')
}

/**
 * Back to the Professional workspace after an Admin session. There is ONE identity system, so the
 * admin account is logged out and the professional signs in again (the in-memory listing data, which
 * is still prototype state, survives because nothing reloads).
 */
export async function returnToProfessional(page: Page, name: string) {
  await page.getByRole('button', { name: 'Log out' }).click()
  await expectPage(page, 'Admin Login')
  await pushInApp(page, '/provider/listings')
  await expectPage(page, 'Log In')
  await signIn(page, name)
  await expectPage(page, 'Listings')
}

export async function openListingReview(page: Page) {
  await navigateInApp(page, '/admin/moderation', 'Listing Review')
}

export async function openMyListings(page: Page) {
  await navigateInApp(page, '/provider/listings', 'Listings')
}
