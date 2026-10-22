import { expect, test, type Page, type Route } from '@playwright/test'
import { ApiClient, API, PASSWORD, createUser, expectH1, loginOn, ownerCard, psql, rows, scalar, signInAs, type TestUser, newContext } from './helpers/stack'
import { approvedProvider, createProvider, openCreateForm, unique } from './helpers/ui'

/**
 * Journeys 26-31: CSRF / Origin, session expiry, the Free quota, auth rate limiting, network failure on every
 * kind of write, and stale reads after a write - all against the real API and database.
 */
test.describe.configure({ mode: 'serial' })

let admin: TestUser
let owner: TestUser
let adminPage: Page

test.beforeAll(async ({ browser }) => {
  admin = await createUser('res-admin', { admin: true })
  owner = await createUser('res-owner', { professional: 'premium' })
  adminPage = await signInAs(browser, admin)
})
test.afterAll(async () => {
  await adminPage?.context().close()
})

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const listingBody = (name: string) => ({ kind: 'provider', name, category: 'plumbing', description: `${name} - plumbing repairs across B-17.`, area: 'B-17', tags: ['plumbing'], location: { visibility: 'area_only' } })

/** Aborts the next matching request (simulating an interrupted network), lets later ones through. */
async function failOnce(page: Page, method: string, url: RegExp): Promise<{ restore: () => Promise<void>; hits: () => number }> {
  let hits = 0
  const handler = async (route: Route) => {
    if (route.request().method() === method && hits === 0) {
      hits += 1
      await route.abort('failed')
    } else {
      await route.fallback()
    }
  }
  await page.route(url, handler)
  return { restore: () => page.unroute(url, handler), hits: () => hits }
}

// ------------------------------------------------------------------------- CSRF / Origin / session

test('CSRF and Origin: the app’s writes carry the token; a missing or tampered token and a foreign Origin are refused by the backend', async ({ browser }) => {
  const page = await signInAs(browser, owner)
  const seen: Record<string, string | undefined> = {}
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().startsWith(API)) seen[`${r.method()} ${new URL(r.url()).pathname.replace('/api/v1', '').replace(/[0-9a-f-]{36}/g, ':id')}`] = r.headers()['x-csrf-token']
  })
  // Representative unsafe calls made BY THE APP: listing create (UI), Saved PUT and request POST via the UI below.
  const id = await createProvider(page, { name: unique('Csrf Provider'), category: 'Plumbing' })
  expect(seen['POST /listings']).toBeTruthy()
  await page.context().close()

  // Direct backend checks with a real session: no token, a wrong token, a foreign Origin.
  const raw = await ApiClient.create()
  await raw.login(owner.email)
  const noToken = await raw.call('POST', '/listings', listingBody(unique('No Token')), { 'X-CSRF-Token': '' })
  expect([401, 403]).toContain(noToken.status)
  expect(noToken.body!.error!.code).toBe('csrf_failed')
  const wrong = await raw.call('POST', '/listings', listingBody(unique('Wrong Token')), { 'X-CSRF-Token': 'not-the-token' })
  expect(wrong.status).toBe(403)
  expect(wrong.body!.error!.code).toBe('csrf_failed')
  const foreign = await raw.call('POST', '/listings', listingBody(unique('Foreign Origin')), { Origin: 'http://evil.example' })
  expect([401, 403]).toContain(foreign.status)
  expect(scalar(`SELECT count(*) FROM listings WHERE title IN ('${unique('No Token')}','${unique('Wrong Token')}','${unique('Foreign Origin')}')`)).toBe('0')
  expect(id).toBeTruthy()
  await raw.dispose()
})

test('session expiry: a write after the session was revoked gives no false success, ends the authenticated state, and creates nothing', async ({ browser }) => {
  const victim = await createUser('res-expiring', { professional: 'premium' })
  const page = await signInAs(browser, victim)
  await openCreateForm(page, /Service \/ Professional/)
  const name = unique('Expired Session Listing')
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Service Category').selectOption({ label: 'Plumbing' })
  await page.getByLabel('Description', { exact: true }).fill('A listing submitted after the session expired must not be created.')
  await page.getByLabel('Area', { exact: true }).fill('B-17')
  await page.getByLabel(/Services Offered/).fill('plumbing, repairs')

  psql(`UPDATE auth_sessions SET revoked_at = now(), revoke_reason = 'admin_action' WHERE user_id = (SELECT id FROM users WHERE email = '${victim.email}')`) // the session "expires" server-side
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url() === `${API}/listings`),
    page.getByRole('button', { name: 'Preview Listing' }).click(),
  ])
  expect(response.status()).toBe(401)
  await expect(page.getByText(/submitted for review/i)).toHaveCount(0)
  expect(scalar(`SELECT count(*) FROM listings WHERE title = '${name}'`)).toBe('0')
  // The authenticated state ended: the existing auth flow takes over (Log In), no token fallback.
  await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toBeVisible({ timeout: 20_000 })
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toMatch(/token|bearer|jwt/i)
  await page.context().close()
})

