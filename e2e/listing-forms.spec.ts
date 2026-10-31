import { expect, test } from './helpers/test'
import { expectPage, signIn } from './helpers/app'
import type { Page } from '@playwright/test'

/**
 * Phase 12S, S4: the listing form tells the truth (merged into main from the parallel S4 worktree, adapted). The Area
 * is a fixed choice (the API accepts one locality), tags stop at 20 with a plain message, the image field promises no
 * upload, the button names what it does, the owner's dashboard shows category NAMES, and an edit of a General Business
 * is saved (it used to send `food: null`, which the real API refuses). Runs against the writable mock backend, whose
 * rules mirror the real API's (`src/test/fixtures/listingRules.ts`): a form that sent a value the API refuses fails here.
 */
async function openCreateForm(page: Page, name: string, kind: RegExp) {
  await page.goto('/provider/listings/new')
  await expectPage(page, 'Log In')
  await signIn(page, name)
  await expectPage(page, 'List a Service, Business, Tutor or Property')
  await page.getByRole('button', { name: kind }).click()
}

async function fillProvider(page: Page, name: string, tags = 'wiring, repairs') {
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Service Category').selectOption({ label: 'Electrical' })
  await page.getByLabel('Description', { exact: true }).fill('Wiring, repairs and fittings across B-17.')
  await page.getByLabel(/Services offered/).fill(tags)
}

function recordWrites(page: Page) {
  const sent: { method: string; path: string; body: Record<string, unknown> }[] = []
  page.on('request', (request) => {
    if (!request.url().includes('/api/v1/') || request.method() === 'GET') return
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '')
    sent.push({ method: request.method(), path, body: request.postData() ? JSON.parse(request.postData()!) : {} })
  })
  return sent
}
const listingPosts = (sent: ReturnType<typeof recordWrites>) => sent.filter((s) => s.method === 'POST' && s.path === '/listings')

test('the Area is B-17 from a list of one, never free text; the block goes in the location section', async ({ page }) => {
  await openCreateForm(page, 'Area Owner', /Service \/ Professional/)
  const area = page.getByRole('combobox', { name: 'Area', exact: true })
  await expect(area).toHaveValue('B-17')
  expect(await area.locator('option').allTextContents()).toEqual(['B-17'])
  await expect(page.getByRole('textbox', { name: 'Area', exact: true })).toHaveCount(0)
  await expect(page.getByText(/Your block or sector within B-17\. The area itself is always B-17\./)).toBeVisible()
  await expect(page.getByPlaceholder('e.g. B-17, Block C')).toHaveCount(0)
})

test('the submit button says what it does: "Submit for Review" - and there is no Preview Listing', async ({ page }) => {
  await openCreateForm(page, 'Label Owner', /Service \/ Professional/)
  await expect(page.getByRole('button', { name: 'Submit for Review' })).toBeVisible()
  await expect(page.getByRole('button', { name: /preview/i })).toHaveCount(0)
})

test('tags: 20 are accepted, a 21st is stopped with a plain message and nothing is sent; the count is live', async ({ page }) => {
  const sent = recordWrites(page)
  await openCreateForm(page, 'Tag Owner', /Service \/ Professional/)
  const tags = (n: number) => Array.from({ length: n }, (_, i) => `tag${i + 1}`).join(', ')
  await fillProvider(page, 'Twenty One Tags', tags(3))
  await expect(page.getByText(/\(3 of 20 so far\)/)).toBeVisible() // the live count, while the field is within its limit
  await page.getByLabel(/Services offered/).fill(tags(21)) // past it, the error replaces the hint and says how many to remove
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  const message = page.getByRole('alert').filter({ hasText: 'You can add up to 20 tags. Remove 1 to continue.' })
  await expect(message).toBeVisible()
  await expect(page.getByLabel(/Services offered/)).toHaveAttribute('aria-invalid', 'true')
  expect(listingPosts(sent)).toHaveLength(0)

  await page.getByLabel(/Services offered/).fill(tags(20))
  await expect(page.getByText(/20 of 20/)).toBeVisible()
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  await expectPage(page, 'Listings')
  const post = listingPosts(sent)[0]!
  expect(post.body.tags).toHaveLength(20)
  expect(post.body.area).toBe('B-17')
})

test('a hidden character (a pasted non-breaking space) in the name is stopped on the page, nothing is sent', async ({ page }) => {
  const sent = recordWrites(page)
  await openCreateForm(page, 'Hidden Owner', /Service \/ Professional/)
  await fillProvider(page, 'Wiring Works')
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  await expect(page.getByText(/Please use plain text only/)).toBeVisible()
  await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  expect(listingPosts(sent)).toHaveLength(0)
})

