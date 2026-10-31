import { expect, test, type Locator, type Page } from '@playwright/test'
import { ApiClient, createUser, emailFor, expectH1, newContext, ownerCard, rows, scalar, signInAs, type TestUser } from './helpers/stack'
import {
  KIND,
  approvedProvider,
  createFood,
  createProperty,
  createProvider,
  createTutor,
  openCreateForm,
  openReviewInUi,
  publicGet,
  rejectInUi,
  takedownInUi,
  unique,
} from './helpers/ui'

/**
 * Phase 12S S5A - pre-redesign functional closure, proven against the REAL stack (React -> FastAPI -> PostgreSQL):
 * B-01 the review shows each kind's facts, B-03 a takedown is not a rejection (for the owner AND the admin, and the
 * public visibility is unchanged), B-04 a one-character name says it is too short, B-13 the request form offers no
 * contact method that does nothing, and the password-reset screen never claims a link was sent. (The verification
 * banner, the gate order and the Request Service verification step are proven in 01-auth, 12-onboarding and 14-s4-forms.)
 */
test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

let owner: TestUser
let admin: TestUser
let resident: TestUser
let ownerPage: Page
let adminPage: Page

const dbRow = (id: string) => rows(`SELECT status, revision FROM listings WHERE id = '${id}'`)[0]!
const history = (id: string) =>
  scalar(`SELECT string_agg(action || ':' || coalesce(from_status::text, '-'), ',' ORDER BY created_at, revision) FROM listing_status_history WHERE listing_id = '${id}'`)

/** What the owner API says about one of the signed-in owner's listings (the marker is the thing under test). */
async function ownerView(page: Page, id: string): Promise<{ status: string; takenDown?: boolean; rejectionReason?: string }> {
  return page.evaluate(async (listingId) => {
    const response = await fetch(`/api/v1/users/me/listings/${listingId}`, { credentials: 'include' })
    return ((await response.json()) as { data: { status: string; takenDown?: boolean; rejectionReason?: string } }).data
  }, id)
}

/** The queue row (card) of a listing on the admin moderation page: the row itself, not the review dialog. */
const queueRow = (page: Page, title: string) =>
  page.getByRole('button', { name: `Review ${title}` }).locator('xpath=ancestor::*[@data-slot="card"][1]')

/** What `GET /admin/listings` says about the given ids (the summary rows the queue is drawn from). */
async function queueSummaries(page: Page, ids: string[]): Promise<Record<string, { status: string; takenDown?: boolean }>> {
  return page.evaluate(async (wanted) => {
    const response = await fetch('/api/v1/admin/listings?status=rejected&limit=50', { credentials: 'include' })
    const rows = ((await response.json()) as { data: { id: string; status: string; takenDown?: boolean }[] }).data
    return Object.fromEntries(rows.filter((r) => wanted.includes(r.id)).map((r) => [r.id, { status: r.status, takenDown: r.takenDown }]))
  }, ids)
}

test.beforeAll(async ({ browser }) => {
  owner = await createUser('s5a-owner', { professional: 'premium' })
  admin = await createUser('s5a-admin', { admin: true })
  resident = await createUser('s5a-resident')
  ownerPage = await signInAs(browser, owner)
  adminPage = await signInAs(browser, admin)
})

test.afterAll(async () => {
  await ownerPage?.context().close()
  await adminPage?.context().close()
})

