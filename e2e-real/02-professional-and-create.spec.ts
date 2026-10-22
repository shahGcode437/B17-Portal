import { expect, test } from '@playwright/test'
import { ApiClient, ownerCard, createUser, expectH1, rows, scalar, signInAs, type TestUser } from './helpers/stack'
import { createFood, createGeneralBusiness, createProperty, createProvider, createTutor, publicGet, searchHits, unique } from './helpers/ui'
import type { Page } from '@playwright/test'

/**
 * Journeys 7-9: the Professional capability (server-backed) and the five real listing kinds, through the
 * real forms into PostgreSQL, then the "pending is invisible publicly" rule.
 */
test.describe.configure({ mode: 'serial' })

let resident: TestUser
let owner: TestUser
let ownerPage: Page
const created: Record<string, { id: string; name: string }> = {}

test.beforeAll(async () => {
  resident = await createUser('capability')
  owner = await createUser('fivekinds', { professional: 'premium' })
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
  await expectH1(page, 'List Your Business / Service / Property')
  expect(scalar(`SELECT plan_code FROM professional_profiles WHERE user_id = (SELECT id FROM users WHERE email='${resident.email}')`)).toBe('free')

  // Reload: still a Professional, because /auth/me says so - not because of anything stored locally.
  await page.reload()
  await expectH1(page, 'List Your Business / Service / Property')
  const me = (await (await page.request.get('http://127.0.0.1:8000/api/v1/auth/me')).json()).data
  expect(me.professional.planCode).toBe('free')
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toMatch(/plan|professional|resident|role/i)
  await page.context().close()
})

test('the five listing kinds are created through the real forms and persist in PostgreSQL as pending / revision 1', async ({ browser }) => {
  ownerPage = await signInAs(browser, owner)

  created.provider = { id: await createProvider(ownerPage, { name: unique('Provider Exact'), category: 'Solar', location: { visibility: 'exact', lat: 33.7011, lng: 73.0511, address: 'Shop 4, Demo Plaza', landmark: 'Next to the park', block: 'C' } }), name: unique('Provider Exact') }
  created.business = { id: await createGeneralBusiness(ownerPage, { name: unique('General Business'), category: 'Pharmacy', location: { visibility: 'approximate', lat: 33.7123456, lng: 73.0612345, block: 'D' } }), name: unique('General Business') }
  created.food = { id: await createFood(ownerPage, { name: unique('Food Bakery'), location: { visibility: 'exact', lat: 33.7055, lng: 73.0455, address: 'Shop 9, Food Street', block: 'B' } }), name: unique('Food Bakery') }
  created.tutor = { id: await createTutor(ownerPage, { name: unique('Tutor Physics'), subject: 'Physics', grade: 'Grade 9' }), name: unique('Tutor Physics') }
  created.property = { id: await createProperty(ownerPage, { title: unique('Property Flat'), type: 'Flat', location: { visibility: 'approximate', lat: 33.7099, lng: 73.0699, block: 'C' } }), name: unique('Property Flat') }

  for (const [kind, { id }] of Object.entries(created)) {
    const [row] = rows(`SELECT kind, status, revision, location_visibility FROM listings WHERE id = '${id}'`)
    const expectedKind = kind === 'food' ? 'business' : kind
    expect(row![0], kind).toBe(expectedKind)
    expect(row![1], kind).toBe('pending')
    expect(row![2], kind).toBe('1')
    expect(scalar(`SELECT count(*) FROM listing_status_history WHERE listing_id = '${id}' AND action = 'submitted' AND revision = 1`), kind).toBe('1')
  }
  // Subtype rows and categories are the right ones.
  expect(scalar(`SELECT vertical FROM business_profiles WHERE listing_id = '${created.business!.id}'`)).toBe('general')
  expect(scalar(`SELECT vertical FROM business_profiles WHERE listing_id = '${created.food!.id}'`)).toBe('food')
  expect(scalar(`SELECT count(*) FROM food_profiles WHERE listing_id = '${created.food!.id}'`)).toBe('1')
  expect(scalar(`SELECT service_options::text FROM food_profiles WHERE listing_id = '${created.food!.id}'`)).toContain('takeaway')
  expect(scalar(`SELECT grade FROM tutor_profiles WHERE listing_id = '${created.tutor!.id}'`)).toBe('Grade 9')
  expect(rows(`SELECT listing_type, price_text FROM property_profiles WHERE listing_id = '${created.property!.id}'`)[0]).toEqual(['rent', 'PKR 65,000 / month'])
  const cat = (id: string) => rows(`SELECT c.module, c.slug FROM listing_categories lc JOIN categories c ON c.id = lc.category_id WHERE lc.listing_id = '${id}'`).map((r) => r.join('/'))
  expect(cat(created.provider!.id)).toEqual(['services/solar'])
  expect(cat(created.business!.id)).toEqual(['directory/pharmacy'])
  expect(cat(created.tutor!.id)).toEqual(['education/physics'])
  expect(cat(created.property!.id)).toEqual(['property/flat'])
  expect(cat(created.food!.id).every((c) => c.startsWith('food/'))).toBe(true)
  // Location as stored: exact keeps the point and the address; approximate stores a rounded PUBLIC point; area_only none.
  expect(rows(`SELECT location_visibility, address, latitude IS NOT NULL, public_latitude IS NOT NULL FROM listings WHERE id = '${created.provider!.id}'`)[0]).toEqual(['exact', 'Shop 4, Demo Plaza', 't', 't'])
  expect(rows(`SELECT location_visibility, address IS NULL, latitude, public_latitude FROM listings WHERE id = '${created.business!.id}'`)[0]![0]).toBe('approximate')
  expect(rows(`SELECT location_visibility, latitude IS NULL, public_latitude IS NULL FROM listings WHERE id = '${created.tutor!.id}'`)[0]).toEqual(['area_only', 't', 't'])
})

