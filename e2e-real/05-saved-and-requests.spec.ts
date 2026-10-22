import { expect, test, type Page } from '@playwright/test'
import { ApiClient, createUser, expectH1, rows, scalar, signInAs, type TestUser } from './helpers/stack'
import { approvedProvider, takedownInUi, unique } from './helpers/ui'

/**
 * Journeys 16-21: Saved (server-backed, survives reload, hides unavailable listings), service requests
 * (create guards, the full lifecycle, the cancel matrix, stale actions, survival across takedown).
 */
test.describe.configure({ mode: 'serial' })

let owner: TestUser
let admin: TestUser
let requester: TestUser
let saver: TestUser
let adminPage: Page
let ownerPage: Page

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const requestRow = (id: string) => rows(`SELECT status, preferred_contact_channel, provider_listing_id, requester_id FROM service_requests WHERE id = '${id}'`)[0]!
const history = (id: string) => rows(`SELECT COALESCE(from_status,'-'), to_status, actor_role FROM service_request_status_history WHERE request_id = '${id}' ORDER BY created_at, id`).map((r) => r.join('>'))

/** Owner and Admin share one session each (the per-user session cap would otherwise end the owner's browser session). */
async function login(user: TestUser): Promise<ApiClient> {
  if (user.email === owner?.email || user.email === admin?.email) return ApiClient.shared(user.email)
  const api = await ApiClient.create()
  await api.login(user.email)
  return api
}

function requestBody(listingId: string, details = 'Please quote a kitchen plumbing fix for next week.') {
  return { providerListingId: listingId, service: 'Plumbing', details, area: 'B-17, Block A', preferredDate: tomorrow(), preferredContactChannel: 'in_app' }
}

/** Requester API: creates a request against `listingId`, returns its id. */
async function apiCreate(who: ApiClient, listingId: string): Promise<string> {
  const r = await who.call('POST', '/requests', requestBody(listingId))
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body!.data.id as string
}

test.beforeAll(async ({ browser }) => {
  owner = await createUser('req-owner', { professional: 'premium' })
  admin = await createUser('req-admin', { admin: true })
  requester = await createUser('requester')
  saver = await createUser('saver')
  adminPage = await signInAs(browser, admin)
  ownerPage = await signInAs(browser, owner)
})

test.afterAll(async () => {
  await adminPage?.context().close()
  await ownerPage?.context().close()
})

// ---------------------------------------------------------------------------------------- Saved

test('Saved: heart -> stored on the server -> Saved page -> reload -> duplicate save is idempotent -> unsave -> gone', async ({ browser }) => {
  const listing = await approvedProvider(owner, admin, 'Saved Provider')
  const page = await signInAs(browser, saver)
  await page.goto(`/providers/${listing.id}`)
  await expectH1(page, listing.name)
  await page.getByRole('button', { name: `Save ${listing.name}` }).click()
  await expect(page.getByRole('button', { name: `Remove ${listing.name} from saved` })).toHaveAttribute('aria-pressed', 'true')
  expect(scalar(`SELECT count(*) FROM saved_items WHERE listing_id = '${listing.id}' AND user_id = (SELECT id FROM users WHERE email = '${saver.email}')`)).toBe('1')

  await page.goto('/profile/saved')
  await expectH1(page, 'Saved')
  await expect(page.getByText(listing.name).first()).toBeVisible()
  await page.reload()
  await expectH1(page, 'Saved')
  await expect(page.getByText(listing.name).first()).toBeVisible()
  const keys = await page.evaluate(() => Object.keys(window.localStorage).concat(Object.keys(window.sessionStorage)))
  for (const key of keys) expect(key).not.toMatch(/saved|resident|plan|request|professional|listing/i)

  // Saving twice is valid and idempotent (the API, as a second device would do it).
  const second = await login(saver)
  expect((await second.call('PUT', `/saved/${listing.id}`)).status).toBeLessThan(300)
  expect((await second.call('PUT', `/saved/${listing.id}`)).status).toBeLessThan(300)
  expect(scalar(`SELECT count(*) FROM saved_items WHERE listing_id = '${listing.id}'`)).toBe('1')
  await second.dispose()

  await page.getByRole('button', { name: new RegExp(`Remove ${listing.name} from saved`) }).first().click()
  await expect(page.getByText(listing.name)).toHaveCount(0)
  await page.reload()
  await expectH1(page, 'Saved')
  await expect(page.getByText(listing.name)).toHaveCount(0)
  expect(scalar(`SELECT count(*) FROM saved_items WHERE listing_id = '${listing.id}'`)).toBe('0')
  await page.context().close()
})