test('B-01: the admin review shows the facts of a provider, a Food business, a tutor and a property', async () => {
  const providerName = unique('S5A Review Provider')
  const foodName = unique('S5A Review Bakery')
  const tutorName = unique('S5A Review Tutor')
  const propertyTitle = unique('S5A Review House')
  await createProvider(ownerPage, { name: providerName, category: 'Solar', tags: 'solar panels, net metering' })
  await createFood(ownerPage, { name: foodName, location: { visibility: 'area_only', block: 'B' } })
  await createTutor(ownerPage, { name: tutorName, subject: 'Physics', grade: 'Grade 9' })
  await createProperty(ownerPage, {
    title: propertyTitle,
    type: 'House',
    listingType: 'sale',
    price: 'PKR 2.5 Cr',
    location: { visibility: 'approximate', lat: 33.7099, lng: 73.0699, block: 'C' },
  })

  // The dialog opens with the queue row and then reads the full listing: wait for the region before reading it.
  const factsOf = async (region: Locator) => {
    await expect(region).toBeVisible()
    return Object.fromEntries(
      await region.locator('dt').evaluateAll((terms) => terms.map((dt) => [dt.textContent ?? '', dt.nextElementSibling?.textContent ?? '']))
    ) as Record<string, string>
  }
  const close = (dialog: Locator) => dialog.getByRole('button', { name: 'Close' }).first().click()

  // Provider: the services offered.
  let dialog = await openReviewInUi(adminPage, providerName)
  const services = dialog.getByRole('region', { name: 'Services offered' })
  await expect(services).toContainText('solar panels')
  await expect(services).toContainText('net metering')
  await close(dialog)

  // Food: categories, services, hours, menu highlights, and the dishes / search tags.
  dialog = await openReviewInUi(adminPage, foodName)
  const food = dialog.getByRole('region', { name: /Food & Dining details/ })
  await expect(food).toBeVisible()
  const foodFacts = await factsOf(food)
  expect(foodFacts['Categories']).toContain('Bakeries')
  expect(foodFacts['Services']).toBe('Takeaway')
  expect(foodFacts['Hours']).toBe('Not provided')
  expect(foodFacts['Menu highlights']).toBe('None')
  await expect(dialog.getByRole('region', { name: 'Dishes and search tags' })).toContainText('cakes')
  await close(dialog)

  // Tutor: subject and grade, and the topics taught.
  dialog = await openReviewInUi(adminPage, tutorName)
  expect(await factsOf(dialog.getByRole('region', { name: 'Listing details' }))).toEqual({ Subject: 'Physics', 'Grade / level': 'Grade 9' })
  await expect(dialog.getByRole('region', { name: 'Topics taught' })).toContainText('physics')
  await close(dialog)

  // Property: sale / rent, type, price - and the area / block in the Location block, with no private point in the facts.
  dialog = await openReviewInUi(adminPage, propertyTitle)
  const propertyFacts = await factsOf(dialog.getByRole('region', { name: 'Listing details' }))
  expect(propertyFacts).toMatchObject({ Listing: 'For Sale', 'Property type': 'House', Price: 'PKR 2.5 Cr' })
  expect(JSON.stringify(propertyFacts)).not.toContain('33.7099')
  await expect(dialog.getByRole('region', { name: 'Location' })).toContainText('Block')
  await close(dialog)
})