test('the image field promises no upload: no file picker, a disabled button and a notice, and nothing is sent for it', async ({ page }) => {
  const sent = recordWrites(page)
  await openCreateForm(page, 'Image Owner', /Service \/ Professional/)
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Choose Image' })).toBeDisabled()
  await expect(page.getByText(/Image upload isn't available yet/)).toBeVisible()
  await expect(page.getByText(/prototype/i)).toHaveCount(0)

  await fillProvider(page, 'No Picture Works')
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  await expectPage(page, 'Listings')
  expect(listingPosts(sent)[0]!.body).not.toHaveProperty('image')
})

test('the owner dashboard shows the category NAME of a business, never a slug', async ({ page }) => {
  await openCreateForm(page, 'Name Owner', /Business \/ Shop/)
  await page.getByLabel('Business Name').fill('Capital Stationers')
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Stationery' })
  await page.getByLabel('Description', { exact: true }).fill('Books, copies and office supplies.')
  await page.getByLabel('Tags (optional)').fill('books, copies')
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  await expectPage(page, 'Listings')
  const card = page.locator('[data-slot="card"]').filter({ hasText: 'Capital Stationers' }).filter({ has: page.getByRole('button', { name: 'View' }) })
  await expect(card).toContainText('Business / Shop · Stationery')
  await expect(card).not.toContainText(/stationery(?!\w)/) // a lower-case slug would match; the name is capitalised
})

test('the Free plan limit is explained in plain words, and the form keeps what was typed', async ({ page }) => {
  // The fixtures start the owner with two active listings (one pending, one approved): the third is allowed.
  await openCreateForm(page, 'Quota Owner', /Service \/ Professional/)
  await fillProvider(page, 'Third Listing Works')
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  await expectPage(page, 'Listings')

  // Three active listings on the Free plan: the dashboard says so next to "New listing", with no upgrade action.
  const limitNotice = page.getByRole('status').filter({ hasText: 'Active listing limit reached' })
  await expect(limitNotice).toContainText('You have 3 of 3 active listings')
  await expect(limitNotice).not.toContainText(/upgrade|premium/i)
  await expect(page.getByRole('link', { name: /upgrade|subscribe|buy/i })).toHaveCount(0)

  await page.getByRole('link', { name: 'New listing' }).click()
  await expectPage(page, 'List a Service, Business, Tutor or Property')
  // ... and so does the create page, BEFORE a kind is chosen or a field is filled (it blocks nothing; the server decides).
  await expect(limitNotice).toBeVisible()
  await expect(limitNotice.getByRole('link', { name: 'Manage my listings' })).toHaveAttribute('href', '/provider/listings')
  await page.getByRole('button', { name: /Service \/ Professional/ }).click()
  await expect(limitNotice).toBeVisible()
  await fillProvider(page, 'Fourth Listing Works')
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  const alert = page.getByRole('alert').filter({ hasText: 'Active listing limit reached' })
  await expect(alert).toBeVisible()
  await expect(alert).toContainText("You've reached the active listing limit for your current plan. Archive an active listing before creating another.")
  await expect(alert).not.toContainText(/upgrade|premium/i)
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Fourth Listing Works')
  await expect(page.getByRole('button', { name: 'Submit for Review' })).toBeEnabled()
})

test('editing: the button says Save Changes and the page says what saving does', async ({ page }) => {
  await page.goto('/provider/listings')
  await expectPage(page, 'Log In')
  await signIn(page, 'Edit Owner')
  await expectPage(page, 'Listings')
  const approved = page.locator('[data-slot="card"]').filter({ hasText: 'Approved Plumbing Co' }).filter({ has: page.getByRole('button', { name: 'View' }) })
  await approved.getByRole('button', { name: 'Edit' }).click()
  await expectPage(page, 'Edit Listing')
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible()
  await expect(page.getByText(/This listing is live\. A change to its content sends it back to review/)).toBeVisible()
  await expect(page.getByRole('button', { name: /preview/i })).toHaveCount(0)
})

test('editing a General Business is saved: the PATCH carries no food block (food: null is not_nullable on the real API)', async ({ page }) => {
  const patches: Record<string, unknown>[] = []
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && /\/api\/v1\/listings\//.test(request.url())) patches.push(JSON.parse(request.postData() ?? '{}'))
  })
  await page.goto('/provider/listings')
  await expectPage(page, 'Log In')
  await signIn(page, 'Business Editor')
  await expectPage(page, 'Listings')
  const pending = page.locator('[data-slot="card"]').filter({ hasText: 'Pending Stationers' }).filter({ has: page.getByRole('button', { name: 'View' }) })
  await pending.getByRole('button', { name: 'Edit' }).click()
  await expectPage(page, 'Edit Listing')
  await page.getByLabel('Description', { exact: true }).fill('A stationery shop with books, copies and office supplies for B-17.')
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.getByText('Listing updated')).toBeVisible()
  await expectPage(page, 'Listings')
  expect(patches).toHaveLength(1)
  expect(patches[0]).not.toHaveProperty('food')
  expect(patches[0]).toMatchObject({ vertical: 'general', category: 'stationery', area: 'B-17' })
})
