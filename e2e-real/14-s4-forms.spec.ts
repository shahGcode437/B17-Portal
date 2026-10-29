import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ApiClient, createUser, expectH1, loginOn, newContext, ownerCard, psql, rows, scalar, signInAs, type TestUser, WEB_API } from './helpers/stack'
import {
  KIND,
  approvedProvider,
  createFood,
  createGeneralBusiness,
  createProperty,
  createProvider,
  createTutor,
  openCreateForm,
  openReviewInUi,
  publicGet,
  searchHits,
  unique,
} from './helpers/ui'

/**
 * Phase 12S S4 - functional UX, validation and copy, proven against the REAL stack (React -> FastAPI -> PostgreSQL).
 *
 * What a person sees and what the database holds, for the things S4 changed: a submit button that says what it does,
 * Area as a fixed B-17 choice (Block separate), tag rules the backend also enforces, category NAMES instead of slugs,
 * an honest image field, a Search that keeps its results while it refreshes, and the words for the errors the API
 * answers with. Backend authority is untouched: a few checks talk to the API directly to prove it still refuses what
 * the form no longer lets a person type.
 */
test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

let owner: TestUser
let free: TestUser
let admin: TestUser
let requester: TestUser
let helper: TestUser
let ownerPage: Page
const created: Record<string, { id: string; name: string }> = {}

test.beforeAll(async () => {
  owner = await createUser('s4-owner', { professional: 'premium' })
  free = await createUser('s4-free', { professional: 'free' })
  admin = await createUser('s4-admin', { admin: true })
  requester = await createUser('s4-requester')
  // Set-up listings come from their own account: creating is limited to 10 per user per hour, and the owner above creates many.
  helper = await createUser('s4-helper', { professional: 'premium' })
})

/** Records the JSON body of every listing POST the page sends. */
function recordListingPosts(page: Page) {
  const posts: Record<string, unknown>[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/listings') posts.push(JSON.parse(request.postData() ?? '{}'))
  })
  return posts
}

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const slugTokens = (slugs: string[]) => new RegExp(`(^|[^A-Za-z])(${slugs.join('|')})([^A-Za-z]|$)`)

