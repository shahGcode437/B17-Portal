import { expect, test, type Page } from '@playwright/test'
import { ApiClient, createUser, expectH1, ownerCard, rows, scalar, signInAs, type TestUser, newContext } from './helpers/stack'
import { approveInUi, approvedProvider, createProvider, openReviewInUi, publicGet, rejectInUi, searchHits, takedownInUi, unique } from './helpers/ui'

/**
 * Journeys 10-15: Admin moderation, the material edit, the reject / resubmit cycle, pure privacy narrowing,
 * stale revisions (owner AND admin), archive and takedown - the real UI against FastAPI and PostgreSQL.
 */
test.describe.configure({ mode: 'serial' })

let owner: TestUser
let admin: TestUser
let ownerPage: Page
let adminPage: Page

const NAME = unique('Lifecycle Provider')
let id = ''
const REASON = 'Please add before-and-after photos of your installations.'

const dbListing = (listingId: string) => rows(`SELECT status, revision, description FROM listings WHERE id = '${listingId}'`)[0]!
const historyActions = (listingId: string) => scalar(`SELECT string_agg(action, ',' ORDER BY created_at, revision) FROM listing_status_history WHERE listing_id = '${listingId}'`)

test.beforeAll(async ({ browser }) => {
  owner = await createUser('lifecycle-owner', { professional: 'premium' })
  admin = await createUser('lifecycle-admin', { admin: true })
  ownerPage = await signInAs(browser, owner)
  adminPage = await signInAs(browser, admin)
})

test.afterAll(async () => {
  await ownerPage?.context().close()
  await adminPage?.context().close()
})

test('1. owner creates an exact Provider listing; the owner sees it Pending; the Admin queue sees it Pending', async () => {
  id = await createProvider(ownerPage, {
    name: NAME,
    category: 'Solar',
    description: 'Rooftop solar design and installation for B-17 homes and shops.',
    location: { visibility: 'exact', lat: 33.7011, lng: 73.0511, address: 'Shop 4, Demo Plaza', landmark: 'Next to the park', block: 'C' },
  })
  await expect(ownerCard(ownerPage, NAME)).toContainText('Pending Review')
  expect(dbListing(id).slice(0, 2)).toEqual(['pending', '1'])

  const dialog = await openReviewInUi(adminPage, NAME)
  await expect(dialog).toContainText('Pending Review')
  // The admin may review the PRIVATE location: address, landmark, block and the stored point.
  await expect(dialog.getByRole('region', { name: 'Location' })).toContainText('Shop 4, Demo Plaza')
  await expect(dialog.getByRole('region', { name: 'Location' })).toContainText('33.7011, 73.0511')
  await dialog.getByRole('button', { name: 'Close' }).first().click().catch(() => adminPage.keyboard.press('Escape'))
})

test('2. admin approves in the UI: approved, NO revision bump, a history row; owner and public see it', async ({ browser }) => {
  await approveInUi(adminPage, NAME)
  expect(dbListing(id).slice(0, 2)).toEqual(['approved', '1'])
  expect(historyActions(id)).toBe('submitted,approved')
  expect(scalar(`SELECT actor_role FROM listing_status_history WHERE listing_id = '${id}' AND action = 'approved'`)).toBe('admin')

  await ownerPage.reload()
  await ownerPage.goto('/provider/listings')
  await expect(ownerCard(ownerPage, NAME)).toContainText('Approved')

  // Public: found by search, detail loads with the subtype data and the EXACT public location.
  expect((await searchHits(NAME)).some((h) => h.id === id)).toBe(true)
  const detail = await publicGet(`/listings/${id}`)
  expect(detail.status).toBe(200)
  expect(detail.body.data.kind).toBe('provider')
  expect(detail.body.data.location).toMatchObject({ visibility: 'exact', address: 'Shop 4, Demo Plaza', landmark: 'Next to the park', block: 'C' })

  // A visitor's browser: the page renders, shows the address and offers directions.
  const visitor = await newContext(browser)
  const page = await visitor.newPage()
  const payloads: string[] = []
  page.on('response', async (r) => {
    if (r.url().includes('/api/v1/') && r.ok()) payloads.push(await r.text().catch(() => ''))
  })
  await page.goto(`http://127.0.0.1:5173/providers/${id}`)
  await expectH1(page, NAME)
  await expect(page.getByText('Shop 4, Demo Plaza').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /Get Directions/i }).or(page.getByRole('button', { name: /Get Directions/i })).first()).toBeVisible()
  const ownerId = scalar(`SELECT owner_id FROM listings WHERE id = '${id}'`)
  expect(payloads.join('\n')).not.toContain(ownerId) // no owner identity on a public page
  await visitor.close()
})