test('login rate limit: repeated failures are throttled (429) and the form says so; the API keeps the lock', async ({ browser }) => {
  const target = await createUser('res-throttled')
  const api = await ApiClient.create()
  for (let i = 0; i < 10; i += 1) {
    const r = await api.call('POST', '/auth/login', { email: target.email, password: 'definitely not the password' })
    expect(r.status).toBe(401)
  }
  const context = await newContext(browser)
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(target.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD) // even the CORRECT password is throttled now
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url() === `${API}/auth/login`),
    page.getByRole('button', { name: 'Log In', exact: true }).click(),
  ])
  expect(response.status()).toBe(429)
  await expect(page.getByRole('alert').first()).toContainText(/too many|try again/i)
  await expectH1(page, 'Log In') // still anonymous
  await api.dispose()
  await context.close()
})

// --------------------------------------------------------------------------------------------- quota

test('Free plan quota: the 4th active listing is refused (plan_limit_reached), nothing is created, nothing is upgraded locally; archiving frees a slot', async ({ browser }) => {
  const free = await createUser('res-free', { professional: 'free' })
  const api = await ApiClient.create()
  await api.login(free.email)
  const ids: string[] = []
  for (const n of ['One', 'Two', 'Three']) {
    const r = await api.call('POST', '/listings', listingBody(unique(`Quota ${n}`)))
    expect(r.status).toBe(201)
    ids.push(r.body!.data.id)
  }
  const page = await signInAs(browser, free)
  await openCreateForm(page, /Service \/ Professional/)
  const fourth = unique('Quota Four')
  await page.getByLabel('Name', { exact: true }).fill(fourth)
  await page.getByLabel('Service Category').selectOption({ label: 'Plumbing' })
  await page.getByLabel('Description', { exact: true }).fill('The fourth active listing on the Free plan must be refused by the server.')
  await page.getByLabel('Area', { exact: true }).fill('B-17')
  await page.getByLabel(/Services Offered/).fill('plumbing, repairs')
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url() === `${API}/listings`),
    page.getByRole('button', { name: 'Preview Listing' }).click(),
  ])
  expect(response.status()).toBe(403)
  expect(JSON.stringify(await response.json())).toContain('plan_limit_reached')
  await expect(page.getByRole('alert').first()).toContainText(/limit/i)
  await expect(page.getByText(/submitted for review/i)).toHaveCount(0)
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(fourth) // the input is kept
  expect(scalar(`SELECT count(*) FROM listings WHERE owner_id = (SELECT id FROM users WHERE email = '${free.email}') AND status <> 'archived'`)).toBe('3')
  expect(scalar(`SELECT plan_code FROM professional_profiles WHERE user_id = (SELECT id FROM users WHERE email = '${free.email}')`)).toBe('free')

  // The existing three are intact; archiving one frees the slot and the same form then succeeds.
  await page.goto('/provider/listings')
  for (const n of ['One', 'Two', 'Three']) await expect(ownerCard(page, unique(`Quota ${n}`))).toBeVisible()
  expect((await api.call('POST', `/listings/${ids[0]}/archive`, { revision: 1 })).status).toBe(200)
  const created = await api.call('POST', '/listings', listingBody(fourth))
  expect(created.status).toBe(201)
  await api.dispose()
  await page.context().close()
})

// ------------------------------------------------------------------------------------ network failure

