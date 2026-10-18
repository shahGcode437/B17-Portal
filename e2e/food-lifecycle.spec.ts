import { expect, test } from './helpers/test'
import type { Page } from '@playwright/test'
import { expectPage, navigateInApp } from './helpers/app'
import { enterAdmin, enterProfessionalWorkspace, openListingReview, returnToProfessional } from './helpers/workspace'

const NAME = 'Sweet Crumbs Bakery'
const REASON = 'Please add your opening hours and a clearer description.'

async function chooseBusinessAsFood(page: Page) {
  await navigateInApp(page, '/provider/listings/new', 'List Your Business / Service / Property')
  await page.getByRole('button', { name: /Business \/ Shop/ }).click()
  await page.getByRole('radio', { name: /Food & Dining/ }).click()
  await expect(page.getByRole('heading', { name: /Food & Dining details/ })).toBeVisible()
}

async function fillFoodForm(page: Page) {
  await page.getByLabel('Business Name').fill(NAME)
  await page.getByLabel('Description', { exact: true }).fill('Fresh cakes and bread baked every morning in B-17.')
  await page.getByLabel('Area', { exact: true }).fill('B-17, Block B')
  await page.getByLabel(/Dishes \/ Search Tags/).fill('cakes, bread, birthday cakes')
  await page.getByRole('checkbox', { name: 'Bakeries' }).check()
  await page.getByRole('checkbox', { name: 'Cafes' }).check()
  await page.getByRole('checkbox', { name: 'Takeaway' }).check()
  await page.getByRole('checkbox', { name: 'Delivery by the business' }).check()
  await page.getByLabel('Opening hours (optional)').fill('Daily, 8 AM–10 PM')
  await page.getByRole('button', { name: 'Add menu item' }).click()
  await page.getByLabel('Item name').fill('Fudge Cake')
  await page.getByLabel('Price (optional)').fill('PKR 1,800')
}

/**
 * The full Food & Dining moderation lifecycle across three roles in ONE continuous session
 * (state is in memory by design): Professional creates → Admin rejects with a reason →
 * Professional sees the reason, edits, resubmits → Admin approves → the public can find it
 * through Search and see the Food data on its profile.
 */