test('the owner dashboard shows all five as Pending Review after a reload (server state, not memory)', async () => {
  await ownerPage.goto('/provider/listings')
  await expectH1(ownerPage, 'Listings')
  for (const { name } of Object.values(created)) {
    await expect(ownerCard(ownerPage, name)).toContainText('Pending Review')
    await expect(ownerCard(ownerPage, name)).toContainText('revision 1')
  }
  await ownerPage.reload()
  await expectH1(ownerPage, 'Listings')
  for (const { name } of Object.values(created)) await expect(ownerCard(ownerPage, name)).toContainText('Pending Review')
})

test('a Property cannot choose area_only (the option is absent) and a map-less point is refused', async () => {
  await ownerPage.goto('/provider/listings/new')
  await ownerPage.getByRole('button', { name: /Property/ }).click()
  const options = await ownerPage.getByLabel('Visibility').locator('option').allTextContents()
  expect(options.join('|')).not.toMatch(/Area only/)
  await ownerPage.getByLabel('Title').fill(unique('No Point'))
  await ownerPage.getByLabel('Listing Type').selectOption('rent')
  await ownerPage.getByLabel('Property Type').selectOption({ label: 'House' })
  await ownerPage.getByLabel('Price').fill('PKR 1')
  await ownerPage.getByLabel('Area', { exact: true }).fill('B-17')
  await ownerPage.getByLabel('Description').fill('A property submitted without a map point must be refused.')
  const before = scalar(`SELECT count(*) FROM listings WHERE title = '${unique('No Point')}'`)
  await ownerPage.getByRole('button', { name: 'Preview Listing' }).click()
  await expect(ownerPage.getByText(/submitted for review/i)).toHaveCount(0)
  await expectH1(ownerPage, 'List Your Business / Service / Property')
  expect(scalar(`SELECT count(*) FROM listings WHERE title = '${unique('No Point')}'`)).toBe(before)
})

test('pending listings are NOT public: absent from search, detail is 404, for every kind', async () => {
  for (const [kind, { id, name }] of Object.entries(created)) {
    expect((await publicGet(`/listings/${id}`)).status, `${kind} detail`).toBe(404)
    expect((await searchHits(name)).some((h) => h.id === id), `${kind} search`).toBe(false)
  }
  // The same through the app: a visitor opening the page sees "not found", not the listing.
  const visitor = await ApiClient.create()
  expect((await visitor.call('GET', `/listings/${created.provider!.id}`)).status).toBe(404)
  await visitor.dispose()
  await ownerPage.context().close()
})