test('Saved + takedown: the Saved page omits the unavailable listing and leaks nothing; the relation survives; re-approval brings it back', async ({ browser }) => {
  const listing = await approvedProvider(owner, admin, 'Saved Then Taken Down')
  const s = await login(saver)
  expect((await s.call('PUT', `/saved/${listing.id}`)).status).toBeLessThan(300)

  await takedownInUi(adminPage, listing.name, 'Temporarily removed while we verify the licence.')
  const list = await s.call('GET', '/saved?limit=50')
  expect(JSON.stringify(list.body)).not.toContain(listing.id) // omitted, and nothing about it leaks
  expect(JSON.stringify(list.body)).not.toContain(listing.name)
  expect(scalar(`SELECT count(*) FROM saved_items WHERE listing_id = '${listing.id}'`)).toBe('1') // kept internally

  const page = await signInAs(browser, saver, '/profile/saved')
  await expectH1(page, 'Saved')
  await expect(page.getByText(listing.name)).toHaveCount(0)

  // The owner fixes and resubmits, the admin approves again: it reappears for the saver.
  const o = await login(owner)
  const fixed = await o.call('PATCH', `/listings/${listing.id}`, { revision: Number(scalar(`SELECT revision FROM listings WHERE id = '${listing.id}'`)), description: 'Licence verified - plumbing repairs and fittings across B-17.' })
  expect(fixed.status).toBe(200)
  const a = await login(admin)
  expect((await a.call('POST', `/admin/listings/${listing.id}/approve`, { revision: fixed.body!.data.revision })).status).toBe(200)
  await page.reload()
  await expect(page.getByText(listing.name).first()).toBeVisible()
  await Promise.all([s.dispose(), o.dispose(), a.dispose(), page.context().close()])
})

// ----------------------------------------------------------------------------------- Requests