test('1. the create form is honest: it says Submit for Review, Area is B-17 from a list of one, and the image field promises no upload', async ({ browser }) => {
  ownerPage = await signInAs(browser, owner)
  await openCreateForm(ownerPage, KIND.provider)

  await expect(ownerPage.getByRole('button', { name: 'Submit for Review' })).toBeVisible()
  await expect(ownerPage.getByRole('button', { name: /preview/i })).toHaveCount(0)

  const area = ownerPage.getByRole('combobox', { name: 'Area', exact: true })
  await expect(area).toHaveValue('B-17')
  expect(await area.locator('option').allTextContents()).toEqual(['B-17'])
  await expect(ownerPage.getByRole('textbox', { name: 'Area', exact: true })).toHaveCount(0)

  // The image: a notice, a disabled button and no file input - nothing that suggests a file was saved.
  await expect(ownerPage.getByRole('button', { name: 'Choose Image' })).toBeDisabled()
  await expect(ownerPage.getByText(/Image upload isn't available yet/)).toBeVisible()
  await expect(ownerPage.locator('input[type="file"]')).toHaveCount(0)
  await expect(ownerPage.getByText(/submitted without an image/i)).toBeVisible()
})

test('2. a listing with NO tags and no image is accepted; the payload carries area B-17 and the database stores no image', async () => {
  const posts = recordListingPosts(ownerPage)
  const name = unique('S4 Minimal')
  await ownerPage.getByLabel('Name', { exact: true }).fill(name)
  await ownerPage.getByLabel('Service Category').selectOption({ label: 'Electrical' })
  await ownerPage.getByLabel('Description', { exact: true }).fill('A minimal listing: no tags and no image, only what is required.')
  const [response] = await Promise.all([
    ownerPage.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/listings'),
    ownerPage.getByRole('button', { name: 'Submit for Review' }).click(),
  ])
  expect(response.status(), await response.text()).toBe(201)
  expect(posts).toHaveLength(1)
  expect(posts[0]!.area).toBe('B-17')
  expect(posts[0]).not.toHaveProperty('image')
  const id = ((await response.json()) as { data: { id: string } }).data.id
  expect(rows(`SELECT area, image_url IS NULL, cardinality(tags) FROM listings WHERE id = '${id}'`)[0]).toEqual(['B-17', 't', '0'])
  await expectH1(ownerPage, 'Listings')
})

test('3. Block stays separate from Area: the block is stored as typed, the area is always B-17', async () => {
  const name = unique('S4 Block')
  const id = await createProvider(ownerPage, { name, category: 'Plumbing', location: { visibility: 'area_only', block: 'C' } })
  expect(rows(`SELECT area, block FROM listings WHERE id = '${id}'`)[0]).toEqual(['B-17', 'C'])
})

test('4. all five kinds persist with area B-17, their tags, and re-open prefilled; an edit saves through PATCH without disturbing area or tags', async () => {
  created.provider = { id: await createProvider(ownerPage, { name: unique('S4 Provider'), category: 'Solar', location: { visibility: 'exact', lat: 33.7011, lng: 73.0511, address: 'Shop 4, Main Market', block: 'C' } }), name: unique('S4 Provider') }
  created.business = { id: await createGeneralBusiness(ownerPage, { name: unique('S4 Business'), category: 'Pharmacy', location: { visibility: 'approximate', lat: 33.7123456, lng: 73.0612345, block: 'D' } }), name: unique('S4 Business') }
  created.food = { id: await createFood(ownerPage, { name: unique('S4 Bakery'), location: { visibility: 'exact', lat: 33.7055, lng: 73.0455, address: 'Shop 9, Food Street', block: 'B' } }), name: unique('S4 Bakery') }
  created.tutor = { id: await createTutor(ownerPage, { name: unique('S4 Tutor'), subject: 'Physics', grade: 'Grade 9' }), name: unique('S4 Tutor') }
  created.property = { id: await createProperty(ownerPage, { title: unique('S4 Property'), type: 'Flat', location: { visibility: 'approximate', lat: 33.7099, lng: 73.0699, block: 'C' } }), name: unique('S4 Property') }

  const expectedTags: Record<string, string> = {
    provider: '{repairs,installation}',
    business: '{books,copies}',
    food: '{cakes,bread}',
    tutor: '{physics,chemistry}',
    property: '{}',
  }
  for (const [kind, { id }] of Object.entries(created)) {
    expect(rows(`SELECT area, tags::text, image_url IS NULL FROM listings WHERE id = '${id}'`)[0], kind).toEqual(['B-17', expectedTags[kind]!, 't'])
  }

  // Each opens prefilled (Area = B-17, the saved name) and saves a description change as an update.
  for (const [kind, { id, name }] of Object.entries(created)) {
    await ownerPage.goto(`/provider/listings/${id}/edit`)
    await expectH1(ownerPage, 'Edit Listing')
    await expect(ownerPage.getByRole('combobox', { name: 'Area', exact: true }), kind).toHaveValue('B-17')
    await expect(ownerPage.getByRole('button', { name: 'Save Changes' }), kind).toBeVisible()
    await expect(ownerPage.getByRole('button', { name: /preview/i }), kind).toHaveCount(0)
    await expect(ownerPage.getByLabel(kind === 'property' ? 'Title' : kind === 'business' || kind === 'food' ? 'Business Name' : 'Name', { exact: true }), kind).toHaveValue(name)
    await ownerPage.getByLabel('Description', { exact: true }).fill(`${name} - an edited description, long enough to be a real change.`)
    const [patch] = await Promise.all([
      ownerPage.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/api/v1/listings/${id}`)),
      ownerPage.getByRole('button', { name: 'Save Changes' }).click(),
    ])
    expect(patch.status(), `${kind}: ${await patch.text()}`).toBe(200)
    await expectH1(ownerPage, 'Listings')
    expect(rows(`SELECT revision, status, area, tags::text, image_url IS NULL FROM listings WHERE id = '${id}'`)[0], kind).toEqual(['2', 'pending', 'B-17', expectedTags[kind]!, 't'])
  }
})

test('4b. a Food edit CLEARS what the owner emptied (hours, menu), and a General business edit never sends a food block', async () => {
  const api = await ApiClient.shared(owner.email)
  const name = unique('S4 Food Clear')
  const made = await api.call('POST', '/listings', {
    kind: 'business',
    vertical: 'food',
    name,
    description: `${name} - fresh bread and cakes baked daily in B-17.`,
    area: 'B-17',
    tags: ['bread'],
    location: { visibility: 'area_only', block: 'B' },
    food: { categories: ['bakeries'], serviceOptions: ['takeaway'], hoursNote: 'Open 10am to 9pm', menuHighlights: [{ name: 'Milk bread', price: 'PKR 250' }] },
  })
  expect(made.status, JSON.stringify(made.body)).toBe(201)
  const id = made.body!.data.id as string
  expect(scalar(`SELECT count(*) FROM food_menu_items WHERE listing_id = '${id}'`)).toBe('1')

  await ownerPage.goto(`/provider/listings/${id}/edit`)
  await expectH1(ownerPage, 'Edit Listing')
  await expect(ownerPage.getByLabel('Opening hours (optional)')).toHaveValue('Open 10am to 9pm')
  await ownerPage.getByLabel('Opening hours (optional)').fill('')
  await ownerPage.getByRole('button', { name: 'Remove menu item 1' }).click()
  const [patch] = await Promise.all([
    ownerPage.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/api/v1/listings/${id}`)),
    ownerPage.getByRole('button', { name: 'Save Changes' }).click(),
  ])
  expect(patch.status(), await patch.text()).toBe(200)
  expect(scalar(`SELECT count(*) FROM food_menu_items WHERE listing_id = '${id}'`)).toBe('0')
  expect(scalar(`SELECT coalesce(hours_note, '(none)') FROM food_profiles WHERE listing_id = '${id}'`)).toBe('(none)')

  // A General business: the saved edit sends no `food` key at all.
  const bodies: Record<string, unknown>[] = []
  ownerPage.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes(`/api/v1/listings/${created.business!.id}`)) bodies.push(JSON.parse(request.postData() ?? '{}'))
  })
  await ownerPage.goto(`/provider/listings/${created.business!.id}/edit`)
  await expectH1(ownerPage, 'Edit Listing')
  await ownerPage.getByLabel('Description', { exact: true }).fill(`${created.business!.name} - one more edit, long enough to be a real change.`)
  await ownerPage.getByRole('button', { name: 'Save Changes' }).click()
  await expectH1(ownerPage, 'Listings')
  expect(bodies).toHaveLength(1)
  expect(bodies[0]).not.toHaveProperty('food')
})

