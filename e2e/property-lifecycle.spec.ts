import { expect, test } from '@playwright/test'
import { expectPage, navigateInApp } from './helpers/app'
import { enterAdmin, enterProfessionalWorkspace, openListingReview } from './helpers/workspace'

const TITLE = '3-Bed Upper Portion — B-17 Block C'

test('Property: create → submit → admin approves → public Search & detail', async ({ page }) => {
  await enterProfessionalWorkspace(page, 'Nadeem Estates')
  await navigateInApp(page, '/provider/listings/new', 'List Your Business / Service / Property')
  await page.getByRole('button', { name: /Property/ }).click()

  // Required fields are enforced with specific messages.
  await page.getByRole('button', { name: 'Preview Listing' }).click()
  await expect(page.getByText('Please enter a title.')).toBeVisible()
  await expect(page.getByText('Please choose Sale or Rent.')).toBeVisible()
  await expect(page.getByText('Please enter a price.')).toBeVisible()

  await page.getByLabel('Title').fill(TITLE)
  await page.getByLabel('Listing Type').selectOption('rent')
  await page.getByLabel('Property Type').selectOption('House')
  await page.getByLabel('Price').fill('PKR 85,000 / month')
  await page.getByLabel('Area', { exact: true }).fill('B-17, Block C')
  await page.getByLabel('Description').fill('Spacious upper portion with separate entrance and parking.')
  await page.getByLabel('Bedrooms (optional)').fill('3')
  await page.getByLabel('Furnishing (optional)').selectOption('Unfurnished')
  await page.getByRole('button', { name: 'Preview Listing' }).click()
  await expect(page.getByText('Demo Preview')).toBeVisible()
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  await expectPage(page, 'Your listing is pending review')

  await enterAdmin(page)
  await openListingReview(page)
  await page.getByRole('button', { name: `Review ${TITLE}` }).click()
  const review = page.getByRole('dialog', { name: 'Review Listing' })
  await expect(review).toContainText('Property')
  await review.getByRole('button', { name: 'Approve' }).click()
  await expect(review).toBeHidden()

  await navigateInApp(page, '/search?q=Upper+Portion&type=property', 'Search / Explore')
  await page.getByRole('button', { name: `Preview ${TITLE}` }).click()
  await page.getByRole('dialog', { name: TITLE }).getByRole('button', { name: 'Contact Agent' }).click()
  await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/)
  await expectPage(page, TITLE)
  await expect(page.getByRole('heading', { name: 'About this property' })).toBeVisible()
  await expect(page.getByText('PKR 85,000 / month')).toBeVisible()
})