test('network failure: no fake success on listing create / edit, Saved, request create, request action or Admin moderation; the UI recovers and a retry works', async ({ browser }) => {
  const approvedFor = await approvedProvider(owner, admin, 'Network Provider')
  const requester = await createUser('res-net-requester')
  const saver = await createUser('res-net-saver')
  const pendingName = unique('Network Pending')
  const o = await ApiClient.create()
  await o.login(owner.email)
  const pending = await o.call('POST', '/listings', listingBody(pendingName))
  expect(pending.status).toBe(201)
  await o.dispose()

  // 1. listing CREATE
  const ownerPage = await signInAs(browser, owner)
  await openCreateForm(ownerPage, /Service \/ Professional/)
  const name = unique('Network Create')
  await ownerPage.getByLabel('Name', { exact: true }).fill(name)
  await ownerPage.getByLabel('Service Category').selectOption({ label: 'Plumbing' })
  await ownerPage.getByLabel('Description', { exact: true }).fill('This listing is submitted while the network is down, then retried.')
  await ownerPage.getByLabel('Area', { exact: true }).fill('B-17')
  await ownerPage.getByLabel(/Services Offered/).fill('plumbing, repairs')
  let net = await failOnce(ownerPage, 'POST', /\/api\/v1\/listings$/)
  await ownerPage.getByRole('button', { name: 'Preview Listing' }).click()
  await expect.poll(() => net.hits()).toBe(1)
  await expect(ownerPage.getByText(/submitted for review/i)).toHaveCount(0)
  await expect(ownerPage.getByLabel('Name', { exact: true })).toHaveValue(name) // input retained
  await expect(ownerPage.getByRole('button', { name: 'Preview Listing' })).toBeEnabled() // recovered
  expect(scalar(`SELECT count(*) FROM listings WHERE title = '${name}'`)).toBe('0')
  await net.restore()
  await ownerPage.getByRole('button', { name: 'Preview Listing' }).click() // the retry
  await expectH1(ownerPage, 'Listings')
  expect(scalar(`SELECT count(*) FROM listings WHERE title = '${name}'`)).toBe('1')

  // 2. listing EDIT
  await ownerCard(ownerPage, approvedFor.name).getByRole('button', { name: 'Edit' }).click()
  await expectH1(ownerPage, 'Edit Listing')
  await ownerPage.getByLabel('Description', { exact: true }).fill('An edit submitted while the network is down, then retried successfully.')
  net = await failOnce(ownerPage, 'PATCH', /\/api\/v1\/listings\/[^/]+$/)
  await ownerPage.getByRole('button', { name: 'Preview Listing' }).click()
  await expect.poll(() => net.hits()).toBe(1)
  await expect(ownerPage.getByText(/Changes submitted|Listing updated/)).toHaveCount(0)
  await expect(ownerPage).toHaveURL(/\/edit$/)
  expect(scalar(`SELECT status FROM listings WHERE id = '${approvedFor.id}'`)).toBe('approved') // the server never saw it
  await net.restore()
  await ownerPage.getByRole('button', { name: 'Preview Listing' }).click()
  await expect(ownerPage.getByText('Changes submitted for review')).toBeVisible()
  expect(scalar(`SELECT status FROM listings WHERE id = '${approvedFor.id}'`)).toBe('pending')
  await ownerPage.context().close()

  // 3. SAVED
  const saverPage = await signInAs(browser, saver)
  const savable = await approvedProvider(owner, admin, 'Network Savable')
  await saverPage.goto(`/providers/${savable.id}`)
  await expectH1(saverPage, savable.name)
  net = await failOnce(saverPage, 'PUT', /\/api\/v1\/saved\//)
  await saverPage.getByRole('button', { name: `Save ${savable.name}` }).click()
  await expect.poll(() => net.hits()).toBe(1)
  await expect(saverPage.getByRole('button', { name: `Save ${savable.name}` })).toHaveAttribute('aria-pressed', 'false') // no fake "saved"
  expect(scalar(`SELECT count(*) FROM saved_items WHERE listing_id = '${savable.id}'`)).toBe('0')
  await net.restore()
  await saverPage.getByRole('button', { name: `Save ${savable.name}` }).click()
  await expect(saverPage.getByRole('button', { name: `Remove ${savable.name} from saved` })).toHaveAttribute('aria-pressed', 'true')
  expect(scalar(`SELECT count(*) FROM saved_items WHERE listing_id = '${savable.id}'`)).toBe('1')
  await saverPage.context().close()

  // 4. REQUEST create
  const reqPage = await signInAs(browser, requester)
  await reqPage.goto(`/providers/${savable.id}`)
  await reqPage.getByRole('button', { name: 'Request Service' }).click()
  const dialog = reqPage.getByRole('dialog', { name: /Request / })
  await dialog.getByLabel('What do you need?').fill('A request submitted while the network is down, then retried.')
  await dialog.getByLabel('Area / Location').fill('B-17')
  await dialog.getByLabel('Preferred Date').fill(tomorrow())
  net = await failOnce(reqPage, 'POST', /\/api\/v1\/requests$/)
  await dialog.getByRole('button', { name: /Submit Request/ }).click()
  await expect.poll(() => net.hits()).toBe(1)
  await expect(dialog.getByText('Request sent')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /Submit Request/ })).toBeEnabled()
  await expect(dialog.getByLabel('What do you need?')).toHaveValue(/network is down/) // retained
  expect(scalar(`SELECT count(*) FROM service_requests WHERE provider_listing_id = '${savable.id}'`)).toBe('0')
  await net.restore()
  await dialog.getByRole('button', { name: /Submit Request/ }).click()
  await expect(dialog.getByText('Request sent')).toBeVisible()
  expect(scalar(`SELECT count(*) FROM service_requests WHERE provider_listing_id = '${savable.id}'`)).toBe('1')
  await reqPage.context().close()

  // 5. REQUEST action (provider accepts)
  const providerPage = await signInAs(browser, owner, '/provider/leads')
  await expectH1(providerPage, 'Leads')
  await providerPage.getByRole('button').filter({ hasText: requester.name }).first().click()
  const lead = providerPage.getByRole('dialog')
  net = await failOnce(providerPage, 'POST', /\/api\/v1\/requests\/[^/]+\/accept$/)
  await lead.getByRole('button', { name: 'Accept' }).click()
  await expect.poll(() => net.hits()).toBe(1)
  expect(scalar(`SELECT status FROM service_requests WHERE provider_listing_id = '${savable.id}'`)).toBe('submitted')
  await expect(lead.getByRole('button', { name: 'Accept' })).toBeEnabled() // the control recovered
  await net.restore()
  await lead.getByRole('button', { name: 'Accept' }).click()
  await expect(lead).toBeHidden({ timeout: 15_000 })
  expect(scalar(`SELECT status FROM service_requests WHERE provider_listing_id = '${savable.id}'`)).toBe('accepted')
  await providerPage.context().close()

  // 6. ADMIN moderation (approve)
  await adminPage.goto('/admin/moderation')
  await adminPage.getByRole('button', { name: `Review ${pendingName}` }).click()
  const review = adminPage.getByRole('dialog', { name: 'Review Listing' })
  net = await failOnce(adminPage, 'POST', /\/api\/v1\/admin\/listings\/[^/]+\/approve$/)
  await review.getByRole('button', { name: /^Approve$/ }).click()
  await expect.poll(() => net.hits()).toBe(1)
  expect(scalar(`SELECT status FROM listings WHERE id = '${pending.body!.data.id}'`)).toBe('pending')
  await expect(review).toBeVisible() // the dialog stays, nothing is claimed
  await expect(review.getByRole('button', { name: /^Approve$/ })).toBeEnabled()
  await net.restore()
  await review.getByRole('button', { name: /^Approve$/ }).click()
  await expect(review).toBeHidden({ timeout: 15_000 })
  expect(scalar(`SELECT status FROM listings WHERE id = '${pending.body!.data.id}'`)).toBe('approved')
  void rows
})