test('a request is created through the real dialog: no client-controlled provider, stored as submitted with its contact preference; requester and provider both see it after reload', async ({ browser }) => {
  const listing = await approvedProvider(owner, admin, 'Lifecycle Plumbing')
  const page = await signInAs(browser, requester)
  await page.goto(`/providers/${listing.id}`)
  await expectH1(page, listing.name)
  await page.getByRole('button', { name: 'Request Service' }).click()
  const dialog = page.getByRole('dialog', { name: /Request / })
  await dialog.getByLabel('What do you need?').fill('Please quote a kitchen plumbing fix - P12I lifecycle.')
  await dialog.getByLabel('Area / Location').fill('B-17, Block A')
  await dialog.getByLabel('Preferred Date').fill(tomorrow())
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/requests')),
    dialog.getByRole('button', { name: /Submit Request/ }).click(),
  ])
  expect(response.status()).toBe(201)
  const sent = JSON.parse(response.request().postData() ?? '{}') as Record<string, unknown>
  for (const forbidden of ['providerId', 'providerUserId', 'ownerId', 'requesterId', 'status', 'providerName', 'id', 'history']) expect(sent, forbidden).not.toHaveProperty(forbidden)
  expect(sent.providerListingId).toBe(listing.id)
  const id = (await response.json()).data.id as string
  await expect(dialog.getByText('Request sent')).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()

  const [status, channel, providerListing, requesterId] = requestRow(id)
  expect([status, channel, providerListing]).toEqual(['submitted', 'in_app', listing.id])
  expect(requesterId).toBe(scalar(`SELECT id FROM users WHERE email = '${requester.email}'`))
  expect(history(id)).toEqual(['->submitted>requester'])

  await page.goto('/profile/requests')
  await page.reload()
  await expectH1(page, 'My Requests')
  await expect(page.getByRole('button').filter({ hasText: listing.name }).filter({ hasText: 'Submitted' }).first()).toBeVisible()

  await ownerPage.goto('/provider/leads')
  await expectH1(ownerPage, 'Leads')
  await expect(ownerPage.getByRole('button').filter({ hasText: requester.name }).first()).toBeVisible()
  await page.context().close()

  // ---- the full lifecycle in the provider's UI: accept -> start -> complete ----
  for (const [action, badge] of [['Accept', /Accepted/], ['Start work', /In Progress/], ['Mark complete', /Completed/]] as const) {
    await ownerPage.getByRole('button').filter({ hasText: requester.name }).first().click()
    const lead = ownerPage.getByRole('dialog')
    // Only the valid controls for this state are offered.
    await expect(lead.getByRole('button', { name: action })).toBeVisible()
    await lead.getByRole('button', { name: action }).click()
    await expect(lead).toBeHidden({ timeout: 15_000 })
    await expect(ownerPage.getByText(badge).first()).toBeVisible()
  }
  expect(requestRow(id)[0]).toBe('completed')
  expect(history(id)).toEqual(['->submitted>requester', 'submitted>accepted>provider', 'accepted>in-progress>provider', 'in-progress>completed>provider'])

  // The requester logs in afresh: Completed, the story in order, and no actions left.
  const again = await signInAs(browser, requester, '/profile/requests')
  await expectH1(again, 'My Requests')
  const row = again.getByRole('button').filter({ hasText: listing.name }).first()
  await expect(row).toContainText('Completed')
  await row.click()
  const detail = again.getByRole('dialog')
  await expect(detail.getByRole('button', { name: /Cancel request|Accept|Start work|Mark complete/ })).toHaveCount(0)
  // The history is the server's, in order, with roles only (no synthetic frontend entries).
  const historyList = detail.locator('ol').filter({ hasText: /by (you|the )/ }) // the History list, not the status stepper
  await expect(historyList.getByRole('listitem')).toHaveCount(4)
  const steps = await historyList.getByRole('listitem').allInnerTexts()
  expect(steps.map((s) => s.split(/\s+by\s+/)[0]!.trim())).toEqual(['Submitted', 'Accepted', 'Marked in progress', 'Completed'])
  expect(steps[0]).toContain('by you') // the viewer is the requester
  expect(steps[3]).toContain('by the provider')
  await again.context().close()
})

test('creation guards: own listing, an unavailable (pending) listing and a non-requestable kind are refused with the real error and create nothing', async ({ browser }) => {
  const own = await approvedProvider(owner, admin, 'Own Listing')
  const before = scalar(`SELECT count(*) FROM service_requests`)

  // Own listing - through the UI dialog as the owner.
  await ownerPage.goto(`/providers/${own.id}`)
  await expectH1(ownerPage, own.name)
  await ownerPage.getByRole('button', { name: 'Request Service' }).click()
  const dialog = ownerPage.getByRole('dialog', { name: /Request / })
  await dialog.getByLabel('What do you need?').fill('Trying to request my own listing, which must be refused.')
  await dialog.getByLabel('Area / Location').fill('B-17')
  await dialog.getByLabel('Preferred Date').fill(tomorrow())
  const [own422] = await Promise.all([
    ownerPage.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/requests')),
    dialog.getByRole('button', { name: /Submit Request/ }).click(),
  ])
  expect(own422.status()).toBeGreaterThanOrEqual(400)
  expect(JSON.stringify(await own422.json())).toContain('own_listing')
  await expect(dialog.getByRole('alert').first()).toContainText('You cannot send a request to your own listing') // the real 422 shape, mapped to clear copy
  await expect(dialog.getByText('Request sent')).toHaveCount(0)
  await dialog.getByRole('button', { name: /Close|Cancel/ }).first().click().catch(() => ownerPage.keyboard.press('Escape'))

  // Unavailable (pending) listing, and a non-requestable kind (a Business) - the API's real answers.
  const r = await login(requester)
  const o = await login(owner)
  const pending = await o.call('POST', '/listings', { kind: 'provider', name: unique('Still Pending'), category: 'plumbing', description: 'A pending listing cannot receive requests yet.', area: 'B-17', tags: ['x'], location: { visibility: 'area_only' } })
  expect(pending.status).toBe(201)
  const notYet = await r.call('POST', '/requests', requestBody(pending.body!.data.id))
  expect(notYet.status).toBeGreaterThanOrEqual(400)
  const business = await o.call('POST', '/listings', { kind: 'business', vertical: 'general', name: unique('A Shop'), category: 'pharmacy', description: 'A shop is not a requestable service provider.', area: 'B-17', tags: ['x'], location: { visibility: 'area_only' } })
  const a = await login(admin)
  expect((await a.call('POST', `/admin/listings/${business.body!.data.id}/approve`, { revision: business.body!.data.revision })).status).toBe(200)
  const wrongKind = await r.call('POST', '/requests', requestBody(business.body!.data.id))
  expect(wrongKind.status).toBeGreaterThanOrEqual(400)
  expect(wrongKind.status).toBe(422)
  expect(wrongKind.body!.error!.code).toBe('validation_error')
  expect(wrongKind.body!.error!.details!.map((d) => d.code)).toContain('not_requestable')
  expect(scalar(`SELECT count(*) FROM service_requests`)).toBe(before) // nothing was created by any of the three
  await Promise.all([r.dispose(), o.dispose(), a.dispose()])
  void browser
})

