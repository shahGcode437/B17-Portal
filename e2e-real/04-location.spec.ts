import { expect, test, type Page } from '@playwright/test'
import { ApiClient, createUser, expectH1, rows, scalar, signInAs, type TestUser, newContext } from './helpers/stack'
import { approvedProvider, createProperty, createProvider, publicGet, searchHits, unique } from './helpers/ui'

/**
 * Journeys 24-25: the location privacy audit across the real DOM and the real network, and the map picker
 * round trip through the real write form and PostgreSQL.
 */
test.describe.configure({ mode: 'serial' })

let owner: TestUser
let admin: TestUser
const L: Record<'exact' | 'approximate' | 'area_only', { id: string; name: string }> = {} as never

const PRIVATE_LAT = '33.712346'
const PRIVATE_LNG = '73.061235'

test.beforeAll(async () => {
  owner = await createUser('location-owner', { professional: 'premium' })
  admin = await createUser('location-admin', { admin: true })
  L.exact = await approvedProvider(owner, admin, 'Exact Place', { location: { visibility: 'exact', block: 'C', address: 'Shop 4, Demo Plaza', landmark: 'Next to the park', latitude: 33.7011, longitude: 73.0511 } })
  L.approximate = await approvedProvider(owner, admin, 'Approximate Place', { location: { visibility: 'approximate', block: 'D', address: 'House 12, Street 3', landmark: 'Opposite the mosque', latitude: Number(PRIVATE_LAT), longitude: Number(PRIVATE_LNG) } })
  L.area_only = await approvedProvider(owner, admin, 'Area Only Place', { location: { visibility: 'area_only', block: 'E' } })
})

/** Opens the public page as an anonymous visitor and records every API payload the browser received. */
async function visit(browser: import('@playwright/test').Browser, id: string, name: string) {
  const context = await newContext(browser)
  const page = await context.newPage()
  const payloads: string[] = []
  page.on('response', async (r) => {
    if (r.url().includes('/api/v1/') && r.ok()) payloads.push(await r.text().catch(() => ''))
  })
  await page.goto(`http://127.0.0.1:5173/providers/${id}`)
  await expectH1(page, name)
  await page.waitForTimeout(800) // let the (lazy) map settle
  return { page, payloads, close: () => context.close() }
}

const directions = (page: Page) => page.getByRole('link', { name: /Get Directions/i }).or(page.getByRole('button', { name: /Get Directions/i }))

test('EXACT: public sees the exact point, address, landmark and directions', async ({ browser }) => {
  const { page, payloads, close } = await visit(browser, L.exact.id, L.exact.name)
  await expect(page.locator('.leaflet-container')).toHaveCount(1)
  await expect(page.getByText('Shop 4, Demo Plaza').first()).toBeVisible()
  await expect(page.getByText('Next to the park').first()).toBeVisible()
  await expect(directions(page).first()).toBeVisible()
  const detail = (await publicGet(`/listings/${L.exact.id}`)).body.data.location
  expect(detail).toMatchObject({ visibility: 'exact', coordinates: { latitude: 33.7011, longitude: 73.0511, precision: 'exact' } })
  expect(payloads.join('\n')).not.toContain(scalar(`SELECT owner_id FROM listings WHERE id = '${L.exact.id}'`))
  await close()
})

test('APPROXIMATE: rounded public point only - no address, landmark, exact point or directions', async ({ browser }) => {
  const { page, payloads, close } = await visit(browser, L.approximate.id, L.approximate.name)
  // The DOM
  await expect(page.locator('.leaflet-container')).toHaveCount(1) // an area map IS drawn
  await expect(page.getByText(/Approximate location/i).first()).toBeVisible()
  await expect(directions(page)).toHaveCount(0)
  const html = await page.content()
  for (const secret of ['House 12, Street 3', 'Opposite the mosque', PRIVATE_LAT, PRIVATE_LNG]) expect(html, secret).not.toContain(secret)
  // The network: every payload this page received, plus the search card of the same listing.
  const all = payloads.join('\n') + JSON.stringify((await searchHits(L.approximate.name)).map((h) => h.item))
  for (const secret of ['House 12, Street 3', 'Opposite the mosque', PRIVATE_LAT, PRIVATE_LNG, '33.712346', '73.061235']) expect(all, secret).not.toContain(secret)
  const location = (await publicGet(`/listings/${L.approximate.id}`)).body.data.location
  expect(location.visibility).toBe('approximate')
  expect(location.coordinates).toEqual({ latitude: 33.71, longitude: 73.06, precision: 'approximate' }) // the 0.01 degree grid
  expect(location.address).toBeUndefined()
  expect(location.landmark).toBeUndefined()
  // The private columns still hold what the owner typed.
  expect(rows(`SELECT latitude, longitude, public_latitude, public_longitude, address FROM listings WHERE id = '${L.approximate.id}'`)[0]).toEqual(['33.712346', '73.061235', '33.710000', '73.060000', 'House 12, Street 3'])
  await close()
})