test('5. the owner dashboard names categories in words, never as slugs', async () => {
  await ownerPage.goto('/provider/listings')
  await expectH1(ownerPage, 'Listings')
  const lines: Record<string, string> = {
    provider: 'Service / Professional · Solar',
    business: 'Business / Shop · Pharmacy',
    tutor: 'Tutor · Physics · Grade 9',
    property: 'Property · Flat · For Rent',
  }
  for (const [kind, line] of Object.entries(lines)) await expect(ownerCard(ownerPage, created[kind]!.name), kind).toContainText(line)
  await expect(ownerCard(ownerPage, created.food!.name)).toContainText('Bakeries')
  for (const { name } of Object.values(created)) {
    const text = (await ownerCard(ownerPage, name).innerText()).replace(name, '')
    expect(text, name).not.toMatch(slugTokens(['solar', 'pharmacy', 'flat', 'physics', 'bakeries']))
  }
})

test('6. the admin sees category names too, and approving makes them public with names on search, detail and Saved', async ({ browser }) => {
  const adminPage = await signInAs(browser, admin)
  const dialog = await openReviewInUi(adminPage, created.provider!.name)
  await expect(dialog).toContainText('Solar')
  expect(await dialog.innerText()).not.toMatch(slugTokens(['solar']))
  await adminPage.keyboard.press('Escape')

  const api = await ApiClient.shared(admin.email)
  for (const { id } of [created.provider!, created.business!, created.property!]) {
    const revision = Number(scalar(`SELECT revision FROM listings WHERE id = '${id}'`))
    const approved = await api.call('POST', `/admin/listings/${id}/approve`, { revision })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
  }

  const visitor = await newContext(browser)
  const page = await visitor.newPage()
  // `onCard`: whether the search card prints the category (a property card shows the offer, price and area instead).
  for (const [kind, label, path, onCard] of [
    ['provider', 'Solar', 'providers', true],
    ['business', 'Pharmacy', 'businesses', true],
    ['property', 'Flat', 'properties', false],
  ] as const) {
    const { id, name } = created[kind]!
    await page.goto(`/search?q=${encodeURIComponent(name)}`)
    // The card itself (its heading and its category name), not the "1 result for ..." line that also carries the query.
    await expect(page.locator('main').getByText(name, { exact: true }), `${kind} search`).toBeVisible()
    if (onCard) await expect(page.locator('main').getByText(label, { exact: true }).first(), `${kind} search`).toBeVisible()
    const main = (await page.locator('main').innerText()).replace(new RegExp(name, 'g'), '')
    expect(main, `${kind} search`).not.toMatch(slugTokens(['solar', 'pharmacy', 'flat']))
    await page.goto(`/${path}/${id}`)
    await expectH1(page, name)
    await expect(page.locator('main'), `${kind} detail`).toContainText(label)
    expect((await page.locator('main').innerText()).replace(new RegExp(name, 'g'), ''), `${kind} detail`).not.toMatch(slugTokens(['solar', 'pharmacy', 'flat']))
  }
  await visitor.close()

  // Saved: the heart on a provider, then the Saved page shows the name.
  const requesterPage = await signInAs(browser, requester)
  await requesterPage.goto(`/providers/${created.provider!.id}`)
  await expectH1(requesterPage, created.provider!.name)
  await requesterPage.getByRole('button', { name: /^Save/ }).first().click()
  await requesterPage.goto('/profile/saved')
  await expect(requesterPage.getByText(created.provider!.name, { exact: true })).toBeVisible()
  const saved = (await requesterPage.locator('main').innerText()).replace(new RegExp(created.provider!.name, 'g'), '')
  expect(saved).toContain('Solar')
  expect(saved).not.toMatch(slugTokens(['solar']))
  await requesterPage.context().close()
  await adminPage.context().close()
})