test('3. material edit of an approved listing: PATCH with the current revision -> pending, revision + 1, "Changes submitted for review"; not public while pending', async () => {
  const patches: { revision: number }[] = []
  ownerPage.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().includes('/api/v1/listings/')) patches.push(JSON.parse(r.postData() ?? '{}'))
  })
  await ownerPage.goto('/provider/listings')
  await ownerCard(ownerPage, NAME).getByRole('button', { name: 'Edit' }).click()
  await expectH1(ownerPage, 'Edit Listing')
  await expect(ownerPage.getByLabel('Name', { exact: true })).toHaveValue(NAME) // prefilled from the owner read
  await ownerPage.getByLabel('Description', { exact: true }).fill('Rooftop solar design and installation - now with inverter and battery storage options.')
  await ownerPage.getByRole('button', { name: 'Preview Listing' }).click()

  await expect(ownerPage.getByText('Changes submitted for review')).toBeVisible()
  await expectH1(ownerPage, 'Listings')
  await expect(ownerCard(ownerPage, NAME)).toContainText('Pending Review')
  await expect(ownerCard(ownerPage, NAME)).toContainText('revision 2')
  await expect(ownerCard(ownerPage, NAME)).not.toContainText(/Approved(?! )/)
  expect(patches).toHaveLength(1)
  expect(patches[0]!.revision).toBe(1)
  expect(dbListing(id).slice(0, 2)).toEqual(['pending', '2'])
  expect(historyActions(id)).toBe('submitted,approved,resubmitted')

  await ownerPage.reload()
  await expect(ownerCard(ownerPage, NAME)).toContainText('Pending Review')
  // Not shown as approved to the public while pending.
  expect((await publicGet(`/listings/${id}`)).status).toBe(404)
  expect((await searchHits(NAME)).some((h) => h.id === id)).toBe(false)
})

test('4. admin rejects with a reason; the owner sees that reason; public stays hidden', async () => {
  await rejectInUi(adminPage, NAME, REASON)
  expect(dbListing(id).slice(0, 2)).toEqual(['rejected', '2'])
  await ownerPage.goto('/provider/listings')
  await expect(ownerCard(ownerPage, NAME)).toContainText('Rejected')
  await expect(ownerCard(ownerPage, NAME)).toContainText(REASON)
  expect((await publicGet(`/listings/${id}`)).status).toBe(404)
})

test('5. rejected + submit unchanged -> no_changes: no false success, a useful message, nothing written', async () => {
  const revisionBefore = dbListing(id)[1]
  const historyBefore = historyActions(id)
  await ownerPage.goto('/provider/listings')
  await ownerCard(ownerPage, NAME).getByRole('button', { name: 'Edit' }).click()
  await expectH1(ownerPage, 'Edit Listing')
  await expect(ownerPage.getByText(new RegExp(`Rejected: ${REASON.slice(0, 20)}`))).toBeVisible()
  const [response] = await Promise.all([
    ownerPage.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/api/v1/listings/')),
    ownerPage.getByRole('button', { name: 'Preview Listing' }).click(),
  ])
  expect(response.status()).toBe(422)
  expect(JSON.stringify(await response.json())).toContain('no_changes')
  await expect(ownerPage.getByText('Please change at least one field before resubmitting.')).toBeVisible()
  await expect(ownerPage.getByText(/Changes submitted|Listing updated/)).toHaveCount(0)
  await expect(ownerPage).toHaveURL(/\/edit$/)
  expect(dbListing(id).slice(0, 2)).toEqual(['rejected', revisionBefore])
  expect(historyActions(id)).toBe(historyBefore)
})

test('6. rejected + a meaningful change -> pending, revision + 1, the stale reason is gone, the Admin queue sees it again; reload keeps it', async () => {
  await ownerPage.getByLabel('Description', { exact: true }).fill('Rooftop solar design and installation. Photo gallery of past installs available on request.')
  await ownerPage.getByRole('button', { name: 'Preview Listing' }).click()
  await expectH1(ownerPage, 'Listings')
  for (const reload of [false, true]) {
    if (reload) await ownerPage.reload()
    await expect(ownerCard(ownerPage, NAME)).toContainText('Pending Review')
    await expect(ownerCard(ownerPage, NAME)).toContainText('revision 3')
    await expect(ownerCard(ownerPage, NAME)).not.toContainText(REASON)
  }
  expect(dbListing(id).slice(0, 2)).toEqual(['pending', '3'])
  await adminPage.goto('/admin/moderation')
  await expect(adminPage.getByRole('button', { name: `Review ${NAME}` })).toBeVisible()
})