test('AREA-ONLY: no coordinate anywhere, no Leaflet instance, no directions - area and block text only', async ({ browser }) => {
  const { page, payloads, close } = await visit(browser, L.area_only.id, L.area_only.name)
  await expect(page.locator('.leaflet-container')).toHaveCount(0)
  await expect(directions(page)).toHaveCount(0)
  const location = (await publicGet(`/listings/${L.area_only.id}`)).body.data.location
  expect(location).toEqual({ visibility: 'area_only', block: 'E' })
  expect(Object.keys(location)).not.toContain('coordinates')
  const hit = (await searchHits(L.area_only.name)).find((h) => h.id === L.area_only.id)!
  expect(hit.item.location).toEqual({ visibility: 'area_only', block: 'E' })
  expect(payloads.join('\n')).not.toMatch(/"latitude"|"longitude"/)
  await close()
})

test('the OWNER (only) sees the private location; a stranger gets 404 for the owner read', async () => {
  const o = await ApiClient.create()
  await o.login(owner.email)
  const mine = await o.call('GET', `/users/me/listings/${L.approximate.id}`)
  expect(mine.status).toBe(200)
  expect(mine.body!.data.location).toMatchObject({ visibility: 'approximate', address: 'House 12, Street 3', latitude: 33.712346, longitude: 73.061235 })
  expect(mine.body!.data.publicLocation.coordinates).toEqual({ latitude: 33.71, longitude: 73.06, precision: 'approximate' })
  await o.dispose()
  const stranger = await createUser('location-stranger', { professional: 'free' })
  const s = await ApiClient.create()
  await s.login(stranger.email)
  expect((await s.call('GET', `/users/me/listings/${L.approximate.id}`)).status).toBe(404)
  await s.dispose()
})

test('map picker round trip: a real map click sets the point, area_only clears it, Property keeps a point; values persist through reload', async ({ browser }) => {
  const page = await signInAs(browser, owner)

  // A real click on the live Leaflet map (the picker engine in the real browser).
  await page.goto('/provider/listings/new')
  await page.getByRole('button', { name: /Service \/ Professional/ }).click()
  await page.getByLabel('Visibility').selectOption('exact')
  const map = page.locator('.leaflet-container').first()
  await expect(map).toBeVisible()
  await map.click({ position: { x: 150, y: 100 } })
  await expect(page.getByLabel('Latitude')).not.toHaveValue('')
  const lat = Number(await page.getByLabel('Latitude').inputValue())
  const lng = Number(await page.getByLabel('Longitude').inputValue())
  expect(lat).toBeGreaterThan(33.5)
  expect(lat).toBeLessThan(33.9)
  expect(lng).toBeGreaterThan(72.9)
  expect(lng).toBeLessThan(73.2)
  // ...then switching to area_only clears the coordinates and removes the map.
  await page.getByLabel('Visibility').selectOption('area_only')
  await expect(page.locator('.leaflet-container')).toHaveCount(0)
  await expect(page.getByLabel('Latitude')).toHaveCount(0)

  // Create an exact Provider through the numeric fallback and round-trip it through the edit form.
  const name = unique('Picker Provider')
  const id = await createProvider(page, { name, category: 'Electrical', location: { visibility: 'exact', lat: 33.70123, lng: 73.05123, address: 'Shop 1, Plaza', block: 'B' } })
  expect(rows(`SELECT latitude, longitude, address FROM listings WHERE id = '${id}'`)[0]).toEqual(['33.701230', '73.051230', 'Shop 1, Plaza'])
  await page.goto(`/provider/listings/${id}/edit`)
  await expectH1(page, 'Edit Listing')
  await expect(page.getByLabel('Visibility')).toHaveValue('exact')
  await expect(page.getByLabel('Latitude')).toHaveValue('33.70123')
  await expect(page.getByLabel('Longitude')).toHaveValue('73.05123')
  await expect(page.getByLabel('Street address')).toHaveValue('Shop 1, Plaza')
  await expect(page.getByLabel('Block (optional)')).toHaveValue('B')

  // Property: an approximate point round-trips and area_only is not on offer.
  const pname = unique('Picker Property')
  const pid = await createProperty(page, { title: pname, type: 'Plot', listingType: 'sale', price: 'PKR 2 Cr', location: { visibility: 'approximate', lat: 33.7099, lng: 73.0699, block: 'C' } })
  await page.goto(`/provider/listings/${pid}/edit`)
  await expect(page.getByLabel('Visibility')).toHaveValue('approximate')
  await expect(page.getByLabel('Latitude')).toHaveValue('33.7099')
  expect(await page.getByLabel('Visibility').locator('option').allTextContents()).not.toContain('Area only (no map, no pin — just the area name)')
  await page.context().close()
})