test('B-03: a takedown reads "Taken down" for the owner and the admin; a plain rejection reads "Rejected"; visibility is unchanged', async () => {
  const live = await approvedProvider(owner, admin, 'S5A Takedown')
  const refusedName = unique('S5A Refused')
  const refusedId = await createProvider(ownerPage, { name: refusedName, category: 'Solar' })
  const reason = 'Reported as closed; please confirm you still trade.'

  await takedownInUi(adminPage, live.name, reason)
  await rejectInUi(adminPage, refusedName, 'Please add a clearer description of the work.')

  // Same status and visibility in the database and on the public API: only the label differs.
  expect(dbRow(live.id)[0]).toBe('rejected')
  expect(dbRow(refusedId)[0]).toBe('rejected')
  expect((await publicGet(`/listings/${live.id}`)).status).toBe(404)
  expect((await publicGet(`/listings/${refusedId}`)).status).toBe(404)
  expect(history(live.id)).toBe('submitted:-,approved:pending,rejected:approved')
  expect(history(refusedId)).toBe('submitted:-,rejected:pending')

  // The admin QUEUE says which it was, in the summary the rows are drawn from and in the row itself (S5A: the queue and
  // the review dialog must not disagree). Both are still filed under the one Rejected filter.
  expect(await queueSummaries(adminPage, [live.id, refusedId])).toEqual({
    [live.id]: { status: 'rejected', takenDown: true },
    [refusedId]: { status: 'rejected' },
  })
  await adminPage.goto('/admin/moderation')
  await expectH1(adminPage, 'Listing Review')
  await adminPage.getByRole('radio', { name: /^Rejected/ }).click()
  await expect(queueRow(adminPage, live.name)).toContainText('Taken down')
  await expect(queueRow(adminPage, live.name)).not.toContainText('Rejected')
  await expect(queueRow(adminPage, refusedName)).toContainText('Rejected')
  await expect(queueRow(adminPage, refusedName)).not.toContainText('Taken down')
  await adminPage.reload()
  await expectH1(adminPage, 'Listing Review')
  await adminPage.getByRole('radio', { name: /^All/ }).click()
  await expect(queueRow(adminPage, live.name)).toContainText('Taken down')

  // The owner API says which it was; the card, the preview and the edit page say it too.
  await ownerPage.goto('/provider/listings')
  expect(await ownerView(ownerPage, live.id)).toMatchObject({ status: 'rejected', takenDown: true, rejectionReason: reason })
  expect((await ownerView(ownerPage, refusedId)).takenDown).toBeUndefined()
  const takenCard = ownerCard(ownerPage, live.name)
  await expect(takenCard).toContainText('Taken down')
  await expect(takenCard).not.toContainText('Rejected')
  await expect(takenCard).toContainText(reason)
  const refusedCard = ownerCard(ownerPage, refusedName)
  await expect(refusedCard).toContainText('Rejected')
  await expect(refusedCard).not.toContainText('Taken down')

  await takenCard.getByRole('button', { name: 'View' }).click()
  const preview = ownerPage.getByRole('dialog')
  await expect(preview).toContainText('Taken down')
  await expect(preview).not.toContainText('Rejected')
  await preview.getByRole('button', { name: 'Close' }).first().click()

  // The overview dashboard row and the edit page.
  await ownerPage.goto('/provider')
  await expect(ownerPage.getByText('Taken down').first()).toBeVisible()
  await ownerPage.goto('/provider/listings')
  await ownerCard(ownerPage, live.name).getByRole('button', { name: 'Edit' }).click()
  await expectH1(ownerPage, 'Edit Listing')
  await expect(ownerPage.getByText('A moderator took this listing down, so it is no longer public.')).toBeVisible()
  await expect(ownerPage.getByText(`Taken down: ${reason}`)).toBeVisible()
  await expect(ownerPage.getByRole('button', { name: 'Resubmit for Review' })).toBeVisible()

  // The admin's review says the same, in the status, the reason label and the history.
  let dialog = await openReviewInUi(adminPage, live.name)
  await expect(dialog.getByText('Takedown reason')).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'History' })).toContainText('Taken down')
  await dialog.getByRole('button', { name: 'Close' }).first().click()
  dialog = await openReviewInUi(adminPage, refusedName)
  await expect(dialog.getByText('Rejection reason')).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'History' })).not.toContainText('Taken down')
  await dialog.getByRole('button', { name: 'Close' }).first().click()

  // Resubmitting clears the marker with the reason: pending again, and a later REJECTION is a plain one.
  await ownerPage.goto(`/provider/listings`)
  await ownerCard(ownerPage, live.name).getByRole('button', { name: 'Edit' }).click()
  await ownerPage.getByLabel('Description', { exact: true }).fill(`${live.name} - plumbing repairs, now with same-day call-outs across B-17.`)
  await ownerPage.getByRole('button', { name: 'Resubmit for Review' }).click()
  await expectH1(ownerPage, 'Listings')
  expect(dbRow(live.id)[0]).toBe('pending')
  expect((await ownerView(ownerPage, live.id)).takenDown).toBeUndefined()
  await rejectInUi(adminPage, live.name, 'Please add the licence details to the description.')
  expect(await queueSummaries(adminPage, [live.id])).toEqual({ [live.id]: { status: 'rejected' } })
  await adminPage.goto('/admin/moderation')
  await expectH1(adminPage, 'Listing Review')
  await adminPage.getByRole('radio', { name: /^Rejected/ }).click()
  await expect(queueRow(adminPage, live.name)).toContainText('Rejected')
  await expect(queueRow(adminPage, live.name)).not.toContainText('Taken down')
  await ownerPage.reload()
  await expect(ownerCard(ownerPage, live.name)).toContainText('Rejected')
  await expect(ownerCard(ownerPage, live.name)).not.toContainText('Taken down')
  expect((await ownerView(ownerPage, live.id)).takenDown).toBeUndefined()
})

