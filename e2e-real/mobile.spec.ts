import { expect, test, type Page } from '@playwright/test'
import { createUser, expectH1, loginOn, ownerCard, scalar, type TestUser, newContext } from './helpers/stack'
import { approvedProvider, createProperty, createProvider, unique } from './helpers/ui'

/**
 * Mobile closeout (Phase 12I): the critical REAL flows at 375px (touch targets: primary page CTAs >= 36px, dialog / secondary actions >= 32px - the design-system default, above WCAG 2.2 AA's 24px minimum) - login, Professional profile, listing
 * create (with the map / numeric location), owner dashboard, Saved, request creation, provider leads and
 * actions, Admin moderation. Every step must fit the viewport (no horizontal page scroll) and every
 * primary control must be reachable and touch-sized.
 */
test.use({ viewport: { width: 375, height: 812 } })
test.setTimeout(300_000)

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

async function fits(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0)
}

/** The element's box is inside the viewport horizontally and tall enough to tap. */
async function tappable(locator: ReturnType<Page['locator']>, label: string, minHeight = 32) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  expect(box, `${label}: not rendered`).not.toBeNull()
  expect(box!.x, `${label}: left edge`).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width, `${label}: right edge`).toBeLessThanOrEqual(375.5)
  expect(box!.height, `${label}: touch height`).toBeGreaterThanOrEqual(minHeight)
}

test('375px: login -> Professional profile -> create a Property with a map location -> dashboard -> Saved -> request -> provider actions -> Admin moderation', async ({ browser }) => {
  const resident = await createUser('mob-resident')
  const owner = await createUser('mob-owner', { professional: 'premium' })
  const admin = await createUser('mob-admin', { admin: true })
  const requester = await createUser('mob-requester')
  const approved = await approvedProvider(owner, admin, 'Mobile Provider')
  const openAs = async (user: TestUser) => {
    const context = await newContext(browser, { viewport: { width: 375, height: 812 } })
    const page = await context.newPage()
    await loginOn(page, user)
    return page
  }

  // ---- login + Professional profile ----
  const context = await newContext(browser, { viewport: { width: 375, height: 812 } })
  const page = await context.newPage()
  await page.goto('/login')
  await expectH1(page, 'Log In')
  await fits(page, 'login')
  await tappable(page.getByRole('button', { name: 'Log In', exact: true }), 'login button', 36)
  await page.getByLabel('Email').fill(resident.email)
  await page.getByLabel('Password', { exact: true }).fill('p12i correct horse battery staple')
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toHaveCount(0)
  await page.goto('/provider/listings/new')
  await expect(page.getByText('Professional profile needed')).toBeVisible()
  await fits(page, 'professional gate')
  await tappable(page.getByRole('button', { name: 'Create a professional profile' }), 'create profile button', 36)
  await page.getByRole('button', { name: 'Create a professional profile' }).click()
  await expectH1(page, 'List Your Business / Service / Property')
  await fits(page, 'create form (kind picker)')
  await context.close()

  // ---- listing create (Property + map) as the premium owner ----
  const ownerPage = await openAs(owner)
  await ownerPage.goto('/provider/listings/new')
  await ownerPage.getByRole('button', { name: /Property/ }).click()
  await fits(ownerPage, 'property form')
  const map = ownerPage.locator('.leaflet-container').first()
  await expect(map).toBeVisible()
  await tappable(map, 'map', 150)
  await tappable(ownerPage.getByLabel('Latitude'), 'latitude input', 36)
  const pname = unique('Mobile Property')
  const pid = await createProperty(ownerPage, { title: pname, type: 'Flat', location: { visibility: 'approximate', lat: 33.7099, lng: 73.0699, block: 'C' } })
  expect(scalar(`SELECT location_visibility FROM listings WHERE id = '${pid}'`)).toBe('approximate')
  await fits(ownerPage, 'owner dashboard')
  await tappable(ownerCard(ownerPage, pname).getByRole('button', { name: 'Edit' }), 'Edit', 36)
  await ownerPage.goto(`/provider/listings/${pid}/edit`)
  await expectH1(ownerPage, 'Edit Listing')
  await fits(ownerPage, 'edit form')
  const providerListing = await createProvider(ownerPage, { name: unique('Mobile Provider Create'), category: 'Plumbing' })
  expect(providerListing).toBeTruthy()

  // ---- Saved + request creation as the requester ----
  const requesterPage = await openAs(requester)
  await requesterPage.goto(`/providers/${approved.id}`)
  await expectH1(requesterPage, approved.name)
  await fits(requesterPage, 'provider detail')
  const heart = requesterPage.getByRole('button', { name: `Save ${approved.name}` })
  await tappable(heart, 'save heart', 32)
  await heart.click()
  await expect(requesterPage.getByRole('button', { name: `Remove ${approved.name} from saved` })).toHaveAttribute('aria-pressed', 'true')
  await requesterPage.goto('/profile/saved')
  await expectH1(requesterPage, 'Saved')
  await fits(requesterPage, 'Saved')
  await expect(requesterPage.getByText(approved.name).first()).toBeVisible()

  await requesterPage.goto(`/providers/${approved.id}`)
  await requesterPage.getByRole('button', { name: 'Request Service' }).click()
  const dialog = requesterPage.getByRole('dialog', { name: /Request / })
  await expect(dialog).toBeVisible()
  const box = (await dialog.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(375.5) // the dialog fits the phone
  await fits(requesterPage, 'request dialog')
  await dialog.getByLabel('What do you need?').fill('Please quote a bathroom plumbing repair, mobile test.')
  await dialog.getByLabel('Area / Location').fill('B-17, Block A')
  await dialog.getByLabel('Preferred Date').fill(tomorrow())
  const submit = dialog.getByRole('button', { name: /Submit Request/ })
  await tappable(submit, 'submit request') // reachable by scrolling the dialog
  await submit.click()
  await expect(dialog.getByText('Request sent')).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await requesterPage.goto('/profile/requests')
  await expectH1(requesterPage, 'My Requests')
  await fits(requesterPage, 'My Requests')

  // ---- provider leads + actions ----
  await ownerPage.goto('/provider/leads')
  await expectH1(ownerPage, 'Leads')
  await fits(ownerPage, 'Leads')
  await ownerPage.getByRole('button').filter({ hasText: requester.name }).first().click()
  const lead = ownerPage.getByRole('dialog')
  await fits(ownerPage, 'lead dialog')
  const accept = lead.getByRole('button', { name: 'Accept' })
  await tappable(accept, 'Accept')
  await accept.click()
  await expect(lead).toBeHidden({ timeout: 15_000 })
  await ownerPage.close()

  // ---- Admin moderation ----
  const adminPage = await openAs(admin)
  await adminPage.goto('/admin/moderation')
  await expectH1(adminPage, 'Listing Review')
  await fits(adminPage, 'moderation queue')
  await adminPage.getByRole('button', { name: `Review ${pname}` }).click()
  const review = adminPage.getByRole('dialog', { name: 'Review Listing' })
  await expect(review).toBeVisible()
  await fits(adminPage, 'review dialog')
  const approve = review.getByRole('button', { name: /^Approve$/ })
  await tappable(approve, 'Approve')
  await approve.click()
  await expect(review).toBeHidden({ timeout: 15_000 })
  expect(scalar(`SELECT status FROM listings WHERE id = '${pid}'`)).toBe('approved')
  await Promise.all([adminPage.context().close(), requesterPage.context().close()])
})