test('7. admin approves again; the public sees the UPDATED listing; history is chronological', async ({ browser }) => {
  await approveInUi(adminPage, NAME)
  expect(dbListing(id).slice(0, 2)).toEqual(['approved', '3'])
  const detail = await publicGet(`/listings/${id}`)
  expect(detail.status).toBe(200)
  expect(detail.body.data.description).toContain('Photo gallery')
  // The 12D/12E timestamp fix, observed on the real database: time order IS the story.
  expect(historyActions(id)).toBe('submitted,approved,resubmitted,rejected,resubmitted,approved')
  const times = rows(`SELECT created_at FROM listing_status_history WHERE listing_id = '${id}' ORDER BY created_at`).map((r) => r[0])
  expect(new Set(times).size).toBe(times.length)
  const visitor = await newContext(browser)
  const page = await visitor.newPage()
  await page.goto(`http://127.0.0.1:5173/providers/${id}`)
  await expectH1(page, NAME)
  await expect(page.getByText(/Photo gallery/)).toBeVisible()
  await visitor.close()
})

test('8. pure privacy narrowing (exact -> approximate, nothing else changed): stays approved, revision + 1, no history row, public narrows at once', async () => {
  const narrow = await approvedProvider(owner, admin, 'Narrowing Provider', { location: { visibility: 'exact', block: 'C', address: 'Shop 7, Narrow Plaza', landmark: 'Behind the clinic', latitude: 33.7011, longitude: 73.0511 } })
  const before = await publicGet(`/listings/${narrow.id}`)
  expect(before.body.data.location.coordinates).toMatchObject({ latitude: 33.7011, longitude: 73.0511, precision: 'exact' })
  expect(before.body.data.location.address).toBe('Shop 7, Narrow Plaza')
  const historyBefore = historyActions(narrow.id)

  await ownerPage.goto('/provider/listings')
  await ownerCard(ownerPage, narrow.name).getByRole('button', { name: 'Edit' }).click()
  await expectH1(ownerPage, 'Edit Listing')
  await ownerPage.getByLabel('Visibility').selectOption('approximate')
  await ownerPage.getByRole('button', { name: 'Preview Listing' }).click()
  await expectH1(ownerPage, 'Listings')

  expect(dbListing(narrow.id).slice(0, 2)).toEqual(['approved', String(narrow.revision + 1)])
  expect(historyActions(narrow.id)).toBe(historyBefore) // a narrowing writes no lifecycle row
  await expect(ownerCard(ownerPage, narrow.name)).toContainText('Approved')
  const after = await publicGet(`/listings/${narrow.id}`)
  expect(after.status).toBe(200)
  expect(after.body.data.location.visibility).toBe('approximate')
  expect(after.body.data.location.coordinates.precision).toBe('approximate')
  expect(after.body.data.location.address).toBeUndefined() // address and landmark are no longer public...
  expect(after.body.data.location.landmark).toBeUndefined()
  expect(JSON.stringify(after.body)).not.toContain('Narrow Plaza')
  expect(rows(`SELECT address, landmark FROM listings WHERE id = '${narrow.id}'`)[0]).toEqual(['Shop 7, Narrow Plaza', 'Behind the clinic']) // ...but kept privately
  expect(JSON.stringify(after.body)).not.toContain('33.7011') // the exact digits are gone from the public payload
  expect(JSON.stringify(after.body)).not.toContain('73.0511')
  // The owner's PRIVATE read keeps the point the owner typed.
  expect(rows(`SELECT latitude, longitude FROM listings WHERE id = '${narrow.id}'`)[0]).toEqual(['33.701100', '73.051100'])

  // Re-saving the narrowed listing UNCHANGED is a no-op (the form still carries the private address and landmark):
  // still approved, same revision - it does not fall back into moderation.
  const revisionAfterNarrowing = dbListing(narrow.id)[1]
  await ownerPage.goto(`/provider/listings/${narrow.id}/edit`)
  await expectH1(ownerPage, 'Edit Listing')
  await expect(ownerPage.getByLabel('Visibility')).toHaveValue('approximate')
  await ownerPage.getByRole('button', { name: 'Preview Listing' }).click()
  await expectH1(ownerPage, 'Listings')
  expect(dbListing(narrow.id).slice(0, 2)).toEqual(['approved', revisionAfterNarrowing])
  expect(rows(`SELECT address, landmark FROM listings WHERE id = '${narrow.id}'`)[0]).toEqual(['Shop 7, Narrow Plaza', 'Behind the clinic'])
})