test('7. more than 20 tags are flagged before submit, in plain words; nothing is sent until it is 20 or fewer', async () => {
  const posts = recordListingPosts(ownerPage)
  await openCreateForm(ownerPage, KIND.provider)
  const name = unique('S4 Tags')
  await ownerPage.getByLabel('Name', { exact: true }).fill(name)
  await ownerPage.getByLabel('Service Category').selectOption({ label: 'Plumbing' })
  await ownerPage.getByLabel('Description', { exact: true }).fill('A listing with too many tags must be stopped before it is sent.')
  const tags = ownerPage.getByLabel(/Services offered/)
  await tags.fill(Array.from({ length: 22 }, (_, i) => `service${i}`).join(', '))
  const alert = ownerPage.getByRole('alert').filter({ hasText: /up to 20 tags/ })
  await expect(alert).toHaveText('You can add up to 20 tags. Remove 2 to continue.')
  await expect(tags).toHaveAttribute('aria-invalid', 'true')
  await ownerPage.getByRole('button', { name: 'Submit for Review' }).click()
  await ownerPage.waitForTimeout(500)
  expect(posts).toHaveLength(0)
  expect(scalar(`SELECT count(*) FROM listings WHERE title = '${name}'`)).toBe('0')
  await expect(ownerPage.locator('body')).not.toContainText(/List should have at most|too_long/)

  await tags.fill(Array.from({ length: 20 }, (_, i) => `service${i}`).join(', '))
  await expect(alert).toHaveCount(0)
  const [response] = await Promise.all([
    ownerPage.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/listings'),
    ownerPage.getByRole('button', { name: 'Submit for Review' }).click(),
  ])
  expect(response.status(), await response.text()).toBe(201)
  expect(scalar(`SELECT cardinality(tags) FROM listings WHERE title = '${name}'`)).toBe('20')
})

test('8. a block with characters the backend refuses is flagged at once and never sent', async () => {
  const posts = recordListingPosts(ownerPage)
  await openCreateForm(ownerPage, KIND.provider)
  const name = unique('S4 Bad Block')
  await ownerPage.getByLabel('Name', { exact: true }).fill(name)
  await ownerPage.getByLabel('Service Category').selectOption({ label: 'Plumbing' })
  await ownerPage.getByLabel('Description', { exact: true }).fill('A listing with an illegal block must be stopped before it is sent.')
  await ownerPage.getByLabel('Visibility').selectOption('area_only')
  const block = ownerPage.getByLabel('Block (optional)')
  await block.fill('C <b>')
  await expect(ownerPage.getByRole('alert').filter({ hasText: /letters, numbers, spaces/i })).toBeVisible()
  await expect(block).toHaveAttribute('aria-invalid', 'true')
  await ownerPage.getByRole('button', { name: 'Submit for Review' }).click()
  await ownerPage.waitForTimeout(500)
  expect(posts).toHaveLength(0)
  expect(scalar(`SELECT count(*) FROM listings WHERE title = '${name}'`)).toBe('0')
})

test('9. the backend still refuses what the form no longer lets a person type (authority untouched)', async () => {
  const api = await ApiClient.shared(owner.email)
  const body = { kind: 'provider', name: unique('S4 Direct'), category: 'plumbing', description: 'Sent straight to the API to prove it still validates.', location: { visibility: 'area_only' } }
  const unknown = await api.call('POST', '/listings', { ...body, area: 'Islamabad' })
  expect(unknown.status).toBe(422)
  expect(unknown.body?.error?.details?.map((d) => `${d.field}:${d.code}`)).toContain('area:unknown_locality')
  const many = await api.call('POST', '/listings', { ...body, area: 'B-17', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })
  expect(many.status).toBe(422)
  expect(many.body?.error?.details?.some((d) => d.field === 'tags')).toBe(true)
  const upload = await api.call('POST', '/listings', { ...body, area: 'B-17', image: 'blob:http://localhost/abc' })
  expect(upload.status).toBe(422)
  expect(upload.body?.error?.details?.map((d) => d.code)).toContain('invalid_media_reference')
  expect(scalar(`SELECT count(*) FROM listings WHERE title = '${body.name}'`)).toBe('0')
})