test('B-04: a one-character name says it is too short, for every kind', async () => {
  const tooShort = 'Name must be at least 2 characters.'
  for (const [kind, label] of [
    [KIND.provider, 'Name'],
    [KIND.business, 'Business Name'],
    [KIND.tutor, 'Name'],
  ] as const) {
    await openCreateForm(ownerPage, kind)
    await ownerPage.getByLabel(label, { exact: true }).fill('x')
    await ownerPage.getByRole('button', { name: 'Submit for Review' }).click()
    await expect(ownerPage.getByText(tooShort)).toBeVisible()
    await expect(ownerPage.getByText('Please enter a name.')).toHaveCount(0)
  }
  await openCreateForm(ownerPage, KIND.property)
  await ownerPage.getByLabel('Title').fill('x')
  await ownerPage.getByRole('button', { name: 'Submit for Review' }).click()
  await expect(ownerPage.getByText('Title must be at least 2 characters.')).toBeVisible()
})

test('B-13: Request Service offers no contact-method choice, and the request is stored as in-app', async ({ browser }) => {
  const target = await approvedProvider(owner, admin, 'S5A Request Target')
  const page = await signInAs(browser, resident)
  await page.goto(`/providers/${target.id}`)
  await expectH1(page, target.name)
  await page.getByRole('button', { name: 'Request Service' }).click()
  const dialog = page.getByRole('dialog', { name: /Request / })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Preferred contact method')).toHaveCount(0)
  await expect(dialog.getByRole('option', { name: /whatsapp|phone/i })).toHaveCount(0)
  await expect(dialog).toContainText('You can follow its progress in My Requests')
  await expect(dialog).not.toContainText(/hint to the provider/i)

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await dialog.getByLabel('What do you need?').fill('A tap is leaking in the kitchen sink.')
  await dialog.getByLabel('Area / Location').fill('B-17, Block C')
  await dialog.getByLabel('Preferred Date').fill(tomorrow)
  await dialog.getByRole('button', { name: /Submit Request/ }).click()
  await expect(dialog.getByText('Request sent')).toBeVisible()
  expect(
    scalar(
      `SELECT preferred_contact_channel FROM service_requests WHERE provider_listing_id = '${target.id}' AND requester_id = (SELECT id FROM users WHERE email = '${resident.email}')`
    )
  ).toBe('in_app')

  // The request detail does not print a pointless "prefers in-app" line.
  await page.goto('/profile/requests')
  await page.getByRole('button').filter({ hasText: target.name }).first().click()
  await expect(page.getByRole('dialog')).not.toContainText(/prefers to be reached/i)

  // The API still accepts the historic values (a stored whatsapp / phone preference stays valid).
  const api = await ApiClient.shared(resident.email)
  const other = await approvedProvider(owner, admin, 'S5A Historic Target')
  const historic = await api.call('POST', '/requests', {
    providerListingId: other.id,
    service: 'Plumbing',
    details: 'A historic client that still sends a phone preference.',
    area: 'B-17',
    preferredDate: tomorrow,
    preferredContactChannel: 'phone',
  })
  expect(historic.status).toBe(201)
  await api.dispose()
  await page.context().close()
})