test('9. stale owner revision: another update lands after the form opened -> 409, no overwrite, the form reloads with the newest state', async () => {
  const stale = await approvedProvider(owner, admin, 'Stale Owner Provider')
  await ownerPage.goto('/provider/listings')
  await ownerCard(ownerPage, stale.name).getByRole('button', { name: 'Edit' }).click()
  await expectH1(ownerPage, 'Edit Listing')
  await ownerPage.getByLabel('Description', { exact: true }).fill('The STALE edit from the open form - this text must never be saved.')

  // Someone else (the owner on another device) legitimately updates the listing first.
  const other = await ApiClient.create()
  await other.login(owner.email)
  const bumped = await other.call('PATCH', `/listings/${stale.id}`, { revision: stale.revision, description: 'The NEWER description saved from another device first.' })
  expect(bumped.status).toBe(200)
  await other.dispose()

  await ownerPage.getByRole('button', { name: 'Preview Listing' }).click()
  await expect(ownerPage.getByText(/changed since you opened it/i)).toBeVisible()
  await expect(ownerPage).toHaveURL(/\/edit$/) // never silently navigates away
  await expect(ownerPage.getByText(/Changes submitted|Listing updated/)).toHaveCount(0)
  expect(dbListing(stale.id)[2]).toContain('NEWER description') // nothing was overwritten
  // The form rehydrated from the latest revision.
  await expect(ownerPage.getByLabel('Description', { exact: true })).toHaveValue(/NEWER description/)
})

test('10. stale admin review: the owner edits after the admin opened the dialog -> 409, no stale decision is applied', async () => {
  const o = await ApiClient.create()
  await o.login(owner.email)
  const name = unique('Stale Admin Provider')
  const created = await o.call('POST', '/listings', {
    kind: 'provider', name, category: 'plumbing', description: `${name} - plumbing repairs across B-17.`, area: 'B-17', tags: ['plumbing'], location: { visibility: 'area_only' },
  })
  expect(created.status).toBe(201)
  const sid = created.body!.data.id as string

  const dialog = await openReviewInUi(adminPage, name) // the admin holds revision 1
  const bumped = await o.call('PATCH', `/listings/${sid}`, { revision: 1, description: `${name} - edited by the owner while the admin was reading.` })
  expect(bumped.status).toBe(200)
  expect(bumped.body!.data.revision).toBe(2)
  await o.dispose()

  await dialog.getByRole('button', { name: /^Approve$/ }).click()
  await expect(dialog.getByText(/changed since you opened it/i)).toBeVisible({ timeout: 15_000 })
  expect(dbListing(sid).slice(0, 2)).toEqual(['pending', '2']) // the stale approve did nothing
  expect(historyActions(sid)).toBe('submitted,resubmitted')
})

test('11. archive: owner archives in the UI -> archived (row kept), gone from public search and detail, persists after reload', async () => {
  const doomed = await approvedProvider(owner, admin, 'Archive Me Provider')
  expect((await publicGet(`/listings/${doomed.id}`)).status).toBe(200)
  ownerPage.once('dialog', (d) => void d.accept())
  await ownerPage.goto('/provider/listings')
  await ownerCard(ownerPage, doomed.name).getByRole('button', { name: 'Archive' }).click()
  await expect(ownerCard(ownerPage, doomed.name)).toContainText('Archived', { timeout: 15_000 })
  expect(dbListing(doomed.id)[0]).toBe('archived')
  expect(scalar(`SELECT count(*) FROM listings WHERE id = '${doomed.id}'`)).toBe('1') // not physically deleted
  expect((await publicGet(`/listings/${doomed.id}`)).status).toBe(404)
  expect((await searchHits(doomed.name)).some((h) => h.id === doomed.id)).toBe(false)
  await ownerPage.reload()
  await expect(ownerCard(ownerPage, doomed.name)).toContainText('Archived')
  await expect(ownerCard(ownerPage, doomed.name).getByRole('button', { name: 'Edit' })).toHaveCount(0)
})

test('12. takedown: admin takes an approved listing down with a reason -> public hidden, the owner sees Rejected and the reason', async () => {
  const taken = await approvedProvider(owner, admin, 'Takedown Provider')
  await takedownInUi(adminPage, taken.name, 'This listing no longer meets the community guidelines.')
  expect(dbListing(taken.id)[0]).toBe('rejected')
  expect((await publicGet(`/listings/${taken.id}`)).status).toBe(404)
  expect((await searchHits(taken.name)).some((h) => h.id === taken.id)).toBe(false)
  await ownerPage.goto('/provider/listings')
  await expect(ownerCard(ownerPage, taken.name)).toContainText('Rejected')
  await expect(ownerCard(ownerPage, taken.name)).toContainText('no longer meets the community guidelines')
})