test('cancel matrix: requester may cancel submitted / accepted but NOT in-progress; provider may cancel all three; terminal states are final', async ({ browser }) => {
  // One shared listing, one requester per scenario (the real limits are per requester and per requester+listing).
  const matrix = await approvedProvider(owner, admin, 'Cancel Matrix')
  const users = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => createUser(`mx-${k}`)))
  const apis = await Promise.all(users.map((u) => login(u)))
  const o = await login(owner)
  const act = async (who: ApiClient, id: string, action: string) => (await who.call('POST', `/requests/${id}/${action}`, {})).status
  const [a, b, c, d, e, f] = await Promise.all(apis.map((api) => apiCreate(api, matrix.id)))

  // A: the requester cancels a SUBMITTED request through the UI (confirm dialog).
  const page = await signInAs(browser, users[0]!, '/profile/requests')
  page.on('dialog', (dlg) => void dlg.accept())
  await expectH1(page, 'My Requests')
  await page.getByRole('button').filter({ hasText: matrix.name }).filter({ hasText: 'Submitted' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel request' }).click()
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 })
  expect(requestRow(a!)[0]).toBe('cancelled')
  await page.context().close()

  // B: accepted -> the requester may still cancel.
  expect(await act(o, b!, 'accept')).toBe(200)
  expect(await act(apis[1]!, b!, 'cancel')).toBe(200)
  // C: in-progress -> the requester may NOT cancel (409), the provider may.
  expect(await act(o, c!, 'accept')).toBe(200)
  expect(await act(o, c!, 'start')).toBe(200)
  expect(await act(apis[2]!, c!, 'cancel')).toBe(409)
  expect(requestRow(c!)[0]).toBe('in-progress')
  expect(await act(o, c!, 'cancel')).toBe(200)
  // D / E: the provider cancels a submitted and an accepted request.
  expect(await act(o, d!, 'cancel')).toBe(200)
  expect(await act(o, e!, 'accept')).toBe(200)
  expect(await act(o, e!, 'cancel')).toBe(200)
  // F: a requester may not accept / start / complete at all.
  for (const action of ['accept', 'start', 'complete']) expect(await act(apis[5]!, f!, action), action).toBe(403) // role has no authority: forbidden
  // ...and the provider cannot skip a step (submitted -> in-progress / completed): invalid_state_transition.
  for (const action of ['start', 'complete']) expect(await act(o, f!, action), action).toBe(409)
  expect(requestRow(f!)[0]).toBe('submitted')
  // Terminal states cannot transition.
  const byRequester = [apis[0]!, apis[1]!, apis[2]!, apis[3]!, apis[4]!]
  for (const [index, id] of [a!, b!, c!, d!, e!].entries()) {
    for (const [who, action] of [[o, 'accept'], [o, 'start'], [o, 'complete'], [o, 'cancel'], [byRequester[index]!, 'cancel']] as const) expect(await act(who, id, action), `${id} ${action}`).toBe(409)
    expect(requestRow(id)[0]).toBe('cancelled')
  }
  await Promise.all([o.dispose(), ...apis.map((api) => api.dispose())])
})

