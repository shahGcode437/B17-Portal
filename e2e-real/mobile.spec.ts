import { expect, test, type Page } from '@playwright/test'
import { ApiClient, createUser, expectH1, loginOn, ownerCard, scalar, type TestUser, newContext } from './helpers/stack'
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
  await expectH1(page, 'List a Service, Business, Tutor or Property')
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

test('375px (Phase 12S S3): a footer link opens at the top; a resident is asked for a professional profile, never for Log In; a professional stays in after a reload', async ({ browser }) => {
  const resident = await createUser('mob-gate-res')
  const professional = await createUser('mob-gate-pro', { professional: 'free' })
  const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))

  const context = await newContext(browser, { viewport: { width: 375, height: 812 } })
  const page = await context.newPage()
  await page.goto('/')
  await expectH1(page, 'B-17 Portal')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => scrollY(page)).toBeGreaterThan(300)
  await page.locator('footer').getByRole('link', { name: 'Education', exact: true }).click()
  await expect(page).toHaveURL(/\/education$/)
  await expect.poll(() => scrollY(page)).toBe(0)
  await fits(page, 'education after a footer link')

  await loginOn(page, resident)
  await page.goto('/')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.locator('footer').getByRole('link', { name: 'List Your Business / Service' }).click()
  await expectH1(page, 'Professional profile needed')
  await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toHaveCount(0)
  await fits(page, 'professional gate')
  await context.close()

  const proContext = await newContext(browser, { viewport: { width: 375, height: 812 } })
  const proPage = await proContext.newPage()
  await loginOn(proPage, professional)
  await proPage.goto('/provider/listings/new')
  await expectH1(proPage, 'List a Service, Business, Tutor or Property')
  await proPage.reload()
  await expectH1(proPage, 'List a Service, Business, Tutor or Property')
  await fits(proPage, 'create listing entry')
  await proContext.close()
})

test('375px (Phase 12S Step A): a Free owner at 3 of 3 sees the limit notice on the dashboard and the create page - it wraps, nothing overflows, the controls stay tappable', async ({ browser }) => {
  const owner = await createUser('mob-limit', { professional: 'free' })
  const api = await ApiClient.shared(owner.email)
  for (const n of ['One', 'Two', 'Three']) {
    const r = await api.call('POST', '/listings', {
      kind: 'provider',
      name: unique(`Mobile Limit ${n}`),
      category: 'plumbing',
      description: 'An active listing that fills the Free plan quota on a phone.',
      area: 'B-17',
      location: { visibility: 'area_only' },
    })
    expect(r.status).toBe(201)
  }
  const context = await newContext(browser, { viewport: { width: 375, height: 812 } })
  const page = await context.newPage()
  await loginOn(page, owner, '/provider/listings')
  await expectH1(page, 'Listings')

  const notice = page.getByRole('status').filter({ hasText: 'Active listing limit reached' })
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('You have 3 of 3 active listings')
  await fits(page, 'dashboard at the limit')
  await tappable(notice, 'limit notice', 44)
  const newListing = page.getByRole('link', { name: 'New listing' })
  await tappable(newListing, 'New listing at the limit', 44)
  await newListing.focus()
  await expect(newListing).toBeFocused()

  // The owner preview stays usable on a phone: it fits, the status badge is clear of the close button, and Escape closes it.
  await page.getByRole('button', { name: 'View' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('img', { name: /No photo available/ })).toBeVisible()
  const badge = await dialog.getByText('Pending Review').boundingBox()
  const close = await dialog.getByRole('button', { name: 'Close' }).boundingBox()
  expect(badge!.x + badge!.width, 'badge vs close button').toBeLessThanOrEqual(close!.x)
  await fits(page, 'owner preview')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await newListing.click()
  await expectH1(page, 'List a Service, Business, Tutor or Property')
  await expect(notice).toBeVisible()
  await fits(page, 'create page at the limit')
  const manage = notice.getByRole('link', { name: 'Manage my listings' })
  await tappable(manage, 'Manage my listings', 44)
  await manage.focus()
  await expect(manage).toBeFocused()
  // The kind choices below the notice are still reachable.
  await tappable(page.getByRole('button', { name: /Service \/ Professional/ }), 'kind choice', 36)
  await context.close()
})