test('Food listing: create → reject with reason → edit & resubmit → approve → public Search & detail', async ({ page }) => {
  // ── Professional: create and submit ─────────────────────────────────────────────────────────
  await enterProfessionalWorkspace(page, 'Sana Baker')
  await chooseBusinessAsFood(page)
  await page.getByRole('button', { name: 'Preview Listing' }).click()
  // Validation blocks an empty Food form with specific, linked errors.
  await expect(page.getByText('Please enter a name.')).toBeVisible()
  await expect(page.getByText('Choose at least one category.')).toBeVisible()
  await expect(page.getByText('Choose at least one service option.')).toBeVisible()

  await fillFoodForm(page)
  await page.getByRole('button', { name: 'Preview Listing' }).click()

  // Preview: the card and the Food summary, flagged as not yet published.
  await expect(page.getByText('Demo Preview')).toBeVisible()
  await expect(page.getByText(/not yet published or\s+visible to other residents/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Fudge Cake' })).toHaveCount(0) // menu items are list text, not headings
  await expect(page.getByText('Fudge Cake')).toBeVisible()

  await page.getByRole('button', { name: 'Submit for Review' }).click()
  await expectPage(page, 'Your listing is pending review')
  await expect(page.getByText('Pending Review', { exact: true })).toBeVisible()

  // Not public yet.
  await navigateInApp(page, '/search?q=Sweet+Crumbs&type=business', 'Search / Explore')
  await expect(page.getByRole('button', { name: `Preview ${NAME}` })).toHaveCount(0)

  // ── Admin: reject with a reason ─────────────────────────────────────────────────────────────
  await enterAdmin(page)
  await openListingReview(page)
  await page.getByRole('button', { name: `Review ${NAME}` }).click()
  const review = page.getByRole('dialog', { name: 'Review Listing' })
  await expect(review).toBeVisible()
  await expect(review).toContainText('Food & Dining') // type label
  await expect(review).toContainText('Bakeries')
  await review.getByRole('button', { name: 'Reject' }).click()

  // A reason is required (at least 10 characters).
  await review.getByLabel('Rejection reason').fill('too short')
  await review.getByRole('button', { name: 'Confirm Rejection' }).click()
  await expect(review.getByRole('alert')).toContainText('at least 10 characters')
  await review.getByLabel('Rejection reason').fill(REASON)
  await review.getByRole('button', { name: 'Confirm Rejection' }).click()
  await expect(review).toBeHidden()
  await expect(page.getByText('Rejected', { exact: true }).first()).toBeVisible()

  // ── Professional: sees the reason, edits, resubmits ─────────────────────────────────────────
  await returnToProfessional(page, 'Sana Baker')
  await expect(page.getByText('Rejected', { exact: true })).toBeVisible()
  await expect(page.getByText(REASON)).toBeVisible()
  await page.getByRole('link', { name: 'Edit' }).click()
  await expectPage(page, 'Edit Listing')

  // The Food data is prefilled — editing never drops it.
  await expect(page.getByRole('radio', { name: /Food & Dining/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Bakeries' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Delivery by the business' })).toBeChecked()
  await expect(page.getByLabel('Item name')).toHaveValue('Fudge Cake')
  await expect(page.getByLabel('Opening hours (optional)')).toHaveValue('Daily, 8 AM–10 PM')

  await page.getByLabel('Description', { exact: true }).fill('Fresh cakes and bread baked every morning. Open daily, 8 AM to 10 PM, in B-17 Block B.')
  await page.getByRole('button', { name: 'Preview Listing' }).click()
  await page.getByRole('button', { name: 'Resubmit for Review' }).click()
  await expectPage(page, 'Listings')
  await expect(page.getByText('Pending Review', { exact: true })).toBeVisible()
  await expect(page.getByText(REASON)).toHaveCount(0) // resubmission clears the previous reason

  // ── Admin: approve ──────────────────────────────────────────────────────────────────────────
  await enterAdmin(page)
  await openListingReview(page)
  await page.getByRole('button', { name: `Review ${NAME}` }).click()
  const approve = page.getByRole('dialog', { name: 'Review Listing' })
  await approve.getByRole('button', { name: 'Approve' }).click()
  await expect(approve).toBeHidden()

  // ── Public: found by Search, with its Food data on the profile ──────────────────────────────
  await navigateInApp(page, '/search?q=Sweet+Crumbs&type=business&vertical=food&foodCategory=bakeries', 'Search / Explore')
  await page.getByRole('button', { name: `Preview ${NAME}` }).click()
  await page.getByRole('dialog', { name: NAME }).getByRole('button', { name: 'View Profile' }).click()
  await expect(page).toHaveURL(/\/businesses\/[0-9a-f-]{36}$/)
  await expectPage(page, NAME)
  await expect(page.getByRole('heading', { name: 'Service options' })).toBeVisible()
  await expect(page.getByText('Delivery by the business').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Menu highlights' })).toBeVisible()
  await expect(page.getByText('Fudge Cake')).toBeVisible()
  await expect(page.getByText('PKR 1,800')).toBeVisible()
  // No ordering / cart language anywhere on a Food profile.
  await expect(page.getByRole('button', { name: /order|cart|checkout/i })).toHaveCount(0)
})

test('a General business and a Service listing go through the same submit → pending flow', async ({ page }) => {
  await enterProfessionalWorkspace(page, 'Imran Traders')
  await navigateInApp(page, '/provider/listings/new', 'List Your Business / Service / Property')
  await page.getByRole('button', { name: /Business \/ Shop/ }).click()
  await expect(page.getByRole('radio', { name: /General Business/ })).toBeChecked()
  await page.getByLabel('Business Name').fill('Capital Stationers')
  await page.getByLabel('Category', { exact: true }).fill('Stationery')
  await page.getByLabel('Description', { exact: true }).fill('Books, copies and office supplies for B-17 families.')
  await page.getByLabel('Area', { exact: true }).fill('B-17, Block A')
  await page.getByLabel(/Services \/ Tags/).fill('books, copies, office supplies')
  await page.getByRole('button', { name: 'Preview Listing' }).click()
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  await expectPage(page, 'Your listing is pending review')

  await navigateInApp(page, '/provider/listings/new', 'List Your Business / Service / Property')
  await page.getByRole('button', { name: /Service \/ Professional/ }).click()
  await page.getByLabel('Name', { exact: true }).fill('Bright Spark Electricians')
  await page.getByLabel('Service Category').selectOption({ index: 1 })
  await page.getByLabel('Description', { exact: true }).fill('Home wiring, repairs and fittings across B-17.')
  await page.getByLabel('Area', { exact: true }).fill('B-17, All Blocks')
  await page.getByLabel(/Services Offered/).fill('wiring, repairs')
  await page.getByRole('button', { name: 'Preview Listing' }).click()
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  await expectPage(page, 'Your listing is pending review')
  await expect(page.getByText('You have 2 listings submitted in this session.')).toBeVisible()
})