// ------------------------------------------------------------------------------------- stale read

test('stale read after write: an OLDER in-flight Saved read that lands after the successful save cannot un-save it', async ({ browser }) => {
  const saver = await createUser('res-stale-saver')
  const listing = await approvedProvider(owner, admin, 'Stale Read Provider')
  const context = await newContext(browser)
  const page = await context.newPage()

  // Every GET /saved is answered with the state captured NOW but delivered late (the classic out-of-order response).
  let delayed = 0
  await page.route(/\/api\/v1\/saved(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    delayed += 1
    const snapshot = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 3000))
    await route.fulfill({ response: snapshot })
  })
  await loginOn(page, saver)
  await page.goto(`/providers/${listing.id}`)
  await expectH1(page, listing.name)
  const heart = page.getByRole('button', { name: new RegExp(`(Save|Remove) ${listing.name}`) })
  await heart.click() // the save lands while the older read is still in flight
  await expect(page.getByRole('button', { name: `Remove ${listing.name} from saved` })).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(4500) // the stale read arrives now
  await expect(page.getByRole('button', { name: `Remove ${listing.name} from saved` })).toHaveAttribute('aria-pressed', 'true')
  expect(delayed).toBeGreaterThan(0)
  expect(scalar(`SELECT count(*) FROM saved_items WHERE listing_id = '${listing.id}'`)).toBe('1')
  await context.close()
})