test('stale UI actions: a stale Cancel / Accept is refused 409, the UI refreshes to the latest state and shows no false success; a concurrent complete-vs-cancel has one winner', async ({ browser }) => {
  const shared = await approvedProvider(owner, admin, 'Stale Shared')
  const [s1, s2, s3] = await Promise.all(['stale-1', 'stale-2', 'stale-3'].map((k) => createUser(k)))
  const [r1, r2, r3] = await Promise.all([s1!, s2!, s3!].map((u) => login(u)))
  const o = await login(owner)

  // The requester's page shows "submitted"; the provider cancels meanwhile; the requester clicks Cancel.
  const id1 = await apiCreate(r1!, shared.id)
  const page = await signInAs(browser, s1!, '/profile/requests')
  page.on('dialog', (dlg) => void dlg.accept())
  await expectH1(page, 'My Requests')
  await page.getByRole('button').filter({ hasText: shared.name }).filter({ hasText: 'Submitted' }).first().click()
  const dialog = page.getByRole('dialog')
  expect(await o.call('POST', `/requests/${id1}/cancel`, {}).then((x) => x.status)).toBe(200) // the provider got there first
  const [stale] = await Promise.all([
    page.waitForResponse((x) => x.url().endsWith(`/requests/${id1}/cancel`)),
    dialog.getByRole('button', { name: 'Cancel request' }).click(),
  ])
  expect(stale.status()).toBe(409)
  expect(JSON.stringify(await stale.json())).toContain('invalid_state_transition')
  await expect(page.getByText(/Request cancelled|cancelled your request/i)).toHaveCount(0) // no false success
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button').filter({ hasText: shared.name }).first()).toContainText('Cancelled')
  expect(requestRow(id1)[0]).toBe('cancelled')
  await page.context().close()

  // The provider's page shows "submitted"; the requester cancels meanwhile; the provider clicks Accept.
  const id2 = await apiCreate(r2!, shared.id)
  await ownerPage.goto('/provider/leads')
  await expectH1(ownerPage, 'Leads')
  await ownerPage.getByRole('button').filter({ hasText: s2!.name }).filter({ hasText: 'Submitted' }).first().click()
  const lead = ownerPage.getByRole('dialog')
  expect(await r2!.call('POST', `/requests/${id2}/cancel`, {}).then((x) => x.status)).toBe(200)
  const [staleAccept] = await Promise.all([
    ownerPage.waitForResponse((x) => x.url().endsWith(`/requests/${id2}/accept`)),
    lead.getByRole('button', { name: 'Accept' }).click(),
  ])
  expect(staleAccept.status()).toBe(409)
  expect(requestRow(id2)[0]).toBe('cancelled')
  await ownerPage.keyboard.press('Escape')
  await ownerPage.reload()
  await expect(ownerPage.getByRole('button').filter({ hasText: s2!.name }).first()).toContainText('Cancelled')

  // Two incompatible actions at the same instant: exactly one wins and the result is consistent.
  const id3 = await apiCreate(r3!, shared.id)
  expect(await o.call('POST', `/requests/${id3}/accept`, {}).then((x) => x.status)).toBe(200)
  expect(await o.call('POST', `/requests/${id3}/start`, {}).then((x) => x.status)).toBe(200)
  const [complete, cancel] = await Promise.all([o.call('POST', `/requests/${id3}/complete`, {}), o.call('POST', `/requests/${id3}/cancel`, {})])
  expect([complete.status, cancel.status].sort()).toEqual([200, 409])
  expect(requestRow(id3)[0]).toBe(complete.status === 200 ? 'completed' : 'cancelled')
  expect(history(id3).filter((h) => h.startsWith('in-progress>')).length).toBe(1) // one terminal transition, not two
  await Promise.all([r1!.dispose(), r2!.dispose(), r3!.dispose(), o.dispose()])
})