test('password reset: the screen says a link was REQUESTED (never sent or on its way), identically for any address, and the request is recorded for a real account only', async ({ browser }) => {
  const context = await newContext(browser)
  const page = await context.newPage()
  const known = resident.email
  const countTokens = (email: string) =>
    Number(scalar(`SELECT count(*) FROM auth_tokens WHERE purpose = 'password_reset' AND user_id IN (SELECT id FROM users WHERE email = '${email}')`))
  expect(countTokens(known)).toBe(0)

  const request = async (email: string) => {
    await page.goto('/forgot-password')
    await expectH1(page, 'Forgot password')
    // Before anything is asked, the page does not promise to send anything.
    await expect(page.getByText('Enter your email address to request a link to reset your password.')).toBeVisible()
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    const status = page.getByRole('status').filter({ hasText: /if an account exists/i })
    await expect(status).toBeVisible()
    return (await status.textContent()) ?? ''
  }

  const forKnown = await request(known)
  const forUnknown = await request(emailFor('s5a-nobody-at-all'))
  const neutral = 'If an account exists for that email address, a password reset link was requested for it. Reset links expire after one hour.'
  expect(forKnown).toContain(neutral)
  expect(forUnknown).toContain(neutral)
  await expect(page.locator('body')).not.toContainText(/on its way|we.ll send|we sent|has been sent|check your inbox/i)
  // Development only: the one line that says how a link is obtained, and that nothing is e-mailed.
  await expect(page.getByTestId('dev-reset-hint')).toContainText('no e-mail is sent')

  // The server recorded a request for the real account (it did not pretend to deliver anything) and for no one else.
  expect(countTokens(known)).toBe(1)
  expect(Number(scalar(`SELECT count(*) FROM users WHERE email = '${emailFor('s5a-nobody-at-all')}'`))).toBe(0)
  await context.close()
})

test('review dialog: after rejecting one listing, opening another never shows the previous reject form or text', async () => {
  const o = await ApiClient.shared(owner.email)
  const names = [unique('S5A Dialog A'), unique('S5A Dialog B')]
  for (const name of names) {
    const created = await o.call('POST', '/listings', {
      kind: 'provider',
      name,
      category: 'plumbing',
      description: `${name} - plumbing repairs across B-17.`,
      area: 'B-17',
      tags: ['plumbing'],
      location: { visibility: 'area_only' },
    })
    expect(created.status).toBe(201)
  }
  await o.dispose()

  await adminPage.goto('/admin/moderation')
  await expectH1(adminPage, 'Listing Review')
  await adminPage.getByRole('radio', { name: /^All/ }).click()
  const reason = 'Please add the shop opening hours and a clearer description.'
  await adminPage.getByRole('button', { name: `Review ${names[0]}` }).click()
  let dialog = adminPage.getByRole('dialog', { name: 'Review Listing' })
  await dialog.getByRole('button', { name: /^Reject$/ }).click()
  await dialog.getByLabel(/Rejection reason/).fill(reason)
  await dialog.getByRole('button', { name: /Confirm Rejection/ }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })

  // No reload and no navigation: the same mounted panel opens for the next listing.
  await adminPage.getByRole('button', { name: `Review ${names[1]}` }).click()
  dialog = adminPage.getByRole('dialog', { name: 'Review Listing' })
  await expect(dialog.getByRole('button', { name: /^Approve$/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^Reject$/ })).toBeVisible()
  await expect(dialog.getByLabel(/Rejection reason/)).toHaveCount(0)
  await expect(dialog).not.toContainText(reason)

  // Its own reject form starts empty; abandoning it and opening the same listing again is clean as well.
  await dialog.getByRole('button', { name: /^Reject$/ }).click()
  await expect(dialog.getByLabel(/Rejection reason/)).toHaveValue('')
  await dialog.getByLabel(/Rejection reason/).fill('A half-typed reason that is abandoned.')
  await adminPage.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await adminPage.getByRole('button', { name: `Review ${names[1]}` }).click()
  dialog = adminPage.getByRole('dialog', { name: 'Review Listing' })
  await expect(dialog.getByRole('button', { name: /^Reject$/ })).toBeVisible()
  await expect(dialog.getByLabel(/Rejection reason/)).toHaveCount(0)
  await expect(dialog).not.toContainText('half-typed')
  await adminPage.keyboard.press('Escape')
})
