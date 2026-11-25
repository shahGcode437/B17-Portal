import { expect, test } from '@playwright/test'
import { ApiClient, ownerCard, createUser, expectH1, rows, scalar, signInAs, type TestUser, WEB_API } from './helpers/stack'
import { CONTACT_PHONE_E164, WHATSAPP_PHONE_E164, createFood, createGeneralBusiness, createPortalProvider, createProperty, createTutor, publicGet, searchHits, unique } from './helpers/ui'
import type { Page } from '@playwright/test'

/**
 * Journeys 7-9: the Professional capability (server-backed) and the real listing kinds, through the
 * real forms into PostgreSQL, then the "pending is invisible publicly" rule. An owner lists four kinds
 * (Business, Food, Tutor, Property); the fifth, a Service / Professional, is PORTAL-MANAGED (RBAC-D) — it has no
 * owner and is authored by staff through the staff API, so it is created that way here and is never on an owner's
 * dashboard.
 */
test.describe.configure({ mode: 'serial' })

let resident: TestUser
let owner: TestUser
let admin: TestUser
let ownerPage: Page
const created: Record<string, { id: string; name: string }> = {}
let portal: { id: string; name: string } // the staff-authored Provider (no owner)

test.beforeAll(async () => {
  resident = await createUser('capability')
  owner = await createUser('fivekinds', { professional: 'premium' })
  admin = await createUser('fivekinds-admin', { admin: true })
})

test('verified Resident -> Professional area -> creates the profile -> capability survives reload (server-backed)', async ({ browser }) => {
  const page = await signInAs(browser, resident)
  await page.goto('/provider/listings/new')
  await expect(page.getByText('Professional profile needed')).toBeVisible()
  expect(scalar(`SELECT count(*) FROM professional_profiles WHERE user_id = (SELECT id FROM users WHERE email='${resident.email}')`)).toBe('0')

  const [put] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/users/me/professional-profile')),
    page.getByRole('button', { name: 'Create a professional profile' }).click(),
  ])
  expect([200, 201]).toContain(put.status())
  await expectH1(page, 'List a Business, Tutor or Property')
  expect(scalar(`SELECT plan_code FROM professional_profiles WHERE user_id = (SELECT id FROM users WHERE email='${resident.email}')`)).toBe('free')

  // Reload: still a Professional, because /auth/me says so - not because of anything stored locally.
  await page.reload()
  await expectH1(page, 'List a Business, Tutor or Property')
  const me = (await (await page.request.get(`${WEB_API}/auth/me`)).json()).data
  expect(me.professional.planCode).toBe('free')
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toMatch(/plan|professional|resident|role/i)
  await page.context().close()
})

test('the four owned kinds are created through the real forms, and a Provider by staff, and they persist in PostgreSQL as pending / revision 1', async ({ browser }) => {
  ownerPage = await signInAs(browser, owner)

  created.business = { id: await createGeneralBusiness(ownerPage, { name: unique('General Business'), category: 'Pharmacy', location: { visibility: 'approximate', lat: 33.7123456, lng: 73.0612345, block: 'D' } }), name: unique('General Business') }
  created.food = { id: await createFood(ownerPage, { name: unique('Food Bakery'), location: { visibility: 'exact', lat: 33.7055, lng: 73.0455, address: 'Shop 9, Food Street', block: 'B' } }), name: unique('Food Bakery') }
  created.tutor = { id: await createTutor(ownerPage, { name: unique('Tutor Physics'), subject: 'Physics', grade: 'Grade 9', location: { visibility: 'exact', lat: 33.7011, lng: 73.0511, address: 'Shop 4, Demo Plaza', landmark: 'Next to the park', block: 'C' } }), name: unique('Tutor Physics') }
  created.property = { id: await createProperty(ownerPage, { title: unique('Property Flat'), type: 'Flat', location: { visibility: 'approximate', lat: 33.7099, lng: 73.0699, block: 'C' } }), name: unique('Property Flat') }

  for (const [kind, { id }] of Object.entries(created)) {
    const [row] = rows(`SELECT kind, status, revision, location_visibility FROM listings WHERE id = '${id}'`)
    const expectedKind = kind === 'food' ? 'business' : kind
    expect(row![0], kind).toBe(expectedKind)
    expect(row![1], kind).toBe('pending')
    expect(row![2], kind).toBe('1')
    expect(scalar(`SELECT count(*) FROM listing_status_history WHERE listing_id = '${id}' AND action = 'submitted' AND revision = 1`), kind).toBe('1')
  }
  // The Provider: authored by STAFF through the real staff API. Pending at revision 1 like every listing, but it has NO
  // owner, and the author is a staff member in the history, never an owner.
  portal = await createPortalProvider(admin, 'Provider Solar', { category: 'solar' })
  const [prow] = rows(`SELECT kind, status, revision, owner_id IS NULL, location_visibility FROM listings WHERE id = '${portal.id}'`)
  expect(prow).toEqual(['provider', 'pending', '1', 't', 'area_only'])
  expect(scalar(`SELECT count(*) FROM listing_status_history WHERE listing_id = '${portal.id}'`)).toBe('1')
  expect(scalar(`SELECT count(*) FROM listing_status_history WHERE listing_id = '${portal.id}' AND actor_role = 'owner'`)).toBe('0')
  // Subtype rows and categories are the right ones.
  expect(scalar(`SELECT vertical FROM business_profiles WHERE listing_id = '${created.business!.id}'`)).toBe('general')
  expect(scalar(`SELECT vertical FROM business_profiles WHERE listing_id = '${created.food!.id}'`)).toBe('food')
  expect(scalar(`SELECT count(*) FROM food_profiles WHERE listing_id = '${created.food!.id}'`)).toBe('1')
  expect(scalar(`SELECT service_options::text FROM food_profiles WHERE listing_id = '${created.food!.id}'`)).toContain('takeaway')
  expect(scalar(`SELECT grade FROM tutor_profiles WHERE listing_id = '${created.tutor!.id}'`)).toBe('Grade 9')
  // Listing Contact v1: every owner-created kind stored the number the form typed in the national
  // form, normalised by the API to one canonical E.164 value; the Food one also has its WhatsApp
  // number, and the portal-managed Provider has neither.
  for (const [label, { id }] of Object.entries(created)) {
    expect(rows(`SELECT contact_phone FROM listings WHERE id = '${id}'`)[0], label).toEqual([CONTACT_PHONE_E164])
  }
  expect(scalar(`SELECT whatsapp_phone FROM listings WHERE id = '${created.food!.id}'`)).toBe(WHATSAPP_PHONE_E164)
  expect(rows(`SELECT contact_phone IS NULL, whatsapp_phone IS NULL FROM listings WHERE id = '${portal.id}'`)[0]).toEqual(['t', 't'])
  expect(rows(`SELECT listing_type, price_text FROM property_profiles WHERE listing_id = '${created.property!.id}'`)[0]).toEqual(['rent', 'PKR 65,000 / month'])
  const cat = (id: string) => rows(`SELECT c.module, c.slug FROM listing_categories lc JOIN categories c ON c.id = lc.category_id WHERE lc.listing_id = '${id}'`).map((r) => r.join('/'))
  expect(cat(portal.id)).toEqual(['services/solar'])
  expect(cat(created.business!.id)).toEqual(['directory/pharmacy'])
  expect(cat(created.tutor!.id)).toEqual(['education/physics'])
  expect(cat(created.property!.id)).toEqual(['property/flat'])
  expect(cat(created.food!.id).every((c) => c.startsWith('food/'))).toBe(true)
  // Location as stored: exact keeps the point and the address; approximate stores a rounded PUBLIC point; area_only none.
  expect(rows(`SELECT location_visibility, address, latitude IS NOT NULL, public_latitude IS NOT NULL FROM listings WHERE id = '${created.tutor!.id}'`)[0]).toEqual(['exact', 'Shop 4, Demo Plaza', 't', 't'])
  expect(rows(`SELECT location_visibility, address IS NULL, latitude, public_latitude FROM listings WHERE id = '${created.business!.id}'`)[0]![0]).toBe('approximate')
  expect(rows(`SELECT location_visibility, latitude IS NULL, public_latitude IS NULL FROM listings WHERE id = '${portal.id}'`)[0]).toEqual(['area_only', 't', 't'])
})