test('a request survives its listing being taken down: still readable and actionable by both parties; no NEW request can be made', async () => {
  const listing = await approvedProvider(owner, admin, 'Takedown With Request')
  const r = await login(requester)
  const o = await login(owner)
  const id = await apiCreate(r, listing.id)

  await takedownInUi(adminPage, listing.name, 'Removed after a licence check, please contact support.')
  expect((await publicGetStatus(listing.id))).toBe(404)

  const mine = await r.call('GET', `/requests/${id}`)
  expect(mine.status).toBe(200)
  expect(mine.body!.data.providerName).toBe(listing.name) // the snapshot keeps the story readable
  const leads = await o.call('GET', '/users/me/leads?limit=50')
  expect(JSON.stringify(leads.body)).toContain(id)
  expect((await o.call('POST', `/requests/${id}/accept`, {})).status).toBe(200) // still actionable
  expect((await r.call('POST', `/requests/${id}/cancel`, {})).status).toBe(200)
  expect(requestRow(id)[0]).toBe('cancelled')

  const other = await createUser('requester-late')
  const late = await login(other)
  const refused = await late.call('POST', '/requests', requestBody(listing.id))
  expect(refused.status).toBeGreaterThanOrEqual(400)
  expect(scalar(`SELECT count(*) FROM service_requests WHERE provider_listing_id = '${listing.id}'`)).toBe('1')
  await Promise.all([r.dispose(), o.dispose(), late.dispose()])
})

async function publicGetStatus(id: string): Promise<number> {
  return (await fetch(`http://127.0.0.1:8000/api/v1/listings/${id}`)).status
}

test('rate limits: the 6th request in an hour, and a 2nd request to the same provider in a day, are refused 429 with clear copy; nothing extra is created', async ({ browser }) => {
  const limited = await createUser('rate-requester')
  const api = await login(limited)
  const rateOwner = await createUser('rate-owner', { professional: 'premium' }) // the listing-create limit is 10/hour per owner
  const listings = await Promise.all(['Rate A', 'Rate B', 'Rate C', 'Rate D', 'Rate E', 'Rate F'].map((n) => approvedProvider(rateOwner, admin, n)))
  for (const l of listings.slice(0, 5)) await apiCreate(api, l.id)
  expect(scalar(`SELECT count(*) FROM service_requests WHERE requester_id = (SELECT id FROM users WHERE email = '${limited.email}')`)).toBe('5')

  // The 6th, through the real dialog: 429 and a visible, honest message; no request is stored.
  const page = await signInAs(browser, limited)
  await page.goto(`/providers/${listings[5]!.id}`)
  await expectH1(page, listings[5]!.name)
  await page.getByRole('button', { name: 'Request Service' }).click()
  const dialog = page.getByRole('dialog', { name: /Request / })
  await dialog.getByLabel('What do you need?').fill('A sixth request within the hour must be rate limited.')
  await dialog.getByLabel('Area / Location').fill('B-17')
  await dialog.getByLabel('Preferred Date').fill(tomorrow())
  const [limit] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/requests')),
    dialog.getByRole('button', { name: /Submit Request/ }).click(),
  ])
  expect(limit.status()).toBe(429)
  expect(limit.headers()['retry-after']).toBeTruthy()
  await expect(dialog.getByRole('alert').first()).toContainText(/Too many/i)
  await expect(dialog.getByText('Request sent')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /Submit Request/ })).toBeEnabled() // the form recovers
  expect(scalar(`SELECT count(*) FROM service_requests WHERE requester_id = (SELECT id FROM users WHERE email = '${limited.email}')`)).toBe('5')

  // The per-provider limit: a different user, the same provider twice in a day.
  const twice = await createUser('rate-requester-2')
  const t = await login(twice)
  await apiCreate(t, listings[0]!.id)
  const second = await t.call('POST', '/requests', requestBody(listings[0]!.id))
  expect(second.status).toBe(429)
  await Promise.all([api.dispose(), t.dispose(), page.context().close()])
})
