import { expect, test } from '../helpers/test'
import { expectPage, signIn } from '../helpers/app'
import type { Page } from '@playwright/test'

/**
 * Phase 12S, S4 on a 375 px phone (merged into main from the parallel S4 worktree, adapted): the S4 form changes (the
 * fixed Area, the tag counter and its error, the image notice, the "Submit for Review" button, the Block rule) must fit
 * the narrow layout - no horizontal page scroll, every control reachable and a 44 px tap target on the form's own
 * action buttons and fields.
 */
test.use({ viewport: { width: 375, height: 812 } })

// The mobile form tests exercise the Tutor kind as the generic fixture — a name, one category, a grade
// and an area-only default (no map point) keep the mobile viewport assertions focused. A Service /
// Professional listing is portal-managed and ownerless (RBAC-D), so nobody lists one on this page.
async function openCreateForm(page: Page, name: string) {
  await page.goto('/provider/listings/new')
  await expectPage(page, 'Log In')
  await signIn(page, name, 'professional')
  await expectPage(page, 'List a Business, Tutor or Property')
  await page.getByRole('button', { name: /^Tutor/ }).click()
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test('phone: the create form has no horizontal scroll and its controls are reachable with a thumb-sized target', async ({ page }) => {
  await openCreateForm(page, 'Phone Owner')
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  const area = page.getByRole('combobox', { name: 'Area', exact: true })
  await area.scrollIntoViewIfNeeded()
  await expect(area).toHaveValue('B-17')
  expect((await area.boundingBox())!.height).toBeGreaterThanOrEqual(44)

  const notice = page.getByText(/Image upload isn't available yet/)
  await notice.scrollIntoViewIfNeeded()
  const noticeBox = (await notice.boundingBox())!
  expect(noticeBox.x).toBeGreaterThanOrEqual(0)
  expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(375)

  for (const name of ['Back', 'Submit for Review']) {
    const button = page.getByRole('button', { name })
    await button.scrollIntoViewIfNeeded()
    const box = (await button.boundingBox())!
    expect(box.height, `${name}: touch height`).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
  }
})

test('phone: the 21-tag message and the Block message wrap inside the screen', async ({ page }) => {
  await openCreateForm(page, 'Phone Errors')
  await page.getByLabel('Name', { exact: true }).fill('Twenty One Tags')
  await page.getByLabel('Subject', { exact: true }).selectOption({ label: 'Physics' })
  await page.getByLabel('Description', { exact: true }).fill('Physics lessons for matric and A-level students across B-17.')
  await page.getByLabel('Grade / level you teach').fill('Matric / A-Levels')
  await page.getByLabel('Contact Number').fill('03001234567')  // Listing Contact v1: required
  await page.getByLabel(/Topics you teach/).fill(Array.from({ length: 21 }, (_, i) => `tag${i + 1}`).join(', '))
  await page.getByLabel('Visibility').selectOption('area_only')
  await page.getByLabel('Block (optional)').fill('C <b>')
  await page.getByRole('button', { name: 'Submit for Review' }).tap()

  const tags = page.getByRole('alert').filter({ hasText: 'You can add up to 20 tags' })
  const block = page.getByRole('alert').filter({ hasText: /letters, numbers, spaces/i })
  await expect(tags).toBeVisible()
  await expect(block).toBeVisible()
  for (const message of [tags, block]) {
    const box = (await message.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
  }
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

test('phone: a failed submit puts the first problem in view and keeps the form usable', async ({ page }) => {
  await openCreateForm(page, 'Phone Empty')
  await page.getByRole('button', { name: 'Submit for Review' }).tap()
  const name = page.getByLabel('Name', { exact: true })
  await expect(page.getByText('Please enter a name.')).toBeVisible()
  await expect(name).toBeFocused()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})