test('9b. the mock server enforces the REAL API\'s rules: each value is sent straight to the live API and refused with the same code', async () => {
  // `src/test/fixtures/listingRules.ts` is written from the backend's schemas. This proves it against the running API,
  // so a mock-backed test can never pass on a value the real stack refuses (and the forms' own checks, which the
  // parity unit tests tie to that mock, are tied to the real thing).
  const owned = await ApiClient.shared(owner.email)
  const NBSP = '\u00a0'
  const point = { latitude: 33.7099, longitude: 73.0699 }
  const provider = { kind: 'provider', name: unique('S4 Parity'), category: 'plumbing', description: 'Sent straight to the API to prove the rule.', area: 'B-17', location: { visibility: 'area_only' } }
  const tutor = { kind: 'tutor', name: unique('S4 Parity'), category: 'physics', grade: 'Grade 9', description: 'Sent straight to the API to prove the rule.', area: 'B-17', location: { visibility: 'area_only' } }
  const property = { kind: 'property', title: unique('S4 Parity'), listingType: 'rent', propertyType: 'house', price: 'PKR 65,000 / month', description: 'Sent straight to the API to prove the rule.', area: 'B-17', location: { visibility: 'approximate', ...point } }
  const creates: [string, Record<string, unknown>, string][] = [
    ['name with a non-breaking space', { ...provider, name: `Parity${NBSP}Works` }, 'name:invalid_characters'],
    ['name on two lines', { ...provider, name: 'Parity\nWorks' }, 'name:invalid_characters'],
    ['name of one character', { ...provider, name: 'P' }, 'name:string_too_short'],
    ['name of 81 characters', { ...provider, name: 'n'.repeat(81) }, 'name:string_too_long'],
    ['description with a zero-width space', { ...provider, description: 'Sent straight\u200b to the API to prove it.' }, 'description:invalid_characters'],
    ['description of 19 characters', { ...provider, description: 'd'.repeat(19) }, 'description:string_too_short'],
    ['description of 401 characters', { ...provider, description: 'd'.repeat(401) }, 'description:string_too_long'],
    ['a tag with a hidden character', { ...provider, tags: [`so${NBSP}lar`] }, 'tags.0:invalid_characters'],
    ['a tag of 41 characters', { ...provider, tags: ['t'.repeat(41)] }, 'tags.0:string_too_long'],
    ['21 tags', { ...provider, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, 'tags:too_long'],
    ['an empty area', { ...provider, area: '' }, 'area:string_too_short'],
    ['an unknown area', { ...provider, area: 'Islamabad' }, 'area:unknown_locality'],
    ['a block with markup', { ...provider, location: { visibility: 'area_only', block: 'C <b>' } }, 'location.block:invalid_format'],
    ['a block of 41 characters', { ...provider, location: { visibility: 'area_only', block: 'C'.repeat(41) } }, 'location.block:string_too_long'],
    ['an address on two lines', { ...provider, location: { visibility: 'exact', address: 'Shop 4\nMain Market', ...point } }, 'location.address:invalid_characters'],
    ['an address of 201 characters', { ...provider, location: { visibility: 'exact', address: 'a'.repeat(201), ...point } }, 'location.address:string_too_long'],
    ['a landmark of 101 characters', { ...provider, location: { visibility: 'exact', address: 'Shop 4', landmark: 'l'.repeat(101), ...point } }, 'location.landmark:string_too_long'],
    ['an unknown key', { ...provider, status: 'approved' }, 'status:not_allowed'],
    ['a picture with credentials in its address', { ...provider, image: 'https://user:pw@example.org/a.jpg' }, 'image:invalid_media_reference'],
    ['a tutor grade of 61 characters', { ...tutor, grade: 'g'.repeat(61) }, 'grade:string_too_long'],
    ['a property price of 41 characters', { ...property, price: 'p'.repeat(41) }, 'price:string_too_long'],
    ['a property price with a hidden character', { ...property, price: `PKR${NBSP}1 Cr` }, 'price:invalid_characters'],
    ['31 bedrooms', { ...property, bedrooms: 31 }, 'bedrooms:less_than_equal'],
    ['a property with no map point (area only)', { ...property, location: { visibility: 'area_only' } }, 'location.visibility:not_allowed'],
  ]
  for (const [label, body, code] of creates) {
    const r = await owned.call('POST', '/listings', body)
    expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBe(422)
    expect(r.body?.error?.details?.map((d) => `${d.field}:${d.code}`), label).toContain(code)
  }

  // PATCH: what may be cleared, and a field the stored kind does not have.
  const revisionOf = (id: string) => Number(scalar(`SELECT revision FROM listings WHERE id = '${id}'`))
  const patches: [string, string, Record<string, unknown>, string][] = [
    ['null description', created.provider!.id, { description: null }, 'description:not_nullable'],
    ['null tags', created.provider!.id, { tags: null }, 'tags:not_nullable'],
    ['null location', created.provider!.id, { location: null }, 'location:not_nullable'],
    ['kind in a PATCH', created.provider!.id, { kind: 'provider' }, 'kind:not_allowed'],
    ['a food block on a General business', created.business!.id, { food: { categories: ['bakeries'] } }, 'food:not_allowed'],
    ['food: null on a General business', created.business!.id, { food: null }, 'food:not_nullable'],
  ]
  for (const [label, id, body, code] of patches) {
    const r = await owned.call('PATCH', `/listings/${id}`, { revision: revisionOf(id), ...body })
    expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBe(422)
    expect(r.body?.error?.details?.map((d) => `${d.field}:${d.code}`), label).toContain(code)
  }

  // Service requests: strict keys, printable text, the time / date / preference formats.
  const target = await approvedProvider(helper, admin, 'S4 Parity Target')
  const requesterApi = await ApiClient.shared(requester.email)
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const request = { providerListingId: target.id, service: 'Plumbing', details: 'A tap is leaking in the kitchen sink.', area: 'B-17, Block C', preferredDate: tomorrow, preferredContactChannel: 'phone' }
  const requests: [string, Record<string, unknown>, string][] = [
    ['details with a non-breaking space', { ...request, details: `A tap is${NBSP}leaking in the kitchen.` }, 'details:invalid_characters'],
    ['an area on two lines', { ...request, area: 'B-17\nBlock C' }, 'area:invalid_characters'],
    ['notes of 501 characters', { ...request, notes: 'n'.repeat(501) }, 'notes:string_too_long'],
    ['an unknown key', { ...request, status: 'accepted' }, 'status:not_allowed'],
    ['a malformed time', { ...request, preferredTime: '9am' }, 'preferredTime:invalid_time'],
    ['a malformed date', { ...request, preferredDate: 'tomorrow' }, 'preferredDate:invalid_date'],
  ]
  for (const [label, body, code] of requests) {
    const r = await requesterApi.call('POST', '/requests', body)
    expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBe(422)
    expect(r.body?.error?.details?.map((d) => `${d.field}:${d.code}`), label).toContain(code)
  }
  expect(scalar(`SELECT count(*) FROM listings WHERE title LIKE '%S4 Parity'`)).toBe('0') // nothing the API refused was stored (the approved set-up target is named '... S4 Parity Target')
})

test('10. an old free-text area on file is shown as B-17 with a note, and a save stores B-17', async () => {
  const { id, name } = created.business!
  psql(`UPDATE listings SET area = 'B-17, Block D (Demo Area)' WHERE id = '${id}'`)
  await ownerPage.goto(`/provider/listings/${id}/edit`)
  await expectH1(ownerPage, 'Edit Listing')
  await expect(ownerPage.getByRole('combobox', { name: 'Area', exact: true })).toHaveValue('B-17')
  await expect(ownerPage.getByText(/will be saved as B-17/)).toBeVisible()
  await ownerPage.getByLabel('Description', { exact: true }).fill(`${name} - saved again after the legacy area was normalised.`)
  const [patch] = await Promise.all([
    ownerPage.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/api/v1/listings/${id}`)),
    ownerPage.getByRole('button', { name: 'Save Changes' }).click(),
  ])
  expect(patch.status(), await patch.text()).toBe(200)
  expect(scalar(`SELECT area FROM listings WHERE id = '${id}'`)).toBe('B-17')
})

test('11. Search keeps its current results while a new query is answered, marks them as updating, and a late answer cannot win', async ({ browser }) => {
  const alpha = await approvedProvider(helper, admin, 'S4 Refresh Alpha')
  const beta = await approvedProvider(helper, admin, 'S4 Refresh Beta')
  expect((await searchHits(alpha.name)).some((hit) => hit.id === alpha.id)).toBe(true)

  const context = await newContext(browser)
  const page = await context.newPage()
  await page.goto(`/search?q=${encodeURIComponent(alpha.name)}`)
  await expect(page.getByText(alpha.name).first()).toBeVisible()

  // The next query is answered slowly; the first (superseded) one would answer even later if it were still running.
  await page.route(/\/api\/v1\/search\?/, async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === beta.name) await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.fallback()
  })
  const box = page.getByRole('combobox', { name: 'Search B-17 Portal' })
  await box.fill(beta.name)
  await box.press('Enter')

  await expect(page.getByText('Updating results…')).toBeVisible()
  await expect(page.getByText(alpha.name).first()).toBeVisible() // still on screen
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(1)
  await expect(page.getByText('Searching…')).toHaveCount(0) // no skeleton flash

  await expect(page.getByText(beta.name).first()).toBeVisible()
  await expect(page.getByText('Updating results…')).toHaveCount(0)
  await expect(page.getByText(alpha.name)).toHaveCount(0)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  // The URL still drives the page: it carries the new query (a replace, as before S4), and a reload shows the same results.
  expect(new URL(page.url()).searchParams.get('q')).toBe(beta.name)
  await page.reload()
  await expect(page.getByText(beta.name).first()).toBeVisible()
  await expect(page.getByText(alpha.name)).toHaveCount(0)
  await context.close()
})

test('12. errors are explained in plain words: plan limit, own listing, unverified e-mail, a stale secure session', async ({ browser }) => {
  // plan_limit_reached: a Free professional with 3 active listings tries a 4th through the form.
  const freeApi = await ApiClient.shared(free.email)
  for (let i = 0; i < 3; i += 1) {
    const r = await freeApi.call('POST', '/listings', { kind: 'provider', name: unique(`S4 Free ${i}`), category: 'plumbing', description: 'An active listing that fills the Free plan quota.', area: 'B-17', location: { visibility: 'area_only' } })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
  }
  const freePage = await signInAs(browser, free)
  await openCreateForm(freePage, KIND.provider)
  await freePage.getByLabel('Name', { exact: true }).fill(unique('S4 Free Four'))
  await freePage.getByLabel('Service Category').selectOption({ label: 'Plumbing' })
  await freePage.getByLabel('Description', { exact: true }).fill('The fourth active listing on the Free plan must be refused in words.')
  await freePage.getByRole('button', { name: 'Submit for Review' }).click()
  const limit = freePage.getByRole('alert').filter({ hasText: 'Active listing limit reached' })
  await expect(limit).toBeVisible()
  await expect(limit).toContainText("You've reached the active listing limit for your current plan. Archive an active listing before creating another.")
  await expect(limit).not.toContainText(/upgrade|premium/i)
  await expect(freePage.locator('body')).not.toContainText(/plan_limit_reached|server text/)

  // csrf_failed: the page's own secure token is replaced by a wrong one on the way out.
  await openCreateForm(freePage, KIND.provider)
  await freePage.route(/\/api\/v1\/listings$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await route.continue({ headers: { ...route.request().headers(), 'x-csrf-token': 'not-the-real-token' } })
  })
  await freePage.getByLabel('Name', { exact: true }).fill(unique('S4 Csrf'))
  await freePage.getByLabel('Service Category').selectOption({ label: 'Plumbing' })
  await freePage.getByLabel('Description', { exact: true }).fill('A write with a wrong secure token must be explained, not shown raw.')
  await freePage.getByRole('button', { name: 'Submit for Review' }).click()
  const csrf = freePage.getByRole('alert').filter({ hasText: 'Your secure session could not be verified' })
  await expect(csrf).toBeVisible()
  await expect(csrf).toContainText('Please reload the page and try again.')
  await freePage.context().close()

  // own_listing: a provider asks for a service from their own approved listing.
  const mine = await approvedProvider(helper, admin, 'S4 Own Listing')
  const helperPage = await signInAs(browser, helper)
  await helperPage.goto(`/providers/${mine.id}`)
  await expectH1(helperPage, mine.name)
  await helperPage.getByRole('button', { name: 'Request Service' }).click()
  const dialog = helperPage.getByRole('dialog', { name: /Request / })
  await dialog.getByLabel('What do you need?').fill('Trying to request my own listing, which must be refused.')
  await dialog.getByLabel('Area / Location').fill('B-17')
  await dialog.getByLabel('Preferred Date').fill(tomorrow())
  await dialog.getByRole('button', { name: /Submit Request/ }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: 'You cannot send a request to your own listing' })).toBeVisible()
  await expect(dialog).not.toContainText(/own_listing/)
  await helperPage.context().close()

  // email_not_verified: a signed-in but unverified account asks for a service.
  const unverified = await createUser('s4-unverified', { verified: false })
  const unverifiedPage = await signInAs(browser, unverified)
  await unverifiedPage.goto(`/providers/${mine.id}`)
  await expectH1(unverifiedPage, mine.name)
  await unverifiedPage.getByRole('button', { name: 'Request Service' }).click()
  const form = unverifiedPage.getByRole('dialog', { name: /Request / })
  await form.getByLabel('What do you need?').fill('An unverified e-mail must be told to verify first.')
  await form.getByLabel('Area / Location').fill('B-17')
  await form.getByLabel('Preferred Date').fill(tomorrow())
  await form.getByRole('button', { name: /Submit Request/ }).click()
  await expect(form.getByRole('alert').filter({ hasText: 'Please verify your email first' })).toBeVisible()
  await unverifiedPage.context().close()
})

test('13. "not found" is specific, and only the API\'s own not_found says it', async ({ browser }) => {
  const context = await newContext(browser)
  const page = await context.newPage()
  const missing = '00000000-0000-4000-8000-0000000000aa'
  await page.goto(`/providers/${missing}`)
  await expectH1(page, 'Provider not found')
  await page.goto(`/businesses/${missing}`)
  await expectH1(page, 'Business not found')
  await page.goto('/news/an-article-that-does-not-exist')
  await expectH1(page, 'Article not found')

  // A 404 that is not the API's envelope (a proxy, a wrong path) is an unexpected answer with a retry.
  await page.route(/\/api\/v1\/listings\//, (route) => route.fulfill({ status: 404, contentType: 'text/html', body: '<html>Cannot GET</html>' }))
  await page.goto(`/providers/${created.provider!.id}`)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Provider not found' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /try again|retry/i })).toBeVisible()
  await context.close()
})

test('14. no screen of the signed-in areas calls a working feature "coming soon", a prototype, or simulated', async ({ browser }) => {
  const stale = /coming soon|is coming\b|not available yet|isn't available yet|still being built|prototype|simulated/i
  const visit = async (user: TestUser, paths: string[]) => {
    const page = await signInAs(browser, user)
    for (const path of paths) {
      await page.goto(path)
      await expect(page.locator('main h1').first(), path).toBeVisible()
      await expect(page.locator('main'), path).not.toContainText(stale)
    }
    await page.context().close()
  }
  await visit(requester, ['/profile', '/profile/saved', '/profile/requests'])
  await visit(owner, ['/provider', '/provider/listings', '/provider/listings/new', '/provider/leads'])
  await visit(admin, ['/admin', '/admin/moderation', '/admin/categories'])
})

test.describe('375px: the changed forms and lists fit the screen and stay tappable', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  const fits = async (page: Page, label: string) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0)
  }
  // The listing forms' action buttons and fields are 44px tall on a phone (`h-11 md:h-8`); other buttons keep the design system's size.
  const tappable = async (locator: ReturnType<Page['locator']>, label: string, minHeight = 32) => {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    expect(box, `${label}: not rendered`).not.toBeNull()
    expect(box!.x, `${label}: left edge`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${label}: right edge`).toBeLessThanOrEqual(375.5)
    expect(box!.height, `${label}: touch height`).toBeGreaterThanOrEqual(minHeight)
  }

  test('create (provider and property), edit, dashboard, admin review and search refresh', async ({ browser }) => {
    const context = await newContext(browser, { viewport: { width: 375, height: 812 } })
    const page = await context.newPage()
    await loginOn(page, owner)

    // Provider create: Area, Block, Tags with its live counter, the image notice and the submit button.
    await openCreateForm(page, KIND.provider)
    await fits(page, 'provider create')
    await tappable(page.getByRole('combobox', { name: 'Area', exact: true }), 'Area', 36)
    await tappable(page.getByLabel(/Services offered/), 'Tags', 36)
    await page.getByLabel(/Services offered/).fill('a, b, c')
    await expect(page.getByText(/3 of 20/)).toBeVisible()
    await fits(page, 'provider create with tags')
    await tappable(page.getByText(/Image upload isn't available yet/), 'image notice', 16)
    await page.getByLabel('Visibility').selectOption('area_only')
    await page.getByLabel('Block (optional)').fill('C <b>')
    await expect(page.getByRole('alert').filter({ hasText: /letters, numbers, spaces/i })).toBeVisible()
    await fits(page, 'provider create with a block error')
    await tappable(page.getByRole('button', { name: 'Submit for Review' }), 'Submit for Review', 44)

    // Property create.
    await openCreateForm(page, KIND.property)
    await fits(page, 'property create')
    await tappable(page.getByRole('button', { name: 'Submit for Review' }), 'Submit for Review (property)', 44)

    // Edit (a created listing).
    await page.goto(`/provider/listings/${created.tutor!.id}/edit`)
    await expectH1(page, 'Edit Listing')
    await fits(page, 'edit')
    await tappable(page.getByRole('button', { name: 'Save Changes' }), 'Save Changes', 44)

    // Dashboard: the category lines are words and the cards fit.
    await page.goto('/provider/listings')
    await expectH1(page, 'Listings')
    await fits(page, 'dashboard')
    await expect(ownerCard(page, created.provider!.name)).toContainText('Solar')
    await context.close()

    // Admin review dialog.
    const adminContext = await newContext(browser, { viewport: { width: 375, height: 812 } })
    const adminPage = await adminContext.newPage()
    await loginOn(adminPage, admin)
    const dialog = await openReviewInUi(adminPage, created.tutor!.name)
    await fits(adminPage, 'admin review dialog')
    await expect(dialog).toContainText('Physics')
    await adminContext.close()

    // Search keeps its results while it refreshes, at phone width.
    const visitor = await newContext(browser, { viewport: { width: 375, height: 812 } })
    const searchPage = await visitor.newPage()
    const name = created.provider!.name
    await searchPage.goto(`/search?q=${encodeURIComponent(name)}`)
    await expect(searchPage.getByText(name).first()).toBeVisible()
    await fits(searchPage, 'search')
    await searchPage.route(/\/api\/v1\/search\?/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      await route.fallback()
    })
    const box = searchPage.getByRole('combobox', { name: 'Search B-17 Portal' })
    await box.fill(created.business!.name) // a DIFFERENT query (a trailing space would trim to the same one and ask nothing)
    await box.press('Enter')
    await expect(searchPage.getByText('Updating results…')).toBeVisible()
    await fits(searchPage, 'search while updating')
    await visitor.close()
  })
})

test('15. the public listing detail for a missing id and the read helper agree with the API (sanity of the harness)', async () => {
  expect((await publicGet(`/listings/00000000-0000-4000-8000-0000000000aa`)).status).toBe(404)
  expect(WEB_API).toContain('/api/v1')
  await ownerPage.context().close()
})