test('the owner dashboard shows all four as Pending Review after a reload (server state, not memory) and never shows a portal Provider', async () => {
  await ownerPage.goto('/provider/listings')
  await expectH1(ownerPage, 'Listings')
  for (const { name } of Object.values(created)) {
    await expect(ownerCard(ownerPage, name)).toContainText('Pending Review')
    await expect(ownerCard(ownerPage, name)).toContainText('revision 1')
  }
  await ownerPage.reload()
  await expectH1(ownerPage, 'Listings')
  for (const { name } of Object.values(created)) await expect(ownerCard(ownerPage, name)).toContainText('Pending Review')
  // A Provider is not an owner's listing: not on this dashboard (nor on anyone's), and the owner API cannot read it.
  await expect(ownerPage.getByText(portal.name)).toHaveCount(0)
  const o = await ApiClient.create()
  await o.login(owner.email)
  expect((await o.call('GET', `/users/me/listings/${portal.id}`)).status).toBe(404)
  await o.dispose()
})

test('a Property cannot choose area_only (the option is absent) and a map-less point is refused', async () => {
  await ownerPage.goto('/provider/listings/new')
  await ownerPage.getByRole('button', { name: /^Property/ }).click()
  const options = await ownerPage.getByLabel('Visibility').locator('option').allTextContents()
  expect(options.join('|')).not.toMatch(/Area only/)
  await ownerPage.getByLabel('Title').fill(unique('No Point'))
  await ownerPage.getByLabel('Listing Type').selectOption('rent')
  await ownerPage.getByLabel('Property Type').selectOption({ label: 'House' })
  await ownerPage.getByLabel('Price').fill('PKR 1')
  await ownerPage.getByLabel('Area', { exact: true }).selectOption('B-17')
  await ownerPage.getByLabel('Description').fill('A property submitted without a map point must be refused.')
  const before = scalar(`SELECT count(*) FROM listings WHERE title = '${unique('No Point')}'`)
  await ownerPage.getByRole('button', { name: 'Submit for Review' }).click()
  await expect(ownerPage.getByText(/submitted for review/i)).toHaveCount(0)
  await expectH1(ownerPage, 'List a Business, Tutor or Property')
  expect(scalar(`SELECT count(*) FROM listings WHERE title = '${unique('No Point')}'`)).toBe(before)
})

test('pending listings are NOT public: absent from search, detail is 404, for every kind', async () => {
  for (const [kind, { id, name }] of Object.entries({ ...created, provider: portal })) {
    expect((await publicGet(`/listings/${id}`)).status, `${kind} detail`).toBe(404)
    expect((await searchHits(name)).some((h) => h.id === id), `${kind} search`).toBe(false)
  }
  // The same through the app: a visitor opening the page sees "not found", not the listing.
  const visitor = await ApiClient.create()
  expect((await visitor.call('GET', `/listings/${portal.id}`)).status).toBe(404)
  await visitor.dispose()
  await ownerPage.context().close()
})
